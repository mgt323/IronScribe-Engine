import { describe, expect, it } from 'vitest';

import { applyEvent } from './apply.js';
import { EngineError } from './errors.js';
import type { CoreEvent } from './events.js';
import { createInitialState } from './state.js';
import { createFakeSystem, makeEntity } from './testing/fake-system.js';

const event: CoreEvent = {
  type: 'system',
  name: 'tag',
  payload: { entityId: 'hero', key: 'tag', value: 'x' },
};
const state = applyEvent(createInitialState({ seed: 1 }), {
  type: 'entity.spawned',
  entity: makeEntity('hero'),
});

describe('system events', () => {
  it('routes to applySystemEvent', () => {
    const s = applyEvent(state, event, createFakeSystem());
    expect(s.entities['hero']?.system['tag']).toBe('x');
  });

  it('throws no_system_reducer without the hook', () => {
    for (const system of [undefined, createFakeSystem({ withReducer: false })]) {
      try {
        applyEvent(state, event, system);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(EngineError);
        expect((e as EngineError).code).toBe('no_system_reducer');
      }
    }
  });
});
