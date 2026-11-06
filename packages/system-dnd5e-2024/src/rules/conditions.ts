import type { CoreEvent, Entity } from '@iron-scribe/engine-core';
import { z } from 'zod';

import type { Ability } from '../catalog/schema.js';

export const ConditionState = z.strictObject({
  ids: z.array(z.string()),
  exhaustion: z.number().int().min(0).max(6),
});
export type ConditionState = z.infer<typeof ConditionState>;

export const NO_CONDITIONS: ConditionState = { ids: [], exhaustion: 0 };

export type ConditionChange =
  | { readonly op: 'add'; readonly id: string }
  | { readonly op: 'remove'; readonly id: string }
  | { readonly op: 'setExhaustion'; readonly level: number };

export interface RollEffects {
  readonly advantage: boolean;
  readonly disadvantage: boolean;
  /** Subtracted from a D20 Test. Exhaustion is −2 per level (SRD 2024). */
  readonly penalty: number;
  readonly autoFail: boolean;
  /** A hit is a critical hit (paralyzed or unconscious, melee, within 5 feet). */
  readonly autoCrit: boolean;
}

export type RollSituation =
  | {
      readonly kind: 'check' | 'save';
      readonly ability: Ability;
      readonly conditions: ConditionState;
    }
  | { readonly kind: 'initiative'; readonly conditions: ConditionState }
  | {
      readonly kind: 'attack';
      readonly attackKind: 'melee' | 'ranged';
      readonly attacker: ConditionState;
      readonly target: ConditionState;
    };

interface Flags {
  readonly blinded: boolean;
  readonly invisible: boolean;
  readonly poisoned: boolean;
  readonly prone: boolean;
  readonly restrained: boolean;
  readonly paralyzed: boolean;
  readonly stunned: boolean;
  readonly unconscious: boolean;
  readonly incapacitated: boolean;
}

/** Unconscious includes Prone and Incapacitated. Paralyzed and Stunned include Incapacitated. */
function flags(state: ConditionState): Flags {
  const has = (id: string) => state.ids.includes(id);
  const unconscious = has('unconscious');
  const paralyzed = has('paralyzed');
  const stunned = has('stunned');
  return {
    blinded: has('blinded'),
    invisible: has('invisible'),
    poisoned: has('poisoned'),
    prone: has('prone') || unconscious,
    restrained: has('restrained'),
    paralyzed,
    stunned,
    unconscious,
    incapacitated: has('incapacitated') || unconscious || paralyzed || stunned,
  };
}

export function isIncapacitated(state: ConditionState): boolean {
  return flags(state).incapacitated;
}

export function readConditions(entity: Entity): ConditionState {
  const raw = entity.system['conditions'];
  if (raw === undefined) return NO_CONDITIONS;
  return ConditionState.parse(raw);
}

/** Writes `entity.system.conditions`. Immune or unchanged requests emit nothing. */
export function conditionEvents(
  entity: Entity,
  change: ConditionChange,
  immunities: readonly string[],
): CoreEvent[] {
  const current = readConditions(entity);
  let next: ConditionState;
  if (change.op === 'add') {
    if (immunities.includes(change.id) || current.ids.includes(change.id)) return [];
    next = { ids: [...current.ids, change.id], exhaustion: current.exhaustion };
  } else if (change.op === 'remove') {
    if (!current.ids.includes(change.id)) return [];
    next = { ids: current.ids.filter((id) => id !== change.id), exhaustion: current.exhaustion };
  } else {
    if (immunities.includes('exhaustion') || change.level === current.exhaustion) return [];
    if (!Number.isInteger(change.level) || change.level < 0 || change.level > 6) {
      throw new Error(`invalid exhaustion: ${String(change.level)}`);
    }
    next = { ids: [...current.ids], exhaustion: change.level };
  }
  if (next.exhaustion === 6) return exhaustionDeath(entity, next);
  return [{ type: 'entity.systemDataSet', entityId: entity.id, key: 'conditions', value: next }];
}

/** SRD 5.2.1, "Exhaustion": level 6 is death. A character is unconscious and dead; any creature is at 0 HP. */
function exhaustionDeath(entity: Entity, next: ConditionState): CoreEvent[] {
  const isCharacter = entity.system['character'] !== undefined;
  const ids =
    isCharacter && !next.ids.includes('unconscious') ? [...next.ids, 'unconscious'] : next.ids;
  const events: CoreEvent[] = [
    {
      type: 'entity.systemDataSet',
      entityId: entity.id,
      key: 'conditions',
      value: { ids, exhaustion: 6 },
    },
  ];
  if (entity.hp.current > 0) {
    events.push({ type: 'entity.damaged', entityId: entity.id, amount: entity.hp.current });
  }
  if (isCharacter) {
    events.push({
      type: 'entity.systemDataSet',
      entityId: entity.id,
      key: 'deathSaves',
      value: { successes: 0, failures: 3, stable: false, dead: true },
    });
  }
  return events;
}

function attackEffects(situation: Extract<RollSituation, { kind: 'attack' }>): RollEffects {
  const attacker = flags(situation.attacker);
  const target = flags(situation.target);
  let advantage = false;
  let disadvantage = false;
  if (attacker.blinded || attacker.poisoned || attacker.prone || attacker.restrained) {
    disadvantage = true;
  }
  if (attacker.invisible) advantage = true;
  if (
    target.blinded ||
    target.restrained ||
    target.paralyzed ||
    target.stunned ||
    target.unconscious
  ) {
    advantage = true;
  }
  if (target.invisible) disadvantage = true;
  // Theater of the mind: melee is within 5 feet, ranged is not. Unconscious includes Prone.
  if (target.prone) {
    if (situation.attackKind === 'melee') advantage = true;
    else disadvantage = true;
  }
  const autoCrit = situation.attackKind === 'melee' && (target.paralyzed || target.unconscious);
  return {
    advantage,
    disadvantage,
    penalty: situation.attacker.exhaustion * 2,
    autoFail: false,
    autoCrit,
  };
}

function testEffects(situation: Exclude<RollSituation, { kind: 'attack' }>): RollEffects {
  const state = flags(situation.conditions);
  let advantage = false;
  let disadvantage = false;
  let autoFail = false;
  if ((situation.kind === 'check' || situation.kind === 'initiative') && state.poisoned) {
    disadvantage = true;
  }
  if (situation.kind === 'initiative' && state.invisible) advantage = true;
  if (situation.kind === 'save') {
    if (state.restrained && situation.ability === 'dex') disadvantage = true;
    const helpless = state.paralyzed || state.stunned || state.unconscious;
    if (helpless && (situation.ability === 'str' || situation.ability === 'dex')) autoFail = true;
  }
  return {
    advantage,
    disadvantage,
    penalty: situation.conditions.exhaustion * 2,
    autoFail,
    autoCrit: false,
  };
}

/** Advantage and disadvantage are flags: several sources of one do not stack. */
export function rollEffects(situation: RollSituation): RollEffects {
  return situation.kind === 'attack' ? attackEffects(situation) : testEffects(situation);
}
