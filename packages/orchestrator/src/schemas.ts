import type { ActionMenu, CheckCatalog } from '@iron-scribe/engine-core';
import { z } from 'zod';

const ATTITUDES = ['hostile', 'neutral', 'friendly'] as const;

export type SpawnAttitude = (typeof ATTITUDES)[number];

/** One catalog spawn. Later slots stay null until the earlier ones are filled. */
export interface SpawnSlotInput {
  readonly query: string | null;
  readonly count: number | null;
  readonly attitude: SpawnAttitude | null;
}

export interface TurnIntent {
  /** True only when the spawn names creatures that were not in Present before this sentence. */
  readonly spawnIsNew: boolean;
  readonly spawn1Query: string | null;
  readonly spawn1Count: number | null;
  readonly spawn1Attitude: SpawnAttitude | null;
  readonly spawn2Query: string | null;
  readonly spawn2Count: number | null;
  readonly spawn2Attitude: SpawnAttitude | null;
  readonly spawn3Query: string | null;
  readonly spawn3Count: number | null;
  readonly spawn3Attitude: SpawnAttitude | null;
  readonly checkAbility: string | null;
  readonly checkSkill: string | null;
  readonly wantsAction: boolean;
}

/** The three spawn slots, in order. */
export function spawnSlotsOf(intent: TurnIntent): readonly SpawnSlotInput[] {
  return [
    { query: intent.spawn1Query, count: intent.spawn1Count, attitude: intent.spawn1Attitude },
    { query: intent.spawn2Query, count: intent.spawn2Count, attitude: intent.spawn2Attitude },
    { query: intent.spawn3Query, count: intent.spawn3Count, attitude: intent.spawn3Attitude },
  ];
}

export interface ActionDecision {
  readonly kind: 'action' | 'none';
  readonly actionAlias: string | null;
  readonly targetAlias: string | null;
  /** Flat on purpose (no arrays in model schemas): a second and third target for area actions. */
  readonly secondaryTargetAlias: string | null;
  readonly tertiaryTargetAlias: string | null;
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

function querySchema(enabled: boolean) {
  return enabled ? z.string().nullable() : z.null();
}

function countSchema(enabled: boolean) {
  return enabled ? z.number().int().min(1).max(10).nullable() : z.null();
}

function attitudeSchema(enabled: boolean) {
  return enabled ? z.enum(ATTITUDES).nullable() : z.null();
}

function refineSpawnSlots(slots: readonly SpawnSlotInput[], ctx: z.RefinementCtx): void {
  let seenEmpty = false;
  let total = 0;
  for (const slot of slots) {
    const filled = slot.query !== null;
    const complete = slot.count !== null && slot.attitude !== null;
    const blank = typeof slot.query === 'string' && slot.query.trim() === '';
    if (filled !== complete || blank) {
      issue(ctx, 'spawn needs a query, a count from 1 to 10, and an attitude');
    }
    if (filled && seenEmpty) issue(ctx, 'spawn slots must be filled in order');
    if (!filled) seenEmpty = true;
    if (filled && typeof slot.count === 'number') total += slot.count;
  }
  if (total > 10) issue(ctx, 'a turn can spawn at most 10 creatures');
}

/** What the player is trying to do. No aliases and no DC: those are not known yet. */
export function buildIntentSchema(
  checkCatalog: CheckCatalog | undefined,
  hasSpawnSupport: boolean,
): z.ZodType<TurnIntent> {
  const on = hasSpawnSupport;
  return z
    .strictObject({
      spawnIsNew: z.boolean(),
      spawn1Query: querySchema(on),
      spawn1Count: countSchema(on),
      spawn1Attitude: attitudeSchema(on),
      spawn2Query: querySchema(on),
      spawn2Count: countSchema(on),
      spawn2Attitude: attitudeSchema(on),
      spawn3Query: querySchema(on),
      spawn3Count: countSchema(on),
      spawn3Attitude: attitudeSchema(on),
      checkAbility: nullableEnum(checkCatalog?.abilities ?? []),
      checkSkill: nullableEnum(checkCatalog?.skills ?? []),
      wantsAction: z.boolean(),
    })
    .superRefine((value, ctx) => {
      refineSpawnSlots(spawnSlotsOf(value), ctx);
      if (value.checkSkill !== null && value.checkAbility === null) {
        issue(ctx, 'a skill check needs an ability');
      }
    });
}

/** Legal aliases after spawn and checks. Built from the menu that exists now. */
export function buildDecisionSchema(menu: ActionMenu): z.ZodType<ActionDecision> {
  const targets = nullableEnum(menu.targets.map((target) => target.alias));
  return z
    .strictObject({
      kind: z.enum(['action', 'none']),
      actionAlias: nullableEnum(menu.actions.map((action) => action.alias)),
      targetAlias: targets,
      secondaryTargetAlias: targets,
      tertiaryTargetAlias: targets,
    })
    .superRefine((value, ctx) => {
      const aliases = targetAliasesOf(value);
      if (value.kind === 'none') {
        if (value.actionAlias !== null || aliases.length > 0) {
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
      if (!action.needsTarget && aliases.length > 0) {
        issue(ctx, 'this action takes no target');
      }
      if (value.secondaryTargetAlias === null && value.tertiaryTargetAlias !== null) {
        issue(ctx, 'tertiaryTargetAlias needs secondaryTargetAlias');
      }
      if (value.targetAlias === null && value.secondaryTargetAlias !== null) {
        issue(ctx, 'secondaryTargetAlias needs targetAlias');
      }
      if (action.needsTarget && aliases.length > (action.maxTargets ?? 1)) {
        issue(ctx, `this action takes at most ${String(action.maxTargets ?? 1)} target(s)`);
      }
    });
}

/** The named targets in order, as the engine takes them. */
export function targetAliasesOf(
  decision: Pick<ActionDecision, 'targetAlias' | 'secondaryTargetAlias' | 'tertiaryTargetAlias'>,
): string[] {
  return [decision.targetAlias, decision.secondaryTargetAlias, decision.tertiaryTargetAlias].filter(
    (alias): alias is string => alias !== null,
  );
}
