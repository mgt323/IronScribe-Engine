import { resolveRollMode, rollD20, type Rng } from '@iron-scribe/dice';
import {
  EngineError,
  type Entity,
  type Fact,
  type GameState,
  type Resolution,
} from '@iron-scribe/engine-core';

import type { Catalog } from '../catalog/catalog.js';
import { readConditions, rollEffects } from './conditions.js';
import { readCreature } from './creature.js';

export interface EncounterOrderEntry {
  readonly entityId: string;
  readonly total: number;
}

/** Stored whole in `state.system.encounter`. `null` there means no encounter. */
export interface EncounterState {
  readonly round: number;
  readonly turnIndex: number;
  /** Actors that have finished their turn in this round. */
  readonly acted: readonly string[];
  readonly order: readonly EncounterOrderEntry[];
}

interface Member {
  readonly entityId: string;
  readonly name: string;
  readonly dex: number;
  readonly spawnIndex: number;
  readonly isCharacter: boolean;
  readonly bonus: number;
  readonly advantage: boolean;
  readonly disadvantage: boolean;
  readonly group: string | null;
}

function memberOf(
  entity: Entity,
  spawnIndex: number,
  surprised: ReadonlySet<string>,
  catalog: Catalog,
): Member {
  const view = readCreature(entity, catalog);
  const effects = rollEffects({ kind: 'initiative', conditions: readConditions(entity) });
  return {
    entityId: entity.id,
    name: view.name,
    dex: view.dexScore,
    spawnIndex,
    isCharacter: view.kind === 'character',
    bonus: view.initiativeBonus - effects.penalty,
    advantage: effects.advantage,
    disadvantage: effects.disadvantage || surprised.has(entity.id),
    group: view.kind === 'monster' ? entity.templateRef : null,
  };
}

/**
 * SRD 5.2.1, "Initiative": a Dexterity check. Surprised creatures roll with
 * disadvantage. Identical monsters (same `templateRef`) share one roll. Ties break
 * by higher Dexterity score, then the player character, then spawn order.
 * Only living, present creatures take part.
 */
export function rollInitiative(
  state: GameState,
  rng: Rng,
  surprised: readonly string[],
  catalog: Catalog,
): Resolution {
  for (const id of surprised) {
    if (!state.entities[id]) throw new EngineError('unknown_entity', `Unknown entity: ${id}`);
  }
  const surprisedIds = new Set(surprised);
  const members: Member[] = [];
  for (const [spawnIndex, entityId] of state.spawnOrder.entries()) {
    const entity = state.entities[entityId];
    if (!entity?.present || entity.hp.current <= 0) continue;
    members.push(memberOf(entity, spawnIndex, surprisedIds, catalog));
  }
  const groupRolls = new Map<string, { total: number; mode: string }>();
  const rolled = members.map((member) => {
    const shared = member.group === null ? undefined : groupRolls.get(member.group);
    if (shared) return { member, ...shared };
    const mates =
      member.group === null ? [member] : members.filter((m) => m.group === member.group);
    const mode = resolveRollMode({
      advantage: mates.every((m) => m.advantage),
      disadvantage: mates.some((m) => m.disadvantage),
    });
    const result = { total: rollD20(rng, { mode, modifier: member.bonus }).total, mode };
    if (member.group !== null) groupRolls.set(member.group, result);
    return { member, ...result };
  });
  rolled.sort(
    (a, b) =>
      b.total - a.total ||
      b.member.dex - a.member.dex ||
      Number(b.member.isCharacter) - Number(a.member.isCharacter) ||
      a.member.spawnIndex - b.member.spawnIndex,
  );
  const order = rolled.map(({ member, total }) => ({ entityId: member.entityId, total }));
  const facts: Fact[] = rolled.map(({ member, total, mode }) => ({
    key: 'initiative',
    text: mode === 'normal' ? `${member.name} ${total}` : `${member.name} ${total} (${mode})`,
  }));
  const encounter: EncounterState = { round: 1, turnIndex: 0, acted: [], order };
  return {
    events: [{ type: 'state.systemDataSet', key: 'encounter', value: encounter as never }],
    facts,
  };
}
