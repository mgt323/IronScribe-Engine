import { createScriptedRng } from '@iron-scribe/dice';
import { applyEvents, createInitialState, type Entity } from '@iron-scribe/engine-core';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../catalog/catalog.js';
import { monsterToEntity } from '../catalog/spawn.js';
import { readEncounter } from './combat.js';
import { characterToEntity } from './character.js';
import { engageNearbyHostiles, joinEncounter } from './join-encounter.js';
import { sampleCharacter } from './testing/sample.js';

const catalog = loadCatalog();
const goblin = catalog.monsters.get('goblin-warrior');
const wolf = catalog.monsters.get('wolf');
if (!goblin || !wolf) throw new Error('missing monster');

function fight(
  entities: Entity[],
  order: { entityId: string; total: number }[],
  turnIndex: number,
) {
  return applyEvents(createInitialState({ seed: 1 }), [
    ...entities.map((entity) => ({ type: 'entity.spawned' as const, entity })),
    {
      type: 'state.systemDataSet' as const,
      key: 'encounter',
      value: { round: 1, turnIndex, acted: [], order },
    },
  ]);
}

describe('reinforcements', () => {
  it('shares the group roll and does not move the current turn', () => {
    const hero = characterToEntity(sampleCharacter(), 'hero', { name: 'Hero' });
    const first = monsterToEntity(goblin, 'goblin_1');
    const second = monsterToEntity(goblin, 'goblin_2');
    const state = fight(
      [
        hero,
        { ...first, system: { ...first.system, attitude: 'hostile' } },
        { ...second, system: { ...second.system, attitude: 'hostile' } },
      ],
      [
        { entityId: 'hero', total: 10 },
        { entityId: 'goblin_1', total: 18 },
      ],
      0,
    );
    const joined = joinEncounter(state, createScriptedRng([]), ['goblin_2'], catalog);
    const encounter = joined.events[0];
    expect(encounter).toMatchObject({
      value: {
        turnIndex: 1,
        acted: ['goblin_2'],
        order: [
          { entityId: 'goblin_2', total: 18 },
          { entityId: 'hero', total: 10 },
          { entityId: 'goblin_1', total: 18 },
        ],
      },
    });
  });

  it('marks a combatant inserted before the current turn as already acted', () => {
    const hero = characterToEntity(sampleCharacter(), 'hero', { name: 'Hero' });
    const standing = monsterToEntity(goblin, 'goblin_1');
    const extra = monsterToEntity(wolf, 'wolf_1');
    const state = fight(
      [
        hero,
        { ...standing, system: { ...standing.system, attitude: 'hostile' } },
        { ...extra, system: { ...extra.system, attitude: 'hostile' } },
      ],
      [
        { entityId: 'hero', total: 5 },
        { entityId: 'goblin_1', total: 8 },
      ],
      1,
    );
    const joined = joinEncounter(state, createScriptedRng([20]), ['wolf_1'], catalog);
    const value = (
      joined.events[0] as {
        value: { turnIndex: number; acted: string[]; order: { entityId: string }[] };
      }
    ).value;
    expect(value.order[value.turnIndex]?.entityId).toBe('goblin_1');
    const index = value.order.findIndex((entry) => entry.entityId === 'wolf_1');
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index < value.turnIndex).toBe(value.acted.includes('wolf_1'));
  });

  it('pulls a nearby hostile into the order', () => {
    const hero = characterToEntity(sampleCharacter(), 'hero', { name: 'Hero' });
    const waiting = { ...monsterToEntity(wolf, 'wolf_1'), proximity: 'nearby' as const };
    const state = fight(
      [hero, { ...waiting, system: { ...waiting.system, attitude: 'hostile' } }],
      [{ entityId: 'hero', total: 10 }],
      0,
    );
    const engaged = engageNearbyHostiles(state, createScriptedRng([1]), catalog);
    expect(engaged.events[0]).toMatchObject({
      type: 'entity.presenceSet',
      entityId: 'wolf_1',
      proximity: 'engaged',
    });
    const next = readEncounter(applyEvents(state, engaged.events));
    expect(next?.order.some((entry) => entry.entityId === 'wolf_1')).toBe(true);
    expect(next?.order[next.turnIndex]?.entityId).toBe('hero');
  });
});
