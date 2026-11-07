import type { RngState } from '@iron-scribe/dice';

import type { Entity, EntityId, JsonValue, Proximity } from './state.js';

export interface SystemEvent {
  readonly type: 'system';
  readonly name: string;
  readonly payload: JsonValue;
}

export type CoreEvent =
  | { readonly type: 'entity.spawned'; readonly entity: Entity }
  | { readonly type: 'entity.removed'; readonly entityId: EntityId }
  | {
      readonly type: 'entity.presenceSet';
      readonly entityId: EntityId;
      readonly proximity: Proximity;
    }
  | { readonly type: 'entity.damaged'; readonly entityId: EntityId; readonly amount: number }
  | { readonly type: 'entity.healed'; readonly entityId: EntityId; readonly amount: number }
  | {
      readonly type: 'entity.systemDataSet';
      readonly entityId: EntityId;
      readonly key: string;
      readonly value: JsonValue;
    }
  | { readonly type: 'state.systemDataSet'; readonly key: string; readonly value: JsonValue }
  | { readonly type: 'rng.advanced'; readonly state: RngState }
  | SystemEvent;
