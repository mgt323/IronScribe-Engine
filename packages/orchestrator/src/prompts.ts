import type { ActionMenu, EntityId, Fact, GameState } from '@iron-scribe/engine-core';
import type { StructuredPrompt } from '@iron-scribe/llm';

/** Stable first message so a prompt cache can reuse it. */
export const ORCHESTRATOR_PREFIX =
  "You are Iron Scribe's rules clerk. You never roll dice, never invent hit points or armor class, and you only use ids the scene lists.";

function prompt(scene: string): StructuredPrompt {
  return { prefix: ORCHESTRATOR_PREFIX, scene, temperature: 0, maxOutputTokens: 2048 };
}

function presentLines(state: GameState): string {
  const lines = state.spawnOrder
    .filter((id) => state.entities[id]?.present === true)
    .map((id) => {
      const entity = state.entities[id];
      const current = entity?.hp.current ?? 0;
      const max = entity?.hp.max ?? 0;
      return `${id} — ${entity?.name ?? id} ${String(current)}/${String(max)} HP`;
    });
  return lines.length > 0 ? lines.join('\n') : '(none)';
}

/** Scene and player text. Aliases are a later call, after any spawn. */
export function buildIntentPrompt(
  state: GameState,
  actorId: EntityId,
  playerInput: string,
): StructuredPrompt {
  return prompt(
    [
      `Actor: ${actorId}`,
      'Present:',
      presentLines(state),
      '',
      'Report a catalog spawn (query, count 1-10, attitude) only for creatures that newly appear and are not already listed under Present. If the player refers to someone already present, spawn nothing (spawnQuery, spawnCount, spawnAttitude all null) and never use an id from Present as a query. For a new group, count is how many appear ("two goblins" is 2). a check (ability id and skill id, or null), and whether the actor also wants one sheet action. Attacking is a sheet action and rolls itself: for a plain attack set the check to null. Use a check only for a separate uncertain feat such as sneaking (Stealth). Do not choose aliases or a DC.',
      '',
      `Player: ${playerInput}`,
    ].join('\n'),
  );
}

/** The menu was built after spawn, so new creatures already have target aliases. */
export function buildDecisionPrompt(menu: ActionMenu, playerInput: string): StructuredPrompt {
  const actions =
    menu.actions.length === 0
      ? '(none)'
      : menu.actions
          .map((action) => `${action.alias} ${action.actionId} — ${action.label}`)
          .join('\n');
  const targets =
    menu.targets.length === 0
      ? '(none)'
      : menu.targets
          .map((target) => `${target.alias} ${target.entityId} — ${target.label}`)
          .join('\n');
  return prompt(
    [
      'Actions:',
      actions,
      'Targets:',
      targets,
      '',
      'Choose one legal alias. Use kind "none" and null aliases when nothing legal matches. Do not invent a target.',
      '',
      `Player: ${playerInput}`,
    ].join('\n'),
  );
}

export function buildNarrationPrompt(
  playerInput: string,
  facts: readonly Fact[],
  state: GameState,
  actorId: EntityId,
): StructuredPrompt {
  const lines = facts.map((fact) => `- ${fact.text}`);
  const names = state.spawnOrder
    .filter((id) => id !== actorId && state.entities[id])
    .map((id) => `${id} = ${state.entities[id]?.name ?? id}`);
  return prompt(
    [
      `Narrate the resolved facts below as a vivid scene in 1-3 sentences, in second person ("you"), present tense. The reader is the player; ${actorId} is you.`,
      'Say what happens, not how it was computed: never write ids (like goblin_warrior_1), dice, DCs, AC, check names, or "hit points"; call creatures by their plain names ("the goblin"). Show success, failure, and wounds in the fiction. Do not add events, outcomes, or creatures the facts omit.',
      'Names:',
      ...(names.length > 0 ? names : ['(none)']),
      'Facts:',
      ...lines,
      '',
      `Player: ${playerInput}`,
    ].join('\n'),
  );
}
