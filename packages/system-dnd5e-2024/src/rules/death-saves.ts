import type { CoreEvent, Entity, EntityId, Fact, Procedure } from '@iron-scribe/engine-core';
import { z } from 'zod';

import { conditionEvents } from './conditions.js';

/**
 * SRD 5.2.1, "Dropping to 0 Hit Points" and "Death Saving Throws". Stored in
 * `entity.system.deathSaves` of a character. `null` or absent means "not dying".
 */
export const DeathSaveState = z.strictObject({
  successes: z.number().int().min(0).max(3),
  failures: z.number().int().min(0).max(3),
  stable: z.boolean(),
  dead: z.boolean(),
});
export type DeathSaveState = z.infer<typeof DeathSaveState>;

export const FRESH_DEATH_SAVES: DeathSaveState = {
  successes: 0,
  failures: 0,
  stable: false,
  dead: false,
};

export interface Outcome {
  readonly events: CoreEvent[];
  readonly facts: Fact[];
}

export function readDeathSaves(entity: Entity | undefined): DeathSaveState | null {
  const raw = entity?.system['deathSaves'];
  if (raw === undefined || raw === null) return null;
  return DeathSaveState.parse(raw);
}

export function isDead(entity: Entity | undefined): boolean {
  return readDeathSaves(entity)?.dead === true;
}

/** Unconscious at 0 HP, not stable, not dead: the character rolls a Death Saving Throw each turn. */
export function isDying(entity: Entity | undefined): boolean {
  if (!entity || entity.system['character'] === undefined || entity.hp.current > 0) return false;
  const state = readDeathSaves(entity);
  return state !== null && !state.dead && !state.stable;
}

export function setDeathSaves(entityId: EntityId, value: DeathSaveState | null): CoreEvent {
  return { type: 'entity.systemDataSet', entityId, key: 'deathSaves', value: value as never };
}

/** The player's whole turn while dying: a Death Saving Throw (no action menu, no model call). */
export function dndPlayerTurnProcedure(
  state: { readonly entities: Readonly<Record<string, Entity>> },
  actorId: EntityId,
): Procedure | null {
  return isDying(state.entities[actorId]) ? { kind: 'deathSave', actorId } : null;
}

/**
 * Damage that reached a character (after defenses, `total` > 0).
 * - At 0 HP: one death save failure (two on a critical hit), stable resets; three kill.
 * - Reduced to 0 with the remainder at or above the hit point maximum: instant death.
 * - Otherwise reduced to 0: Unconscious and a fresh death save tally.
 */
export function downedOutcome(
  defender: Entity,
  immunities: readonly string[],
  hit: { readonly total: number; readonly critical: boolean },
): Outcome {
  const none: Outcome = { events: [], facts: [] };
  const id = defender.id;
  const state = readDeathSaves(defender);
  if (state?.dead) return none;
  const before = defender.hp.current;
  if (before === 0) {
    const failures = Math.min(3, (state?.failures ?? 0) + (hit.critical ? 2 : 1));
    const dead = failures >= 3;
    const next: DeathSaveState = {
      successes: state?.successes ?? 0,
      failures,
      stable: false,
      dead,
    };
    const facts: Fact[] = [
      { key: 'death_save', text: `${id} takes damage at 0 HP (${String(failures)}/3 failures)` },
    ];
    if (dead) facts.push({ key: 'dead', text: `${id} dies` });
    return { events: [setDeathSaves(id, next)], facts };
  }
  if (before - hit.total > 0) return none;
  const unconscious = conditionEvents(defender, { op: 'add', id: 'unconscious' }, immunities);
  const facts: Fact[] = [{ key: 'condition', text: `${id} unconscious` }];
  if (hit.total - before >= defender.hp.max) {
    facts.push({ key: 'dead', text: `${id} dies (massive damage)` });
    const next: DeathSaveState = { successes: 0, failures: 3, stable: false, dead: true };
    return { events: [...unconscious, setDeathSaves(id, next)], facts };
  }
  return { events: [...unconscious, setDeathSaves(id, FRESH_DEATH_SAVES)], facts };
}

/**
 * Healing. A living character at 0 HP who regains HP wakes up and stops dying.
 * The dead are not healed here (Revivify-style magic is not modelled).
 */
export function healEvents(entity: Entity, amount: number): Outcome {
  if (amount <= 0 || isDead(entity)) return { events: [], facts: [] };
  const id = entity.id;
  const after = Math.min(entity.hp.max, entity.hp.current + amount);
  const events: CoreEvent[] = [{ type: 'entity.healed', entityId: id, amount }];
  const facts: Fact[] = [{ key: 'heal', text: `${id} regains ${String(amount)} HP` }];
  if (entity.hp.current === 0 && entity.system['character'] !== undefined) {
    events.push(...conditionEvents(entity, { op: 'remove', id: 'unconscious' }, []));
    events.push(setDeathSaves(id, null));
    facts.push({ key: 'condition', text: `${id} regains consciousness` });
  }
  facts.push({ key: 'hp', text: `${id} ${String(after)}/${String(entity.hp.max)}` });
  return { events, facts };
}

/** Sets an exhaustion level. Level 6 is death (see `conditionEvents`). */
export function exhaustionOutcome(
  entity: Entity,
  level: number,
  immunities: readonly string[],
): Outcome {
  const events = conditionEvents(entity, { op: 'setExhaustion', level }, immunities);
  const facts: Fact[] =
    level === 6 && events.length > 0
      ? [{ key: 'dead', text: `${entity.id} dies of exhaustion` }]
      : [];
  return { events, facts };
}
