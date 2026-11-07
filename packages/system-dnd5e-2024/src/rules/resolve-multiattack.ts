import type { Rng } from '@iron-scribe/dice';
import {
  applyEvents,
  EngineError,
  type CoreEvent,
  type Fact,
  type GameState,
  type Resolution,
  type ResolvedRequest,
} from '@iron-scribe/engine-core';

import type { Catalog } from '../catalog/catalog.js';
import type { MonsterAction } from '../catalog/schema-monster.js';
import { entityOf } from './deal-damage.js';
import { expandMultiattackVariants, isAttack, variantIndexOf } from './multiattack.js';
import { attackOnce, monsterAttack } from './resolve-attack.js';
import { resolveMonsterSave } from './resolve-save.js';
import { isActionAvailable, useActionEvents } from './usage.js';

/** One step on the running state: an attack, or a save action aimed at one creature. */
function resolveStep(
  state: GameState,
  actorId: string,
  action: MonsterAction,
  targetId: string,
  rng: Rng,
  catalog: Catalog,
): Resolution {
  const actor = entityOf(state, actorId);
  if (!isAttack(action)) return resolveMonsterSave(state, actor, action, [targetId], rng, catalog);
  const part = attackOnce(
    state,
    actor,
    monsterAttack(actor, action.id, rng),
    targetId,
    rng,
    catalog,
  );
  const facts = part.facts.map((fact) =>
    fact.key === 'attack' ? { ...fact, text: `${action.name}: ${fact.text}` } : fact,
  );
  return { events: part.events, facts };
}

/**
 * The chosen Multiattack variant, step by step on a running state. Step `i` aims at
 * `targets[i]`, or the first target when there is none for it. A step whose target is already
 * at 0 HP is skipped: there is no spillover onto creatures the caller did not choose. A limited
 * action records its use as it is spent, so later steps see it.
 */
export function resolveMultiattack(
  state: GameState,
  request: ResolvedRequest,
  rng: Rng,
  catalog: Catalog,
): Resolution {
  const index = variantIndexOf(request.action.actionId) ?? 0;
  const variant = expandMultiattackVariants(entityOf(state, request.actorId))[index];
  const first = request.targets[0];
  if (!variant || !first) {
    throw new EngineError('unknown_alias', 'Multiattack is not available');
  }
  const events: CoreEvent[] = [];
  const facts: Fact[] = [];
  let running = state;
  for (const [step, action] of variant.entries()) {
    const targetId = (request.targets[step] ?? first).entityId;
    if (entityOf(running, targetId).hp.current <= 0) continue;
    const actor = entityOf(running, request.actorId);
    if (!isActionAvailable(actor, action)) continue;
    const part = resolveStep(running, request.actorId, action, targetId, rng, catalog);
    const spent = useActionEvents(actor, action);
    events.push(...part.events, ...spent);
    facts.push(...part.facts);
    running = applyEvents(running, [...part.events, ...spent]);
  }
  return { events, facts };
}
