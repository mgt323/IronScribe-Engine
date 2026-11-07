/**
 * 7B invariant audit: the 7A rules (adjusted where 7B legitimately changes them) plus
 * death saves, spell slots, limited actions and Hydra heads. Runs on every turn of every
 * case. A violation is an engine or orchestrator bug, not a model miss.
 */
import { auditTurn as audit7a } from '../../stage-7a/lib/audit.mjs';
import { HERO, heroRequest } from './driver.mjs';

const SLOT_TOTAL = 2;
const facts = (turn) => turn.result.facts;
const has = (turn, key, re) => facts(turn).some((f) => f.key === key && (!re || re.test(f.text)));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** 7A flags any HP gain. Waking from the dying state and a Hydra regrowing are legal now. */
function filter7a(turn, list) {
  const wakes =
    has(turn, 'recovery') || has(turn, 'death_save', /natural 20/i) || has(turn, 'heal');
  return list.filter((v) => !(wakes && v === `${HERO} gained hp`));
}

function deathSaves(turn) {
  const { before: b, after: a } = turn;
  const bad = [];
  for (const d of [b.death, a.death]) {
    if (d && (d.successes > 3 || d.failures > 3)) bad.push('death-save tally above 3');
  }
  if (b.death && a.death && !b.death.dead) {
    if (a.death.successes < b.death.successes || a.death.failures < b.death.failures)
      bad.push('death-save tally went down inside one dying spell');
  }
  if (b.death?.dead) {
    if (a.commits !== b.commits || JSON.stringify(a.hp) !== JSON.stringify(b.hp))
      bad.push('state changed after the hero died');
    if (turn.calls !== 0) bad.push(`${turn.calls} model calls after the hero died`);
    if (turn.result.status !== 'none') bad.push(`status ${turn.result.status} after death`);
  }
  if (a.death?.dead && a.hp[HERO] !== 0) bad.push(`dead hero has ${a.hp[HERO]} hp`);
  // The dying turn is a death save: the model is called for narration only.
  const wasDying = b.death && !b.death.dead && !b.death.stable && b.hp[HERO] <= 0;
  if (wasDying) {
    if (!has(turn, 'death_save')) bad.push('dying turn produced no death-save fact');
    if (turn.calls > 1) bad.push(`${turn.calls} model calls on a dying turn (narration only)`);
    if (has(turn, 'attack')) bad.push('hero attacked while dying');
    if (has(turn, 'npc_attack')) bad.push('a hostile attacked a dying hero');
  }
  if (a.death && !b.death && a.hp[HERO] > 0) bad.push('death tally on a conscious hero');
  return bad;
}

/** Spell slots: bounded, spent only by a leveled cast, one per cast, never refunded in a turn. */
function slots(turn) {
  const bad = [];
  const was = turn.before.slots['1'] ?? 0;
  const now = turn.after.slots['1'] ?? 0;
  if (now > SLOT_TOTAL) bad.push(`slots used ${now} of ${SLOT_TOTAL}`);
  if (now < was) bad.push('a slot came back during a turn');
  const leveled = has(turn, 'use', /casts (Burning Hands|Magic Missile)/);
  if (now > was && !leveled) bad.push('slot spent with no leveled spell cast');
  if (leveled && now - was !== 1) bad.push(`a cast spent ${now - was} slots`);
  if (has(turn, 'use', /casts (Fire Bolt|Ray of Frost)/) && now !== was)
    bad.push('a cantrip spent a slot');
  return bad;
}

/** The darts of Magic Missile, per the engine's allocation of the request's slots (SRD 5.2.1). */
const dartAllocation = (slots) =>
  [0, 1, 2].map((i) => (slots.length === 2 ? slots[i % 2] : slots[slots.length === 1 ? 0 : i]));

/** A dart `N` strikes the creature in slot `N`; none strikes a creature that was not named. */
function darts(turn) {
  const req = heroRequest(turn);
  if (!has(turn, 'use', /casts Magic Missile/) || !req) return [];
  const planned = dartAllocation(req.targets);
  const bad = [];
  const struck = facts(turn).filter((f) => f.key === 'spell' && /^dart \d+ strikes /.test(f.text));
  if (struck.length > 3) bad.push(`${struck.length} darts`);
  for (const f of struck) {
    const [, n, id] = /^dart (\d+) strikes (.+)$/.exec(f.text) ?? [];
    if (planned[Number(n) - 1] !== id)
      bad.push(`dart ${n} struck ${id}, slot says ${planned[n - 1]}`);
  }
  return bad;
}

/** Limited monster actions: an expended action is not used again until it is recharged. */
function limitedActions(turn) {
  const bad = [];
  const recharged = (name) =>
    facts(turn).some(
      (f) => f.key === 'recharge' && f.text.includes(name) && /: recharged$/.test(f.text),
    );
  for (const f of facts(turn)) {
    const m = f.key === 'use' && /^(\S+) uses (.+)$/.exec(f.text);
    if (!m || m[1] === HERO) continue;
    const expended = turn.before.expended[m[1]] ?? [];
    if (expended.some((id) => id === slug(m[2])) && !recharged(m[2]))
      bad.push(`${m[1]} used ${m[2]} while it was expended`);
  }
  return bad;
}

/** Hydra: a head only falls with a fact that says so; regrowth is two heads per head lost. */
function hydra(turn) {
  const bad = [];
  for (const [id, now] of Object.entries(turn.after.heads)) {
    const was = turn.before.heads[id] ?? now;
    const lost = facts(turn).filter((f) => f.key === 'hydra' && /loses a head/.test(f.text)).length;
    const grew = facts(turn).some((f) => f.key === 'hydra' && /grows/.test(f.text));
    if (now < 0) bad.push(`${id} has ${now} heads`);
    if (now < was && lost === 0) bad.push(`${id} lost heads silently`);
    if (now > was && !grew) bad.push(`${id} grew heads silently`);
  }
  return bad;
}

export function auditTurn(turn, state) {
  if (turn.kind !== 'say') return [];
  return [
    ...filter7a(turn, audit7a(turn, state)),
    ...deathSaves(turn),
    ...slots(turn),
    ...darts(turn),
    ...limitedActions(turn),
    ...hydra(turn),
  ];
}

/** Whole case: every turn, plus rules that span turns. */
export function auditCase(ctx) {
  const out = [];
  ctx.turns.forEach((turn, i) => {
    for (const v of auditTurn(turn, ctx.state())) out.push(`turn ${i + 1}: ${v}`);
  });
  // Death is terminal: once a turn ends dead, no later turn may leave it.
  const says = ctx.turns.filter((t) => t.kind === 'say');
  let dead = false;
  for (const t of says) {
    if (dead && !t.after.death?.dead) out.push('hero left the dead state');
    dead ||= !!t.after.death?.dead;
  }
  // The closing state of the last model turn: an encounter needs a living hostile, unless
  // the hero is dead or down (those fights stay open on purpose).
  const last = says.at(-1);
  if (last) {
    const { encounter: e, hostiles } = last.after;
    const heroOut = (last.after.hp[HERO] ?? 1) <= 0;
    if (e && !hostiles && !heroOut) out.push('encounter still active with no living hostile');
  }
  return out;
}
