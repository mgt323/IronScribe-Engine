import { createScriptedRng } from '@iron-scribe/dice';
import { describe, expect, it } from 'vitest';

import { applyEvent, applyEvents } from './apply.js';
import { EngineError, type EngineErrorCode } from './errors.js';
import type { CoreEvent } from './events.js';
import { createInitialState, type GameState } from './state.js';
import { makeEntity } from './testing/fake-system.js';

const base = (): GameState => createInitialState({ seed: 1 });
const withHero = (hp = { current: 10, max: 10 }): GameState =>
  applyEvent(base(), { type: 'entity.spawned', entity: makeEntity('hero', { hp }) });

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

describe('entity.spawned', () => {
  it('appends to spawnOrder in order', () => {
    const s = applyEvents(base(), [
      { type: 'entity.spawned', entity: makeEntity('a') },
      { type: 'entity.spawned', entity: makeEntity('b') },
    ]);
    expect(s.spawnOrder).toEqual(['a', 'b']);
    expect(s.entities['b']?.name).toBe('b');
  });

  it('rejects invalid entities', () => {
    const bad = [
      makeEntity(''),
      makeEntity('x', { hp: { current: 0, max: 0 } }),
      makeEntity('x', { hp: { current: -1, max: 5 } }),
      makeEntity('x', { hp: { current: 6, max: 5 } }),
      makeEntity('x', { hp: { current: 1.5, max: 5 } }),
      makeEntity('x', { hp: { current: 1, max: 5.5 } }),
    ];
    for (const entity of bad) {
      expect(code(() => applyEvent(base(), { type: 'entity.spawned', entity }))).toBe(
        'invalid_entity',
      );
    }
  });

  it('rejects duplicate ids', () => {
    expect(
      code(() => applyEvent(withHero(), { type: 'entity.spawned', entity: makeEntity('hero') })),
    ).toBe('duplicate_entity');
  });
});

describe('other entity events', () => {
  it('throws unknown_entity', () => {
    const events: CoreEvent[] = [
      { type: 'entity.removed', entityId: 'nope' },
      { type: 'entity.presenceSet', entityId: 'nope', proximity: 'gone' },
      { type: 'entity.damaged', entityId: 'nope', amount: 1 },
      { type: 'entity.healed', entityId: 'nope', amount: 1 },
      { type: 'entity.systemDataSet', entityId: 'nope', key: 'k', value: 1 },
    ];
    for (const e of events) {
      expect(code(() => applyEvent(base(), e))).toBe('unknown_entity');
    }
  });

  it('clamps damage at 0 and healing at max', () => {
    const hurt = applyEvent(withHero(), { type: 'entity.damaged', entityId: 'hero', amount: 99 });
    expect(hurt.entities['hero']?.hp.current).toBe(0);
    const healed = applyEvent(hurt, { type: 'entity.healed', entityId: 'hero', amount: 99 });
    expect(healed.entities['hero']?.hp.current).toBe(10);
  });

  it('allows amount 0 and rejects negative or non-integer amounts', () => {
    const s = withHero({ current: 4, max: 10 });
    for (const type of ['entity.damaged', 'entity.healed'] as const) {
      const same = applyEvent(s, { type, entityId: 'hero', amount: 0 });
      expect(same.entities['hero']?.hp.current).toBe(4);
      for (const amount of [-1, 1.5, Number.NaN]) {
        expect(code(() => applyEvent(s, { type, entityId: 'hero', amount }))).toBe(
          'invalid_amount',
        );
      }
    }
  });

  it('sets proximity and cleans spawnOrder on removal', () => {
    const s = applyEvent(withHero(), {
      type: 'entity.presenceSet',
      entityId: 'hero',
      proximity: 'gone',
    });
    expect(s.entities['hero']?.proximity).toBe('gone');
    const removed = applyEvent(s, { type: 'entity.removed', entityId: 'hero' });
    expect(removed.entities['hero']).toBeUndefined();
    expect(removed.spawnOrder).toEqual([]);
  });

  it('stores nested JSON in the global and entity bags', () => {
    const value = { round: 1, initiative: ['a', 'b'] };
    const s = applyEvent(withHero(), { type: 'state.systemDataSet', key: 'encounter', value });
    expect(s.system['encounter']).toEqual(value);
    const e = applyEvent(s, {
      type: 'entity.systemDataSet',
      entityId: 'hero',
      key: 'k',
      value: { a: [1] },
    });
    expect(e.entities['hero']?.system['k']).toEqual({ a: [1] });
  });

  it('rng.advanced sets state.rng', () => {
    const rng = createScriptedRng([5]);
    rng.int(1, 6);
    const s = applyEvent(base(), { type: 'rng.advanced', state: rng.getState() });
    expect(s.rng).toEqual(rng.getState());
  });

  it('does not mutate the input state', () => {
    const s = withHero();
    const snapshot = structuredClone(s);
    applyEvent(s, { type: 'entity.damaged', entityId: 'hero', amount: 3 });
    applyEvent(s, { type: 'entity.removed', entityId: 'hero' });
    expect(s).toEqual(snapshot);
  });
});
