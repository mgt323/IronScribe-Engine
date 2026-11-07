import type { ActionRequest, EntityId, GameState, MenuAction } from '@iron-scribe/engine-core';

import type { Catalog } from '../catalog/catalog.js';
import { readMonsterSnapshot } from '../catalog/spawn.js';
import type { MonsterAction } from '../catalog/schema-monster.js';
import { readCreature } from './creature.js';
import { buildMenu } from './menu.js';
import { expandMultiattackVariants, variantIndexOf } from './multiattack.js';

/**
 * Iron Scribe NPC tactical policy (deterministic, no model, not an SRD rule).
 * - Targets: the hero and friendly NPCs above 0 HP, lowest HP first (ties: the hero, then
 *   spawn order). A hero at 0 HP is not a target, so with no conscious ally a hostile holds
 *   its turn and the solo hero can roll Death Saving Throws instead of dying in one round.
 * - Actions: the highest expected damage on the primary target. Save actions count 0.65 per
 *   creature hit (up to 3); attacks count damage times hit chance. A Multiattack variant is
 *   the sum of its steps. Ties: Multiattack, then melee before ranged, then menu order.
 * - A Multiattack splits across two targets when the primary would fall to its first step.
 */
const SAVE_HIT_RATE = 0.65;
const MAX_AREA_TARGETS = 3;

/** Average of a plain dice formula such as `1d10+8` or `17d6`. */
export function averageDice(formula: string): number {
  let total = 0;
  for (const [, sign, count, sides, constant] of formula.matchAll(
    /([+-]?)\s*(?:(\d*)d(\d+)|(\d+))/g,
  )) {
    const value = sides ? Number(count || 1) * ((Number(sides) + 1) / 2) : Number(constant);
    total += sign === '-' ? -value : value;
  }
  return total;
}

export function averageDamage(action: MonsterAction): number {
  return action.damage.reduce((sum, part) => sum + averageDice(part.dice), 0);
}

interface Candidate {
  readonly entityId: EntityId;
  readonly alias: string;
  readonly hp: number;
  readonly ac: number;
}

function stepScore(action: MonsterAction, primary: Candidate, areaTargets: number): number {
  if (action.kind === 'save') return averageDamage(action) * SAVE_HIT_RATE * areaTargets;
  const bonus = action.attackBonus ?? 0;
  const chance = Math.min(0.95, Math.max(0.05, 0.05 * (21 - (primary.ac - bonus))));
  return averageDamage(action) * chance;
}

function candidates(
  state: GameState,
  npcId: EntityId,
  playerId: EntityId,
  catalog: Catalog,
): Candidate[] {
  const menu = buildMenu(state, npcId, catalog);
  const order = (id: string) => state.spawnOrder.indexOf(id);
  return menu.targets
    .filter(
      (t) =>
        t.entityId === playerId || state.entities[t.entityId]?.system['attitude'] === 'friendly',
    )
    .map((t) => {
      const entity = state.entities[t.entityId];
      if (!entity) throw new Error(`missing ${t.entityId}`);
      return {
        entityId: t.entityId,
        alias: t.alias,
        hp: entity.hp.current,
        ac: readCreature(entity, catalog).ac,
      };
    })
    .sort(
      (a, b) =>
        a.hp - b.hp ||
        Number(b.entityId === playerId) - Number(a.entityId === playerId) ||
        order(a.entityId) - order(b.entityId),
    );
}

interface Scored {
  readonly action: MenuAction;
  readonly score: number;
  readonly multi: boolean;
  readonly ranged: boolean;
  readonly index: number;
  readonly firstStep: MonsterAction | null;
  readonly area: boolean;
}

/** The NPC's request for its turn, or null when it has no legal action or target (it holds). */
export function chooseNpcAction(
  state: GameState,
  npcId: EntityId,
  playerId: EntityId,
  catalog: Catalog,
): ActionRequest | null {
  const npc = state.entities[npcId];
  const targets = candidates(state, npcId, playerId, catalog);
  const primary = targets[0];
  if (!npc || !primary) return null;
  const actions = readMonsterSnapshot(npc).actions;
  const variants = expandMultiattackVariants(npc);
  const areaTargets = Math.min(MAX_AREA_TARGETS, targets.length);
  const scored: Scored[] = buildMenu(state, npcId, catalog).actions.map((action, index) => {
    const variantIndex = variantIndexOf(action.actionId);
    const steps =
      variantIndex === null
        ? actions.filter((a) => `monster:${a.id}` === action.actionId)
        : (variants[variantIndex] ?? []);
    const first = steps[0] ?? null;
    return {
      action,
      index,
      firstStep: first,
      multi: variantIndex !== null,
      area: variantIndex === null && first?.kind === 'save',
      ranged: variantIndex === null && first?.kind === 'ranged',
      score: steps.reduce((sum, step) => sum + stepScore(step, primary, areaTargets), 0),
    };
  });
  const best = [...scored].sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.multi) - Number(a.multi) ||
      Number(a.ranged) - Number(b.ranged) ||
      a.index - b.index,
  )[0];
  if (!best) return null;
  const request = { actorId: npcId, actionAlias: best.action.alias, targetAlias: primary.alias };
  if (best.area && targets.length > 1) {
    return { ...request, targetAliases: targets.slice(0, areaTargets).map((t) => t.alias) };
  }
  const second = targets[1];
  if (best.multi && second && best.firstStep && primary.hp <= averageDamage(best.firstStep)) {
    return { ...request, targetAliases: [primary.alias, second.alias] };
  }
  return request;
}
