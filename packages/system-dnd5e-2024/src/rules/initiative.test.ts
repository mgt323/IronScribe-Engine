import { createScriptedRng } from '@iron-scribe/dice';
import { applyEvents, createInitialState, type Entity } from '@iron-scribe/engine-core';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../catalog/catalog.js';
import { monsterToEntity } from '../catalog/spawn.js';
import { characterToEntity } from './character.js';
import { sampleCharacter } from './testing/sample.js';
import { rollInitiative } from './initiative.js';

const catalog = loadCatalog();
const goblin = catalog.monsters.get('goblin-warrior');
if (!goblin) throw new Error('missing goblin');

function stateWith(...entities: Entity[]) {
  return applyEvents(
    createInitialState({ seed: 1 }),
    entities.map((entity) => ({ type: 'entity.spawned' as const, entity })),
  );
}

const abilities = (dex: number) => ({ str: 10, dex, con: 10, int: 10, wis: 10, cha: 10 });

describe('initiative (SRD 5.2.1, Initiative)', () => {
  it('breaks a tie by Dexterity score, then by spawn order', () => {
    const hero = characterToEntity(sampleCharacter({ abilities: abilities(14) }), 'hero', {
      name: 'Hero',
    });
    const tied = rollInitiative(
      stateWith(hero, monsterToEntity(goblin, 'goblin_1')),
      createScriptedRng([10, 10]),
      [],
      catalog,
    );
    expect(tied.events[0]).toMatchObject({
      type: 'state.systemDataSet',
      key: 'encounter',
      value: {
        round: 1,
        turnIndex: 0,
        order: [
          { entityId: 'goblin_1', total: 12 },
          { entityId: 'hero', total: 12 },
        ],
      },
    });

    const sameDex = characterToEntity(sampleCharacter({ abilities: abilities(15) }), 'hero', {
      name: 'Hero',
    });
    const spawn = rollInitiative(
      stateWith(sameDex, monsterToEntity(goblin, 'goblin_1')),
      createScriptedRng([10, 10]),
      [],
      catalog,
    );
    const order = (spawn.events[0] as { value: { order: { entityId: string }[] } }).value.order;
    expect(order.map((entry) => entry.entityId)).toEqual(['hero', 'goblin_1']);
  });

  it('surprised creatures roll with disadvantage (SRD 2024 Surprise)', () => {
    const hero = characterToEntity(sampleCharacter({ abilities: abilities(14) }), 'hero', {
      name: 'Hero',
    });
    const result = rollInitiative(
      stateWith(hero, monsterToEntity(goblin, 'goblin_1')),
      createScriptedRng([18, 3, 10]),
      ['hero'],
      catalog,
    );
    expect(result.facts.map((fact) => fact.text)).toEqual([
      'Goblin Warrior 12',
      'Hero 5 (disadvantage)',
    ]);
    expect(result.facts[0]?.key).toBe('initiative');
  });

  it('rejects a surprised id that is not in the scene', () => {
    const hero = characterToEntity(sampleCharacter(), 'hero');
    expect(() =>
      rollInitiative(stateWith(hero), createScriptedRng([]), ['ghost'], catalog),
    ).toThrow(/ghost/);
  });
});
