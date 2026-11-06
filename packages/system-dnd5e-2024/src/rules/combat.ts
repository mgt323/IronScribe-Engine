import {
  EngineError,
  type CombatStep,
  type Entity,
  type EntityId,
  type GameState,
  type Procedure,
  type Resolution,
} from '@iron-scribe/engine-core';

import type { Catalog } from '../catalog/catalog.js';
import { isIncapacitated, readConditions } from './conditions.js';
import type { EncounterState } from './initiative.js';
import { buildMenu } from './menu.js';

/** The active encounter, or null when none is stored (absent, or set to null). */
export function readEncounter(state: GameState): EncounterState | null {
  const raw = state.system['encounter'];
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as unknown as EncounterState;
}

function livingHostile(entity: Entity | undefined): boolean {
  return (
    entity?.present === true && entity.hp.current > 0 && entity.system['attitude'] === 'hostile'
  );
}

function hasLivingHostiles(state: GameState): boolean {
  return state.spawnOrder.some((id) => livingHostile(state.entities[id]));
}

function canAct(entity: Entity | undefined): boolean {
  return (
    entity?.present === true && entity.hp.current > 0 && !isIncapacitated(readConditions(entity))
  );
}

const advanceTurn = (label: string): CombatStep => ({
  kind: 'procedure',
  label,
  procedure: { kind: 'advanceTurn' },
});

/**
 * The next engine-run step of an active encounter, or null when the player is up,
 * the encounter is suspended (player down while hostiles live), or there is none.
 * An `action` step is followed by `turnEnd`; `procedure` steps end their own turn.
 * NPC policy (Stage 7a): the first menu action against the player. No choices.
 */
export function dndNextCombatStep(
  state: GameState,
  playerId: EntityId,
  catalog: Catalog,
): CombatStep | null {
  const encounter = readEncounter(state);
  if (!encounter) return null;
  if (!hasLivingHostiles(state)) {
    return { kind: 'procedure', label: 'End of combat', procedure: { kind: 'endEncounter' } };
  }
  if (!canAct(state.entities[playerId])) return null;
  if (encounter.turnIndex >= encounter.order.length) {
    return {
      kind: 'procedure',
      label: 'Next round',
      procedure: { kind: 'advanceRound' },
    };
  }
  const currentId = encounter.order[encounter.turnIndex]?.entityId;
  if (currentId === undefined || currentId === playerId) return null;
  const npc = state.entities[currentId];
  const name = npc?.name ?? currentId;
  if (!npc || !livingHostile(npc)) return advanceTurn(`${name} skips a turn`);
  const menu = buildMenu(state, currentId, catalog);
  const action = menu.actions[0];
  const target = menu.targets.find((entry) => entry.entityId === playerId);
  if (!action || !target) return advanceTurn(`${name} has no action`);
  return {
    kind: 'action',
    request: { actorId: currentId, actionAlias: action.alias, targetAlias: target.alias },
  };
}

export function dndTurnEnd(state: GameState, actorId: EntityId): Procedure | null {
  const encounter = readEncounter(state);
  if (!encounter || encounter.order[encounter.turnIndex]?.entityId !== actorId) return null;
  return { kind: 'advanceTurn' };
}

/** `advanceTurn`, `advanceRound` and `endEncounter`: pure state changes, no dice. */
export function runCombatProcedure(
  state: GameState,
  kind: 'advanceTurn' | 'advanceRound' | 'endEncounter',
): Resolution {
  const encounter = readEncounter(state);
  if (!encounter) throw new EngineError('invalid_combat_state', 'No active encounter');
  const set = (value: EncounterState | null): Resolution => ({
    events: [{ type: 'state.systemDataSet', key: 'encounter', value: value as never }],
    facts: [],
  });
  if (kind === 'endEncounter') {
    if (hasLivingHostiles(state)) {
      throw new EngineError('invalid_combat_state', 'Hostile creatures are still standing');
    }
    return set(null);
  }
  if (kind === 'advanceRound') {
    if (encounter.turnIndex < encounter.order.length) {
      throw new EngineError('invalid_combat_state', 'The round is not over');
    }
    return set({ ...encounter, round: encounter.round + 1, turnIndex: 0, acted: [] });
  }
  const current = encounter.order[encounter.turnIndex];
  if (!current) throw new EngineError('invalid_combat_state', 'Nobody is left to act this round');
  return set({
    ...encounter,
    turnIndex: encounter.turnIndex + 1,
    acted: [...encounter.acted, current.entityId],
  });
}
