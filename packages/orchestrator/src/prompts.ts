import type { ActionMenu, EntityId, Fact, GameState, MenuTarget } from '@iron-scribe/engine-core';
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
      'Report, in this order: (1) spawnIsNew: true only if the sentence introduces creatures or people who are NOT already listed under Present (a goblin, a guard, a merchant, a dog); false if the player talks about, attacks, or ambushes someone who is already listed. "a goblin" while a goblin is listed means that goblin: false. Compare with Present before you answer. (2) A catalog spawn (spawnQuery, spawnCount 1-10, spawnAttitude: friendly, neutral or hostile, whichever fits), or all three null when spawnIsNew is false or nobody new appears. Never use an id from Present as a query. For a new group, count is how many appear ("two goblins" is 2). (3) A check (ability id and skill id, or null) and whether the actor also wants one sheet action. A stance or preparation ("I prepare to fight", "I ready my dagger", "I grip my weapon") is not an action: set wantsAction to false unless the player actually strikes, shoots, or otherwise uses a weapon now. Attacking is a sheet action and rolls itself: for a plain attack set the check to null. Use a check only for a separate uncertain feat. Sneaking, hiding, or creeping up before a strike is that feat: set checkAbility dex and checkSkill stealth, and still set wantsAction true for the strike. Do not choose aliases or a DC.',
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
      'Fill secondaryTargetAlias and tertiaryTargetAlias only when the player names several targets, for an action that takes several (an area effect or Magic Missile). Otherwise leave them null. Never repeat a target.',
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
      ...outcomeLines(facts),
      ...(dyingFacts(facts)
        ? [
            "The player's line below is the hero's thoughts at the brink of death. Use it only as flavor. It is not an action and nothing in it happens.",
          ]
        : []),
      '',
      `Player: ${playerInput}`,
    ].join('\n'),
  );
}

/** Death saves, recovery and death are about the hero's body, not a fresh wound. */
function dyingFacts(facts: readonly Fact[]): boolean {
  return facts.some((f) => f.key === 'death_save' || f.key === 'recovery' || f.key === 'dead');
}

/** Plain-language outcome so a terse roll line cannot be read as the opposite. */
function outcomeLines(facts: readonly Fact[]): string[] {
  const out: string[] = [];
  for (const fact of facts) {
    if (fact.key === 'npc_attack') {
      const who = fact.text.split(' (')[0] ?? 'The creature';
      out.push(
        /\bmiss\b/i.test(fact.text)
          ? `Outcome: ${who}'s attack MISSES. Do not describe a hit or a wound from it.`
          : `Outcome: ${who}'s attack HITS. The blow lands.`,
      );
      continue;
    }
    if (fact.key === 'save') {
      const who = fact.text.split(' ')[0] ?? 'The creature';
      out.push(
        /\bsuccess\b/i.test(fact.text)
          ? `Outcome: ${who} makes the saving throw and avoids most of the effect.`
          : `Outcome: ${who} fails the saving throw and takes the effect in full.`,
      );
      continue;
    }
    if (fact.key !== 'attack') continue;
    if (/\bmiss\b/i.test(fact.text)) {
      out.push(
        'Outcome: the attack MISSES. The blow does not land. Do not describe a hit or a wound.',
      );
    } else {
      out.push('Outcome: the attack HITS. The blow lands.');
    }
  }
  const hurt = facts.some((fact) => fact.key === 'damage' || fact.key === 'hp');
  if (!hurt && !dyingFacts(facts))
    out.push('Nobody is wounded in this scene. Do not describe injuries or blood.');
  return out;
}
