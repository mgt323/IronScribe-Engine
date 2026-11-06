import {
  applyEvents,
  createEngine,
  createInitialState,
  EngineError,
  type Entity,
  type GameState,
} from '@iron-scribe/engine-core';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../catalog/catalog.js';
import { monsterToEntity } from '../catalog/spawn.js';
import { characterToEntity } from './character.js';
import { readEncounter } from './combat.js';
import { createDnd5eSystem } from './system.js';
import { sampleCharacter } from './testing/sample.js';

const catalog = loadCatalog();
const system = createDnd5eSystem({ catalog });
const goblin = catalog.monsters.get('goblin-warrior');
if (!goblin) throw new Error('missing goblin');

const hero = () => characterToEntity(sampleCharacter(), 'hero', { name: 'Hero' });
const gob = (id: string, patch: Partial<Entity> = {}): Entity => {
  const base = monsterToEntity(goblin, id);
  return { ...base, system: { ...base.system, attitude: 'hostile' }, ...patch };
};

function scene(order: string[], entities: Entity[], turnIndex = 0): GameState {
  const base = applyEvents(
    createInitialState({ seed: 1 }),
    entities.map((entity) => ({ type: 'entity.spawned' as const, entity })),
  );
  return applyEvents(base, [
    {
      type: 'state.systemDataSet',
      key: 'encounter',
      value: {
        round: 1,
        turnIndex,
        acted: [],
        order: order.map((entityId) => ({ entityId, total: 10 })),
      },
    },
  ]);
}

describe('combat steps', () => {
  it('an NPC ahead of the player acts first, aimed at the player', () => {
    const state = scene(['goblin_1', 'hero'], [hero(), gob('goblin_1')]);
    const step = system.nextCombatStep?.(state, 'hero');
    expect(step).toEqual({
      kind: 'action',
      request: { actorId: 'goblin_1', actionAlias: 'A1', targetAlias: 'T1' },
    });
  });

  it('hands control to the player on their turn', () => {
    const state = scene(['hero', 'goblin_1'], [hero(), gob('goblin_1')]);
    expect(system.nextCombatStep?.(state, 'hero')).toBeNull();
    expect(system.turnEnd?.(state, 'hero')).toEqual({ kind: 'advanceTurn' });
  });

  it('an NPC with no legal action still ends its turn', () => {
    const stunned = gob('goblin_1', {
      system: { ...gob('goblin_1').system, conditions: { ids: ['incapacitated'], exhaustion: 0 } },
    });
    const state = scene(['goblin_1', 'hero'], [hero(), stunned]);
    const step = system.nextCombatStep?.(state, 'hero');
    expect(step).toMatchObject({ kind: 'procedure', procedure: { kind: 'advanceTurn' } });
  });

  it('advances turn by turn, then the round once everyone has acted', () => {
    const engine = createEngine({
      system,
      initialState: scene(['hero', 'goblin_1'], [hero(), gob('goblin_1')]),
    });
    engine.runProcedure('t', { kind: 'advanceTurn' });
    expect(readEncounter(engine.state)).toMatchObject({ turnIndex: 1, acted: ['hero'] });
    expect(() => engine.runProcedure('t', { kind: 'advanceRound' })).toThrow(EngineError);
    engine.runProcedure('t', { kind: 'advanceTurn' });
    expect(system.nextCombatStep?.(engine.state, 'hero')).toMatchObject({
      procedure: { kind: 'advanceRound' },
    });
    engine.runProcedure('t', { kind: 'advanceRound' });
    expect(readEncounter(engine.state)).toMatchObject({ round: 2, turnIndex: 0, acted: [] });
  });

  it('is suspended, not ended, while the player is down and hostiles live', () => {
    const down = { ...hero(), hp: { current: 0, max: 10, temp: 0 } } as Entity;
    const state = scene(['goblin_1', 'hero'], [down, gob('goblin_1')]);
    expect(system.nextCombatStep?.(state, 'hero')).toBeNull();
    expect(readEncounter(state)).not.toBeNull();
    const engine = createEngine({ system, initialState: state });
    expect(() => engine.runProcedure('t', { kind: 'endEncounter' })).toThrow(EngineError);
  });

  it('ends the encounter only when no living hostile is present', () => {
    const dead = gob('goblin_1', { hp: { current: 0, max: 10, temp: 0 } } as Partial<Entity>);
    const engine = createEngine({
      system,
      initialState: scene(['hero', 'goblin_1'], [hero(), dead]),
    });
    expect(system.nextCombatStep?.(engine.state, 'hero')).toMatchObject({
      procedure: { kind: 'endEncounter' },
    });
    engine.runProcedure('t', { kind: 'endEncounter' });
    expect(readEncounter(engine.state)).toBeNull();
    expect(system.nextCombatStep?.(engine.state, 'hero')).toBeNull();
  });
});
