import { applyEvents, createInitialState, type Entity } from '@iron-scribe/engine-core';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../catalog/catalog.js';
import { monsterToEntity } from '../catalog/spawn.js';
import { characterToEntity } from './character.js';
import { dndEncounterStart } from './encounter-start.js';
import { sampleCharacter } from './testing/sample.js';

const catalog = loadCatalog();
const template = catalog.monsters.get('goblin-warrior');
if (!template) throw new Error('missing goblin');

function stateWith(attitude: string | null, withEncounter = false) {
  const hero = characterToEntity(sampleCharacter(), 'hero', { name: 'Hero' });
  const goblin = monsterToEntity(template, 'goblin_1');
  const entities: Entity[] = [
    hero,
    ...(attitude === null ? [] : [{ ...goblin, system: { ...goblin.system, attitude } }]),
  ];
  const state = applyEvents(
    createInitialState({ seed: 1 }),
    entities.map((entity) => ({ type: 'entity.spawned' as const, entity })),
  );
  return withEncounter
    ? { ...state, system: { ...state.system, encounter: { round: 1, turnIndex: 0, order: [] } } }
    : state;
}

describe('encounter start', () => {
  it('rolls initiative before the first attack on a hostile creature', () => {
    expect(dndEncounterStart(stateWith('hostile'), 'hero')).toEqual({
      kind: 'initiative',
      surprised: [],
    });
  });

  it('does nothing for a neutral creature, an empty scene, or a running encounter', () => {
    expect(dndEncounterStart(stateWith('neutral'), 'hero')).toBeNull();
    expect(dndEncounterStart(stateWith(null), 'hero')).toBeNull();
    expect(dndEncounterStart(stateWith('hostile', true), 'hero')).toBeNull();
  });
});
