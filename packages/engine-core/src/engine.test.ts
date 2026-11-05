import { describe, expect, it } from 'vitest';

import { createEngine, type Engine } from './engine.js';
import { EngineError } from './errors.js';
import type { CoreEvent } from './events.js';
import { replay } from './replay.js';
import type { ActionRequest, RuleSystem } from './rule-system.js';
import { createInitialState } from './state.js';
import { createFakeSystem, makeEntity } from './testing/fake-system.js';

const initial = createInitialState({ seed: 'seed' });
const poke: ActionRequest = { actorId: 'hero', actionAlias: 'A1', targetAlias: 'T1' };
const wait: ActionRequest = { actorId: 'hero', actionAlias: 'A2', targetAlias: null };

function setup(system: RuleSystem = createFakeSystem()): Engine {
  const engine = createEngine({ system, initialState: initial });
  engine.commit('setup', [
    { type: 'entity.spawned', entity: makeEntity('hero') },
    { type: 'entity.spawned', entity: makeEntity('goblin', { hp: { current: 50, max: 50 } }) },
  ]);
  return engine;
}

describe('perform', () => {
  it('appends one commit with events, facts, and a trailing rng.advanced', () => {
    const engine = setup();
    engine.perform(poke);
    const c = engine.commits.at(-1);
    expect(engine.commits.length).toBe(2);
    expect(c?.request).toEqual(poke);
    expect(c?.facts.length).toBe(1);
    expect(c?.events.map((e) => e.type)).toEqual(['entity.damaged', 'rng.advanced']);
    expect(engine.state.rng).not.toEqual(initial.rng);
  });

  it('wait adds no rng.advanced because the RNG did not move', () => {
    const engine = setup();
    engine.perform(wait);
    expect(engine.commits.at(-1)?.events).toEqual([]);
    expect(engine.state.rng).toEqual(initial.rng);
  });

  it('commit() stores request null and no facts, and can be undone', () => {
    const engine = setup();
    const c = engine.commits[0];
    expect(c?.request).toBeNull();
    expect(c?.procedure).toBeNull();
    expect(c?.facts).toEqual([]);
    engine.undo();
    expect(engine.state).toEqual(initial);
  });

  it('a failing event mid-batch changes nothing', () => {
    const fake = createFakeSystem();
    const engine = setup({
      ...fake,
      resolve: () => ({
        events: [
          { type: 'entity.damaged', entityId: 'goblin', amount: 1 },
          { type: 'entity.damaged', entityId: 'nobody', amount: 1 },
        ],
        facts: [],
      }),
    });
    const before = engine.state;
    expect(() => engine.perform(poke)).toThrow(EngineError);
    expect(engine.state).toBe(before);
    expect(engine.commits.length).toBe(1);
  });

  it('rejects rng.advanced from rule systems and from commit()', () => {
    const fake = createFakeSystem();
    const forged: CoreEvent = { type: 'rng.advanced', state: initial.rng };
    const engine = setup({ ...fake, resolve: () => ({ events: [forged], facts: [] }) });
    expect(() => engine.perform(poke)).toThrow(/rng\.advanced/);
    expect(() => engine.commit('x', [forged])).toThrow(EngineError);
    try {
      engine.commit('x', [forged]);
    } catch (e) {
      expect((e as EngineError).code).toBe('forbidden_event');
    }
  });
});

describe('undo / redo', () => {
  it('round-trips and a new commit clears redo', () => {
    const engine = setup();
    engine.perform(poke);
    const after = engine.state;
    engine.undo();
    expect(engine.canRedo).toBe(true);
    engine.redo();
    expect(engine.state).toEqual(after);
    engine.undo();
    engine.perform(wait);
    expect(engine.canRedo).toBe(false);
  });

  it('restores rng so the repeated action rolls the same', () => {
    const engine = setup();
    const rngBefore = engine.state.rng;
    engine.perform(poke);
    const first = engine.state;
    engine.undo();
    expect(engine.state.rng).toEqual(rngBefore);
    engine.perform(poke);
    expect(engine.state).toEqual(first);
  });

  it('throws when there is nothing to undo or redo', () => {
    const engine = createEngine({ system: createFakeSystem(), initialState: initial });
    expect(() => engine.undo()).toThrow(/undo/);
    expect(() => engine.redo()).toThrow(/redo/);
  });
});

