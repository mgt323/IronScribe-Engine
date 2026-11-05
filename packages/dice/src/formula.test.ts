import { describe, expect, it } from 'vitest';

import { DiceFormulaError, formatFormula, parseFormula } from './formula.js';

describe('parseFormula', () => {
  it('parses longsword-style 1d8+2', () => {
    expect(parseFormula('1d8+2')).toEqual({
      terms: [
        { kind: 'dice', sign: 1, count: 1, sides: 8 },
        { kind: 'constant', sign: 1, value: 2 },
      ],
    });
  });

  it('parses 2d6', () => {
    expect(parseFormula('2d6')).toEqual({
      terms: [{ kind: 'dice', sign: 1, count: 2, sides: 6 }],
    });
  });

  it('parses bare d20 with implied count 1', () => {
    expect(parseFormula('d20')).toEqual({
      terms: [{ kind: 'dice', sign: 1, count: 1, sides: 20 }],
    });
  });

  it('parses mixed dice with a subtracted constant', () => {
    expect(parseFormula('1d6 + 1d4 - 1')).toEqual({
      terms: [
        { kind: 'dice', sign: 1, count: 1, sides: 6 },
        { kind: 'dice', sign: 1, count: 1, sides: 4 },
        { kind: 'constant', sign: -1, value: 1 },
      ],
    });
  });

  it('parses 4d6kh3 keep-highest', () => {
    expect(parseFormula('4d6kh3')).toEqual({
      terms: [
        {
          kind: 'dice',
          sign: 1,
          count: 4,
          sides: 6,
          keep: { mode: 'highest', count: 3 },
        },
      ],
    });
  });

  it('parses fireball 8d6', () => {
    expect(parseFormula('8d6')).toEqual({
      terms: [{ kind: 'dice', sign: 1, count: 8, sides: 6 }],
    });
  });

  it('is case-insensitive for keep suffixes', () => {
    expect(parseFormula('4D6KH3')).toEqual(parseFormula('4d6kh3'));
    expect(parseFormula('4d6KL2')).toEqual({
      terms: [
        {
          kind: 'dice',
          sign: 1,
          count: 4,
          sides: 6,
          keep: { mode: 'lowest', count: 2 },
        },
      ],
    });
  });

  it.each(['', '2d', 'd1', '0d6', '1d6++2', '101d6'] as const)(
    'rejects invalid formula %j',
    (text) => {
      expect(() => parseFormula(text)).toThrow(DiceFormulaError);
    },
  );
});

describe('formatFormula', () => {
  it('round-trips normalized text', () => {
    const cases = [
      ['1d8+2', '1d8+2'],
      ['2d6', '2d6'],
      ['d20', '1d20'],
      ['1d6 + 1d4 - 1', '1d6+1d4-1'],
      ['4d6kh3', '4d6kh3'],
      ['8d6', '8d6'],
    ] as const;
    for (const [input, expected] of cases) {
      expect(formatFormula(parseFormula(input))).toBe(expected);
    }
  });
});
