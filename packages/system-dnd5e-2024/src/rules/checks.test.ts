import { createScriptedRng } from '@iron-scribe/dice';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../catalog/catalog.js';
import { monsterToEntity } from '../catalog/spawn.js';
import { abilityCheck, savingThrow, skillCheck } from './checks.js';
import { NO_CONDITIONS, type ConditionState } from './conditions.js';
import { readCreature } from './creature.js';

const catalog = loadCatalog();
const goblin = catalog.monsters.get('goblin-warrior');
if (!goblin) throw new Error('missing goblin');
const view = readCreature(monsterToEntity(goblin, 'g'), catalog);

describe('ability checks and saves (SRD 5.2.1, D20 Tests)', () => {
  it('d20 + modifier meets the DC on a tie and fails one short', () => {
    const made = abilityCheck(createScriptedRng([12]), {
      bonus: view.abilityMod('str'),
      dc: 11,
      conditions: NO_CONDITIONS,
      ability: 'str',
    });
    expect(made).toMatchObject({
      natural: 12,
      modifier: -1,
      total: 11,
      success: true,
      autoFail: false,
    });
    const missed = abilityCheck(createScriptedRng([10]), {
      bonus: 2,
      dc: 13,
      conditions: NO_CONDITIONS,
      ability: 'dex',
    });
    expect(missed).toMatchObject({ total: 12, success: false });
  });

  it('a skill check uses the skill bonus, and expertise is already in that bonus', () => {
    const result = skillCheck(createScriptedRng([12]), {
      bonus: view.skillBonus('stealth'),
      dc: 15,
      conditions: NO_CONDITIONS,
      ability: 'dex',
    });
    expect(view.skillBonus('stealth')).toBe(6);
    expect(result).toMatchObject({ natural: 12, total: 18, success: true });
  });

  it('poisoned is disadvantage; exhaustion subtracts 2 per level', () => {
    const poisoned: ConditionState = { ids: ['poisoned'], exhaustion: 2 };
    const result = abilityCheck(createScriptedRng([18, 4]), {
      bonus: 3,
      dc: 10,
      conditions: poisoned,
      ability: 'dex',
    });
    expect(result.mode).toBe('disadvantage');
    expect(result.natural).toBe(4);
    expect(result.modifier).toBe(-1);
    expect(result.total).toBe(3);
    expect(result.success).toBe(false);
  });

  it('a paralyzed creature auto-fails a Strength save without rolling', () => {
    const rng = createScriptedRng([]);
    const result = savingThrow(rng, {
      bonus: 5,
      dc: 10,
      conditions: { ids: ['paralyzed'], exhaustion: 0 },
      ability: 'str',
    });
    expect(result).toMatchObject({ autoFail: true, success: false, rolls: [], total: null });
    expect(() => rng.int(1, 20)).toThrow(/exhausted/i);
  });

  it('a Wisdom save while paralyzed is rolled normally', () => {
    const result = savingThrow(createScriptedRng([8]), {
      bonus: view.saveBonus('wis'),
      dc: 10,
      conditions: { ids: ['paralyzed'], exhaustion: 0 },
      ability: 'wis',
    });
    expect(result.autoFail).toBe(false);
    expect(result.total).toBe(7);
    expect(result.success).toBe(false);
  });
});
