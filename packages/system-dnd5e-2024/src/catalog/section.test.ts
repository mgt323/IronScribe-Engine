import { describe, expect, it } from 'vitest';

import { loadCatalog } from './catalog.js';

const c = loadCatalog();
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);

describe('find: exact match first', () => {
  it.each(['Goblin Warrior', 'goblin-warrior', '  GOBLIN warrior ', 'goblin_warrior'])(
    '%j returns exactly one',
    (q) => {
      expect(ids(c.monsters.find(q))).toEqual(['goblin-warrior']);
    },
  );
});

describe('find: whole-word token match', () => {
  it('returns every whole-word match sorted by id; Hobgoblins do not match "goblin"', () => {
    expect(ids(c.monsters.find('goblin'))).toEqual([
      'goblin-boss',
      'goblin-minion',
      'goblin-warrior',
    ]);
  });
  it('partial words, unknown names and empty queries return nothing', () => {
    expect(c.monsters.find('gob')).toEqual([]);
    expect(c.monsters.find('zzz')).toEqual([]);
    expect(c.monsters.find('')).toEqual([]);
    expect(c.monsters.find('   ')).toEqual([]);
  });
});

describe('other sections', () => {
  it('weapons, armor and spells share the rules', () => {
    expect(ids(c.weapons.find('Light Crossbow'))).toEqual(['light-crossbow']);
    expect(c.weapons.find('sword')).toEqual([]);
    expect(ids(c.spells.find('fire bolt'))).toEqual(['fire-bolt']);
    expect(ids(c.armor.find('chain'))).toEqual(['chain-mail', 'chain-shirt']);
  });
});

describe('get and list', () => {
  it('list is sorted by id; get misses return undefined', () => {
    for (const s of [c.monsters, c.weapons, c.armor, c.gear, c.magicItems, c.spells]) {
      const l = ids(s.list());
      expect(l).toEqual([...l].sort());
    }
    expect(c.monsters.get('nope')).toBeUndefined();
    expect(c.monsters.get('ogre')?.name).toBe('Ogre');
  });
});
