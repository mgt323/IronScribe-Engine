import { createScriptedRng } from '@iron-scribe/dice';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../catalog/catalog.js';
import { attackRoll, weaponAttackBonus } from './attack.js';
import { sampleCharacter } from './testing/sample.js';
import { NO_CONDITIONS, type ConditionState } from './conditions.js';

const catalog = loadCatalog();
const weapon = (id: string) => {
  const found = catalog.weapons.get(id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};

const roll = (
  values: number[],
  bonus: number,
  ac: number,
  extra: Partial<Parameters<typeof attackRoll>[1]> = {},
) =>
  attackRoll(createScriptedRng(values), {
    bonus,
    ac,
    attackKind: 'melee',
    attacker: NO_CONDITIONS,
    target: NO_CONDITIONS,
    ...extra,
  });

describe('weapon attack bonus (SRD 5.2.1, Attack Rolls)', () => {
  it('finesse uses the better ability, and proficiency adds the bonus', () => {
    const finesse = sampleCharacter({
      abilities: { str: 8, dex: 16, con: 10, int: 10, wis: 10, cha: 10 },
      weaponProficiencies: ['simple'],
    });
    expect(weaponAttackBonus(finesse, weapon('dagger'))).toMatchObject({
      ability: 'dex',
      modifier: 3,
      proficient: true,
      bonus: 5,
    });
    const strong = sampleCharacter({
      abilities: { str: 18, dex: 12, con: 10, int: 10, wis: 10, cha: 10 },
      weaponProficiencies: [],
    });
    expect(weaponAttackBonus(strong, weapon('dagger')).bonus).toBe(4);
    expect(weaponAttackBonus(strong, weapon('shortbow'))).toMatchObject({
      ability: 'dex',
      modifier: 1,
      bonus: 1,
    });
  });

  it('a martial weapon is not covered by simple proficiency', () => {
    const sheet = sampleCharacter({ weaponProficiencies: ['simple'] });
    expect(weaponAttackBonus(sheet, weapon('longsword')).proficient).toBe(false);
    const named = sampleCharacter({ weaponProficiencies: ['longsword'] });
    expect(weaponAttackBonus(named, weapon('longsword')).proficient).toBe(true);
  });
});

describe('attack rolls (SRD 5.2.1, Attack Rolls)', () => {
  it('a natural 20 hits any AC and is a critical hit; a natural 1 misses', () => {
    expect(roll([20], 0, 30)).toMatchObject({ hit: true, critical: true, natural: 20 });
    expect(roll([1], 20, 5)).toMatchObject({ hit: false, critical: false, natural: 1, total: 21 });
  });

  it('otherwise hits when the total equals AC', () => {
    expect(roll([10], 5, 15)).toMatchObject({ hit: true, critical: false, total: 15 });
    expect(roll([10], 5, 16)).toMatchObject({ hit: false, total: 15 });
  });

  it('exhaustion lowers the total, and prone grants advantage on a melee attack', () => {
    const tired: ConditionState = { ids: [], exhaustion: 1 };
    expect(roll([10], 5, 15, { attacker: tired })).toMatchObject({
      total: 13,
      hit: false,
      modifier: 3,
    });
    const prone: ConditionState = { ids: ['prone'], exhaustion: 0 };
    const advantaged = roll([3, 16], 0, 15, { target: prone });
    expect(advantaged.mode).toBe('advantage');
    expect(advantaged.natural).toBe(16);
    expect(advantaged.hit).toBe(true);
  });

  it('a melee hit against a paralyzed creature is a critical hit', () => {
    const paralyzed: ConditionState = { ids: ['paralyzed'], exhaustion: 0 };
    expect(roll([11, 8], 0, 10, { target: paralyzed })).toMatchObject({
      hit: true,
      critical: true,
      natural: 11,
    });
  });
});
