import type { Rng } from './rng.js';

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

export interface AdvantageFlags {
  readonly advantage: boolean;
  readonly disadvantage: boolean;
}

export interface D20RollOptions {
  readonly mode: RollMode;
  readonly modifier: number;
}

export interface D20RollResult {
  readonly mode: RollMode;
  readonly rolls: readonly number[];
  readonly natural: number;
  readonly modifier: number;
  readonly total: number;
}

/**
 * SRD: if circumstances give you both advantage and disadvantage, you have
 * neither. Multiple sources of the same do not stack.
 */
export function resolveRollMode(flags: AdvantageFlags): RollMode {
  if (flags.advantage && flags.disadvantage) {
    return 'normal';
  }
  if (flags.advantage) {
    return 'advantage';
  }
  if (flags.disadvantage) {
    return 'disadvantage';
  }
  return 'normal';
}

export function rollD20(rng: Rng, options: D20RollOptions): D20RollResult {
  const { mode, modifier } = options;

  if (mode === 'normal') {
    const natural = rng.int(1, 20);
    return {
      mode,
      rolls: [natural],
      natural,
      modifier,
      total: natural + modifier,
    };
  }

  const a = rng.int(1, 20);
  const b = rng.int(1, 20);
  const natural = mode === 'advantage' ? Math.max(a, b) : Math.min(a, b);
  return {
    mode,
    rolls: [a, b],
    natural,
    modifier,
    total: natural + modifier,
  };
}
