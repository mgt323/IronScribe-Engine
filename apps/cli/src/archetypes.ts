import { Character } from '@iron-scribe/system-dnd5e-2024';

export const ARCHETYPES = ['rogue', 'sorcerer'] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export function isArchetype(value: string): value is Archetype {
  return (ARCHETYPES as readonly string[]).includes(value);
}

/** Labels only: the sheet stores no class. */
export const ARCHETYPE_LABEL: Readonly<Record<Archetype, { name: string; hitDie: string }>> = {
  rogue: { name: 'Rogue', hitDie: 'd8' },
  sorcerer: { name: 'Sorcerer', hitDie: 'd6' },
};

/**
 * SRD 5.2.1 Level 1 Rogue. The sheet stores no class: the label lives in the CLI.
 * Hit die d8, so hpMax is 8 + Constitution modifier (+2) = 10.
 * Proficiency bonus is +2 from `proficiencyBonus(1)`, not a field on the sheet.
 */
export function defaultAdventurerSheet(): Character {
  return Character.parse({
    level: 1,
    abilities: { str: 8, dex: 16, con: 14, int: 12, wis: 13, cha: 10 },
    saveProficiencies: ['dex', 'int'],
    skillProficiencies: [
      { skill: 'stealth', expertise: true },
      { skill: 'sleight-of-hand', expertise: true },
      { skill: 'perception', expertise: false },
      { skill: 'investigation', expertise: false },
    ],
    weaponProficiencies: [
      'simple',
      'shortsword',
      'rapier',
      'scimitar',
      'whip',
      'longsword',
      'hand-crossbow',
    ],
    weapons: ['dagger', 'shortbow'],
    armor: 'leather-armor',
    shield: false,
    hpMax: 10,
  });
}

/**
 * The only spells a preset may carry. Sacred Flame and Cure Wounds stay out until a
 * Cleric preset exists; unit tests use a test-only Cleric sheet for them.
 */
export const SORCERER_ALLOWLIST: ReadonlySet<string> = new Set([
  'fire-bolt',
  'ray-of-frost',
  'mage-hand',
  'prestidigitation',
  'burning-hands',
  'magic-missile',
]);

/**
 * SRD 5.2.1 Level 1 Sorcerer. Hit die d6, so hpMax is 6 + Constitution modifier (+2) = 8.
 * Unarmored AC is 10 + Dexterity (+2) = 12. Spellcasting uses Charisma: four cantrips, two
 * prepared 1st-level spells, two 1st-level slots. Innate Sorcery and other class features
 * that need a duration are not modelled yet.
 */
export function defaultSorcererSheet(): Character {
  return Character.parse({
    level: 1,
    abilities: { str: 8, dex: 14, con: 14, int: 12, wis: 10, cha: 16 },
    saveProficiencies: ['con', 'cha'],
    skillProficiencies: [
      { skill: 'arcana', expertise: false },
      { skill: 'persuasion', expertise: false },
    ],
    weaponProficiencies: ['simple'],
    weapons: ['dagger', 'light-crossbow'],
    armor: null,
    shield: false,
    hpMax: 8,
    spellcastingAbility: 'cha',
    cantrips: ['fire-bolt', 'ray-of-frost', 'mage-hand', 'prestidigitation'],
    preparedSpells: ['burning-hands', 'magic-missile'],
    spellSlots: { '1': 2 },
  });
}

export function defaultSheet(archetype: Archetype): Character {
  return archetype === 'sorcerer' ? defaultSorcererSheet() : defaultAdventurerSheet();
}
