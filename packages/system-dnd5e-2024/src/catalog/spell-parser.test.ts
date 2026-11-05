import { describe, expect, it } from 'vitest';

import { loadCatalog } from './catalog.js';

const c = loadCatalog();
const spell = (id: string) => {
  const s = c.spells.get(id);
  if (!s) throw new Error(`missing spell ${id}`);
  return s;
};

// Expected values come from the SRD 5.2.1 spell entries (text checked against the raw data).
describe('spell text parser (mechanics: parsed)', () => {
  it('Fireball: Dexterity save for half, 8d6 Fire, +1d6 per slot above 3', () => {
    const s = spell('fireball');
    expect(s.mechanics).toBe('parsed');
    expect([s.resolution, s.save]).toEqual(['save', { ability: 'dex', onSuccess: 'half' }]);
    expect(s.damage).toEqual({ dice: '8d6', type: 'fire', addSpellcastingMod: false });
    expect(s.upcast).toEqual({ dicePerSlot: '1d6', projectilesPerSlot: null });
  });

  it('Lightning Bolt: same shape with Lightning', () => {
    const s = spell('lightning-bolt');
    expect(s.save).toEqual({ ability: 'dex', onSuccess: 'half' });
    expect(s.damage?.type).toBe('lightning');
  });

  it('Shocking Grasp: melee spell attack with cantrip dice', () => {
    const s = spell('shocking-grasp');
    expect([s.resolution, s.attack]).toEqual(['attack', 'melee']);
    expect(s.damage).toEqual({ dice: '1d8', type: 'lightning', addSpellcastingMod: false });
    expect(s.cantripDice?.map((d) => d.dice)).toEqual(['1d8', '2d8', '3d8', '4d8']);
  });

  it('Healing Word: heals 2d4 plus the spellcasting modifier, +2d4 per slot', () => {
    const s = spell('healing-word');
    expect(s.resolution).toBe('none');
    expect(s.heal).toEqual({ dice: '2d4', addSpellcastingMod: true });
    expect(s.upcast?.dicePerSlot).toBe('2d4');
  });

  it('Hold Person: a Wisdom save with no damage', () => {
    const s = spell('hold-person');
    expect([s.resolution, s.save, s.damage]).toEqual([
      'save',
      { ability: 'wis', onSuccess: 'none' },
      null,
    ]);
  });

  it('Guiding Bolt: ranged spell attack, 4d6 Radiant', () => {
    const s = spell('guiding-bolt');
    expect([s.attack, s.damage?.dice, s.damage?.type]).toEqual(['ranged', '4d6', 'radiant']);
  });

  it('hand-written overrides win and are marked', () => {
    expect(spell('fire-bolt').mechanics).toBe('override');
    expect(spell('magic-missile').mechanics).toBe('override');
  });

  it('spells the parser cannot read stay text-only with no mechanics', () => {
    const textOnly = c.spells.list().filter((s) => s.mechanics === 'text-only');
    expect(textOnly.length).toBeGreaterThan(0);
    for (const s of textOnly)
      expect([s.resolution, s.damage, s.heal]).toEqual(['none', null, null]);
  });

  it('coverage snapshot: spells per mechanics value', () => {
    const counts: Record<string, number> = {};
    for (const s of c.spells.list()) counts[s.mechanics] = (counts[s.mechanics] ?? 0) + 1;
    expect(counts).toMatchInlineSnapshot(`
      {
        "override": 5,
        "parsed": 132,
        "text-only": 202,
      }
    `);
  });
});
