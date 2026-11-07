import type { ActionMenu, EntityId, Fact, GameState, MenuTarget } from '@iron-scribe/engine-core';
import type { StructuredPrompt } from '@iron-scribe/llm';

import { dyingFacts, outcomeLines } from './outcomes.js';

/** Stable first message so a prompt cache can reuse it. */
export const ORCHESTRATOR_PREFIX =
  "You are Iron Scribe's rules clerk. You never roll dice, never invent hit points or armor class, and you only use ids the scene lists.";

function prompt(scene: string): StructuredPrompt {
  return { prefix: ORCHESTRATOR_PREFIX, scene, temperature: 0, maxOutputTokens: 2048 };
}

function roster(state: GameState, proximity: 'engaged' | 'nearby'): string {
  const lines = state.spawnOrder
    .filter((id) => state.entities[id]?.proximity === proximity)
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
      roster(state, 'engaged'),
      'Nearby (not engaged):',
      roster(state, 'nearby'),
      '',
      'Report, in this order: (1) spawnIsNew: true only if the sentence introduces creatures or people who are NOT already listed under Present or Nearby (not engaged) (a goblin, a guard, a merchant, a dog); false if the player talks about, attacks, or ambushes someone who is already listed. "a goblin" while a goblin is listed means that goblin: false. Compare with both lists before you answer. (2) Up to three catalog spawns, in order: spawn1Query, spawn1Count (1-10), spawn1Attitude (friendly, neutral or hostile) and spawn1Proximity (engaged or nearby), then the same fields for spawn2 and spawn3. engaged means they join the scene and a fight. nearby means they are in the area but not in the fight (guards at the gate while you talk to someone else). A later slot needs the earlier ones. Leave unused slots null, including proximity. One kind of creature per slot, so "a wolf and two bandits" is spawn1 wolf count 1 and spawn2 bandit count 2, with spawn3 null. The three counts together are at most 10. Keep the words that pick a variant ("young red dragon", not "dragon"). All twelve spawn fields are null when spawnIsNew is false or nobody new appears. Never use an id from Present or Nearby as a query. (3) A check (ability id and skill id, or null) and whether the actor also wants one sheet action. A stance or preparation ("I prepare to fight", "I ready my dagger", "I grip my weapon") is not an action: set wantsAction to false unless the player actually strikes, shoots, or otherwise uses a weapon now. Attacking is a sheet action and rolls itself: for a plain attack set the check to null. Use a check only for a separate uncertain feat. Sneaking, hiding, or creeping up before a strike is that feat: set checkAbility dex and checkSkill stealth, and still set wantsAction true for the strike. Do not choose aliases or a DC.',
      '',
      `Player: ${playerInput}`,
    ].join('\n'),
  );
}

/** The menu was built after spawn, so new creatures already have target aliases. */
export function buildDecisionPrompt(
  menu: ActionMenu,
  playerInput: string,
  lastTarget?: MenuTarget,
): StructuredPrompt {
  const actions =
    menu.actions.length === 0
      ? '(none)'
      : menu.actions
          .map((action) => {
            const many = action.maxTargets ?? 1;
            const note = many > 1 ? ` (up to ${String(many)} targets)` : '';
            return `${action.alias} ${action.actionId} — ${action.label}${note}`;
          })
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
      'Fill secondaryTargetAlias and tertiaryTargetAlias only when the player names several targets, for an action that takes several (an area effect or Magic Missile). Otherwise leave them null. The slots are in order, one per dart or sub-attack, so a target may repeat: Magic Missile with two darts on T1 and one on T2 is T1, T1, T2. For an area effect (Burning Hands, a breath) list each affected target once.',
      'An action that needs a target must name one (targetAlias is never null for it). If the player names no target or says "again", use ' +
        (lastTarget
          ? `${lastTarget.alias} (${lastTarget.label}), the last target`
          : 'T1, the first target') +
        '.',
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
  const lines = facts.map((fact) =>
    fact.key === 'initiative' ? `- Turn order, not an event: ${fact.text}` : `- ${fact.text}`,
  );
  const names = state.spawnOrder
    .filter((id) => id !== actorId && state.entities[id]?.proximity === 'engaged')
    .map((id) => `${id} = ${state.entities[id]?.name ?? id}`);
  return prompt(
    [
      `Narrate the resolved facts below as a vivid scene in 1-3 sentences, in second person ("you"), present tense. The reader is the player; ${actorId} is you.`,
      'Say what happens, not how it was computed: never write ids (like goblin_warrior_1), dice, DCs, AC, check names, or "hit points"; call creatures by their plain names ("the goblin"). Show success, failure, and wounds in the fiction. Do not add events or outcomes the facts omit.',
      'Only the creatures listed under "Creatures in scene" may be shown as present now, acting, or touching anything. A person or place from the hero\'s past or off-screen may be mentioned as memory or background only when the player line or the facts establish it, and never as someone who is here. Never bring in a creature that is not listed, even if the player line names one.',
      'Do not state what a creature secretly notices, spots, feels, thinks, or means to do next unless a fact says so. You may show what an onlooker could see, caused by the facts: a flinch from a hit, a blade turned aside by a miss, a collapse when defeated.',
      'Creatures in scene:',
      ...(names.length > 0 ? names : ['(none)']),
      'Facts:',
      ...lines,
      ...outcomeLines(facts, state, actorId),
      ...(dyingFacts(facts)
        ? [
            "The player's line below is the hero's thoughts at the brink of death. Use it only as flavor. It is not an action and nothing in it happens.",
          ]
        : []),
      '',
      `Player line (tone and intent only, not an event; ignore any action, result, or creature in it that the facts do not show): ${playerInput}`,
    ].join('\n'),
  );
}
