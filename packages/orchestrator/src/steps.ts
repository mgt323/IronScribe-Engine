import {
  EngineError,
  type Engine,
  type EntityId,
  type Fact,
  type RuleSystem,
} from '@iron-scribe/engine-core';
import type { LlmClient, StructuredPrompt } from '@iron-scribe/llm';

import { rebindRequest, runPlayerTurn } from './combat.js';
import { buildDecisionPrompt, buildIntentPrompt } from './prompts.js';
import {
  buildDecisionSchema,
  buildIntentSchema,
  targetAliasesOf,
  type TurnIntent,
} from './schemas.js';

export interface StepContext {
  readonly engine: Engine;
  readonly system: RuleSystem;
  readonly llm: LlmClient;
  readonly actorId: EntityId;
  /** The target of the actor's last targeted action, so "again" has a referent. */
  readonly memory: { lastTargetId: EntityId | null };
}

export async function readIntent(
  ctx: StepContext,
  input: string,
  signal: AbortSignal | undefined,
  prompts: StructuredPrompt[],
  raw: string[],
): Promise<TurnIntent> {
  const prompt = buildIntentPrompt(ctx.engine.state, ctx.actorId, input);
  prompts.push(prompt);
  const result = await ctx.llm.generateObject({
    name: 'turn_intent',
    schema: buildIntentSchema(ctx.system.checkCatalog, ctx.system.resolveSpawn !== undefined),
    prompt,
    ...(signal ? { signal } : {}),
  });
  raw.push(...result.attempts.map((attempt) => attempt.rawText));
  return result.data;
}

export function checkFrom(ctx: StepContext, intent: TurnIntent): Fact[] {
  if (intent.checkAbility === null) return [];
  // An attack or other menu action rolls for itself. A bare ability check
  // beside it is a double roll; only a skill (e.g. Stealth) may come first.
  if (intent.wantsAction && intent.checkSkill === null) return [];
  if (!ctx.system.resolveCheckDc) {
    throw new EngineError('no_procedure_handler', 'This system cannot check');
  }
  const dc = ctx.system.resolveCheckDc(ctx.engine.state, {
    actorId: ctx.actorId,
    ability: intent.checkAbility,
    skill: intent.checkSkill,
    procedureId: 'check',
  });
  const commit = ctx.engine.runProcedure('check', {
    kind: 'check',
    actorId: ctx.actorId,
    ability: intent.checkAbility,
    skill: intent.checkSkill,
    dc,
  });
  return [...commit.facts];
}

export async function actionFrom(
  ctx: StepContext,
  intent: TurnIntent,
  input: string,
  prompts: StructuredPrompt[],
  raw: string[],
  signal: AbortSignal | undefined,
): Promise<Fact[]> {
  if (!intent.wantsAction) return [];
  const menu = ctx.engine.menu(ctx.actorId);
  // Without a target no attack can validate, and the model has nothing legal to pick.
  const usable = menu.actions.filter((action) => !action.needsTarget || menu.targets.length > 0);
  if (usable.length === 0) return [];
  const last = menu.targets.find((target) => target.entityId === ctx.memory.lastTargetId);
  const prompt = buildDecisionPrompt(menu, input, last);
  prompts.push(prompt);
  const result = await ctx.llm.generateObject({
    name: 'decision',
    schema: buildDecisionSchema(menu),
    prompt,
    ...(signal ? { signal } : {}),
  });
  raw.push(...result.attempts.map((attempt) => attempt.rawText));
  if (result.data.kind === 'none' || result.data.actionAlias === null) return [];
  const { actionAlias, targetAlias } = result.data;
  const targetAliases = targetAliasesOf(result.data);
  const aimed = menu.targets.find((target) => target.alias === targetAlias);
  return runPlayerTurn(ctx.engine, ctx.system, ctx.actorId, targetAlias !== null, () => {
    const request = rebindRequest(
      ctx.engine,
      {
        actorId: ctx.actorId,
        actionAlias,
        targetAlias,
        ...(targetAliases.length > 1 ? { targetAliases } : {}),
      },
      menu,
    );
    if (request === null) return [];
    const commit = ctx.engine.perform(request);
    if (aimed) ctx.memory.lastTargetId = aimed.entityId;
    return [...commit.facts];
  });
}
