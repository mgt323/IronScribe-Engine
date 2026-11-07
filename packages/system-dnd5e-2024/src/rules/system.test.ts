import { createScriptedRng } from '@iron-scribe/dice';
import {
  applyEvents,
  createEngine,
  createInitialState,
  EngineError,
  replay,
  type Entity,
  type GameState,
} from '@iron-scribe/engine-core';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../catalog/catalog.js';
import { monsterToEntity } from '../catalog/spawn.js';
import { characterToEntity } from './character.js';
import { sampleCharacter } from './testing/sample.js';
import { readConditions } from './conditions.js';
import { createDnd5eSystem } from './system.js';

const catalog = loadCatalog();
const system = createDnd5eSystem({ catalog });
const goblin = catalog.monsters.get('goblin-warrior');
if (!goblin) throw new Error('missing goblin');

const abilities = { str: 8, dex: 16, con: 14, int: 10, wis: 12, cha: 10 };

function heroEntity(hpMax = 12): Entity {
  return characterToEntity(
    sampleCharacter({
      abilities,
      hpMax,
      armor: 'leather-armor',
      weapons: ['dagger', 'shortbow'],
      weaponProficiencies: ['simple'],
      skillProficiencies: [{ skill: 'stealth', expertise: false }],
    }),
    'hero',
    { name: 'Hero' },
  );
}

function scene(hpMax = 12): GameState {
  return applyEvents(createInitialState({ seed: 'stage4' }), [
    { type: 'entity.spawned', entity: heroEntity(hpMax) },
    { type: 'entity.spawned', entity: monsterToEntity(goblin, 'goblin_1') },
  ]);
}

describe('D&D menu', () => {
  it('offers carried weapons and monster attacks, and hides the other side at 0 HP', () => {
    const state = scene();
    const menu = system.availableActions(state, 'hero');
    expect(menu.actions.map((action) => action.actionId)).toEqual([
      'weapon:dagger',
      'weapon:shortbow',
    ]);
    expect(menu.actions.every((action) => action.needsTarget)).toBe(true);
    expect(menu.targets).toEqual([{ alias: 'T1', entityId: 'goblin_1', label: 'Goblin Warrior' }]);
    const goblinMenu = system.availableActions(state, 'goblin_1');
    expect(goblinMenu.actions.map((action) => action.actionId)).toEqual([
      'monster:scimitar',
      'monster:shortbow',
    ]);
    expect(goblinMenu.targets.map((target) => target.entityId)).toEqual(['hero']);
  });

  it('an unconscious or 0 HP creature has nothing to do', () => {
    const base = scene();
    const hero = base.entities['hero'];
    if (!hero) throw new Error('missing');
    const unconscious = {
      ...base,
      entities: {
        ...base.entities,
        hero: {
          ...hero,
          system: { ...hero.system, conditions: { ids: ['unconscious'], exhaustion: 0 } },
        },
      },
    };
    expect(system.availableActions(unconscious, 'hero').actions).toEqual([]);
    const goblinEntity = base.entities['goblin_1'];
    if (!goblinEntity) throw new Error('missing');
    const empty = {
      ...base,
      entities: {
        ...base.entities,
        goblin_1: { ...goblinEntity, hp: { current: 0, max: goblinEntity.hp.max } },
      },
    };
    expect(system.availableActions(empty, 'goblin_1').actions).toEqual([]);
  });
});

describe('resolving an attack', () => {
  it('a dagger hit deals piercing and records the new hit points', () => {
    const state = scene();
    const menu = system.availableActions(state, 'hero');
    const action = menu.actions[0];
    const target = menu.targets[0];
    if (!action || !target) throw new Error('missing menu');
    const resolution = system.resolve(
      state,
      { actorId: 'hero', action, target },
      createScriptedRng([10, 2]),
    );
    expect(resolution.facts.map((fact) => fact.text)).toEqual([
      '15 vs AC 15, hit',
      '5 piercing',
      'goblin_1 5/10',
    ]);
    expect(resolution.events).toEqual([
      { type: 'entity.damaged', entityId: 'goblin_1', amount: 5 },
    ]);
  });

  it('a monster critical hit drops a character to 0 and applies Unconscious', () => {
    const state = scene(4);
    const menu = system.availableActions(state, 'goblin_1');
    const action = menu.actions[0];
    const target = menu.targets[0];
    if (!action || !target) throw new Error('missing menu');
    const resolution = system.resolve(
      state,
      { actorId: 'goblin_1', action, target },
      createScriptedRng([20, 3, 3]),
    );
    expect(resolution.facts.find((fact) => fact.key === 'attack')?.text).toBe(
      '24 vs AC 14, critical hit',
    );
    const next = applyEvents(state, resolution.events, system);
    const hero = next.entities['hero'];
    if (!hero) throw new Error('missing');
    expect(hero.hp.current).toBe(0);
    expect(readConditions(hero).ids).toEqual(['unconscious']);
    expect(resolution.facts.some((fact) => fact.key === 'defeated')).toBe(false);
  });

  it('a club doubles against a skeleton (vulnerability to bludgeoning)', () => {
    const skeleton = catalog.monsters.get('skeleton');
    if (!skeleton) throw new Error('missing skeleton');
    const hero = characterToEntity(
      sampleCharacter({
        abilities: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        weapons: ['club'],
        weaponProficiencies: ['simple'],
      }),
      'hero',
    );
    const state = applyEvents(createInitialState({ seed: 1 }), [
      { type: 'entity.spawned', entity: hero },
      { type: 'entity.spawned', entity: monsterToEntity(skeleton, 'skeleton_1') },
    ]);
    const menu = system.availableActions(state, 'hero');
    const action = menu.actions[0];
    const target = menu.targets[0];
    if (!action || !target) throw new Error('missing menu');
    const resolution = system.resolve(
      state,
      { actorId: 'hero', action, target },
      createScriptedRng([12, 3]),
    );
    expect(resolution.facts.map((fact) => fact.text)).toContain('12 bludgeoning (vulnerability)');
  });
});

