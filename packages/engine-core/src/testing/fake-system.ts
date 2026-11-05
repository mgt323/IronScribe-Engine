import { roll } from '@iron-scribe/dice';

import { EngineError } from '../errors.js';
import type { SystemEvent } from '../events.js';
import type { ActionMenu, Procedure, RuleSystem } from '../rule-system.js';
import type { Entity, GameState, JsonValue } from '../state.js';

export function makeEntity(id: string, overrides: Partial<Entity> = {}): Entity {
  return {
    id,
    name: id,
    templateRef: null,
    present: true,
    hp: { current: 10, max: 10 },
    system: {},
    ...overrides,
  };
}

/** Fake rules: "poke" (1d4 damage, needs target), "wait" (no target, no roll). */
export function createFakeSystem(options: { withReducer?: boolean } = {}): RuleSystem {
  const withReducer = options.withReducer ?? true;
  const base: RuleSystem = {
    id: 'fake',
    availableActions(state: GameState, actorId: string): ActionMenu {
      const targets = state.spawnOrder
        .filter((id) => id !== actorId && state.entities[id]?.present === true)
        .map((id, i) => ({
          alias: `T${String(i + 1)}`,
          entityId: id,
          label: state.entities[id]?.name ?? id,
        }));
      return {
        actions: [
          { alias: 'A1', actionId: 'poke', label: 'Poke', needsTarget: true },
          { alias: 'A2', actionId: 'wait', label: 'Wait', needsTarget: false },
        ],
        targets,
      };
    },
    resolve(_state, request, rng) {
      if (request.action.actionId === 'wait') {
        return { events: [], facts: [{ key: 'wait', text: 'waited' }] };
      }
      const target = request.target;
      if (!target) {
        throw new Error('poke needs a target');
      }
      const amount = roll('1d4', rng).total;
      return {
        events: [{ type: 'entity.damaged', entityId: target.entityId, amount }],
        facts: [{ key: 'poke', text: `${target.entityId} takes ${String(amount)}` }],
      };
    },
    runProcedure(_state, procedure: Procedure, rng) {
      if (procedure.kind !== 'rollHeal') {
        throw new EngineError('unknown_alias', `Unknown procedure: ${procedure.kind}`);
      }
      const entityId = procedure['entityId'];
      if (typeof entityId !== 'string') {
        throw new EngineError('unknown_entity', 'rollHeal needs an entityId');
      }
      const amount = roll('1d4', rng).total;
      return {
        events: [{ type: 'entity.healed' as const, entityId, amount }],
        facts: [{ key: 'heal', text: `${entityId} heals ${String(amount)}` }],
      };
    },
  };
  if (!withReducer) {
    return base;
  }
  return {
    ...base,
    applySystemEvent(state: GameState, event: SystemEvent): GameState {
      const payload = event.payload as { entityId: string; key: string; value: JsonValue };
      const entity = state.entities[payload.entityId];
      if (!entity) {
        throw new EngineError('unknown_entity', payload.entityId);
      }
      return {
        ...state,
        entities: {
          ...state.entities,
          [entity.id]: { ...entity, system: { ...entity.system, [payload.key]: payload.value } },
        },
      };
    },
  };
}
