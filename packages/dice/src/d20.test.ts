import { describe, expect, it } from 'vitest';

import { resolveRollMode, rollD20 } from './d20.js';
import { createScriptedRng } from './rng.js';

describe('resolveRollMode', () => {
  it('returns advantage when only advantage is set', () => {
    expect(resolveRollMode({ advantage: true, disadvantage: false })).toBe('advantage');
  });

  it('returns disadvantage when only disadvantage is set', () => {
    expect(resolveRollMode({ advantage: false, disadvantage: true })).toBe('disadvantage');
  });

  it('returns normal when neither is set', () => {
    expect(resolveRollMode({ advantage: false, disadvantage: false })).toBe('normal');
  });

  it('returns normal when both are set (SRD: having both means neither)', () => {
    expect(resolveRollMode({ advantage: true, disadvantage: true })).toBe('normal');
  });
});

describe('rollD20', () => {
  it('keeps the higher die with advantage', () => {
    const rng = createScriptedRng([8, 17]);
    const result = rollD20(rng, { mode: 'advantage', modifier: 0 });
    expect(result).toEqual({
      mode: 'advantage',
      rolls: [8, 17],
      natural: 17,
      modifier: 0,
      total: 17,
    });
  });

  it('keeps the lower die with disadvantage', () => {
    const rng = createScriptedRng([8, 17]);
    const result = rollD20(rng, { mode: 'disadvantage', modifier: 0 });
    expect(result).toEqual({
      mode: 'disadvantage',
      rolls: [8, 17],
      natural: 8,
      modifier: 0,
      total: 8,
    });
  });

  it('rolls once in normal mode', () => {
    const rng = createScriptedRng([12]);
    const result = rollD20(rng, { mode: 'normal', modifier: 0 });
    expect(result).toEqual({
      mode: 'normal',
      rolls: [12],
      natural: 12,
      modifier: 0,
      total: 12,
    });
  });

  it('adds the modifier to the total', () => {
    const rng = createScriptedRng([14]);
    const result = rollD20(rng, { mode: 'normal', modifier: 3 });
    expect(result.natural).toBe(14);
    expect(result.modifier).toBe(3);
    expect(result.total).toBe(17);
  });
});
