import { createScriptedRng } from '@iron-scribe/dice';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../catalog/catalog.js';
import { monsterToEntity } from '../catalog/spawn.js';
import { readCreature } from './creature.js';
import {
  applyDefenses,
  rollMonsterDamage,
  rollWeaponDamage,
  type DefenseProfile,
} from './damage.js';

const catalog = loadCatalog();
const monster = (id: string) => {
  const found = catalog.monsters.get(id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};
const defensesOf = (id: string): DefenseProfile => {
  const view = readCreature(monsterToEntity(monster(id), id), catalog);
  return view;
};

describe('weapon damage (SRD 5.2.1, Damage Rolls and Critical Hits)', () => {
  it('adds the ability modifier, and a critical hit doubles the dice only', () => {
    const dagger = catalog.weapons.get('dagger');
    if (!dagger) throw new Error('missing dagger');
    expect(rollWeaponDamage(createScriptedRng([2]), dagger, 3, false)).toEqual({
      type: 'piercing',
      amount: 5,
    });
    expect(rollWeaponDamage(createScriptedRng([4, 3]), dagger, 3, true)).toEqual({
      type: 'piercing',
      amount: 10,
    });
  });

  it('the damage total is at least 0', () => {
    const club = catalog.weapons.get('club');
    if (!club) throw new Error('missing club');
    expect(rollWeaponDamage(createScriptedRng([1]), club, -1, false).amount).toBe(0);
  });
});

describe('monster damage', () => {
  const scimitar = monster('goblin-warrior').actions.find((action) => action.name === 'Scimitar');
  if (!scimitar) throw new Error('missing scimitar');

  it('keeps the printed modifier and skips the advantage rider otherwise', () => {
    expect(rollMonsterDamage(createScriptedRng([4]), scimitar.damage, false, false)).toEqual([
      { type: 'slashing', amount: 6 },
    ]);
  });

  it('rolls the rider when the attack roll had advantage', () => {
    expect(rollMonsterDamage(createScriptedRng([3, 2]), scimitar.damage, false, true)).toEqual([
      { type: 'slashing', amount: 5 },
      { type: 'slashing', amount: 2 },
    ]);
  });
});

describe('resistance, vulnerability and immunity (SRD 5.2.1)', () => {
  it('applies immunity, then resistance (round down), then vulnerability', () => {
    const profile = (over: Partial<DefenseProfile>): DefenseProfile => ({
      immunities: [],
      resistances: [],
      vulnerabilities: [],
      conditionalDefenses: [],
      ...over,
    });
    const fire = [{ type: 'fire' as const, amount: 7 }];
    expect(applyDefenses(fire, profile({ immunities: ['fire'] }))[0]?.amount).toBe(0);
    expect(applyDefenses(fire, profile({ resistances: ['fire'] }))[0]?.amount).toBe(3);
    expect(applyDefenses(fire, profile({ vulnerabilities: ['fire'] }))[0]?.amount).toBe(14);
    expect(
      applyDefenses([{ type: 'fire', amount: 1 }], profile({ resistances: ['fire'] }))[0]?.amount,
    ).toBe(0);
  });

  it('does not stack, and resistance plus vulnerability cancel', () => {
    const both = applyDefenses([{ type: 'fire', amount: 7 }], {
      immunities: [],
      resistances: ['fire', 'fire'],
      vulnerabilities: ['fire'],
      conditionalDefenses: [],
    });
    expect(both[0]).toMatchObject({ amount: 7, notes: ['resistance and vulnerability cancel'] });
    const immune = applyDefenses([{ type: 'fire', amount: 7 }], {
      immunities: ['fire'],
      resistances: [],
      vulnerabilities: ['fire'],
      conditionalDefenses: [],
    });
    expect(immune[0]?.amount).toBe(0);
  });

  it('uses the catalog: skeleton, dragon turtle, rakshasa', () => {
    const skeleton = defensesOf('skeleton');
    expect(applyDefenses([{ type: 'bludgeoning', amount: 5 }], skeleton)[0]?.amount).toBe(10);
    expect(applyDefenses([{ type: 'poison', amount: 5 }], skeleton)[0]?.amount).toBe(0);
    expect(
      applyDefenses([{ type: 'fire', amount: 7 }], defensesOf('dragon-turtle'))[0]?.amount,
    ).toBe(3);
    const rakshasa = applyDefenses([{ type: 'piercing', amount: 4 }], defensesOf('rakshasa'));
    expect(rakshasa[0]?.amount).toBe(4);
    expect(rakshasa[0]?.notes[0]).toMatch(/bless spell/);
  });
});
