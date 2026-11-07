/**
 * Case driver: a fresh CLI session per case, a `ctx` the cases drive, and the engine
 * "setup" helpers that pin state (HP, turn order) so dice cannot decide the scenario.
 * Setup commits are real engine commits, so they show up in `ctx.setups`, not in turns.
 */
import { createCliSession, defaultAdventurerSheet, handleCliLine } from '../../../dist/index.js';

export const HERO = 'hero';

/** Thrown by a case when the dice did not produce the situation it needs. Not a failure. */
export class Inconclusive extends Error {}

const clone = (v) => JSON.parse(JSON.stringify(v));

/** What the audit needs to compare a turn with the one before it. */
export function snapshot(engine) {
  const s = engine.state;
  return {
    encounter: clone(s.system.encounter ?? null),
    hp: Object.fromEntries(Object.entries(s.entities).map(([id, e]) => [id, e.hp.current])),
    max: Object.fromEntries(Object.entries(s.entities).map(([id, e]) => [id, e.hp.max])),
    present: Object.fromEntries(
      Object.entries(s.entities).map(([id, e]) => [id, e.proximity === 'engaged']),
    ),
    hostiles: Object.values(s.entities).filter(
      (e) =>
        e.proximity === 'engaged' &&
        e.hp.current > 0 &&
        e.system?.attitude === 'hostile' &&
        e.id !== HERO,
    ).length,
    rng: clone(s.rng),
    commits: engine.commits.length,
  };
}

export function createCtx({ seed, client, catalog, timeoutMs, heroHp, onTurn }) {
  const session = createCliSession({
    seed,
    character: { ...defaultAdventurerSheet(), ...(heroHp ? { hpMax: heroHp } : {}) },
    characterName: 'Adventurer',
    llm: client,
    catalog,
  });
  const engine = session.orchestrator.engine;
  const ctx = {
    session,
    engine,
    turns: [],
    setups: [],
    /** Per-turn intent expectations: { turn, field, ok }. Feeds the intent-accuracy score. */
    intents: [],
    notes: {},
    state: () => engine.state,
    inconclusive: (why) => {
      throw new Inconclusive(why);
    },
  };

  /** One player line. Slash commands skip the model; free text records the menu it saw. */
  ctx.send = async (line, expect) => {
    const at = Date.now();
    const before = snapshot(engine);
    if (line.startsWith('/')) {
      let output = '';
      await handleCliLine(session, line, { write: (t) => (output += t) });
      ctx.turns.push({ input: line, kind: 'cmd', output, before, after: snapshot(engine), ms: 0 });
      return ctx.turns.at(-1);
    }
    const menu = engine.menu(HERO);
    const s0 = { ...client.stats };
    const result = await session.orchestrator.runTurn(line, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const turn = {
      input: line,
      kind: 'say',
      result,
      menu,
      before,
      after: snapshot(engine),
      ms: Date.now() - at,
      calls: client.stats.calls - s0.calls,
      repairs: client.stats.repairs - s0.repairs,
      tokens: client.stats.tokens - s0.tokens,
    };
    ctx.turns.push(turn);
    if (expect) scoreIntent(ctx, turn, expect);
    onTurn?.(turn);
    return turn;
  };

  /** Engine-side setup, committed like any other change (the model never sees it). */
  ctx.setup = (label, events) => {
    engine.commit(`setup: ${label}`, events);
    ctx.setups.push(label);
  };
  return ctx;
}

/** Compare what the model asked for with what the case wanted. */
function scoreIntent(ctx, turn, expect) {
  const turnNo = ctx.turns.length - 1;
  const req = turn.result.commits.map((c) => c.request).find((r) => r?.actorId === HERO);
  if (expect.target !== undefined) {
    const t = req?.targetAlias && turn.menu.targets.find((x) => x.alias === req.targetAlias);
    ctx.intents.push({ turn: turnNo, field: 'target', ok: t?.entityId === expect.target });
  }
  if (expect.action !== undefined) {
    const a = req && turn.menu.actions.find((x) => x.alias === req.actionAlias);
    ctx.intents.push({ turn: turnNo, field: 'action', ok: expect.action.test(a?.label ?? '') });
  }
}

// --- setup helpers -------------------------------------------------------------

export const setHp = (ctx, id, hp) => {
  const cur = ctx.state().entities[id]?.hp.current;
  if (cur === undefined || cur === hp) return;
  ctx.setup(
    `${id} hp ${cur} -> ${hp}`,
    cur > hp
      ? [{ type: 'entity.damaged', entityId: id, amount: cur - hp }]
      : [{ type: 'entity.healed', entityId: id, amount: hp - cur }],
  );
};

/** Pin the turn order. `order` is entity ids, first to last; totals count down from 20. */
export const pinOrder = (ctx, order) =>
  ctx.setup(`pin order ${order.join(',')}`, [
    {
      type: 'state.systemDataSet',
      key: 'encounter',
      value: {
        round: 1,
        turnIndex: 0,
        acted: [],
        order: order.map((entityId, i) => ({ entityId, total: 20 - i })),
      },
    },
  ]);

/** `/spawn` through the real command path, so the entity is built by the real rules. */
export const spawn = (ctx, args) => ctx.send(`/spawn ${args}`);

// --- state readers -------------------------------------------------------------

export const entities = (ctx) => Object.values(ctx.state().entities);
export const others = (ctx) => entities(ctx).filter((e) => e.id !== HERO && e.proximity !== 'gone');
export const baseId = (id) => id.replace(/_\d+$/, '').replace(/_/g, '-');
export const ofKind = (ctx, kind) => others(ctx).filter((e) => baseId(e.id) === kind);
export const attitude = (e) => e.system?.attitude;
export const livingHostiles = (ctx) =>
  others(ctx).filter((e) => attitude(e) === 'hostile' && e.hp.current > 0);
export const hp = (ctx, id) => ctx.state().entities[id]?.hp.current;
export const encounter = (ctx) => ctx.state().system.encounter ?? null;

export const says = (ctx) => ctx.turns.filter((t) => t.kind === 'say');
export const cmdOut = (ctx, prefix) =>
  ctx.turns.find((t) => t.kind === 'cmd' && t.input.startsWith(prefix))?.output ?? '';
export const factsOf = (turn) => turn.result?.facts ?? [];
export const allFacts = (ctx) => says(ctx).flatMap(factsOf);
export const countKey = (ctx, key) => allFacts(ctx).filter((f) => f.key === key).length;

/** First failing [ok, message] wins. */
export function rules(...pairs) {
  for (const [ok, message] of pairs) if (!ok) return message;
  return true;
}

/** The hero's request in a turn, with the alias resolved against the menu the model saw. */
export function heroAim(turn) {
  const req = turn.result?.commits.map((c) => c.request).find((r) => r?.actorId === HERO);
  if (!req) return null;
  const target = turn.menu.targets.find((t) => t.alias === req.targetAlias);
  const action = turn.menu.actions.find((a) => a.alias === req.actionAlias);
  return { target: target?.entityId ?? null, action: action?.label ?? null };
}
