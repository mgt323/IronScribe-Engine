import type { Rng } from '@iron-scribe/dice';
import {
  applyEvents,
  EngineError,
  type CoreEvent,
  type Fact,
  type GameState,
  type Resolution,
} from '@iron-scribe/engine-core';

import type { Catalog } from '../catalog/catalog.js';
import type { Ability } from '../catalog/schema.js';
import type { MonsterAction } from '../catalog/schema-monster.js';
import { savingThrow } from './checks.js';
import { readConditions } from './conditions.js';
import { readCreature } from './creature.js';
import { dealDamage, entityOf } from './deal-damage.js';
import { rollMonsterDamage, type DamagePart } from './damage.js';
import { ABILITY_LABEL } from './modifiers.js';

/**
 * A monster save action the rules can run: a DC, damage dice, and a success rule that
 * is `half` or `none`. `onSuccess: 'other'` is never read as "no damage"; it is not offered.
 */
export function isSupportedSaveAction(action: MonsterAction): boolean {
  return (
    action.kind === 'save' &&
    action.save !== null &&
    action.save.dc !== null &&
    action.save.onSuccess !== 'other' &&
    action.damage.length > 0
  );
}

export interface SaveEffect {
  readonly ability: Ability;
  readonly dc: number;
  /** Damage taken by a creature that makes the save. `other` is not supported. */
  readonly onSuccess: 'half' | 'none';
  /** Rolled once for the whole effect (SRD 5.2.1, "Damage Rolls"). */
  readonly parts: readonly DamagePart[];
}

/**
 * A save-based damage effect on one or more creatures (Burning Hands, a breath weapon).
 * The damage is rolled by the caller once and shared. Each living target, deduplicated
 * and in the order given, rolls its own save: a failure takes the full roll, a success
 * takes half (rounded down, per damage part) or none. Defenses apply per target.
 */
export function resolveSaveEffect(
  state: GameState,
  targetIds: readonly string[],
  effect: SaveEffect,
  rng: Rng,
  catalog: Catalog,
): Resolution {
  const events: CoreEvent[] = [];
  const facts: Fact[] = [];
  let running = state;
  for (const id of new Set(targetIds)) {
    const target = entityOf(running, id);
    if (target.hp.current <= 0) continue;
    const result = savingThrow(rng, {
      bonus: readCreature(target, catalog).saveBonus(effect.ability),
      dc: effect.dc,
      conditions: readConditions(target),
      ability: effect.ability,
    });
    const label = `${id} ${ABILITY_LABEL[effect.ability]} save`;
    const outcome = result.success ? 'success' : 'failure';
    facts.push({
      key: 'save',
      text: result.autoFail
        ? `${label} auto-fail vs DC ${String(effect.dc)}`
        : `${label} ${String(result.total)} vs DC ${String(effect.dc)}, ${outcome}`,
    });
    const taken = result.success
      ? effect.onSuccess === 'half'
        ? effect.parts.map((part) => ({ ...part, amount: Math.floor(part.amount / 2) }))
        : []
      : effect.parts;
    if (taken.length === 0) continue;
    const dealt = dealDamage(running, id, taken, false, catalog);
    events.push(...dealt.events);
    facts.push(...dealt.facts);
    running = applyEvents(running, dealt.events);
  }
  return { events, facts };
}

/** A monster save action (breath weapon, Consume Memories) on the given targets. */
export function resolveMonsterSave(
  state: GameState,
  actor: { readonly id: string },
  action: MonsterAction,
  targetIds: readonly string[],
  rng: Rng,
  catalog: Catalog,
): Resolution {
  if (!isSupportedSaveAction(action) || action.save?.dc == null) {
    throw new EngineError('unknown_alias', `${action.name} cannot be resolved`);
  }
  const { ability, dc, onSuccess } = action.save;
  if (onSuccess === 'other') {
    throw new EngineError('unknown_alias', `${action.name} is unsupported`);
  }
  const parts = rollMonsterDamage(rng, action.damage, false, false);
  const effect = resolveSaveEffect(
    state,
    targetIds,
    { ability, dc, onSuccess, parts },
    rng,
    catalog,
  );
  return {
    events: effect.events,
    facts: [{ key: 'use', text: `${actor.id} uses ${action.name}` }, ...effect.facts],
  };
}
