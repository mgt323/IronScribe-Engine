import { describe, expect, it } from 'vitest';

import { createRng, createScriptedRng } from './rng.js';
import { roll } from './roll.js';

describe('roll', () => {
  it('totals a scripted 2d6+3 as 11 with a full breakdown', () => {
    const rng = createScriptedRng([3, 5]);
    const result = roll('2d6+3', rng);
    expect(result.total).toBe(11);
    expect(result.formula).toBe('2d6+3');
    expect(result.terms).toEqual([
      {
        kind: 'dice',
        sign: 1,
        count: 2,
        sides: 6,
        rolls: [3, 5],
        kept: [3, 5],
      },
      {
        kind: 'constant',
        sign: 1,
        value: 3,
      },
    ]);
  });

  it('drops the lowest die for 4d6kh3', () => {
    const rng = createScriptedRng([6, 1, 4, 5]);
    const result = roll('4d6kh3', rng);
    expect(result.total).toBe(15);
    expect(result.terms[0]).toMatchObject({
      kind: 'dice',
      rolls: [6, 1, 4, 5],
      kept: [6, 4, 5],
    });
  });

  it('on critical rolls dice terms twice and leaves constants alone', () => {
    const rng = createScriptedRng([4, 7]);
    const result = roll('1d8+2', rng, { critical: true });
    expect(result.total).toBe(13);
    expect(result.terms).toEqual([
      {
        kind: 'dice',
        sign: 1,
        count: 2,
        sides: 8,
        rolls: [4, 7],
        kept: [4, 7],
      },
      {
        kind: 'constant',
        sign: 1,
        value: 2,
      },
    ]);
  });

  it('is reproducible with the same seed', () => {
    const a = roll('2d6+1', createRng(777));
    const b = roll('2d6+1', createRng(777));
    expect(a).toEqual(b);
  });

  it('accepts a parsed formula AST', () => {
    const rng = createScriptedRng([2]);
    const result = roll({ terms: [{ kind: 'dice', sign: 1, count: 1, sides: 6 }] }, rng);
    expect(result.total).toBe(2);
  });
});
