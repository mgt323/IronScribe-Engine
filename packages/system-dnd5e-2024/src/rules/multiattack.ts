import type { Entity } from '@iron-scribe/engine-core';

import { readMonsterSnapshot } from '../catalog/spawn.js';
import type { MonsterAction } from '../catalog/schema-monster.js';
import { FRESH_HYDRA, readHydraState } from './hydra.js';
import { isSupportedSaveAction } from './resolve-save.js';
import { isActionAvailable } from './usage.js';

export const MULTIATTACK_ACTION_ID = 'multiattack';
/** Menu action id of the first variant; later variants are `monster:multiattack:<n>`. */
export const MULTIATTACK_ID = `monster:${MULTIATTACK_ACTION_ID}`;
export const HEADS_COUNT = 'Number of Heads';

type Step = { readonly action: string; readonly count: number | string };
type Variant = readonly MonsterAction[];

export function isAttack(action: MonsterAction): boolean {
  return (
    action.attackBonus !== null &&
    (action.kind === 'melee' || action.kind === 'ranged' || action.kind === 'meleeOrRanged')
  );
}

function lookup(actions: readonly MonsterAction[], name: string): MonsterAction | undefined {
  const wanted = name.trim().toLowerCase();
  return actions.find((a) => a.id === wanted || a.name.toLowerCase() === wanted);
}

/** A step is resolvable when it names an attack or a supported save action that is usable now. */
function expandSteps(
  steps: readonly Step[],
  actions: readonly MonsterAction[],
  actor: Entity | null,
): Variant | null {
  const out: MonsterAction[] = [];
  for (const step of steps) {
    const action = lookup(actions, step.action);
    if (!action || !(isAttack(action) || isSupportedSaveAction(action))) return null;
    if (actor && !isActionAvailable(actor, action)) return null;
    const count =
      typeof step.count === 'number'
        ? step.count
        : step.count === HEADS_COUNT
          ? ((actor ? readHydraState(actor) : null) ?? FRESH_HYDRA).heads
          : 0;
    if (count < 1) return null;
    for (let i = 0; i < count; i += 1) out.push(action);
  }
  return out;
}

function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  return items.flatMap((item, index) =>
    combinations(items.slice(index + 1), size - 1).map((rest) => [item, ...rest]),
  );
}

function variantsOf(actions: readonly MonsterAction[], actor: Entity | null): Variant[] {
  const multi = actions.find((a) => a.id === MULTIATTACK_ACTION_ID)?.multiattack;
  if (!multi || multi.steps.length === 0) return [];
  const fixed = expandSteps(multi.steps, actions, actor);
  if (!fixed) return [];
  const { options } = multi;
  if (options === null) return [fixed];
  const valid = options.choices
    .map((choice) => expandSteps(choice, actions, actor))
    .filter((choice): choice is Variant => choice !== null);
  if (options.choose < 1 || valid.length < options.choose) return [];
  return combinations(valid, options.choose).map((chosen) => [...fixed, ...chosen.flat()]);
}

/**
 * Every complete Multiattack a monster can make now (SRD 5.2.1 stat blocks), as lists of
 * actions. Pure: no dice, no choosing. A step must name an attack or a supported save action
 * that still has uses (not expended, per-day count left); "Number of Heads" reads the Hydra's
 * live heads. A fixed step that cannot be resolved empties the result: a partial Multiattack
 * is never produced. "Choose N" options expand to every combination of the usable choices.
 */
export function expandMultiattackVariants(actor: Entity): readonly Variant[] {
  return variantsOf(readMonsterSnapshot(actor).actions, actor);
}

/**
 * The first Multiattack variant, or `[]` (convenience). Takes a monster's actions (usage
 * not checked, Hydra at 5 heads) or a spawned monster entity.
 */
export function expandMultiattack(source: readonly MonsterAction[] | Entity): MonsterAction[] {
  const variants = Array.isArray(source)
    ? variantsOf(source as readonly MonsterAction[], null)
    : expandMultiattackVariants(source as Entity);
  return [...(variants[0] ?? [])];
}

export function variantActionId(index: number): string {
  return index === 0 ? MULTIATTACK_ID : `${MULTIATTACK_ID}:${String(index)}`;
}

/** The variant a menu action id names, or null when it is not a Multiattack id. */
export function variantIndexOf(actionId: string): number | null {
  if (actionId === MULTIATTACK_ID) return 0;
  const match = /^monster:multiattack:(\d+)$/.exec(actionId);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** "Rend x2, Scorching Ray": steps in order, repeats counted. */
export function variantLabel(variant: Variant): string {
  const parts: { name: string; count: number }[] = [];
  for (const action of variant) {
    const last = parts[parts.length - 1];
    if (last?.name === action.name) last.count += 1;
    else parts.push({ name: action.name, count: 1 });
  }
  return parts.map((p) => (p.count > 1 ? `${p.name} x${String(p.count)}` : p.name)).join(', ');
}
