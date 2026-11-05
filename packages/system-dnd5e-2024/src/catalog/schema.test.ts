import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { RAW_DIR } from './paths.js';
import { RawEquipment, RawMonster, RawProperty, RawSpell } from './raw-schema.js';
import { Spell } from './schema-spell.js';

const read = (f: string): unknown => JSON.parse(readFileSync(join(RAW_DIR, f), 'utf8'));

describe('raw data', () => {
  it('every raw entry passes the raw schema, ids unique', () => {
    const cases = [
      ['monsters.json', RawMonster],
      ['equipment.json', RawEquipment],
      ['spells.json', RawSpell],
      ['weapon-properties.json', RawProperty],
      ['weapon-mastery-properties.json', RawProperty],
    ] as const;
    for (const [file, schema] of cases) {
      const rows = z.array(schema).parse(read(file));
      expect(new Set(rows.map((r) => r.index)).size).toBe(rows.length);
    }
  });

  it('raw files and SOURCE.json exist', () => {
    expect(readdirSync(RAW_DIR).sort()).toHaveLength(5);
    const src = JSON.parse(readFileSync(join(RAW_DIR, '..', 'SOURCE.json'), 'utf8')) as {
      commit: string;
    };
    expect(src.commit).toMatch(/^[0-9a-f]{40}$/);
  });
});

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
    resolution: 'save',
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
});
