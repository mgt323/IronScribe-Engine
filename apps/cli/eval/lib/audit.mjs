/**
 * Invariant audit. Runs on every turn of every case, whatever the dice and the model did.
 * A violation here is an engine or orchestrator bug, not a model miss, so it is reported
 * apart from case goals. Each rule returns zero or more messages.
 */
import { HERO, baseId } from './driver.mjs';

const isSubsequence = (small, big) => {
  let i = 0;
  for (const x of big) if (x === small[i]) i += 1;
  return i === small.length;
};

const heroCommit = (turn) => turn.result.commits.find((c) => c.request?.actorId === HERO);
const initCommits = (turn) => turn.result.commits.filter((c) => c.procedure?.kind === 'initiative');
const heroDown = (snap) => (snap.hp[HERO] ?? 1) <= 0;

/** Hit points stay in range and only fall through a fact that says someone was hit. */
function hitPoints(turn) {
  const bad = [];
  for (const [id, hp] of Object.entries(turn.after.hp)) {
    if (hp < 0 || hp > turn.after.max[id])
      bad.push(`${id} hp ${hp}/${turn.after.max[id]} out of range`);
  }
  const lost = (id) => turn.before.hp[id] - turn.after.hp[id];
  const hitFacts = (key) =>
    turn.result.facts.filter((f) => f.key === key && !/miss/i.test(f.text)).length;
  if (lost(HERO) > 0 && hitFacts('npc_attack') === 0) bad.push('hero lost hp with no NPC hit');
  for (const id of Object.keys(turn.after.hp)) {
    if (id !== HERO && lost(id) > 0 && hitFacts('attack') === 0)
      bad.push(`${id} lost hp with no hero hit`);
    if (turn.after.hp[id] > (turn.before.hp[id] ?? Infinity)) bad.push(`${id} gained hp`);
  }
  return bad;
}

/** Encounter state is well formed and control is where the loop promises it is. */
function encounterShape(turn) {
  const e = turn.after.encounter;
  if (!e) return [];
  const bad = [];
  const ids = e.order.map((o) => o.entityId);
  if (new Set(ids).size !== ids.length) bad.push('duplicate entity in initiative order');
  for (const id of ids) if (!(id in turn.after.hp)) bad.push(`order lists unknown entity ${id}`);
  if (e.round < 1) bad.push(`round ${e.round}`);
  if (e.turnIndex < 0 || e.turnIndex > ids.length)
    bad.push(`turnIndex ${e.turnIndex} of ${ids.length}`);
  if (!e.acted.every((id) => ids.includes(id))) bad.push('acted lists a stranger');
  if (e.acted.length !== new Set(e.acted).size) bad.push('an entity acted twice in a round');
  // Between player turns the hero is up, or the fight is suspended because the hero is down.
  if (!heroDown(turn.after) && ids[e.turnIndex] !== HERO)
    bad.push(`control left with ${ids[e.turnIndex] ?? 'nobody'}, not the hero`);
  return bad;
}

/** Initiative rolls once per encounter, covers the living, and never lists the dead. */
function initiative(turn) {
  const rolls = initCommits(turn);
  const bad = [];
  if (rolls.length > 1) bad.push(`${rolls.length} initiative rolls in one turn`);
  if (rolls.length && turn.before.encounter)
    bad.push('initiative rolled during an active encounter');
  if (rolls.length) {
    const e = turn.after.encounter;
    const living = Object.keys(turn.before.hp).filter(
      (id) => turn.before.hp[id] > 0 && turn.before.present[id],
    );
    if (e) {
      const ids = e.order.map((o) => o.entityId).sort();
      if (JSON.stringify(ids) !== JSON.stringify([...living].sort()))
        bad.push(`order ${ids.join(',')} != living ${living.join(',')}`);
    }
  }
  return bad;
}

/** Round counter: exactly one round per hero action. Initiative on the first one opens round 1. */
function rounds(turn) {
  const a = turn.after.encounter;
  const b = turn.before.encounter ?? (initCommits(turn).length ? { round: 1 } : null);
  if (!a || !b || !heroCommit(turn) || heroDown(turn.after)) return [];
  const delta = a.round - b.round;
  if (delta !== 1) return [`round went ${b.round} -> ${a.round} on one hero action`];
  return [];
}

