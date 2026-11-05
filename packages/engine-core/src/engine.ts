import { restoreRng } from '@iron-scribe/dice';

import { applyEvents } from './apply.js';
import { EngineError } from './errors.js';
import type { CoreEvent } from './events.js';
import { validateRequest } from './menu.js';
import { replay } from './replay.js';
import type { ActionMenu, ActionRequest, Fact, RuleSystem } from './rule-system.js';
import type { EntityId, GameState } from './state.js';

export interface Commit {
  readonly index: number;
  readonly label: string;
  readonly request: ActionRequest | null;
  readonly events: readonly CoreEvent[];
  readonly facts: readonly Fact[];
}

export interface Engine {
  readonly state: GameState;
  readonly commits: readonly Commit[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  menu(actorId: EntityId): ActionMenu;
  perform(request: ActionRequest): Commit;
  commit(label: string, events: readonly CoreEvent[]): Commit;
  undo(): void;
  redo(): void;
}

function rejectRngEvents(events: readonly CoreEvent[]): void {
  if (events.some((e) => e.type === 'rng.advanced')) {
    throw new EngineError('forbidden_event', 'rng.advanced may only be emitted by the engine');
  }
}

export function createEngine(options: { system: RuleSystem; initialState: GameState }): Engine {
  const { system, initialState } = options;
  let state = initialState;
  let commits: Commit[] = [];
  let redoStack: Commit[] = [];

  const checkActor = (actorId: EntityId): void => {
    const actor = state.entities[actorId];
    if (!actor) {
      throw new EngineError('unknown_entity', `Unknown actor: ${actorId}`);
    }
    if (!actor.present) {
      throw new EngineError('actor_not_present', `Actor not present: ${actorId}`);
    }
  };

  const menu = (actorId: EntityId): ActionMenu => {
    checkActor(actorId);
    return system.availableActions(state, actorId);
  };

  const append = (
    label: string,
    request: ActionRequest | null,
    events: readonly CoreEvent[],
    facts: readonly Fact[],
  ): Commit => {
    const next = applyEvents(state, events, system);
    const entry: Commit = { index: commits.length, label, request, events, facts };
    state = next;
    commits = [...commits, entry];
    redoStack = [];
    return entry;
  };

  return {
    get state() {
      return state;
    },
    get commits() {
      return commits;
    },
    get canUndo() {
      return commits.length > 0;
    },
    get canRedo() {
      return redoStack.length > 0;
    },
    menu,
    perform(request) {
      const available = menu(request.actorId);
      const resolved = validateRequest(available, request);
      const rng = restoreRng(state.rng);
      const resolution = system.resolve(state, resolved, rng);
      rejectRngEvents(resolution.events);
      const after = rng.getState();
      const events: CoreEvent[] = [...resolution.events];
      if (after.algorithm !== state.rng.algorithm || after.seed !== state.rng.seed) {
        events.push({ type: 'rng.advanced', state: after });
      }
      return append(resolved.action.label, request, events, resolution.facts);
    },
    commit(label, events) {
      rejectRngEvents(events);
      return append(label, null, [...events], []);
    },
    undo() {
      const last = commits.at(-1);
      if (!last) {
        throw new EngineError('nothing_to_undo', 'Nothing to undo');
      }
      const remaining = commits.slice(0, -1);
      state = replay(initialState, remaining, system);
      commits = remaining;
      redoStack = [...redoStack, last];
    },
    redo() {
      const next = redoStack.at(-1);
      if (!next) {
        throw new EngineError('nothing_to_redo', 'Nothing to redo');
      }
      state = applyEvents(state, next.events, system);
      commits = [...commits, next];
      redoStack = redoStack.slice(0, -1);
    },
  };
}
