/** Injectable random source. Callers never use Math.random. */
export interface Rng {
  /** Next unsigned 32-bit value in [0, 2^32). */
  nextUint32(): number;
  /** Inclusive integer in [min, max]. */
  int(min: number, max: number): number;
  /** Opaque serializable state for replay / undo. */
  getState(): RngState;
}

export interface RngState {
  readonly algorithm: 'mulberry32';
  readonly seed: number;
}

export class ScriptedRngExhaustedError extends Error {
  constructor() {
    super('Scripted RNG exhausted');
    this.name = 'ScriptedRngExhaustedError';
  }
}

const UINT32_MASK = 0xffff_ffff;

function toUint32(n: number): number {
  return n >>> 0;
}

/** FNV-1a 32-bit hash of a UTF-16 string. */
export function hashSeed(text: string): number {
  let hash = 0x811c_9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return toUint32(hash);
}

function normalizeSeed(seed: number | string): number {
  if (typeof seed === 'string') {
    return hashSeed(seed);
  }
  if (!Number.isFinite(seed)) {
    throw new RangeError('RNG seed must be a finite number or a string');
  }
  return toUint32(seed);
}

function makeMulberry32(initial: number): Rng {
  let state = toUint32(initial);

  const nextUint32 = (): number => {
    state = toUint32(state + 0x6d2b_79f5);
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return toUint32(t ^ (t >>> 14));
  };

  const int = (min: number, max: number): number => {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new RangeError('RNG int bounds must be integers');
    }
    if (max < min) {
      throw new RangeError(`RNG int max (${max}) must be >= min (${min})`);
    }
    const span = max - min + 1;
    if (span <= 0 || span > UINT32_MASK) {
      throw new RangeError(`RNG int span must be in 1..${UINT32_MASK}`);
    }
    // Rejection sampling: unbiased over [0, span).
    const limit = UINT32_MASK - (UINT32_MASK % span);
    let x = nextUint32();
    while (x >= limit) {
      x = nextUint32();
    }
    return min + (x % span);
  };

  return {
    nextUint32,
    int,
    getState: (): RngState => ({ algorithm: 'mulberry32', seed: state }),
  };
}

export function createRng(seed: number | string): Rng {
  return makeMulberry32(normalizeSeed(seed));
}

export function restoreRng(state: RngState): Rng {
  if (state.algorithm !== 'mulberry32') {
    throw new Error(`Unknown RNG algorithm: ${String(state.algorithm)}`);
  }
  return makeMulberry32(state.seed);
}

/**
 * Returns the given values from `int` in order. Used in tests so a die face
 * can be forced (e.g. "the d20 shows 17"). Throws once exhausted.
 */
export function createScriptedRng(values: readonly number[]): Rng {
  let index = 0;
  let stateSeed = 0;

  return {
    nextUint32(): number {
      if (index >= values.length) {
        throw new ScriptedRngExhaustedError();
      }
      const value = values[index];
      index += 1;
      if (value === undefined) {
        throw new ScriptedRngExhaustedError();
      }
      stateSeed = toUint32(value);
      return stateSeed;
    },
    int(min: number, max: number): number {
      if (index >= values.length) {
        throw new ScriptedRngExhaustedError();
      }
      const value = values[index];
      index += 1;
      if (value === undefined) {
        throw new ScriptedRngExhaustedError();
      }
      if (!Number.isInteger(value) || value < min || value > max) {
        throw new RangeError(
          `Scripted RNG value ${String(value)} is outside requested range [${String(min)}, ${String(max)}]`,
        );
      }
      stateSeed = toUint32(value);
      return value;
    },
    getState(): RngState {
      return { algorithm: 'mulberry32', seed: stateSeed };
    },
  };
}
