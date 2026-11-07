import { EngineError } from './errors.js';
import type { CoreEvent } from './events.js';
import type { RuleSystem } from './rule-system.js';
import type { Entity, EntityId, GameState, Hp } from './state.js';

function isInt(n: number): boolean {
  return Number.isInteger(n);
}

function getEntity(state: GameState, id: EntityId): Entity {
  const entity = state.entities[id];
  if (!entity) {
    throw new EngineError('unknown_entity', `Unknown entity: ${id}`);
  }
  return entity;
}

function putEntity(state: GameState, entity: Entity): GameState {
  return { ...state, entities: { ...state.entities, [entity.id]: entity } };
}

function checkSpawn(entity: Entity): void {
  const { id, hp } = entity;
  if (typeof id !== 'string' || id.length === 0) {
    throw new EngineError('invalid_entity', 'Entity id must be a non-empty string');
  }
  if (
    entity.proximity !== 'engaged' &&
    entity.proximity !== 'nearby' &&
    entity.proximity !== 'gone'
  ) {
    throw new EngineError('invalid_entity', `Invalid proximity for ${id}`);
  }
  if (!isInt(hp.max) || hp.max < 1 || !isInt(hp.current) || hp.current < 0 || hp.current > hp.max) {
    throw new EngineError('invalid_entity', `Invalid hit points for ${id}`);
  }
}

function checkAmount(amount: number): void {
  if (!isInt(amount) || amount < 0) {
    throw new EngineError('invalid_amount', `Invalid amount: ${String(amount)}`);
  }
}

function withHp(entity: Entity, current: number): Entity {
  const hp: Hp = { current, max: entity.hp.max };
  return { ...entity, hp };
}

export function applyEvent(state: GameState, event: CoreEvent, system?: RuleSystem): GameState {
  switch (event.type) {
    case 'entity.spawned': {
      checkSpawn(event.entity);
      if (state.entities[event.entity.id]) {
        throw new EngineError('duplicate_entity', `Duplicate entity: ${event.entity.id}`);
      }
      return {
        ...putEntity(state, event.entity),
        spawnOrder: [...state.spawnOrder, event.entity.id],
      };
    }
    case 'entity.removed': {
      getEntity(state, event.entityId);
      const { [event.entityId]: _removed, ...rest } = state.entities;
      return {
        ...state,
        entities: rest,
        spawnOrder: state.spawnOrder.filter((id) => id !== event.entityId),
      };
    }
    case 'entity.presenceSet': {
      if (
        event.proximity !== 'engaged' &&
        event.proximity !== 'nearby' &&
        event.proximity !== 'gone'
      ) {
        throw new EngineError('invalid_entity', `Invalid proximity for ${event.entityId}`);
      }
      return putEntity(state, { ...getEntity(state, event.entityId), proximity: event.proximity });
    }
    case 'entity.damaged': {
      const entity = getEntity(state, event.entityId);
      checkAmount(event.amount);
      return putEntity(state, withHp(entity, Math.max(0, entity.hp.current - event.amount)));
    }
    case 'entity.healed': {
      const entity = getEntity(state, event.entityId);
      checkAmount(event.amount);
      return putEntity(
        state,
        withHp(entity, Math.min(entity.hp.max, entity.hp.current + event.amount)),
      );
    }
    case 'entity.systemDataSet': {
      const entity = getEntity(state, event.entityId);
      return putEntity(state, {
        ...entity,
        system: { ...entity.system, [event.key]: event.value },
      });
    }
    case 'state.systemDataSet':
      return { ...state, system: { ...state.system, [event.key]: event.value } };
    case 'rng.advanced':
      return { ...state, rng: event.state };
    case 'system': {
      if (!system?.applySystemEvent) {
        throw new EngineError('no_system_reducer', 'Rule system has no applySystemEvent');
      }
      return system.applySystemEvent(state, event);
    }
  }
}

export function applyEvents(
  state: GameState,
  events: readonly CoreEvent[],
  system?: RuleSystem,
): GameState {
  let current = state;
  for (const event of events) {
    current = applyEvent(current, event, system);
  }
  return current;
}