describe('runProcedure', () => {
  it('logs the procedure, heals from the seeded RNG, and appends rng.advanced', () => {
    const engine = setup();
    engine.perform(poke);
    const before = engine.state.entities['goblin']?.hp.current ?? 0;
    const procedure = { kind: 'rollHeal', entityId: 'goblin' };
    const commit = engine.runProcedure('heal', procedure);
    expect(commit.request).toBeNull();
    expect(commit.procedure).toEqual(procedure);
    expect(commit.events.map((e) => e.type)).toEqual(['entity.healed', 'rng.advanced']);
    expect(engine.state.entities['goblin']?.hp.current).toBeGreaterThan(before);
  });

  it('undo and redo restore the dice stream, and replay matches', () => {
    const engine = setup();
    const rngBefore = engine.state.rng;
    engine.runProcedure('heal', { kind: 'rollHeal', entityId: 'goblin' });
    const after = engine.state;
    engine.undo();
    expect(engine.state.rng).toEqual(rngBefore);
    engine.redo();
    expect(engine.state).toEqual(after);
    expect(replay(initial, engine.commits, createFakeSystem())).toEqual(engine.state);
  });

  it('throws no_procedure_handler when the system has none, with no commit', () => {
    const fake = createFakeSystem();
    const engine = setup({
      id: fake.id,
      availableActions: (state, actorId) => fake.availableActions(state, actorId),
      resolve: (state, request, rng) => fake.resolve(state, request, rng),
    });
    const before = engine.state;
    expect(() => engine.runProcedure('heal', { kind: 'rollHeal', entityId: 'goblin' })).toThrow(
      EngineError,
    );
    try {
      engine.runProcedure('heal', { kind: 'rollHeal', entityId: 'goblin' });
    } catch (e) {
      expect((e as EngineError).code).toBe('no_procedure_handler');
    }
    expect(engine.state).toBe(before);
    expect(engine.commits.length).toBe(1);
  });
});

describe('snapshot / restore', () => {
  it('drops a commit without leaving it on the redo stack', () => {
    const engine = setup();
    const before = engine.snapshot();
    engine.perform(poke);
    expect(engine.commits.length).toBe(2);
    engine.restore(before);
    expect(engine.commits).toEqual(before.commits);
    expect(engine.canRedo).toBe(false);
    expect(engine.state).toEqual(replay(initial, before.commits, createFakeSystem()));
  });

  it('puts back the redo stack the snapshot recorded', () => {
    const engine = setup();
    engine.perform(poke);
    engine.undo();
    const snap = engine.snapshot();
    expect(engine.canRedo).toBe(true);
    engine.redo();
    engine.restore(snap);
    expect(engine.canRedo).toBe(true);
    expect(engine.commits).toEqual(snap.commits);
  });
});

describe('fake system hooks', () => {
  it('names a check catalog, a fixed DC, and spawn outcomes', () => {
    const system = createFakeSystem();
    expect(system.checkCatalog?.abilities).toContain('dex');
    expect(system.checkCatalog?.skills).toContain('stealth');
    expect(
      system.resolveCheckDc?.(initial, { actorId: 'hero', ability: 'dex', skill: 'stealth' }),
    ).toBe(12);
    expect(system.resolveSpawn?.(initial, { query: 'rat', count: 1 })?.status).toBe('matched');
    expect(system.resolveSpawn?.(initial, { query: 'goblin', count: 1 })?.status).toBe('ambiguous');
    expect(system.resolveSpawn?.(initial, { query: 'dragon', count: 1 })?.status).toBe('not_found');
  });

  it('runs a check procedure without rolling dice', () => {
    const engine = setup();
    const commit = engine.runProcedure('check', {
      kind: 'check',
      actorId: 'hero',
      ability: 'dex',
      skill: 'stealth',
      dc: 12,
    });
    expect(commit.facts[0]?.text).toBe('hero stealth');
    expect(commit.events.some((event) => event.type === 'rng.advanced')).toBe(false);
  });
});

describe('replay and determinism', () => {
  it('replay(commits) deep-equals live state including rng', () => {
    const engine = setup();
    engine.perform(poke);
    engine.perform(poke);
    engine.perform(wait);
    expect(replay(initial, engine.commits, createFakeSystem())).toEqual(engine.state);
  });

  it('same seed and actions give identical state and commits', () => {
    const run = (): Engine => {
      const e = setup();
      e.perform(poke);
      e.perform(poke);
      return e;
    };
    const a = run();
    const b = run();
    expect(a.state).toEqual(b.state);
    expect(a.commits).toEqual(b.commits);
  });
});