describe('procedures, undo and replay', () => {
  it('runs initiative, an attack and a save, then undo restores the dice', () => {
    const initial = createInitialState({ seed: 'play' });
    const engine = createEngine({ system, initialState: initial });
    engine.commit('spawn', [
      { type: 'entity.spawned', entity: heroEntity() },
      { type: 'entity.spawned', entity: monsterToEntity(goblin, 'goblin_1') },
    ]);
    engine.runProcedure('initiative', { kind: 'initiative', surprised: [] });
    const menu = engine.menu('hero');
    const attack = menu.actions[0];
    const target = menu.targets[0];
    if (!attack || !target) throw new Error('missing menu');
    engine.perform({ actorId: 'hero', actionAlias: attack.alias, targetAlias: target.alias });
    const save = engine.runProcedure('save', {
      kind: 'save',
      actorId: 'hero',
      ability: 'dex',
      dc: 12,
    });
    expect(save.procedure).toMatchObject({ kind: 'save', ability: 'dex' });
    expect(save.facts[0]?.key).toBe('save');
    expect(save.facts[0]?.text).toMatch(/Dexterity \d+ vs DC 12/);
    expect(engine.state.system['encounter']).toBeTruthy();
    const played = engine.state;
    expect(replay(initial, engine.commits, system)).toEqual(played);
    while (engine.canUndo) engine.undo();
    expect(engine.state).toEqual(initial);
    while (engine.canRedo) engine.redo();
    expect(engine.state).toEqual(played);
  });

  it('a stealth check uses the skill bonus and names the skill', () => {
    const initial = createInitialState({ seed: 3 });
    const engine = createEngine({ system, initialState: initial });
    engine.commit('spawn', [{ type: 'entity.spawned', entity: heroEntity() }]);
    const commit = engine.runProcedure('check', {
      kind: 'check',
      actorId: 'hero',
      ability: 'dex',
      skill: 'stealth',
      dc: 12,
    });
    expect(commit.facts[0]?.text).toMatch(/^Stealth \d+ vs DC 12, /);
    expect(commit.events.some((event) => event.type === 'rng.advanced')).toBe(true);
  });

  it('stealth during a fight is only a fact unless Hide is legal', () => {
    const initial = createInitialState({ seed: 'stealth' });
    const engine = createEngine({ system, initialState: initial });
    engine.commit('spawn', [
      { type: 'entity.spawned', entity: heroEntity() },
      {
        type: 'state.systemDataSet',
        key: 'encounter',
        value: { round: 1, turnIndex: 0, acted: [], order: [] },
      },
    ]);
    const check = engine.runProcedure('check', {
      kind: 'check',
      actorId: 'hero',
      ability: 'dex',
      skill: 'stealth',
      dc: 12,
    });
    expect(check.facts.map((fact) => fact.text).join(' ')).toMatch(/^Stealth \d+ vs DC 12, /);
    expect(check.events.some((event) => event.type === 'entity.systemDataSet')).toBe(false);
    const hero = engine.state.entities['hero'];
    if (!hero) throw new Error('missing');
    expect(readConditions(hero).ids).not.toContain('invisible');
    expect(
      system.resolveCheckDc?.(engine.state, {
        actorId: 'hero',
        ability: 'dex',
        skill: 'stealth',
        procedureId: 'check',
      }),
    ).toBe(12);
  });

  it('rejects a procedure the rules do not know', () => {
    const engine = createEngine({ system, initialState: createInitialState({ seed: 1 }) });
    expect(() => engine.runProcedure('nope', { kind: 'sing', song: 'x' })).toThrow(EngineError);
    try {
      engine.runProcedure('nope', { kind: 'sing', song: 'x' });
    } catch (error) {
      expect((error as EngineError).code).toBe('unknown_alias');
    }
  });
});
