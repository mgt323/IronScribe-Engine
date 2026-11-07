import { describe, expect, it } from 'vitest';

import { Spell } from './schema-spell.js';

describe('Spell resolution consistency', () => {
  const base = {
    id: 'x',
    name: 'X',
    level: 1,
    school: 'evocation',
    castingTime: 'Action',
    range: '60 feet',
    rangeFeet: 60,
    concentration: false,
    verbal: false,
    resolution: 'save',
    mechanics: 'override',
    attack: null,
    save: null,
    damage: null,
    heal: null,
    projectiles: null,
    cantripDice: null,
    upcast: null,
    text: '',
    source: '/api/2024/spells/x',
  };

  it("rejects resolution 'save' with save null", () => {
    expect(Spell.safeParse(base).success).toBe(false);
  });

  it('accepts a consistent save spell and rejects ability text in dice', () => {
    const save = { ability: 'dex', onSuccess: 'half' };
    expect(Spell.safeParse({ ...base, save }).success).toBe(true);
    const heal = { dice: '2d8 + MOD', addSpellcastingMod: true };
    expect(Spell.safeParse({ ...base, save, heal }).success).toBe(false);
  });

  it('text-only spells carry no mechanics', () => {
    const textOnly = { ...base, resolution: 'none', mechanics: 'text-only' };
    expect(Spell.safeParse(textOnly).success).toBe(true);
    const damage = { dice: '1d6', type: 'fire', addSpellcastingMod: false };
    expect(Spell.safeParse({ ...textOnly, damage }).success).toBe(false);
  });
});
