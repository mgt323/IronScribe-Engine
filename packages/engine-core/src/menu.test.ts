import { describe, expect, it } from 'vitest';

import { createEngine, type Engine } from './engine.js';
import { EngineError, type EngineErrorCode } from './errors.js';
import type { CoreEvent } from './events.js';
import type { ActionRequest, ResolvedRequest, RuleSystem } from './rule-system.js';
import { createInitialState } from './state.js';
import { createFakeSystem, makeEntity } from './testing/fake-system.js';

const spawn = (id: string, proximity: 'engaged' | 'gone' = 'engaged'): CoreEvent => ({
  type: 'entity.spawned',
  entity: makeEntity(id, { proximity }),
});

function setup(system: RuleSystem = createFakeSystem()): Engine {
  const engine = createEngine({ system, initialState: createInitialState({ seed: 7 }) });
  engine.commit('setup', [spawn('hero'), spawn('goblin'), spawn('ghost', 'gone')]);
  return engine;
}

function code(fn: () => unknown): EngineErrorCode | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof EngineError) {
      return e.code;
    }
    throw e;
  }
  return undefined;
}

const poke = (targetAlias: string | null): ActionRequest => ({
  actorId: 'hero',
  actionAlias: 'A1',
  targetAlias,
});

describe('menu', () => {
  it('uses A1..An and T1..Tn aliases and hides absent entities', () => {
    const menu = setup().menu('hero');
    expect(menu.actions.map((a) => a.alias)).toEqual(['A1', 'A2']);
    expect(menu.targets).toEqual([{ alias: 'T1', entityId: 'goblin', label: 'goblin' }]);
  });

  it('passes the resolved target entityId to resolve', () => {
    let seen: ResolvedRequest | undefined;
    const fake = createFakeSystem();
    const engine = setup({
      ...fake,
      resolve(state, request, rng) {
        seen = request;
        return fake.resolve(state, request, rng);
      },
    });
    engine.perform(poke('T1'));
    expect(seen?.target?.entityId).toBe('goblin');
    expect(seen?.action.actionId).toBe('poke');
  });

  it('rejects missing and absent actors', () => {
    const engine = setup();
    expect(code(() => engine.menu('nobody'))).toBe('unknown_entity');
    expect(code(() => engine.menu('ghost'))).toBe('actor_not_present');
    expect(code(() => engine.perform({ ...poke('T1'), actorId: 'nobody' }))).toBe('unknown_entity');
    expect(code(() => engine.perform({ ...poke('T1'), actorId: 'ghost' }))).toBe(
      'actor_not_present',
    );
  });

  it('rejects bad requests with no state change and no commit', () => {
    const engine = setup();
    const before = engine.state;
    const n = engine.commits.length;
    expect(code(() => engine.perform(poke('T9')))).toBe('unknown_alias');
    expect(code(() => engine.perform({ ...poke('T1'), actionAlias: 'A9' }))).toBe('unknown_alias');
    expect(code(() => engine.perform(poke(null)))).toBe('target_required');
    expect(code(() => engine.perform({ ...poke('T1'), actionAlias: 'A2' }))).toBe(
      'unexpected_target',
    );
    expect(engine.state).toBe(before);
    expect(engine.commits.length).toBe(n);
  });

  it('empty scene has no targets, so a targeted poke is unknown_alias', () => {
    const engine = createEngine({
      system: createFakeSystem(),
      initialState: createInitialState({ seed: 1 }),
    });
    engine.commit('hero', [spawn('hero')]);
    expect(engine.menu('hero').targets).toEqual([]);
    expect(code(() => engine.perform(poke('T1')))).toBe('unknown_alias');
  });
});