/** No creature acts after it is down, nobody acts after the hero falls, order is respected. */
function actors(turn) {
  const bad = [];
  const down = new Set(Object.keys(turn.before.hp).filter((id) => turn.before.hp[id] <= 0));
  let heroFell = heroDown(turn.before);
  const acted = [];
  for (const c of turn.result.commits) {
    const actor = c.request?.actorId;
    if (actor) {
      if (down.has(actor)) bad.push(`${actor} acted while down`);
      if (actor !== HERO && heroFell) bad.push(`${actor} attacked a fallen hero`);
      if (actor === HERO && heroFell) bad.push('hero acted after falling');
      acted.push(actor);
    }
    for (const f of c.facts ?? []) {
      // Monsters get `defeated <id>`; a character at 0 HP gets `condition <id> unconscious`.
      const id =
        f.key === 'defeated'
          ? f.text
          : f.key === 'condition' && /unconscious$/.test(f.text)
            ? f.text.split(' ')[0]
            : null;
      if (!id) continue;
      down.add(id);
      if (id === HERO) heroFell = true;
    }
  }
  // The turn walks the order once from where it stood, then wraps into the next round.
  const known = turn.before.encounter ?? turn.after.encounter;
  if (known) {
    const ids = known.order.map((o) => o.entityId);
    const start = turn.before.encounter ? turn.before.encounter.turnIndex : 0;
    const walk = [...ids.slice(start), ...ids, ...ids];
    const seq = acted.filter((id, k) => id !== acted[k - 1]);
    if (!isSubsequence(seq, walk))
      bad.push(`actors ${seq.join(',')} break order ${ids.join(',')} from ${start}`);
  }
  return bad;
}

/** Non-hostile creatures never attack and are never attacked by the hero. */
function bystanders(turn, state) {
  const bad = [];
  for (const c of turn.result.commits) {
    const actor = c.request?.actorId;
    if (actor && actor !== HERO && state.entities[actor]?.system?.attitude !== 'hostile')
      bad.push(`non-hostile ${actor} acted`);
  }
  return bad;
}

/** Prose that must never reach the player: ids, mechanics words, reasoning tags. */
const LEAK =
  /\b[a-z]+(?:_[a-z]+)*_\d+\b|\bDC ?\d|\bAC ?\d|\bd20\b|<think>|<\|channel\|>|\bhit points\b/i;
function narration(turn) {
  const n = turn.result.narration;
  if (n === null)
    return turn.result.status === 'resolved' && turn.result.facts.length
      ? ['resolved turn with facts has no narration']
      : [];
  return LEAK.test(n) ? [`narration leaks mechanics: "${n.match(LEAK)[0]}"`] : [];
}

/** Model-call budget: intent + decision + narration, plus at most one repair each. */
function budget(turn) {
  return turn.calls > 8 ? [`${turn.calls} model calls in one turn`] : [];
}

export function auditTurn(turn, state) {
  if (turn.kind !== 'say') return [];
  return [
    ...hitPoints(turn),
    ...encounterShape(turn),
    ...initiative(turn),
    ...rounds(turn),
    ...actors(turn),
    ...bystanders(turn, state),
    ...narration(turn),
    ...budget(turn),
  ];
}

/** Whole-case audit: every turn, then the closing state. */
export function auditCase(ctx) {
  const violations = [];
  ctx.turns.forEach((turn, i) => {
    for (const v of auditTurn(turn, ctx.state())) violations.push(`turn ${i + 1}: ${v}`);
  });
  // The closing state of the last model turn, before any /spawn setup that follows it.
  const last = ctx.turns.filter((t) => t.kind === 'say').at(-1);
  if (last) {
    const { encounter: e, hostiles } = last.after;
    if (e && !hostiles) violations.push('encounter still active with no living hostile');
    if (!e && hostiles && last.result.commits.some((c) => c.request?.actorId === HERO))
      violations.push('living hostile left with no encounter after a fight turn');
  }
  return violations;
}

export { baseId };
