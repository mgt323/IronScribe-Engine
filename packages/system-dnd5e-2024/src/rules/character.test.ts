import type { Entity } from '@iron-scribe/engine-core';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../catalog/catalog.js';
import { monsterToEntity } from '../catalog/spawn.js';
import { Character, characterToEntity, readCharacter } from './character.js';
import { readCreature } from './creature.js';
import { sampleCharacter } from './testing/sample.js';

const catalog = loadCatalog();

const monster = (id: string) => {
  const entry = catalog.monsters.get(id);
  if (!entry) throw new Error(`missing ${id}`);
  return entry;
};

describe('character sheet', () => {
  it('copies hpMax and stores a validated sheet', () => {
    const sheet = sampleCharacter({ hpMax: 12, level: 5 });
    const entity = characterToEntity(sheet, 'hero', { name: 'Hero' });
    expect(entity).toMatchObject({
      id: 'hero',
      name: 'Hero',
      templateRef: null,
      hp: { current: 12, max: 12 },
    });
    expect(readCharacter(entity)).toEqual(sheet);
    const roundTrip = JSON.parse(JSON.stringify(entity)) as Entity;
    expect(readCharacter(roundTrip)).toEqual(sheet);
  });

  it('rejects a level or hit point maximum outside the sheet rules', () => {
    expect(Character.safeParse({ ...sampleCharacter(), level: 0 }).success).toBe(false);
    expect(Character.safeParse({ ...sampleCharacter(), hpMax: 0 }).success).toBe(false);
  });

  it('readCharacter throws when the sheet is missing', () => {
    const entity = characterToEntity(sampleCharacter(), 'hero');
    expect(() => readCharacter({ ...entity, system: {} })).toThrow();
  });
});

describe('creature view', () => {
  it('unarmored AC is 10 + Dexterity (SRD, Armor Class)', () => {
    const low = characterToEntity(
      sampleCharacter({ abilities: { ...sampleCharacter().abilities, dex: 8 } }),
      'a',
    );
    const high = characterToEntity(
      sampleCharacter({ abilities: { ...sampleCharacter().abilities, dex: 16 } }),
      'b',
    );
    expect(readCreature(low, catalog).ac).toBe(9);
    expect(readCreature(high, catalog).ac).toBe(13);
  });

  it('leather uses full Dex, chain shirt caps it at +2, chain mail adds none', () => {
    const abilities = { ...sampleCharacter().abilities, dex: 18 };
    const ac = (armor: string | null, shield: boolean) =>
      readCreature(characterToEntity(sampleCharacter({ abilities, armor, shield }), 'h'), catalog)
        .ac;
    expect(ac('leather-armor', false)).toBe(15);
    expect(ac('chain-shirt', false)).toBe(15);
    expect(ac('chain-mail', false)).toBe(16);
    expect(ac('leather-armor', true)).toBe(17);
    expect(ac(null, true)).toBe(16);
  });

  it('a negative Dexterity modifier still lowers medium armor, not heavy', () => {
    const abilities = { ...sampleCharacter().abilities, dex: 8 };
    const ac = (armor: string) =>
      readCreature(characterToEntity(sampleCharacter({ abilities, armor }), 'h'), catalog).ac;
    expect(ac('chain-shirt')).toBe(12);
    expect(ac('chain-mail')).toBe(16);
  });

  it('saves add proficiency once; skills add it again with expertise', () => {
    const entity = characterToEntity(
      sampleCharacter({
        level: 5,
        abilities: { ...sampleCharacter().abilities, dex: 16, wis: 12 },
        saveProficiencies: ['dex'],
        skillProficiencies: [
          { skill: 'stealth', expertise: false },
          { skill: 'perception', expertise: true },
        ],
      }),
      'hero',
    );
    const view = readCreature(entity, catalog);
    expect(view.saveBonus('dex')).toBe(6);
    expect(view.saveBonus('wis')).toBe(1);
    expect(view.skillBonus('stealth')).toBe(6);
    expect(view.skillBonus('perception')).toBe(7);
    expect(view.skillBonus('athletics')).toBe(0);
    expect(view.initiativeBonus).toBe(3);
  });

  it('reads the Goblin Warrior stat block, with unlisted skills falling back', () => {
    const view = readCreature(monsterToEntity(monster('goblin-warrior'), 'g'), catalog);
    expect(view.kind).toBe('monster');
    expect(view.ac).toBe(15);
    expect(view.dexScore).toBe(15);
    expect(view.initiativeBonus).toBe(2);
    expect(view.saveBonus('dex')).toBe(2);
    expect(view.saveBonus('str')).toBe(-1);
    expect(view.skillBonus('stealth')).toBe(6);
    expect(view.skillBonus('perception')).toBe(-1);
  });

  it('reads skeleton defenses and condition immunities from the catalog', () => {
    const view = readCreature(monsterToEntity(monster('skeleton'), 's'), catalog);
    expect(view.vulnerabilities).toEqual(['bludgeoning']);
    expect(view.immunities).toEqual(['poison']);
    expect(view.conditionImmunities).toEqual(['exhaustion', 'poisoned']);
  });

  it('rejects an entity that is neither a character nor a monster', () => {
    const entity = characterToEntity(sampleCharacter(), 'hero');
    expect(() => readCreature({ ...entity, system: {} }, catalog)).toThrow(/character or monster/);
  });
});
