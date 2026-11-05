import { createEngine, createInitialState, replay, type Entity } from '@iron-scribe/engine-core';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from './catalog.js';
import { monsterToEntity, readMonsterSnapshot } from './spawn.js';

const c = loadCatalog();
const goblin = () => {
  const m = c.monsters.get('goblin-warrior');
  if (!m) throw new Error('missing');
  return m;
};

describe('monsterToEntity', () => {
  it('copies name, hp and template ref from the SRD template', () => {
    const e = monsterToEntity(goblin(), 'goblin_1');
    expect(e).toMatchObject({
      id: 'goblin_1',
      name: 'Goblin Warrior',
      templateRef: 'srd-5.2.1:monster:goblin-warrior',
      present: true,
      hp: { current: 10, max: 10 },
    });
  });

  it('name override keeps the snapshot', () => {
    const a = monsterToEntity(goblin(), 'goblin_2', { name: 'Goblin Warrior 2' });
    expect(a.name).toBe('Goblin Warrior 2');
    expect(readMonsterSnapshot(a)).toEqual(goblin());
  });

  it('snapshot is the full template and JSON-safe', () => {
    const e = monsterToEntity(goblin(), 'goblin_1');
    expect(readMonsterSnapshot(e)).toEqual(goblin());
    const roundTrip = JSON.parse(JSON.stringify(e)) as Entity;
    expect(readMonsterSnapshot(roundTrip)).toEqual(goblin());
  });

  it('snapshot carries saves, skills, attacks and defenses', () => {
    const snap = readMonsterSnapshot(monsterToEntity(goblin(), 'g'));
    expect(snap.saves.dex).toBe(2);
    expect(snap.skills.stealth).toBe(6);
    expect(snap.actions.find((a) => a.name === 'Scimitar')?.attackBonus).toBe(4);
    const skeleton = c.monsters.get('skeleton');
    if (!skeleton) throw new Error('missing');
    expect(readMonsterSnapshot(monsterToEntity(skeleton, 's')).immunities).toContain('poison');
  });

  it('survives engine commit and replay', () => {
    const system = {
      id: 'x',
      availableActions: () => ({ actions: [], targets: [] }),
      resolve: () => ({ events: [], facts: [] }),
    };
    const initial = createInitialState({ seed: 1 });
    const engine = createEngine({ system, initialState: initial });
    const entity = monsterToEntity(goblin(), 'goblin_1');
    engine.commit('spawn', [{ type: 'entity.spawned', entity }]);
    const rebuilt = replay(initial, engine.commits, system);
    expect(readMonsterSnapshot(rebuilt.entities['goblin_1'] as Entity)).toEqual(goblin());
  });

  it('readMonsterSnapshot throws without a snapshot', () => {
    const e = { ...monsterToEntity(goblin(), 'g'), system: {} };
    expect(() => readMonsterSnapshot(e)).toThrow();
  });
});
