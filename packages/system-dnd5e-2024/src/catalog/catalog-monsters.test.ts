import { parseFormula } from '@iron-scribe/dice';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from './catalog.js';
import { UNRESOLVED_MONSTER_DAMAGE } from './overrides.js';
import { readRaw } from './raw-read.js';

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

describe('every monster, whole catalog', () => {
  const all = c.monsters.list();
  const actionsOf = (m: (typeof all)[number]) => [
    ...m.actions,
    ...m.bonusActions,
    ...m.reactions,
    ...m.legendaryActions,
  ];

  it('the advantage rider is recognised on exactly the four actions that print it', () => {
    const found = all.flatMap((m) =>
      actionsOf(m)
        .filter((a) => a.damage.some((d) => d.condition === 'advantage'))
        .map((a) => `${m.id}/${a.id}`),
    );
    expect(found).toHaveLength(4);
    expect(found).toContain('goblin-warrior/scimitar');
  });

  it('no attack prints damage the data lacks (flat damage and riders are overridden)', () => {
    const raw = readRaw('monsters.json');
    const missing: string[] = [];
    for (const r of raw) {
      const m = monster(r.index);
      for (const ra of [...(r.actions ?? [])]) {
        const printed = [...ra.desc.matchAll(/\d+ (?:\([^)]*\) )?[A-Z][a-z]+ damage/g)].length;
        const have = m.actions.find((a) => a.name === ra.name)?.damage.length ?? 0;
        const key = `${r.index}/${m.actions.find((a) => a.name === ra.name)?.id}`;
        if (ra.desc.includes('Hit:') && printed !== have && !UNRESOLVED_MONSTER_DAMAGE.has(key)) {
          missing.push(key);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('usage, multiattack and spellcasting counts match the raw data', () => {
    const raw = readRaw('monsters.json');
    const rawSpellcasting = raw.reduce(
      (n, r) =>
        n +
        [
          ...(r.actions ?? []),
          ...(r.bonus_actions ?? []),
          ...(r.reactions ?? []),
          ...(r.legendary_actions ?? []),
          ...(r.special_abilities ?? []),
        ].filter((a) => a.spellcasting).length,
      0,
    );
    const ours = all.reduce(
      (n, m) => n + [...actionsOf(m), ...m.traits].filter((a) => a.spellcasting !== null).length,
      0,
    );
    expect(ours).toBe(rawSpellcasting);
    expect(all.flatMap(actionsOf).filter((a) => a.multiattack !== null)).toHaveLength(188);
    const rawUsage = raw.reduce(
      (n, r) =>
        n +
        [
          ...(r.actions ?? []),
          ...(r.bonus_actions ?? []),
          ...(r.reactions ?? []),
          ...(r.legendary_actions ?? []),
        ].filter((a) => a.usage).length,
      0,
    );
    expect(all.flatMap(actionsOf).filter((a) => a.usage !== null)).toHaveLength(rawUsage);
  });
});
