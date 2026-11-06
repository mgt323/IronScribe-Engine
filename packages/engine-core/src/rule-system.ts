import type { Rng } from '@iron-scribe/dice';

import type { CoreEvent, SystemEvent } from './events.js';
import type { Entity, EntityId, GameState, JsonValue } from './state.js';

/** A system-specific engine-triggered roll. `kind` names it; other fields are the payload. */
export interface Procedure {
  readonly kind: string;
  readonly [key: string]: JsonValue;
}

export interface MenuAction {
  /** Per-turn alias: "A1".. */
  readonly alias: string;
  /** Stable system key, e.g. "weapon:dagger". */
  readonly actionId: string;
  readonly label: string;
  readonly needsTarget: boolean;
}

export interface MenuTarget {
  /** Per-turn alias: "T1".. */
  readonly alias: string;
  readonly entityId: EntityId;
  readonly label: string;
}

export interface ActionMenu {
  readonly actions: readonly MenuAction[];
  readonly targets: readonly MenuTarget[];
}

/** What callers send. */
export interface ActionRequest {
  readonly actorId: EntityId;
  readonly actionAlias: string;
  readonly targetAlias: string | null;
}

/** What RuleSystem.resolve receives. */
export interface ResolvedRequest {
  readonly actorId: EntityId;
  readonly action: MenuAction;
  readonly target: MenuTarget | null;
}

export interface Fact {
  readonly key: string;
  readonly text: string;
}

export interface Resolution {
  readonly events: readonly CoreEvent[];
  readonly facts: readonly Fact[];
}

/** Ruleset-neutral. A concrete system validates its own attitude words. */
export interface SpawnRequest {
  readonly query: string;
  readonly count: number;
  readonly attitude?: string;
}

export interface SpawnCandidate {
  readonly id: string;
  readonly name: string;
}

export type SpawnResolution =
  | {
      readonly status: 'matched';
      readonly entities: readonly Entity[];
      readonly facts: readonly Fact[];
    }
  | { readonly status: 'not_found'; readonly query: string }
  | {
      readonly status: 'ambiguous';
      readonly query: string;
      readonly candidates: readonly SpawnCandidate[];
    };

/** Ids the model may use for a check. The system, not the model, picks the DC. */
export interface CheckCatalog {
  readonly abilities: readonly string[];
  readonly skills: readonly string[];
}

/** SRD-style difficulty bands. The numbers live in the rules package, not here. */
export type CheckDifficultyBand =
  'veryEasy' | 'easy' | 'medium' | 'hard' | 'veryHard' | 'nearlyImpossible';

/** Typed check context. No free-form model text. */
export interface CheckDcContext {
  readonly actorId: EntityId;
  readonly ability: string;
  readonly skill: string | null;
  readonly procedureId?: string;
  readonly difficulty?: CheckDifficultyBand;
}

export interface RuleSystem {
  readonly id: string;
  readonly checkCatalog?: CheckCatalog;
  availableActions(state: GameState, actorId: EntityId): ActionMenu;
  resolve(state: GameState, request: ResolvedRequest, rng: Rng): Resolution;
  /** Engine-triggered rolls (checks, saves, initiative). Not a player menu action. */
  runProcedure?(state: GameState, procedure: Procedure, rng: Rng): Resolution;
  /** The rules system owns the DC. The model never sends one. */
  resolveCheckDc?(state: GameState, context: CheckDcContext): number;
  /** Name a catalog entry. 0 or many matches ask the user; one match returns entities to spawn. */
  resolveSpawn?(state: GameState, request: SpawnRequest): SpawnResolution;
  /**
   * Called before a targeted action. Returns the procedure that opens combat
   * (e.g. initiative) when the action starts a fight that is not under way yet.
   */
  encounterStart?(state: GameState, actorId: EntityId): Procedure | null;
  applySystemEvent?(state: GameState, event: SystemEvent): GameState;
}
