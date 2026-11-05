import { parseFormula } from '@iron-scribe/dice';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { loadCatalog } from './catalog.js';
import { readRaw } from './raw-read.js';
import { ABILITIES, Armor, DamageType, MASTERIES, WEAPON_PROPERTIES, Weapon } from './schema.js';
import { Gear, MagicItem, RuleEntry } from './schema-items.js';
import { Monster } from './schema-monster.js';
import { Spell } from './schema-spell.js';

const c = loadCatalog();

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

describe('gear and magic items', () => {
  it('Longbow-style routing: weapons, armor and gear partition the equipment file', () => {
    const total = readRaw('equipment.json').length;
    expect(c.weapons.list().length + c.armor.list().length + c.gear.list().length).toBe(total);
    expect(c.weapons.list()).toHaveLength(38);
    expect(c.armor.list()).toHaveLength(13);
    expect(c.gear.list()).toHaveLength(131);
  });

  it('Morningstar has no upstream range, so melee reach defaults to 5 feet', () => {
    expect(c.weapons.get('morningstar')?.range).toEqual({ normal: 5, long: null });
  });

  it('gear kinds', () => {
    expect(c.gear.get('arrows')?.kind).toBe('ammunition');
    expect(c.gear.get('thieves-tools')?.kind).toBe('tool');
    expect(c.gear.get('lute')?.kind).toBe('instrument');
    expect(c.gear.get('dice')?.kind).toBe('gaming-set');
    expect(c.gear.get('burglars-pack')?.kind).toBe('pack');
    expect(c.gear.get('rope')).toMatchObject({ kind: 'gear', weight: 5 });
  });

  it('magic items keep compound rarity text and link variants both ways', () => {
    const bonus = c.magicItems.get('ammunition');
    expect(bonus?.variants).toEqual(['ammunition-1', 'ammunition-2', 'ammunition-3']);
    expect(c.magicItems.get('ammunition-2')?.variantOf).toBe('ammunition');
    expect(c.magicItems.get('ammunition-2')?.text.length).toBeGreaterThan(0);
    expect(c.magicItems.list().some((m) => m.rarity.includes('(+1)'))).toBe(true);
  });
});

describe('rules reference', () => {
  it('damage types, abilities and conditions match our enums', () => {
    expect(c.damageTypes.list().map((x) => x.id)).toEqual([...DamageType.options].sort());
    expect(c.abilityScores.list().map((x) => x.id)).toEqual([...ABILITIES].sort());
    const conditions = new Set(c.conditions.list().map((x) => x.id));
    for (const m of c.monsters.list()) {
      for (const id of m.conditionImmunities) expect(conditions.has(id)).toBe(true);
    }
  });

  it('weapon properties and masteries match our enums', () => {
    const ids = (f: 'weapon-properties.json' | 'weapon-mastery-properties.json') =>
      readRaw(f)
        .map((r) => r.index)
        .sort();
    expect(ids('weapon-properties.json')).toEqual([...WEAPON_PROPERTIES].sort());
    expect(ids('weapon-mastery-properties.json')).toEqual([...MASTERIES].sort());
  });

  it('skills name their ability', () => {
    expect(c.skills.get('stealth')).toMatchObject({ ability: 'dex' });
    expect(c.skills.list().every((s) => ABILITIES.some((a) => a === s.ability))).toBe(true);
  });
});

describe('catalog-wide', () => {
  it('every dice string parses and none mentions a modifier', () => {
    const dice: string[] = [];
    for (const m of c.monsters.list()) {
      const actions = [...m.actions, ...m.bonusActions, ...m.reactions, ...m.legendaryActions];
      dice.push(m.hpFormula, ...actions.flatMap((a) => a.damage.map((d) => d.dice)));
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
    const all = [
      ...c.monsters.list(),
      ...c.weapons.list(),
      ...c.armor.list(),
      ...c.gear.list(),
      ...c.magicItems.list(),
      ...c.spells.list(),
      ...c.conditions.list(),
      ...c.damageTypes.list(),
      ...c.abilityScores.list(),
      ...c.skills.list(),
    ];
    for (const e of all) expect(e.source.startsWith('/api/2024/')).toBe(true);
  });

  // Committed data is trusted at load (decision A), so our own schemas are enforced here.
  it('every entry of every section passes its own schema', () => {
    const parse = <T>(schema: z.ZodType<T>, entries: readonly unknown[]) => {
      for (const e of entries) expect(schema.safeParse(e).success).toBe(true);
    };
    parse(Monster, c.monsters.list());
    parse(Weapon, c.weapons.list());
    parse(Armor, c.armor.list());
    parse(Gear, c.gear.list());
    parse(MagicItem, c.magicItems.list());
    parse(Spell, c.spells.list());
    for (const s of [c.conditions, c.damageTypes, c.abilityScores, c.skills]) {
      parse(RuleEntry, s.list());
    }
  });

  it('section sizes match the raw files', () => {
    expect(c.monsters.list()).toHaveLength(readRaw('monsters.json').length);
    expect(c.spells.list()).toHaveLength(readRaw('spells.json').length);
    expect(c.magicItems.list()).toHaveLength(readRaw('magic-items.json').length);
    expect(c.conditions.list()).toHaveLength(readRaw('conditions.json').length);
    expect(c.skills.list()).toHaveLength(readRaw('skills.json').length);
  });
});
