import { roll } from '@iron-scribe/dice';

import { EngineError } from '../errors.js';
import type { SystemEvent } from '../events.js';
import type {
  ActionMenu,
  Procedure,
  RuleSystem,
  SpawnRequest,
  SpawnResolution,
} from '../rule-system.js';
import type { Entity, GameState, JsonValue } from '../state.js';

export function makeEntity(id: string, overrides: Partial<Entity> = {}): Entity {
  return {
    id,
    name: id,
    templateRef: null,
    proximity: 'engaged',
    hp: { current: 10, max: 10 },
    system: {},
    ...overrides,
  };
}

function resolveFakeSpawn(state: GameState, request: SpawnRequest): SpawnResolution {
  const query = request.query.trim().toLowerCase();
  if (query === 'goblin') {
    return {
      status: 'ambiguous',
      query: request.query,
      candidates: [
        { id: 'goblin-minion', name: 'Goblin Minion' },
        { id: 'goblin-warrior', name: 'Goblin Warrior' },
        { id: 'rat', name: 'Rat' },
      ],
    };
  }
  if (query !== 'rat') return { status: 'not_found', query: request.query };
  const taken = new Set(Object.keys(state.entities));
  const entities: Entity[] = [];
  for (let i = 0; i < request.count; i += 1) {
    let n = 1;
    while (taken.has(`rat_${String(n)}`)) n += 1;
    const id = `rat_${String(n)}`;
    taken.add(id);
    entities.push(
      makeEntity(id, {
        name: 'Rat',
        templateRef: 'rat',
        system: { attitude: request.attitude ?? 'hostile' },
      }),
    );
  }
  return {
    status: 'matched',
    entities,
    facts: entities.map((entity) => ({ key: 'spawn', text: `${entity.id} (${entity.name})` })),
  };
}

/** Fake rules: "poke" (1d4 damage, needs target), "wait" (no target, no roll). */
export function createFakeSystem(options: { withReducer?: boolean } = {}): RuleSystem {
  const withReducer = options.withReducer ?? true;
  const base: RuleSystem = {
    id: 'fake',
    availableActions(state: GameState, actorId: string): ActionMenu {
      const targets = state.spawnOrder
        .filter((id) => id !== actorId && state.entities[id]?.proximity === 'engaged')
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
    checkCatalog: {
      abilities: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
      skills: ['perception', 'stealth'],
    },
    resolveCheckDc() {
      return 12;
    },
    resolveSpawn(state, request) {
      return resolveFakeSpawn(state, request);
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
      if (procedure.kind === 'check') {
        const actorId = procedure['actorId'];
        const skill = procedure['skill'];
        const who = typeof actorId === 'string' ? actorId : 'unknown';
        const label = typeof skill === 'string' ? skill : 'check';
        return {
          events: [],
          facts: [{ key: 'check', text: `${who} ${label}` }],
        };
      }
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
