import { roll, type Rng } from '@iron-scribe/dice';
import {
  EngineError,
  type CoreEvent,
  type Entity,
  type Fact,
  type GameState,
  type Resolution,
} from '@iron-scribe/engine-core';
import { z } from 'zod';

import { readMonsterSnapshot } from '../catalog/spawn.js';
import type { MonsterAction } from '../catalog/schema-monster.js';
import type { EncounterState } from './initiative.js';

/**
 * Limited monster actions, in `entity.system.usage`. A recharge or per-rest action is
 * `expended` once used; a per-day action counts uses. A recharge action is rolled for at
 * the start of its owner's turn (`runRecharge`); a per-rest action stays expended.
 */
export const UsageState = z.strictObject({
  expended: z.array(z.string()),
  counts: z.record(z.string(), z.number().int().min(0)),
});
export type UsageState = z.infer<typeof UsageState>;

export function readUsage(entity: Entity): UsageState {
  const raw = entity.system['usage'];
  return raw === undefined || raw === null ? { expended: [], counts: {} } : UsageState.parse(raw);
}

/** False once a limited action has no uses left. Unlimited actions are always available. */
export function isActionAvailable(entity: Entity, action: MonsterAction): boolean {
  const usage = action.usage;
  if (!usage) return true;
  const state = readUsage(entity);
  if (usage.type === 'perDay') return (state.counts[action.id] ?? 0) < (usage.times ?? 1);
  return !state.expended.includes(action.id);
}

/** The event that records one use, or none for an unlimited action. */
export function useActionEvents(entity: Entity, action: MonsterAction): CoreEvent[] {
  const usage = action.usage;
  if (!usage) return [];
  const state = readUsage(entity);
  const next: UsageState =
    usage.type === 'perDay'
      ? { ...state, counts: { ...state.counts, [action.id]: (state.counts[action.id] ?? 0) + 1 } }
      : { ...state, expended: [...new Set([...state.expended, action.id])] };
  return [{ type: 'entity.systemDataSet', entityId: entity.id, key: 'usage', value: next }];
}

/** Expended recharge actions of a monster, in stat block order. */
export function expendedRecharges(entity: Entity): MonsterAction[] {
  if (entity.system['monster'] === undefined) return [];
  const { expended } = readUsage(entity);
  return readMonsterSnapshot(entity).actions.filter(
    (action) => action.usage?.type === 'recharge' && expended.includes(action.id),
  );
}

/**
 * Start of an NPC's turn (SRD 5.2.1, Monsters: Recharge): roll a d6 for each expended
 * recharge action; at or above its minimum it is ready again. Marks the actor in
 * `encounter.recharged` so the roll happens once per turn (`advanceTurn` clears it).
 */
export function runRecharge(state: GameState, actorId: string, rng: Rng): Resolution {
  const actor = state.entities[actorId];
  if (!actor) throw new EngineError('unknown_entity', `Unknown entity: ${actorId}`);
  const usage = readUsage(actor);
  const facts: Fact[] = [];
  let expended = usage.expended;
  for (const action of expendedRecharges(actor)) {
    const min = action.usage?.min ?? 6;
    const die = roll('1d6', rng).total;
    const ready = die >= min;
    if (ready) expended = expended.filter((id) => id !== action.id);
    facts.push({
      key: 'recharge',
      text: `${actor.name} ${action.name} recharge d6=${String(die)} (needs ${String(min)}+): ${ready ? 'recharged' : 'not recharged'}`,
    });
  }
  const encounter = state.system['encounter'] as unknown as EncounterState | null | undefined;
  const events: CoreEvent[] = [];
  if (expended.length !== usage.expended.length) {
    events.push({
      type: 'entity.systemDataSet',
      entityId: actorId,
      key: 'usage',
      value: { ...usage, expended },
    });
  }
  if (encounter) {
    const recharged = [...(encounter.recharged ?? []), actorId];
    events.push({
      type: 'state.systemDataSet',
      key: 'encounter',
      value: { ...encounter, recharged } as never,
    });
  }
  return { events, facts };
}
