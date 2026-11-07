import { createScriptedRng } from '@iron-scribe/dice';
import {
  applyEvents,
  createEngine,
  createInitialState,
  type Entity,
} from '@iron-scribe/engine-core';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../catalog/catalog.js';
import { monsterToEntity } from '../catalog/spawn.js';
import { characterToEntity } from './character.js';
import { readConditions } from './conditions.js';
import { resolveHide, resolveSearch } from './hide.js';
import { createDnd5eSystem } from './system.js';
import { sampleCharacter } from './testing/sample.js';

const catalog = loadCatalog();
const goblin = catalog.monsters.get('goblin-warrior');
if (!goblin) throw new Error('missing goblin');

function hero(): Entity {
  return characterToEntity(
    sampleCharacter({
      abilities: { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 },
      skillProficiencies: [{ skill: 'stealth', expertise: false }],
    }),
    'hero',
    { name: 'Hero' },
  );
}

function scene(...entities: Entity[]) {
  return applyEvents(
    createInitialState({ seed: 1 }),
    entities.map((entity) => ({ type: 'entity.spawned' as const, entity })),
  );
}

describe('Hide and Search (SRD 5.2.1)', () => {
  it('succeeds on DC 15, grants Invisible, and stores the Stealth total', () => {
    const foe = monsterToEntity(goblin, 'goblin_1');
    const state = scene(hero(), { ...foe, system: { ...foe.system, attitude: 'hostile' } });
    const result = resolveHide(state, state.entities['hero']!, createScriptedRng([20]), catalog);
    expect(result.facts[0]?.text).toMatch(/^Stealth \d+ vs DC 15, success$/);
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'conditions' }),
        expect.objectContaining({ key: 'hiddenStealthDc' }),
      ]),
    );
    const dc = result.events.find(
      (event) => event.type === 'entity.systemDataSet' && event.key === 'hiddenStealthDc',
    );
    expect(dc && 'value' in dc ? dc.value : null).toBeGreaterThanOrEqual(15);
  });

  it('is spotted when an opponent Passive Perception meets the total', () => {
    const watcher = characterToEntity(
      sampleCharacter({
        abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 20, cha: 10 },
        skillProficiencies: [{ skill: 'perception', expertise: true }],
      }),
      'watcher',
      { name: 'Watcher' },
    );
    const hostile = { ...watcher, system: { ...watcher.system, attitude: 'hostile' } };
    const state = scene(hero(), hostile);
    const result = resolveHide(state, state.entities['hero']!, createScriptedRng([10]), catalog);
    expect(result.facts.map((fact) => fact.text).join(' ')).toMatch(/Spotted by Watcher/);
    expect(result.events).toEqual([]);
  });

  it('an attack roll ends Hide', () => {
    const system = createDnd5eSystem({ catalog });
    const sheet = hero();
    const hidden: Entity = {
      ...sheet,
      system: {
        ...sheet.system,
        conditions: { ids: ['invisible'], exhaustion: 0 },
        hiddenStealthDc: 18,
      },
    };
    const foe = monsterToEntity(goblin, 'goblin_1');
    const engine = createEngine({ system, initialState: createInitialState({ seed: 2 }) });
    engine.commit('spawn', [
      { type: 'entity.spawned', entity: hidden },
      {
        type: 'entity.spawned',
        entity: { ...foe, system: { ...foe.system, attitude: 'hostile' } },
      },
    ]);
    const action = engine.menu('hero').actions[0];
    const target = engine.menu('hero').targets[0];
    if (!action || !target) throw new Error('missing menu');
    engine.perform({ actorId: 'hero', actionAlias: action.alias, targetAlias: target.alias });
    const after = engine.state.entities['hero'];
    if (!after) throw new Error('missing');
    expect(after.system['hiddenStealthDc']).toBeNull();
    expect(readConditions(after).ids).not.toContain('invisible');
  });

  it('Search ends Hide when the Perception total meets the Stealth DC', () => {
    const sheet = hero();
    const hidden: Entity = {
      ...sheet,
      system: {
        ...sheet.system,
        conditions: { ids: ['invisible'], exhaustion: 0 },
        hiddenStealthDc: 12,
      },
    };
    const foe = monsterToEntity(goblin, 'goblin_1');
    const hostile = { ...foe, system: { ...foe.system, attitude: 'hostile' } };
    const state = scene(hidden, hostile);
    const result = resolveSearch(
      state,
      state.entities['goblin_1']!,
      createScriptedRng([20]),
      catalog,
    );
    expect(result?.facts[0]?.text).toMatch(/^Perception \d+ spots Hero$/);
    expect(
      result?.events.some(
        (event) => event.type === 'entity.systemDataSet' && event.key === 'hiddenStealthDc',
      ),
    ).toBe(true);
  });
});
