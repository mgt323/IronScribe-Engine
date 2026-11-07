import { resolveRollMode, rollD20, type Rng } from '@iron-scribe/dice';
import {
  applyEvents,
  EngineError,
  type Entity,
  type Fact,
  type GameState,
  type Resolution,
} from '@iron-scribe/engine-core';

import type { Catalog } from '../catalog/catalog.js';
import { readEncounter } from './combat.js';
import { readConditions, rollEffects } from './conditions.js';
import { readCreature } from './creature.js';
import type { EncounterOrderEntry, EncounterState } from './initiative.js';

interface Rank {
  readonly entityId: string;
  readonly name: string;
  readonly total: number;
  readonly dex: number;
  readonly isCharacter: boolean;
  readonly spawnIndex: number;
  readonly fresh: boolean;
  readonly mode: string;
}

function earlier(a: Rank, b: Rank): number {
  return (
    b.total - a.total ||
    b.dex - a.dex ||
    Number(b.isCharacter) - Number(a.isCharacter) ||
    a.spawnIndex - b.spawnIndex
  );
}

function rankOf(
  state: GameState,
  entity: Entity,
  total: number,
  mode: string,
  fresh: boolean,
  catalog: Catalog,
): Rank {
  const view = readCreature(entity, catalog);
  return {
    entityId: entity.id,
    name: view.name,
    total,
    dex: view.dexScore,
    isCharacter: view.kind === 'character',
    spawnIndex: state.spawnOrder.indexOf(entity.id),
    fresh,
    mode,
  };
}

/**
 * Inserts engaged creatures who are not yet in the order. A `templateRef` already
 * in the order keeps that roll (group initiative). Anyone inserted before the
 * current turn is marked acted, and `turnIndex` stays on the same creature.
 */
export function joinEncounter(
  state: GameState,
  rng: Rng,
  entityIds: readonly string[],
  catalog: Catalog,
): Resolution {
  const encounter = readEncounter(state);
  if (!encounter) throw new EngineError('invalid_combat_state', 'No active encounter');
  const already = new Set(encounter.order.map((entry) => entry.entityId));
  const joining: Entity[] = [];
  for (const id of entityIds) {
    const entity = state.entities[id];
    if (!entity) throw new EngineError('unknown_entity', `Unknown entity: ${id}`);
    if (entity.proximity !== 'engaged' || entity.hp.current <= 0 || already.has(id)) continue;
    joining.push(entity);
  }
  if (joining.length === 0) return { events: [], facts: [] };

  const groupTotal = new Map<string, number>();
  for (const entry of encounter.order) {
    const group = state.entities[entry.entityId]?.templateRef;
    if (group && !groupTotal.has(group)) groupTotal.set(group, entry.total);
  }
  const rolled = new Map<string, { total: number; mode: string }>();
  const fresh: Rank[] = joining.map((entity) => {
    const group = entity.templateRef;
    const shared = group ? groupTotal.get(group) : undefined;
    if (shared !== undefined) return rankOf(state, entity, shared, 'group', true, catalog);
    const pending = group ? rolled.get(group) : undefined;
    if (pending) return rankOf(state, entity, pending.total, pending.mode, true, catalog);
    const mates = group ? joining.filter((other) => other.templateRef === group) : [entity];
    const mode = resolveRollMode({
      advantage: mates.every(
        (mate) => rollEffects({ kind: 'initiative', conditions: readConditions(mate) }).advantage,
      ),
      disadvantage: mates.some(
        (mate) =>
          rollEffects({ kind: 'initiative', conditions: readConditions(mate) }).disadvantage,
      ),
    });
    const bonus = readCreature(entity, catalog).initiativeBonus;
    const result = { total: rollD20(rng, { mode, modifier: bonus }).total, mode };
    if (group) rolled.set(group, result);
    return rankOf(state, entity, result.total, result.mode, true, catalog);
  });

  const standing: Rank[] = encounter.order.flatMap((entry) => {
    const entity = state.entities[entry.entityId];
    if (!entity) return [];
    return [rankOf(state, entity, entry.total, 'normal', false, catalog)];
  });
  // Keep the existing order. Newcomers slot in where their total belongs.
  const pending = [...fresh].sort(earlier);
  const order: Rank[] = [];
  let cursor = 0;
  for (const entry of standing) {
    while (cursor < pending.length) {
      const rank = pending[cursor];
      if (!rank || earlier(rank, entry) >= 0) break;
      order.push(rank);
      cursor += 1;
    }
    order.push(entry);
  }
  for (const rank of pending.slice(cursor)) order.push(rank);
  const currentId =
    encounter.turnIndex < encounter.order.length
      ? encounter.order[encounter.turnIndex]?.entityId
      : undefined;
  const acted = new Set(encounter.acted);
  let turnIndex: number;
  if (currentId === undefined) {
    turnIndex = order.length;
    for (const rank of fresh) acted.add(rank.entityId);
  } else {
    turnIndex = order.findIndex((rank) => rank.entityId === currentId);
    for (const rank of fresh) {
      const index = order.findIndex((entry) => entry.entityId === rank.entityId);
      if (index < turnIndex) acted.add(rank.entityId);
    }
  }
  const next: EncounterState = {
    ...encounter,
    turnIndex,
    acted: [...acted],
    order: order.map((rank): EncounterOrderEntry => ({
      entityId: rank.entityId,
      total: rank.total,
    })),
  };
  const facts: Fact[] = fresh.map((rank) => ({
    key: 'initiative',
    text:
      rank.mode === 'normal' || rank.mode === 'group'
        ? `${rank.name} joins at ${String(rank.total)}`
        : `${rank.name} joins at ${String(rank.total)} (${rank.mode})`,
  }));
  return {
    events: [{ type: 'state.systemDataSet', key: 'encounter', value: next as never }],
    facts,
  };
}

/** Living nearby hostiles become engaged and join the current order. */
export function engageNearbyHostiles(state: GameState, rng: Rng, catalog: Catalog): Resolution {
  const encounter = readEncounter(state);
  if (!encounter) return { events: [], facts: [] };
  const ids = state.spawnOrder.filter((id) => {
    const entity = state.entities[id];
    return (
      entity?.proximity === 'nearby' &&
      entity.hp.current > 0 &&
      entity.system['attitude'] === 'hostile'
    );
  });
  if (ids.length === 0) return { events: [], facts: [] };
  const presence = ids.map((id) => ({
    type: 'entity.presenceSet' as const,
    entityId: id,
    proximity: 'engaged' as const,
  }));
  const joined = joinEncounter(applyEvents(state, presence), rng, ids, catalog);
  return { events: [...presence, ...joined.events], facts: joined.facts };
}
