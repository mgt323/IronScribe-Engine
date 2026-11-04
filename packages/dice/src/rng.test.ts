import { describe, expect, it } from 'vitest';

import { createRng, createScriptedRng, restoreRng } from './rng.js';

describe('createRng', () => {
  it('produces the same sequence for the same numeric seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 8 }, () => a.nextUint32());
    const seqB = Array.from({ length: 8 }, () => b.nextUint32());
    expect(seqA).toEqual(seqB);
  });

  it('produces the same sequence for the same string seed', () => {
    const a = createRng('campaign-seed');
    const b = createRng('campaign-seed');
    expect(Array.from({ length: 5 }, () => a.int(1, 20))).toEqual(
      Array.from({ length: 5 }, () => b.int(1, 20)),
    );
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(Array.from({ length: 4 }, () => a.nextUint32())).not.toEqual(
      Array.from({ length: 4 }, () => b.nextUint32()),
    );
  });

  it('keeps int results within [min, max]', () => {
    const rng = createRng(99);
    for (let i = 0; i < 200; i += 1) {
      const n = rng.int(1, 6);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
    }
  });

  it('covers every d20 face with roughly even counts over many rolls', () => {
    const rng = createRng(2024);
    const counts = new Array<number>(21).fill(0);
    const rolls = 20_000;
    for (let i = 0; i < rolls; i += 1) {
      const face = rng.int(1, 20);
      counts[face] = (counts[face] ?? 0) + 1;
    }
    for (let face = 1; face <= 20; face += 1) {
      expect(counts[face]).toBeGreaterThan(0);
      // Loose bound: expected ~1000; allow 500..1500
      expect(counts[face]).toBeGreaterThan(500);
      expect(counts[face]).toBeLessThan(1500);
    }
  });
});

describe('restoreRng', () => {
  it('continues the identical sequence from a saved state', () => {
    const original = createRng(12345);
    original.int(1, 20);
    original.int(1, 20);
    const state = original.getState();
    const nextFromOriginal = [original.int(1, 6), original.int(1, 6), original.int(1, 6)];

    const restored = restoreRng(state);
    expect([restored.int(1, 6), restored.int(1, 6), restored.int(1, 6)]).toEqual(nextFromOriginal);
  });
});

describe('createScriptedRng', () => {
  it('returns the given die faces in order', () => {
    const rng = createScriptedRng([3, 5, 17]);
    expect(rng.int(1, 6)).toBe(3);
    expect(rng.int(1, 6)).toBe(5);
    expect(rng.int(1, 20)).toBe(17);
  });

  it('throws when exhausted', () => {
    const rng = createScriptedRng([1]);
    expect(rng.int(1, 6)).toBe(1);
    expect(() => rng.int(1, 6)).toThrow(/exhausted/i);
  });
});
