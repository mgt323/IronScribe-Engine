import { describe, expect, it } from 'vitest';

import { abilityModifier, proficiencyBonus } from './modifiers.js';

describe('ability modifier (SRD 5.2.1, Ability Scores)', () => {
  it('is (score − 10) / 2, rounded down', () => {
    expect(abilityModifier(1)).toBe(-5);
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(9)).toBe(-1);
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(11)).toBe(0);
    expect(abilityModifier(12)).toBe(1);
    expect(abilityModifier(15)).toBe(2);
    expect(abilityModifier(16)).toBe(3);
    expect(abilityModifier(30)).toBe(10);
  });
});

describe('proficiency bonus (SRD 5.2.1, Proficiency Bonus)', () => {
  it('steps up by 1 at every fourth level', () => {
    expect([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(proficiencyBonus)).toEqual([
      2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
    ]);
  });

  it('rejects a level outside 1–20', () => {
    expect(() => proficiencyBonus(0)).toThrow(/level/);
    expect(() => proficiencyBonus(21)).toThrow(/level/);
  });
});
