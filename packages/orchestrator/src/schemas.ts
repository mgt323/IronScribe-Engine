import type { ActionMenu, CheckCatalog } from '@iron-scribe/engine-core';
import { z } from 'zod';

const ATTITUDES = ['hostile', 'neutral', 'friendly'] as const;

export interface TurnIntent {
  /** True only when the spawn names creatures that were not in Present before this sentence. */
  readonly spawnIsNew: boolean;
  readonly spawnQuery: string | null;
  readonly spawnCount: number | null;
  readonly spawnAttitude: (typeof ATTITUDES)[number] | null;
  readonly checkAbility: string | null;
  readonly checkSkill: string | null;
  readonly wantsAction: boolean;
}

export interface ActionDecision {
  readonly kind: 'action' | 'none';
  readonly actionAlias: string | null;
  readonly targetAlias: string | null;
}

/** An empty list is `null`, never `z.enum([])`. */
export function nullableEnum(values: readonly string[]): z.ZodType<string | null> {
  const [first, ...rest] = values;
  if (!first) return z.null();
  return z.enum([first, ...rest]).nullable();
}

function issue(ctx: z.RefinementCtx, message: string): void {
  ctx.addIssue({ code: 'custom', message });
}

/** What the player is trying to do. No aliases and no DC: those are not known yet. */
export function buildIntentSchema(
  checkCatalog: CheckCatalog | undefined,
  hasSpawnSupport: boolean,
): z.ZodType<TurnIntent> {
  return z
    .strictObject({
      spawnIsNew: z.boolean(),
      spawnQuery: hasSpawnSupport ? z.string().nullable() : z.null(),
      spawnCount: hasSpawnSupport ? z.number().int().min(1).max(10).nullable() : z.null(),
      spawnAttitude: hasSpawnSupport ? z.enum(ATTITUDES).nullable() : z.null(),
      checkAbility: nullableEnum(checkCatalog?.abilities ?? []),
      checkSkill: nullableEnum(checkCatalog?.skills ?? []),
      wantsAction: z.boolean(),
    })
    .superRefine((value, ctx) => {
      const spawning = value.spawnQuery !== null;
      const complete = value.spawnCount !== null && value.spawnAttitude !== null;
      const blank = typeof value.spawnQuery === 'string' && value.spawnQuery.trim() === '';
      if (spawning !== complete || blank) {
        issue(ctx, 'spawn needs a query, a count from 1 to 10, and an attitude');
      }
      if (value.checkSkill !== null && value.checkAbility === null) {
        issue(ctx, 'a skill check needs an ability');
      }
    });
}

/** Legal aliases after spawn and checks. Built from the menu that exists now. */
export function buildDecisionSchema(menu: ActionMenu): z.ZodType<ActionDecision> {
  return z
    .strictObject({
      kind: z.enum(['action', 'none']),
      actionAlias: nullableEnum(menu.actions.map((action) => action.alias)),
      targetAlias: nullableEnum(menu.targets.map((target) => target.alias)),
    })
    .superRefine((value, ctx) => {
      if (value.kind === 'none') {
        if (value.actionAlias !== null || value.targetAlias !== null) {
          issue(ctx, 'none requires null aliases');
        }
        return;
      }
      const action = menu.actions.find((entry) => entry.alias === value.actionAlias);
      if (!action || value.actionAlias === null) {
        issue(ctx, 'action requires an alias from the menu');
        return;
      }
      if (action.needsTarget && value.targetAlias === null) {
        issue(ctx, 'this action needs a target');
      }
      if (!action.needsTarget && value.targetAlias !== null) {
        issue(ctx, 'this action takes no target');
      }
    });
}
