import {
  EngineError,
  type ActionMenu,
  type Entity,
  type GameState,
  type MenuAction,
} from '@iron-scribe/engine-core';

import type { Catalog } from '../catalog/catalog.js';
import { readMonsterSnapshot } from '../catalog/spawn.js';
import { readCharacter } from './character.js';
import { isIncapacitated, readConditions } from './conditions.js';

function targetsOf(state: GameState, actorId: string): ActionMenu['targets'] {
  return state.spawnOrder
    .filter((id) => {
      if (id === actorId) return false;
      const entity = state.entities[id];
      return entity?.present === true && entity.hp.current > 0;
    })
    .map((id, index) => ({
      alias: `T${String(index + 1)}`,
      entityId: id,
      label: state.entities[id]?.name ?? id,
    }));
}

function weaponActions(actor: Entity, catalog: Catalog): MenuAction[] {
  const sheet = readCharacter(actor);
  return sheet.weapons.map((id, index) => {
    const weapon = catalog.weapons.get(id);
    if (!weapon) throw new Error(`unknown weapon: ${id}`);
    return {
      alias: `A${String(index + 1)}`,
      actionId: `weapon:${id}`,
      label: weapon.name,
      needsTarget: true,
    };
  });
}

function monsterActions(actor: Entity): MenuAction[] {
  const attacks = readMonsterSnapshot(actor).actions.filter(
    (action) =>
      action.attackBonus !== null &&
      (action.kind === 'melee' || action.kind === 'ranged' || action.kind === 'meleeOrRanged'),
  );
  return attacks.map((action, index) => ({
    alias: `A${String(index + 1)}`,
    actionId: `monster:${action.id}`,
    label: action.name,
    needsTarget: true,
  }));
}

/** Weapons on a character sheet, or a monster's attack actions. No Multiattack or spells. */
export function buildMenu(state: GameState, actorId: string, catalog: Catalog): ActionMenu {
  const actor = state.entities[actorId];
  if (!actor) throw new EngineError('unknown_entity', `Unknown entity: ${actorId}`);
  const targets = targetsOf(state, actorId);
  if (actor.hp.current <= 0 || isIncapacitated(readConditions(actor))) {
    return { actions: [], targets };
  }
  if (actor.system['character'] !== undefined) {
    return { actions: weaponActions(actor, catalog), targets };
  }
  if (actor.system['monster'] !== undefined) {
    return { actions: monsterActions(actor), targets };
  }
  throw new EngineError('invalid_entity', `${actor.id} has no character or monster`);
}
