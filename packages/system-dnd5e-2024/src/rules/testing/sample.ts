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

/** Level 1 Sorcerer fixture (Charisma casting): two cantrips in combat, two leveled spells, two slots. */
export function sorcererSheet(overrides: Partial<Sheet> = {}): Sheet {
  return sampleCharacter({
    abilities: { str: 8, dex: 14, con: 14, int: 12, wis: 10, cha: 16 },
    saveProficiencies: ['con', 'cha'],
    weapons: ['dagger', 'light-crossbow'],
    hpMax: 8,
    spellcastingAbility: 'cha',
    cantrips: ['fire-bolt', 'ray-of-frost', 'mage-hand', 'prestidigitation'],
    preparedSpells: ['burning-hands', 'magic-missile'],
    spellSlots: { '1': 2 },
    ...overrides,
  });
}

/** Test-only Cleric fixture: the heal and save spells that stay out of the CLI presets. */
export function clericSheet(overrides: Partial<Sheet> = {}): Sheet {
  return sampleCharacter({
    abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 16, cha: 10 },
    hpMax: 10,
    spellcastingAbility: 'wis',
    cantrips: ['sacred-flame'],
    preparedSpells: ['cure-wounds'],
    spellSlots: { '1': 2 },
    ...overrides,
  });
}
