/**
 * Stage 7B case driver. Same shape as the 7A driver (fresh session per case, a `ctx` the
 * cases drive, engine "setup" commits that pin state), plus: the Sorcerer archetype, a
 * snapshot that carries the 7B state (death saves, spell slots, limited actions, Hydra
 * heads), and intent scoring for spells and several targets.
 */
import {
  createCliSession,
  defaultAdventurerSheet,
  defaultSorcererSheet,
  handleCliLine,
} from '../../../dist/index.js';
import { HERO, Inconclusive, snapshot as baseSnapshot } from '../../stage-7a/lib/driver.mjs';

export * from '../../stage-7a/lib/driver.mjs';

const clone = (v) => JSON.parse(JSON.stringify(v ?? null));

/** The 7A snapshot plus the state 7B added. */
export function snapshot(engine) {
  const entities = Object.entries(engine.state.entities);
  return {
    ...baseSnapshot(engine),
    death: clone(engine.state.entities[HERO]?.system?.deathSaves),
    slots: clone(engine.state.entities[HERO]?.system?.spellSlotsUsed) ?? {},
    expended: Object.fromEntries(entities.map(([id, e]) => [id, e.system?.usage?.expended ?? []])),
    heads: Object.fromEntries(
      entities.filter(([, e]) => e.system?.hydra).map(([id, e]) => [id, e.system.hydra.heads]),
    ),
  };
}

const SHEETS = { rogue: defaultAdventurerSheet, sorcerer: defaultSorcererSheet };

export function createCtx({ seed, client, catalog, timeoutMs, heroHp, archetype = 'rogue' }) {
  const session = createCliSession({
    seed,
    character: { ...SHEETS[archetype](), ...(heroHp ? { hpMax: heroHp } : {}) },
    characterName: 'Adventurer',
    archetype,
    llm: client,
    catalog,
  });
  const engine = session.orchestrator.engine;
  const ctx = {
    session,
    engine,
    archetype,
    turns: [],
    setups: [],
    intents: [],
    notes: {},
    state: () => engine.state,
    inconclusive: (why) => {
      throw new Inconclusive(why);
    },
  };

  ctx.send = async (line, expect) => {
    const at = Date.now();
    const before = snapshot(engine);
    if (line.startsWith('/')) {
      let output = '';
      await handleCliLine(session, line, { write: (t) => (output += t) });
      const turn = { input: line, kind: 'cmd', output, before, after: snapshot(engine), ms: 0 };
      ctx.turns.push(turn);
      return turn;
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
    return turn;
  };

  ctx.setup = (label, events) => {
    engine.commit(`setup: ${label}`, events);
    ctx.setups.push(label);
  };
  return ctx;
}

/** The hero's request this turn, with every alias resolved against the menu the model saw. */
export function heroRequest(turn) {
  const req = turn.result?.commits.map((c) => c.request).find((r) => r?.actorId === HERO);
  if (!req) return null;
  const action = turn.menu.actions.find((a) => a.alias === req.actionAlias);
  const aliases = req.targetAliases ?? (req.targetAlias ? [req.targetAlias] : []);
  const targets = aliases.map((a) => turn.menu.targets.find((t) => t.alias === a)?.entityId);
  return { action: action?.label ?? null, actionId: action?.actionId ?? null, targets };
}

/**
 * expect: { target, action: RegExp, targets: [ids] (set equality), minTargets: n,
 *           none: true (the model must not act) }
 */
function scoreIntent(ctx, turn, expect) {
  const turnNo = ctx.turns.length - 1;
  const req = heroRequest(turn);
  const add = (field, ok) => ctx.intents.push({ turn: turnNo, field, ok });
  if (expect.none) add('refusal', req === null);
  if (expect.action !== undefined) add('action', expect.action.test(req?.action ?? ''));
  if (expect.target !== undefined) add('target', req?.targets[0] === expect.target);
  if (expect.targets !== undefined) {
    const got = new Set(req?.targets ?? []);
    add('targets', got.size === expect.targets.length && expect.targets.every((t) => got.has(t)));
  }
  if (expect.minTargets !== undefined)
    add('targets', new Set(req?.targets ?? []).size >= expect.minTargets);
}

// --- 7B setup helpers ----------------------------------------------------------

const set = (id, key, value) => ({ type: 'entity.systemDataSet', entityId: id, key, value });

/** Put the hero at 0 HP, Unconscious, with a death-save tally (what the engine does on a drop). */
export function downHero(
  ctx,
  tally = { successes: 0, failures: 0, stable: false, dead: false },
  exhaustion = 0,
) {
  const hero = ctx.state().entities[HERO];
  ctx.setup('hero down', [
    { type: 'entity.damaged', entityId: HERO, amount: hero.hp.current },
    set(HERO, 'conditions', { ids: ['unconscious'], exhaustion }),
    set(HERO, 'deathSaves', tally),
  ]);
}

export const spendSlots = (ctx, level, n) =>
  ctx.setup(`spend ${n} level ${level} slot(s)`, [set(HERO, 'spellSlotsUsed', { [level]: n })]);

export const setHydra = (ctx, id, patch) => {
  const cur = ctx.state().entities[id].system.hydra ?? {
    heads: 5,
    damageThisTurn: 0,
    headsLostSinceLastTurn: 0,
    fireDamageSinceLastTurn: false,
  };
  ctx.setup(`hydra ${JSON.stringify(patch)}`, [set(id, 'hydra', { ...cur, ...patch })]);
};

// --- 7B readers ----------------------------------------------------------------

export const deathSaves = (ctx) => ctx.state().entities[HERO].system.deathSaves ?? null;
export const slotsUsed = (ctx, level = '1') =>
  ctx.state().entities[HERO].system.spellSlotsUsed?.[level] ?? 0;
export const hydraHeads = (ctx, id) => ctx.state().entities[id]?.system.hydra?.heads ?? null;
export const heroUp = (ctx) => ctx.state().entities[HERO].hp.current > 0;
export const isDying = (ctx) => {
  const d = deathSaves(ctx);
  return !!d && !d.dead && !d.stable && !heroUp(ctx);
};
export const isDead = (ctx) => deathSaves(ctx)?.dead === true;
