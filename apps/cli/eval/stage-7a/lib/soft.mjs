/**
 * Narration quality probes. Heuristics, so they are scored as rates and never fail a
 * case: they tell two models apart, and they show drift between runs of one model.
 *   grounding  names no creature that is not in the scene (7C item 1)
 *   outcome    does not contradict the resolved hit / miss / defeat (7C item 2)
 *   hurt       does not wound a hero the engine says was not hit (7C item 3)
 *   attackers  names or clearly depicts every creature that attacked
 */
import { HERO } from './driver.mjs';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MISS_WORDS = /\b(misses|missed|whiffs?|harmless(ly)?|glances? off|barely (grazes|nicks))\b/i;
const HIT_WORDS =
  /\b(bleeds?|bleeding|blood|pierces|sinks? (in|into)|gashes?|wounds?|slashes? (across|into))\b/i;
const HURT_WORDS =
  /\b(you|your)\b[^.!?]*\b(bleed|bleeding|blood|wound|gash|wince|stagger|reel|pain)/i;
const ALIVE_WORDS = /\b(still (stands|snarls|fights|growls)|shrugs it off)\b/i;

/** Names every catalog creature could be called, longest first. */
export function monsterNames(catalog) {
  return catalog.monsters
    .list()
    .map((m) => m.name)
    .filter((n) => n.length >= 4)
    .sort((a, b) => b.length - a.length);
}

/** Creatures the engine spawned. The player's own line is NOT a source: a creature the player
 *  names but the engine did not spawn must not show up (7C.1). */
function sceneWords(state) {
  return Object.values(state.entities)
    .map((e) => e.name.toLowerCase())
    .join(' ');
}

/** Background or memory is allowed ("escaping the high priest's soldiers"); presence is not. */
const MEMORY =
  /\b(remember\w*|memor(y|ies)|once|years? ago|long ago|fled|flee(ing)?|escap(ed|ing)|past|behind you|back (home|then))\b/i;

function onlyRemembered(narration, low) {
  const re = new RegExp(`\\b${esc(low)}s?\\b`, 'i');
  return narration
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => re.test(sentence))
    .every((sentence) => MEMORY.test(sentence));
}

export function probeTurn(turn, state, names) {
  const n = turn.result?.narration;
  if (turn.kind !== 'say' || !n) return null;
  const out = {};
  const allowed = sceneWords(state);
  const stray = names.filter((name) => {
    const low = name.toLowerCase();
    return (
      !allowed.includes(low) &&
      new RegExp(`\\b${esc(low)}s?\\b`, 'i').test(n) &&
      !onlyRemembered(n, low)
    );
  });
  out.grounding = stray.length === 0 ? true : `invented ${stray[0]}`;

  const heroFacts = turn.result.facts;
  const attack = heroFacts.find((f) => f.key === 'attack');
  const killed = heroFacts.some((f) => f.key === 'defeated' && f.text !== HERO);
  if (attack) {
    const miss = /miss/i.test(attack.text);
    const bad = miss ? HIT_WORDS : killed ? ALIVE_WORDS : MISS_WORDS;
    out.outcome = bad.test(n) ? `${miss ? 'miss' : killed ? 'kill' : 'hit'} contradicted` : true;
  }
  const npc = heroFacts.filter((f) => f.key === 'npc_attack');
  if (npc.length) {
    const hurt = turn.after.hp[HERO] < turn.before.hp[HERO];
    out.hurt = !hurt && HURT_WORDS.test(n) ? 'hero hurt in prose, not in state' : true;
    const missing = npc
      .map((f) => f.text.split(' (')[0])
      .filter((who) => !new RegExp(esc(who.toLowerCase().split(' ')[0]), 'i').test(n));
    out.attackers = missing.length === 0 ? true : `omits ${missing[0]}`;
  }
  return out;
}

/** { probe: { ok, total } } over a list of turns. */
export function probeCase(ctx, names) {
  const tally = {};
  const notes = [];
  ctx.turns.forEach((turn, i) => {
    const p = probeTurn(turn, ctx.state(), names);
    for (const [k, v] of Object.entries(p ?? {})) {
      tally[k] ??= { ok: 0, total: 0 };
      tally[k].total += 1;
      if (v === true) tally[k].ok += 1;
      else notes.push(`turn ${i + 1} ${k}: ${v}`);
    }
  });
  return { tally, notes };
}
