import type { Rng } from '@iron-scribe/dice';

import type { CoreEvent, SystemEvent } from './events.js';
import type { EntityId, GameState, JsonValue } from './state.js';

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

export interface RuleSystem {
  readonly id: string;
  availableActions(state: GameState, actorId: EntityId): ActionMenu;
  resolve(state: GameState, request: ResolvedRequest, rng: Rng): Resolution;
  /** Engine-triggered rolls (checks, saves, initiative). Not a player menu action. */
  runProcedure?(state: GameState, procedure: Procedure, rng: Rng): Resolution;
  applySystemEvent?(state: GameState, event: SystemEvent): GameState;
}
