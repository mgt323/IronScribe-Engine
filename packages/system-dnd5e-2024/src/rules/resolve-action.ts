import type { Rng } from '@iron-scribe/dice';
import {
  EngineError,
  type Entity,
  type Resolution,
  type ResolvedRequest,
  type GameState,
} from '@iron-scribe/engine-core';

import type { Catalog } from '../catalog/catalog.js';
import type { MonsterAction } from '../catalog/schema-monster.js';
import { readMonsterSnapshot } from '../catalog/spawn.js';
import { entityOf } from './deal-damage.js';
import { resolveAttack } from './resolve-attack.js';
import { resolveMultiattack } from './resolve-multiattack.js';
import { resolveMonsterSave } from './resolve-save.js';
import { MULTIATTACK_ID } from './multiattack.js';
import { SPELL_PREFIX } from './spell-data.js';
import { resolveSpell } from './spells.js';
import { isActionAvailable, useActionEvents } from './usage.js';

function monsterAction(actor: Entity, request: ResolvedRequest): MonsterAction | undefined {
  const id = request.action.actionId;
  if (!id.startsWith('monster:')) return undefined;
  const wanted = id.slice('monster:'.length);
  if (actor.system['monster'] === undefined) return undefined;
  return readMonsterSnapshot(actor).actions.find((entry) => entry.id === wanted);
}

/**
 * The one entry point for menu actions: weapon and monster attacks, Multiattack, monster
 * save actions, and character spells. A limited monster action records its use as an event.
 */
export function resolveAction(
  state: GameState,
  request: ResolvedRequest,
  rng: Rng,
  catalog: Catalog,
): Resolution {
  const actor = entityOf(state, request.actorId);
  if (request.action.actionId.startsWith(SPELL_PREFIX)) {
    return resolveSpell(state, request, rng, catalog);
  }
  const action = monsterAction(actor, request);
  if (action && !isActionAvailable(actor, action)) {
    throw new EngineError('invalid_combat_state', `${action.name} has no uses left`);
  }
  if (request.action.actionId.startsWith(MULTIATTACK_ID)) {
    return resolveMultiattack(state, request, rng, catalog);
  }
  const done =
    action?.kind === 'save'
      ? resolveMonsterSave(
          state,
          actor,
          action,
          request.targets.map((target) => target.entityId),
          rng,
          catalog,
        )
      : resolveAttack(state, request, rng, catalog);
  if (!action) return done;
  return { events: [...done.events, ...useActionEvents(actor, action)], facts: done.facts };
}
