import { createRng, type RngState } from '@iron-scribe/dice';

export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type EntityId = string;

export type SystemData = Readonly<Record<string, JsonValue>>;

export interface Hp {
  readonly current: number;
  readonly max: number;
}

export interface Entity {
  readonly id: EntityId;
  readonly name: string;
  readonly templateRef: string | null;
  readonly present: boolean;
  readonly hp: Hp;
  readonly system: SystemData;
}

export interface GameState {
  readonly rng: RngState;
  readonly entities: Readonly<Record<EntityId, Entity>>;
  /** Stable display and alias order. Not initiative order. */
  readonly spawnOrder: readonly EntityId[];
  /** Global rule-system data (e.g. encounter state). */
  readonly system: SystemData;
}

export function createInitialState(options: { seed: number | string }): GameState {
  return {
    rng: createRng(options.seed).getState(),
    entities: {},
    spawnOrder: [],
    system: {},
  };
}
