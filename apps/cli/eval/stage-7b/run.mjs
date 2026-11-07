#!/usr/bin/env node
/**
 * Live Stage 7B eval: a real model, the orchestrator, and the real D&D rules, driving
 * combat from free text. Three layers per run, reported apart:
 *   engine invariants  audited on every turn of every case (a violation is an engine bug)
 *   case goals         what this scenario was built to show (7B: dying and death saves,
 *                      spells and slots, several targets, recharge, Multiattack, Hydra, NPC policy)
 *   model behavior     spell / target accuracy, refusals, narration probes, latency
 *
 *   pnpm --filter @iron-scribe/cli build
 *   node apps/cli/eval/stage-7a/run.mjs --url http://127.0.0.1:5001 --runs 3 --summary a.json
 *
 * Exit codes: 0 ok, 1 server unreachable / bad arguments, 2 a threshold failed.
 */
import { writeFileSync } from 'node:fs';

import { LlmError } from '@iron-scribe/llm';
import { loadCatalog } from '@iron-scribe/system-dnd5e-2024';

import { DYING_CASES } from './cases/dying.mjs';
import { E2E_CASES } from './cases/e2e.mjs';
import { NPC_CASES } from './cases/npc.mjs';
import { SPELL_CASES } from './cases/spells.mjs';
import { auditCase } from './lib/audit.mjs';
import { HELP, makeClient, parseArgs, unreachable } from './lib/client.mjs';
import { Inconclusive, createCtx } from './lib/driver.mjs';
import { report } from './lib/report.mjs';
import { monsterNames, probeCase } from './lib/soft.mjs';

const kindOf = (c) => c.kind ?? 'positive';

function selectCases(o) {
  let cases = [...DYING_CASES, ...SPELL_CASES, ...NPC_CASES, ...E2E_CASES];
  if (o.tier) cases = cases.filter((c) => c.tier === o.tier);
  if (o.only) cases = cases.filter((c) => c.id.includes(o.only) || c.category.includes(o.only));
  if (o.kind) cases = cases.filter((c) => kindOf(c) === o.kind);
  return cases;
}

/** One case, one fresh session. Never throws except when the server is unreachable. */
async function runCase(c, o, client, catalog, names, run) {
  const ctx = createCtx({
    seed: `${o.seed}-${run}`,
    client,
    catalog,
    timeoutMs: o.timeoutMs,
    heroHp: o.heroHp ?? c.heroHp,
    archetype: c.archetype,
  });
  const started = Date.now();
  let error = null;
  let skip = null;
  let schemaError = false;
  try {
    await c.steps(ctx);
  } catch (e) {
    if (e instanceof Inconclusive) skip = e.message;
    else {
      if (unreachable(e)) throw e;
      schemaError = e instanceof LlmError;
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const invariants = skip ? [] : auditCase(ctx);
  let goal = error === null ? (skip ? true : c.check(ctx)) : `turn failed: ${error}`;
  if (goal !== true && typeof goal !== 'string') goal = 'check returned a non-true value';
  const { tally, notes } = probeCase(ctx, names);
  const status = skip ? 'skip' : goal === true && invariants.length === 0 ? 'pass' : 'fail';
  const says = ctx.turns.filter((t) => t.kind === 'say');
  return {
    run,
    id: c.id,
    category: c.category,
    tier: c.tier,
    kind: kindOf(c),
    known: c.known ?? null,
    status,
    goal,
    invariants,
    skipReason: skip,
    schemaError,
    ms: Date.now() - started,
    intents: ctx.intents,
    probes: tally,
    probeNotes: notes,
    setups: ctx.setups,
    timing: says.map((t) => ({ ms: t.ms, calls: t.calls, repairs: t.repairs, tokens: t.tokens })),
    turns: ctx.turns.map((t) =>
      t.kind === 'cmd'
        ? { input: t.input, output: t.output }
        : {
            input: t.input,
            status: t.result.status,
            facts: t.result.facts.map((f) => f.text),
            clarification: t.result.clarification?.message ?? null,
            narration: t.result.narration,
            hpAfter: t.after.hp,
            round: t.after.encounter?.round ?? null,
          },
    ),
  };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) return console.log(HELP);
  const cases = selectCases(o);
  if (o.list) {
    for (const c of cases)
      console.log(
        `${c.category.padEnd(6)} ${c.tier.padEnd(7)} ${kindOf(c).padEnd(9)} ${c.id}\n         ${c.about}`,
      );
    return undefined;
  }
  if (!cases.length) throw new Error('No cases match --tier / --only / --kind');
  const { client, model } = await makeClient(o);
  const catalog = loadCatalog();
  const names = monsterNames(catalog);
  const results = [];
  for (let run = 1; run <= o.runs; run += 1) {
    for (const c of cases) {
      const r = await runCase(c, o, client, catalog, names, run);
      results.push(r);
      if (!o.json) process.stderr.write({ pass: '.', fail: 'x', skip: '-' }[r.status]);
    }
  }
  if (!o.json) process.stderr.write('\n\n');
  if (o.out) writeFileSync(o.out, `${results.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const meta = {
    model,
    url: o.provider === 'gemini' && !o.urlSet ? 'gemini' : o.url,
    runs: o.runs,
    seed: o.seed,
  };
  const summary = report(meta, results, o);
  if (o.summary) writeFileSync(o.summary, `${JSON.stringify({ ...meta, summary }, null, 2)}\n`);
  if (o.failUnder !== undefined && summary.pass < o.failUnder) {
    console.error(`pass rate ${summary.pass}% is below --fail-under ${o.failUnder}%`);
    process.exit(2);
  }
  if (o.maxInvariants !== undefined && summary.invariantViolations > o.maxInvariants) {
    console.error(
      `${summary.invariantViolations} invariant violations exceed --max-invariants ${o.maxInvariants}`,
    );
    process.exit(2);
  }
  return undefined;
}

main().catch((e) => {
  const m = e instanceof Error ? e.message : String(e);
  console.error(e?.cause?.code ? `${m} (${e.cause.code})` : m);
  process.exit(1);
});
