import {
  type ConstantTerm,
  type DiceFormula,
  type DiceTerm,
  formatFormula,
  parseFormula,
} from './formula.js';
import type { Rng } from './rng.js';

export interface RollOptions {
  /** Roll each dice term twice as many times; leave constants alone (SRD 2024 crit). */
  readonly critical?: boolean;
}

export interface DiceRollTerm {
  readonly kind: 'dice';
  readonly sign: 1 | -1;
  readonly count: number;
  readonly sides: number;
  readonly rolls: readonly number[];
  readonly kept: readonly number[];
}

export interface ConstantRollTerm {
  readonly kind: 'constant';
  readonly sign: 1 | -1;
  readonly value: number;
}

export type RollTerm = DiceRollTerm | ConstantRollTerm;

export interface RollResult {
  readonly formula: string;
  readonly total: number;
  readonly terms: readonly RollTerm[];
}

function keepDice(rolls: readonly number[], keep: DiceTerm['keep']): readonly number[] {
  if (!keep) {
    return rolls;
  }
  // Rank by value, then take the keep.count best indices, restoring roll order.
  const indexed = rolls.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => (keep.mode === 'highest' ? b.value - a.value : a.value - b.value));
  const selected = indexed
    .slice(0, Math.min(keep.count, indexed.length))
    .sort((a, b) => a.index - b.index);
  return selected.map((entry) => entry.value);
}

function rollDiceTerm(term: DiceTerm, rng: Rng, critical: boolean): DiceRollTerm {
  const count = critical ? term.count * 2 : term.count;
  const rolls: number[] = [];
  for (let i = 0; i < count; i += 1) {
    rolls.push(rng.int(1, term.sides));
  }
  // On a critical, keep applies to the doubled pool if present.
  const keep =
    term.keep && critical ? { mode: term.keep.mode, count: term.keep.count * 2 } : term.keep;
  const kept = keepDice(rolls, keep);
  return {
    kind: 'dice',
    sign: term.sign,
    count,
    sides: term.sides,
    rolls,
    kept,
  };
}

function rollConstantTerm(term: ConstantTerm): ConstantRollTerm {
  return {
    kind: 'constant',
    sign: term.sign,
    value: term.value,
  };
}

function termContribution(term: RollTerm): number {
  if (term.kind === 'constant') {
    return term.sign * term.value;
  }
  let sum = 0;
  for (const face of term.kept) {
    sum += face;
  }
  return term.sign * sum;
}

export function roll(formula: string | DiceFormula, rng: Rng, options?: RollOptions): RollResult {
  const parsed = typeof formula === 'string' ? parseFormula(formula) : formula;
  const critical = options?.critical === true;
  const terms: RollTerm[] = [];

  for (const term of parsed.terms) {
    if (term.kind === 'dice') {
      terms.push(rollDiceTerm(term, rng, critical));
    } else {
      terms.push(rollConstantTerm(term));
    }
  }

  let total = 0;
  for (const term of terms) {
    total += termContribution(term);
  }

  return {
    formula: formatFormula(parsed),
    total,
    terms,
  };
}
