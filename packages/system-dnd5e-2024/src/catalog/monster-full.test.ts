import { describe, expect, it } from 'vitest';

import { loadCatalog } from './catalog.js';
import { readRaw } from './raw-read.js';

const c = loadCatalog();
const monster = (id: string) => {
  const m = c.monsters.get(id);
  if (!m) throw new Error(`missing monster ${id}`);
  return m;
};
const action = (id: string, name: string) => {
  const a = monster(id).actions.find((x) => x.name === name);
  if (!a) throw new Error(`missing action ${id}/${name}`);
  return a;
};

// Stat blocks checked against SRD 5.2.1 (Monsters A-Z) and the pinned raw data.
describe('Aboleth: Multiattack and an attack that also forces a save', () => {
  it('Multiattack is data: two Tentacle attacks, then one of two options', () => {
    expect(action('aboleth', 'Multiattack').multiattack).toEqual({
      steps: [{ action: 'Tentacle', count: 2 }],
      options: {
        choose: 1,
        choices: [
          [{ action: 'Consume Memories', count: 1 }],
          [{ action: 'Dominate Mind', count: 1 }],
        ],
      },
    });
  });

  it('Tentacle is an attack (+9) and keeps its Strength DC 14 save', () => {
    const t = action('aboleth', 'Tentacle');
    expect(t.kind).toBe('melee');
    expect(t.attackBonus).toBe(9);
    expect(t.reach).toBe(15);
    expect(t.save).toEqual({ ability: 'str', dc: 14, onSuccess: 'none' });
    expect(t.damage).toEqual([{ dice: '2d6+5', type: 'bludgeoning', condition: null }]);
  });
});

describe('Adult Red Dragon: legendary actions, spellcasting, usage, lair XP', () => {
  const d = () => monster('adult-red-dragon');

  it('has three legendary actions and lair XP', () => {
    expect(d().legendaryActions.map((a) => a.name)).toEqual([
      'Commanding Presence',
      'Fiery Rays',
      'Pounce',
    ]);
    expect(d().xp).toBe(18000);
    expect(d().xpInLair).toBe(20000);
  });

  it('Spellcasting lists spells with usage', () => {
    const sc = action('adult-red-dragon', 'Spellcasting').spellcasting;
    expect(sc?.ability).toBe('cha');
    expect(sc?.dc).toBe(20);
    expect(sc?.attackBonus).toBe(12);
    expect(sc?.spells.find((s) => s.id === 'command')).toMatchObject({
      level: 2,
      usage: { type: 'at will', times: null },
    });
    expect(sc?.spells.find((s) => s.id === 'fireball')?.usage?.type).toBe('per day');
  });

  it('Fire Breath recharges on 5-6 and halves on a save', () => {
    const b = action('adult-red-dragon', 'Fire Breath');
    expect(b.kind).toBe('save');
    expect(b.save).toEqual({ ability: 'dex', dc: 21, onSuccess: 'half' });
    expect(b.usage).toEqual({ type: 'recharge', min: 5, times: null });
  });

  it('senses and speed', () => {
    expect(d().senses).toEqual({
      passivePerception: 23,
      blindsight: 60,
      darkvision: 120,
      tremorsense: null,
      truesight: null,
    });
    expect(d().speed).toMatchObject({ walk: 40, climb: 40, fly: 80, hover: false });
  });
});

describe('Ghost: a hovering flyer', () => {
  it('hover is its own flag, not a note on the fly speed', () => {
    expect(monster('ghost').speed).toMatchObject({ walk: 5, fly: 40, hover: true });
    expect(monster('ogre').speed.hover).toBe(false);
  });
});

describe('edge cases in the full data', () => {
  it('Vampire, Mist Form has no actions; Vampire lists its forms', () => {
    expect(monster('vampire-mist').actions).toEqual([]);
    expect(monster('vampire-vampire').forms).toEqual(['vampire-bat', 'vampire-mist']);
  });

  it('qualified defenses keep their text instead of a damage type', () => {
    expect(monster('rakshasa').conditionalDefenses).toEqual([
      {
        kind: 'vulnerability',
        type: 'piercing',
        text: 'piercing damage from weapons wielded by creatures under the effect of a bless spell',
      },
    ]);
    expect(monster('rakshasa').vulnerabilities).toEqual([]);
  });

  it('every raw monster is in the catalog', () => {
    expect(c.monsters.list()).toHaveLength(readRaw('monsters.json').length);
  });
});
