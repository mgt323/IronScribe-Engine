import { Character, type Character as Sheet } from '../character.js';

/** A level 1 sheet. Tests override only the fields they care about. */
export function sampleCharacter(overrides: Partial<Sheet> = {}): Sheet {
  return Character.parse({
    level: 1,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    saveProficiencies: [],
    skillProficiencies: [],
    weaponProficiencies: ['simple'],
    weapons: ['dagger'],
    armor: null,
    shield: false,
    hpMax: 10,
    ...overrides,
  });
}
