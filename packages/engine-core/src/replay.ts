import { applyEvents } from './apply.js';
import type { Commit } from './engine.js';
import type { RuleSystem } from './rule-system.js';
import type { GameState } from './state.js';

/** Rebuild state by folding commit events. RNG comes back via logged rng.advanced. */
export function replay(
  initialState: GameState,
  commits: readonly Commit[],
  system: RuleSystem,
): GameState {
  let state = initialState;
  for (const commit of commits) {
    state = applyEvents(state, commit.events, system);
  }
  return state;
}
