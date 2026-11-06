import { createScriptedRng } from '@iron-scribe/dice';
import { applyEvents, createInitialState } from '@iron-scribe/engine-core';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../catalog/catalog.js';
import { monsterToEntity } from '../catalog/spawn.js';
import { characterToEntity } from './character.js';
import { expandMultiattack } from './multiattack.js';
import { createDnd5eSystem } from './system.js';
import { sampleCharacter } from './testing/sample.js';

const catalog = loadCatalog();
const system = createDnd5eSystem({ catalog });

function actionsOf(id: string) {
  const monster = catalog.monsters.get(id);
  if (!monster) throw new Error(`missing ${id}`);
  return monster.actions;
}

describe('expandMultiattack', () => {
  it('expands fixed integer steps into attack actions', () => {
    const steps = expandMultiattack(actionsOf('ogre-zombie') ?? []);
    const all = catalog.monsters.list().map((m) => expandMultiattack(m.actions));
    expect(all.some((s) => s.length > 0)).toBe(true);
    expect(steps.every((a) => a.attackBonus !== null)).toBe(true);
  });

  it('returns [] for Hydra (variable count), option lists, and monsters without it', () => {
    expect(expandMultiattack(actionsOf('hydra'))).toEqual([]);
    expect(expandMultiattack(actionsOf('goblin-warrior'))).toEqual([]);
    for (const monster of catalog.monsters.list()) {
      const multi = monster.actions.find((a) => a.id === 'multiattack')?.multiattack;
      if (multi?.options) expect(expandMultiattack(monster.actions)).toEqual([]);
    }
  });

  it('returns [] when any step is not an attack', () => {
    const base = actionsOf('goblin-warrior')[0];
    if (!base) throw new Error('missing');
    const multi = {
      ...base,
      id: 'multiattack',
      name: 'Multiattack',
      attackBonus: null,
      multiattack: { steps: [{ action: 'Nope', count: 2 }], options: null },
    };
    expect(expandMultiattack([base, multi])).toEqual([]);
  });
});

describe('Multiattack resolution', () => {
  const eligible = catalog.monsters.list().find((m) => expandMultiattack(m.actions).length >= 2);
  if (!eligible) throw new Error('no eligible multiattack monster in the catalog');
  const hero = characterToEntity(
    sampleCharacter({ hpMax: 200, weapons: ['dagger'], weaponProficiencies: ['simple'] }),
    'hero',
  );
  const state = applyEvents(createInitialState({ seed: 1 }), [
    { type: 'entity.spawned', entity: hero },
    { type: 'entity.spawned', entity: monsterToEntity(eligible, 'm_1') },
  ]);

  it('is offered first on the menu with alias A1', () => {
    const menu = system.availableActions(state, 'm_1');
    expect(menu.actions[0]).toMatchObject({ alias: 'A1', actionId: 'monster:multiattack' });
  });

  it('runs every sub-attack on the same target, in order', () => {
    const menu = system.availableActions(state, 'm_1');
    const action = menu.actions[0];
    const target = menu.targets[0];
    if (!action || !target) throw new Error('menu');
    const count = expandMultiattack(eligible.actions).length;
    const rng = createScriptedRng(Array.from({ length: count * 4 }, () => 1));
    const result = system.resolve(state, { actorId: 'm_1', action, target }, rng);
    expect(result.facts.filter((f) => f.key === 'attack')).toHaveLength(count);
  });

  it('stops once the target is at 0 HP', () => {
    const menu = system.availableActions(state, 'm_1');
    const action = menu.actions[0];
    const target = menu.targets[0];
    if (!action || !target) throw new Error('menu');
    const frail = {
      ...state,
      entities: { ...state.entities, hero: { ...hero, hp: { current: 1, max: 200, temp: 0 } } },
    };
    const rng = createScriptedRng(Array.from({ length: 40 }, () => 6));
    const result = system.resolve(frail, { actorId: 'm_1', action, target }, rng);
    const attacks = result.facts.filter((f) => f.key === 'attack').length;
    expect(attacks).toBeGreaterThanOrEqual(1);
    expect(attacks).toBeLessThan(expandMultiattack(eligible.actions).length + 1);
    const next = applyEvents(frail, result.events, system);
    expect(next.entities['hero']?.hp.current).toBe(0);
  });
});
