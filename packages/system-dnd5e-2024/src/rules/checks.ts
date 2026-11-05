import { resolveRollMode, rollD20, type Rng, type RollMode } from '@iron-scribe/dice';

import type { Ability } from '../catalog/schema.js';
import { rollEffects, type ConditionState } from './conditions.js';

export interface D20TestInput {
  readonly bonus: number;
  readonly dc: number;
  readonly conditions: ConditionState;
  readonly ability: Ability;
  readonly advantage?: boolean;
  readonly disadvantage?: boolean;
}

export interface CheckResult {
  readonly mode: RollMode;
  readonly rolls: readonly number[];
  readonly natural: number | null;
  readonly modifier: number;
  readonly total: number | null;
  readonly dc: number;
  readonly success: boolean;
  readonly autoFail: boolean;
}

function runTest(kind: 'check' | 'save', rng: Rng, input: D20TestInput): CheckResult {
  const effects = rollEffects({ kind, ability: input.ability, conditions: input.conditions });
  const mode = resolveRollMode({
    advantage: effects.advantage || input.advantage === true,
    disadvantage: effects.disadvantage || input.disadvantage === true,
  });
  const modifier = input.bonus - effects.penalty;
  if (effects.autoFail) {
    return {
      mode,
      rolls: [],
      natural: null,
      modifier,
      total: null,
      dc: input.dc,
      success: false,
      autoFail: true,
    };
  }
  const rolled = rollD20(rng, { mode, modifier });
  return {
    mode,
    rolls: rolled.rolls,
    natural: rolled.natural,
    modifier,
    total: rolled.total,
    dc: input.dc,
    success: rolled.total >= input.dc,
    autoFail: false,
  };
}

/** SRD 5.2.1, "Ability Checks": d20 + ability modifier (+ proficiency) vs DC. */
export function abilityCheck(rng: Rng, input: D20TestInput): CheckResult {
  return runTest('check', rng, input);
}

/** SRD 5.2.1, "Skills": same as an ability check, using the skill's bonus. */
export function skillCheck(rng: Rng, input: D20TestInput): CheckResult {
  return runTest('check', rng, input);
}

/** SRD 5.2.1, "Saving Throws": d20 + save bonus vs DC. */
export function savingThrow(rng: Rng, input: D20TestInput): CheckResult {
  return runTest('save', rng, input);
}
