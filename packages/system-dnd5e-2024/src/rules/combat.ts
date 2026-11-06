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
import { isDead, isDying } from './death-saves.js';
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
 * What the player's situation is, for status lines and the CLI.
 * - `none`: no encounter and the hero is fine
 * - `active`: an encounter runs and the hero can act
 * - `dying`: 0 HP, rolling Death Saving Throws on their turns
 * - `suspended`: the hero cannot act (stable at 0 HP, or incapacitated) and is not dying
 * - `dead`: terminal; the hero died and nothing more happens
 */
export type CombatPhase = 'none' | 'active' | 'dying' | 'suspended' | 'dead';

export function combatPhase(state: GameState, playerId: EntityId): CombatPhase {
  const player = state.entities[playerId];
  if (isDead(player)) return 'dead';
  if (isDying(player)) return 'dying';
  if (!readEncounter(state)) return 'none';
  return canAct(player) ? 'active' : 'suspended';
}

/**
 * The next engine-run step of an active encounter, or null when the player is up
 * (to act, or to roll a death save), the encounter is suspended (player cannot act
 * and is not dying, or is dead), or there is none.
 * An `action` step is followed by `turnEnd`; `procedure` steps end their own turn.
 * NPC policy (Stage 7a): the first menu action against the player. No choices.
 * Iron Scribe tactical policy (not an SRD rule): an unconscious dying hero is not on
 * an NPC's target list, so hostiles hold their turn and the solo hero gets to roll
 * Death Saving Throws turn by turn instead of dying in the same round.
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
  const phase = combatPhase(state, playerId);
  if (phase === 'dead' || phase === 'suspended') return null;
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
  if (!action || !target) {
    return advanceTurn(phase === 'dying' ? `${name} holds` : `${name} has no action`);
  }
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
