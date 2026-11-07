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
import { expandMultiattackVariants, variantActionId, variantLabel } from './multiattack.js';
import { isSupportedSaveAction } from './resolve-save.js';
import { castableSpells, SPELL_PREFIX, spellMaxTargets } from './spell-data.js';
import { isActionAvailable } from './usage.js';

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

type Entry = Pick<MenuAction, 'actionId' | 'label' | 'needsTarget' | 'maxTargets'>;

function numbered(entries: readonly Entry[]): MenuAction[] {
  return entries.map(({ maxTargets, ...entry }, index) => ({
    alias: `A${String(index + 1)}`,
    ...entry,
    ...(maxTargets !== undefined && maxTargets > 1 ? { maxTargets } : {}),
  }));
}

function weaponEntries(actor: Entity, catalog: Catalog): Entry[] {
  return readCharacter(actor).weapons.map((id) => {
    const weapon = catalog.weapons.get(id);
    if (!weapon) throw new Error(`unknown weapon: ${id}`);
    return { actionId: `weapon:${id}`, label: weapon.name, needsTarget: true };
  });
}

/** Spells with a rules effect. Healing can target the caster (`:self`) or someone else. */
function spellEntries(actor: Entity, catalog: Catalog, hasOthers: boolean): Entry[] {
  return castableSpells(actor, catalog).flatMap((spell): Entry[] => {
    const id = `${SPELL_PREFIX}${spell.id}`;
    if (spell.heal === null) {
      return [
        { actionId: id, label: spell.name, needsTarget: true, maxTargets: spellMaxTargets(spell) },
      ];
    }
    const self: Entry = {
      actionId: `${id}:self`,
      label: `${spell.name} (self)`,
      needsTarget: false,
    };
    return hasOthers ? [self, { actionId: id, label: spell.name, needsTarget: true }] : [self];
  });
}

function monsterEntries(actor: Entity): Entry[] {
  const all = readMonsterSnapshot(actor).actions;
  const attacks = all.filter(
    (action) =>
      action.attackBonus !== null &&
      (action.kind === 'melee' || action.kind === 'ranged' || action.kind === 'meleeOrRanged'),
  );
  const saves = all.filter(isSupportedSaveAction);
  const entries: Entry[] = [...attacks, ...saves]
    .filter((action) => isActionAvailable(actor, action))
    .map((action) => ({
      actionId: `monster:${action.id}`,
      label: action.name,
      needsTarget: true,
      ...(action.kind === 'save' ? { maxTargets: 3 } : {}),
    }));
  const variants = expandMultiattackVariants(actor);
  entries.unshift(
    ...variants.map((variant, index) => ({
      actionId: variantActionId(index),
      label: variants.length === 1 ? 'Multiattack' : `Multiattack (${variantLabel(variant)})`,
      needsTarget: true,
      maxTargets: 3,
    })),
  );
  return entries;
}

/** Weapons on a character sheet, or a monster's attacks (Multiattack first when automatable). */
export function buildMenu(state: GameState, actorId: string, catalog: Catalog): ActionMenu {
  const actor = state.entities[actorId];
  if (!actor) throw new EngineError('unknown_entity', `Unknown entity: ${actorId}`);
  const targets = targetsOf(state, actorId);
  if (actor.hp.current <= 0 || isIncapacitated(readConditions(actor))) {
    return { actions: [], targets };
  }
  if (actor.system['character'] !== undefined) {
    const entries = [
      ...weaponEntries(actor, catalog),
      ...spellEntries(actor, catalog, targets.length > 0),
    ];
    return { actions: numbered(entries), targets };
  }
  if (actor.system['monster'] !== undefined) {
    return { actions: numbered(monsterEntries(actor)), targets };
  }
  throw new EngineError('invalid_entity', `${actor.id} has no character or monster`);
}
