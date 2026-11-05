import { parseFormula } from '@iron-scribe/dice';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from './catalog.js';

const c = loadCatalog();
const monster = (id: string) => {
  const m = c.monsters.get(id);
  if (!m) throw new Error(`missing monster ${id}`);
  return m;
};

describe('monsters', () => {
  it('Goblin Warrior (2024): 10 HP, AC 15, Scimitar +4, 1d4 only with advantage', () => {
    const g = monster('goblin-warrior');
    expect(g.hp).toBe(10);
    expect(g.ac).toBe(15);
    const scimitar = g.actions.find((a) => a.name === 'Scimitar');
    expect(scimitar?.attackBonus).toBe(4);
    expect(scimitar?.kind).toBe('melee');
    expect(scimitar?.reach).toBe(5);
    expect(scimitar?.damage).toEqual([
      { dice: '1d6+2', type: 'slashing', condition: null },
      { dice: '1d4', type: 'slashing', condition: 'advantage' },
    ]);
    expect(g.actions.find((a) => a.name === 'Shortbow')?.range).toEqual({ normal: 80, long: 320 });
  });

  it('Goblin Minion is 7 HP, AC 12', () => {
    expect([monster('goblin-minion').hp, monster('goblin-minion').ac]).toEqual([7, 12]);
  });

  it('Skeleton defenses', () => {
    const s = monster('skeleton');
    expect(s.vulnerabilities).toEqual(['bludgeoning']);
    expect(s.immunities).toEqual(['poison']);
    expect(s.conditionImmunities).toEqual(['exhaustion', 'poisoned']);
  });

  it('Ogre: numeric speed, parseable HP formula', () => {
    const o = monster('ogre');
    expect(o.speed.walk).toBe(40);
    expect(o.speed.fly).toBeNull();
    expect(() => parseFormula(o.hpFormula)).not.toThrow();
    expect(o.hpFormula.replace(/\s/g, '')).toBe('8d10+24');
  });

  it('Bandit sizes and exact CR; Javelin is melee or ranged', () => {
    expect(monster('bandit').sizes).toEqual(['medium', 'small']);
    expect(monster('bandit').cr).toBe(0.125);
    expect(monster('ogre').actions.find((a) => a.name === 'Javelin')?.kind).toBe('meleeOrRanged');
  });

  it('saves default to ability modifiers; listed proficiencies use the stat block', () => {
    expect(monster('goblin-warrior').saves.dex).toBe(2);
    expect(monster('giant-rat').saves.dex).toBe(5);
    expect(monster('zombie').saves.wis).toBe(0);
    expect(monster('goblin-warrior').skills).toEqual({ stealth: 6 });
  });

  it('Cultist sickle includes its extra 1 necrotic', () => {
    const d = monster('cultist').actions[0]?.damage ?? [];
    expect(d.map((x) => x.type)).toEqual(['slashing', 'necrotic']);
  });
});

describe('weapons', () => {
  it('Longsword', () => {
    const w = c.weapons.get('longsword');
    expect(w?.damage).toEqual({ dice: '1d8', type: 'slashing' });
    expect(w?.versatileDamage?.dice).toBe('1d10');
    expect(w?.mastery).toBe('sap');
    expect(w?.category).toBe('martial');
  });

  it('Dagger', () => {
    const w = c.weapons.get('dagger');
    expect([...(w?.properties ?? [])].sort()).toEqual(['finesse', 'light', 'thrown']);
    expect(w?.throwRange).toEqual({ normal: 20, long: 60 });
    expect(w?.kind).toBe('melee');
    expect(c.weapons.get('shortbow')?.kind).toBe('ranged');
  });
});

describe('armor', () => {
  it('Chain Mail', () => {
    expect(c.armor.get('chain-mail')).toMatchObject({
      kind: 'body',
      category: 'heavy',
      baseAc: 16,
      dexCap: 0,
      strMin: 13,
      stealthDisadvantage: true,
    });
  });

  it('dex caps', () => {
    expect(c.armor.get('leather-armor')).toMatchObject({ dexCap: null, baseAc: 11 });
    expect(c.armor.get('chain-shirt')).toMatchObject({ dexCap: 2, baseAc: 13 });
  });

  it('Shield adds to AC and has no base', () => {
    const s = c.armor.get('shield');
    expect(s).toMatchObject({ kind: 'shield', acBonus: 2 });
    expect(s).not.toHaveProperty('baseAc');
  });
});

describe('spells', () => {
  const spell = (id: string) => {
    const s = c.spells.get(id);
    if (!s) throw new Error(`missing spell ${id}`);
    return s;
  };

  it('Fire Bolt', () => {
    const s = spell('fire-bolt');
    expect([s.resolution, s.attack]).toEqual(['attack', 'ranged']);
    expect(s.cantripDice).toEqual([
      { minLevel: 1, dice: '1d10' },
      { minLevel: 5, dice: '2d10' },
      { minLevel: 11, dice: '3d10' },
      { minLevel: 17, dice: '4d10' },
    ]);
  });

  it('Sacred Flame negates on a save; Burning Hands halves', () => {
    expect(spell('sacred-flame').save).toEqual({ ability: 'dex', onSuccess: 'none' });
    const bh = spell('burning-hands');
    expect(bh.save).toEqual({ ability: 'dex', onSuccess: 'half' });
    expect(bh.damage).toEqual({ dice: '3d6', type: 'fire', addSpellcastingMod: false });
    expect(bh.upcast).toEqual({ dicePerSlot: '1d6', projectilesPerSlot: null });
  });

  it('Magic Missile is automatic with 3 darts', () => {
    const s = spell('magic-missile');
    expect(s.resolution).toBe('auto');
    expect([s.attack, s.save, s.projectiles]).toEqual([null, null, 3]);
    expect(s.damage).toEqual({ dice: '1d4+1', type: 'force', addSpellcastingMod: false });
    expect(s.upcast?.projectilesPerSlot).toBe(1);
  });

  it('Cure Wounds heals 2d8 plus the spellcasting modifier', () => {
    const s = spell('cure-wounds');
    expect(s.heal).toEqual({ dice: '2d8', addSpellcastingMod: true });
    expect(s.upcast?.dicePerSlot).toBe('2d8');
  });
});

describe('catalog-wide', () => {
  it('every dice string parses and none mentions a modifier', () => {
    const dice: string[] = [];
    for (const m of c.monsters.list()) {
      dice.push(m.hpFormula, ...m.actions.flatMap((a) => a.damage.map((d) => d.dice)));
    }
    for (const w of c.weapons.list()) dice.push(w.damage.dice);
    for (const s of c.spells.list()) {
      dice.push(
        ...[s.damage?.dice, s.heal?.dice, s.upcast?.dicePerSlot].filter((x): x is string => !!x),
        ...(s.cantripDice?.map((d) => d.dice) ?? []),
      );
    }
    for (const d of dice) {
      expect(() => parseFormula(d)).not.toThrow();
      expect(d.toLowerCase()).not.toContain('mod');
    }
  });

  it('only 2024 sources', () => {
    for (const e of [
      ...c.monsters.list(),
      ...c.weapons.list(),
      ...c.armor.list(),
      ...c.spells.list(),
    ]) {
      expect(e.source.startsWith('/api/2024/')).toBe(true);
    }
  });

  it('has the full allowlist', () => {
    expect(c.monsters.list()).toHaveLength(11);
    expect(c.weapons.list()).toHaveLength(14);
    expect(c.armor.list()).toHaveLength(4);
    expect(c.spells.list()).toHaveLength(5);
  });
});
