import type { EntityId, Fact, GameState } from '@iron-scribe/engine-core';

/* Plain-language `Outcome:` lines for the narration prompt. Facts hold ids and terse rolls;
   these lines say who was hit, who was missed, and who stands, with display names only. */

/** Death saves, recovery and death are about the hero's body, not a fresh wound. */
export function dyingFacts(facts: readonly Fact[]): boolean {
  return facts.some((f) => f.key === 'death_save' || f.key === 'recovery' || f.key === 'dead');
}

/** "You" for the hero, the display name for anyone else, never a raw id. */
function subjectOf(state: GameState, id: string, actorId: EntityId): string {
  if (id === actorId) return 'You';
  return state.entities[id]?.name ?? 'The creature';
}

/** A fact text that starts with an entity id names that creature. Procedure saves name nobody. */
function leadingId(state: GameState, text: string, actorId: EntityId): string {
  const first = text.split(' ')[0] ?? '';
  return state.entities[first] ? first : actorId;
}

function hostileStep(state: GameState, fact: Fact): boolean {
  return fact.source !== undefined && state.entities[fact.source]?.system['attitude'] === 'hostile';
}

const WOUND_KEYS = new Set(['hp', 'death_save', 'dead', 'condition']);

/**
 * The hero is unharmed only when a hostile step was aimed at them (explicit targets) and no
 * fact from a hostile step records applied damage or a downing for them. Missing hp facts
 * alone prove nothing: an NPC may have attacked an ally, or a Multiattack may have landed once.
 */
function heroUnharmed(facts: readonly Fact[], state: GameState, actorId: EntityId): boolean {
  const hostile = facts.filter((fact) => hostileStep(state, fact));
  const aimed = hostile.some((fact) => fact.targetIds?.includes(actorId) === true);
  if (!aimed) return false;
  return !hostile.some((fact) => WOUND_KEYS.has(fact.key) && fact.text.startsWith(`${actorId} `));
}

function attackLine(fact: Fact): string {
  if (fact.key === 'npc_attack') {
    const who = fact.text.split(' (')[0] ?? 'The creature';
    return /\bmiss\b/i.test(fact.text)
      ? `Outcome: ${who}'s attack MISSES. Do not describe a hit or a wound from that attack.`
      : `Outcome: ${who}'s attack HITS. The blow lands.`;
  }
  return /\bmiss\b/i.test(fact.text)
    ? 'Outcome: Your attack MISSES. Your blow does not land. Do not describe a hit or a wound from your attack.'
    : 'Outcome: Your attack HITS. Your blow lands.';
}

function saveLine(fact: Fact, state: GameState, actorId: EntityId): string {
  const id = leadingId(state, fact.text, actorId);
  const who = subjectOf(state, id, actorId);
  const s = id === actorId ? '' : 's';
  return /\bsuccess\b/i.test(fact.text)
    ? `Outcome: ${who} make${s} the saving throw and avoid${s} most of the effect.`
    : `Outcome: ${who} fail${s} the saving throw and take${s} the effect in full.`;
}

function defeatLine(fact: Fact, state: GameState, actorId: EntityId): string {
  const who = subjectOf(state, fact.text.trim(), actorId);
  return `Outcome: ${who} is DEFEATED and falls. Do not describe it still standing or fighting.`;
}

export function outcomeLines(
  facts: readonly Fact[],
  state: GameState,
  actorId: EntityId,
): string[] {
  const out: string[] = [];
  for (const fact of facts) {
    if (fact.key === 'npc_attack' || fact.key === 'attack') out.push(attackLine(fact));
    else if (fact.key === 'save') out.push(saveLine(fact, state, actorId));
    else if (fact.key === 'defeated') out.push(defeatLine(fact, state, actorId));
  }
  if (heroUnharmed(facts, state, actorId)) {
    out.push(
      'Outcome: You take no damage from the enemy attack. Do not describe yourself bleeding, wounded, or hurt.',
    );
  }
  const hurt = facts.some((fact) => fact.key === 'damage' || fact.key === 'hp');
  if (!hurt && !dyingFacts(facts))
    out.push('Nobody is wounded in this scene. Do not describe injuries or blood.');
  return out;
}
