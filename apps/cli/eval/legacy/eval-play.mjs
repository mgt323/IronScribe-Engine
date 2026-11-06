#!/usr/bin/env node
/**
 * Live play eval for @iron-scribe/cli: the model, the orchestrator, and the real
 * D&D rules together. Each case is a fresh session driven by player lines.
 *
 *   pnpm --filter @iron-scribe/cli build
 *   node apps/cli/eval/legacy/eval-play.mjs --url http://127.0.0.1:5001 --runs 3 --out play.jsonl
 *
 * Positive cases check the model did the right thing (spawn count, variant,
 * action alias, skill, narration). Negative cases check it did not (invented
 * spawns, double rolls, injected hit points). Command cases cover slash commands.
 *
 * Exit codes: 0 ok, 1 server unreachable / bad arguments, 2 pass rate below --fail-under.
 */
import { writeFileSync } from 'node:fs';

import {
  LlmError,
  createGeminiAdapter,
  createLlmClient,
  createOpenAiCompatibleAdapter,
  detectOpenAiModel,
} from '@iron-scribe/llm';
import { loadCatalog } from '@iron-scribe/system-dnd5e-2024';

import { createCliSession, defaultAdventurerSheet, handleCliLine } from '../../dist/index.js';
import { COMMAND_CASES } from './eval-play-command-cases.mjs';
import { E2E_CASES } from './eval-play-e2e-cases.mjs';
import { ACTION_CASES } from './eval-play-action-cases.mjs';
import { SPAWN_CASES } from './eval-play-cases.mjs';
import { report } from './eval-play-report.mjs';

const HELP = `Usage: node apps/cli/eval/legacy/eval-play.mjs [options]
  --url <url>          server (default http://127.0.0.1:5001)
  --provider <p>       openai (default) | gemini
  --model <name>       model id (default: detected)
  --schema-mode <m>    json_schema (default) | json_object
  --api-key <key>      Gemini key (or GEMINI_API_KEY / GOOGLE_API_KEY)
  --only <text>        cases whose id or category contains <text>
                       categories: spawn clarify action check narration command e2e
  --kind <k>           positive | negative
  --runs <n>           repeat every case n times (default 1)
  --seed <value>       base RNG seed (default: eval; run n uses <seed>-<n>)
  --timeout-ms <n>     per-turn limit (default 180000)
  --out <file>         one JSON line per run: turns, facts, narration, verdict
  --json               print the report as JSON
  --fail-under <pct>   exit 2 when the pass rate is below pct
  --list               print the case ids and exit
  --verbose            print every failure
  --help, -h`;

function parseArgs(argv) {
  const o = {
    url: 'http://127.0.0.1:5001',
    urlSet: false,
    provider: 'openai',
    model: undefined,
    schemaMode: 'json_schema',
    apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
    only: undefined,
    kind: undefined,
    runs: 1,
    seed: 'eval',
    timeoutMs: 180_000,
    out: undefined,
    json: false,
    failUnder: undefined,
    list: false,
    verbose: false,
    help: false,
  };
  const val = (i) => {
    if (argv[i] === undefined || argv[i].startsWith('--'))
      throw new Error(`Missing value for ${argv[i - 1]}`);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') continue;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--json') o.json = true;
    else if (a === '--list') o.list = true;
    else if (a === '--verbose') o.verbose = true;
    else if (a === '--url') {
      o.url = val(++i);
      o.urlSet = true;
    } else if (a === '--provider') o.provider = val(++i);
    else if (a === '--model') o.model = val(++i);
    else if (a === '--schema-mode') o.schemaMode = val(++i);
    else if (a === '--api-key') o.apiKey = val(++i);
    else if (a === '--only') o.only = val(++i);
    else if (a === '--kind') o.kind = val(++i);
    else if (a === '--seed') o.seed = val(++i);
    else if (a === '--out') o.out = val(++i);
    else if (a === '--runs') o.runs = Number(val(++i));
    else if (a === '--timeout-ms') o.timeoutMs = Number(val(++i));
    else if (a === '--fail-under') o.failUnder = Number(val(++i));
    else throw new Error(`Unknown argument: ${a}`);
  }
  const bad = (m) => {
    throw new Error(m);
  };
  if (!['openai', 'gemini'].includes(o.provider)) bad('--provider must be openai or gemini');
  if (!['json_schema', 'json_object'].includes(o.schemaMode))
    bad('--schema-mode must be json_schema or json_object');
  if (o.kind !== undefined && !['positive', 'negative'].includes(o.kind))
    bad('--kind must be positive or negative');
  if (!Number.isInteger(o.runs) || o.runs < 1) bad('--runs must be a positive integer');
  if (!Number.isFinite(o.timeoutMs) || o.timeoutMs <= 0) bad('--timeout-ms must be positive');
  if (o.failUnder !== undefined && !(o.failUnder >= 0 && o.failUnder <= 100))
    bad('--fail-under must be 0-100');
  return o;
}

const unreachable = (e) =>
  /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|fetch failed|network/i.test(
    [e?.code, e?.message, e?.cause?.code, e?.cause?.message].filter(Boolean).join(' '),
  );

const kindOf = (c) => c.kind ?? 'positive';

function selectCases(o) {
  let cases = [...SPAWN_CASES, ...ACTION_CASES, ...COMMAND_CASES, ...E2E_CASES];
  if (o.only) cases = cases.filter((c) => c.id.includes(o.only) || c.category.includes(o.only));
  if (o.kind) cases = cases.filter((c) => kindOf(c) === o.kind);
  return cases;
}

async function makeClient(o) {
  let model = o.model ?? (o.provider === 'gemini' ? 'gemini-2.5-flash' : '');
  if (o.provider === 'openai' && !o.model) {
    try {
      model = await detectOpenAiModel(o.url);
    } catch (e) {
      if (unreachable(e)) throw e;
      model = 'local';
    }
  }
  if (o.provider === 'gemini' && !o.apiKey)
    throw new Error('Gemini needs --api-key or GEMINI_API_KEY.');
  const adapter =
    o.provider === 'gemini'
      ? createGeminiAdapter({ apiKey: o.apiKey, model, ...(o.urlSet ? { baseUrl: o.url } : {}) })
      : createOpenAiCompatibleAdapter({ baseUrl: o.url, model, schemaMode: o.schemaMode });
  return { client: createLlmClient(adapter), model };
}

const EVAL_HERO_HP = 200;

/** One case, one fresh session. Never throws; a thrown turn is a failed case. */
async function runCase(c, o, client, catalog, run) {
  const session = createCliSession({
    seed: `${o.seed}-${run}`,
    // Eval only: enough HP that NPC turns never down the hero and mask the model's behavior.
    character: { ...defaultAdventurerSheet(), hpMax: EVAL_HERO_HP },
    characterName: 'Adventurer',
    llm: client,
    catalog,
  });
  const ctx = { session, turns: [] };
  /** One player line. Slash commands skip the model; free text records the menu it saw. */
  ctx.send = async (line) => {
    const at = Date.now();
    if (line.startsWith('/')) {
      let output = '';
      await handleCliLine(session, line, { write: (t) => (output += t) });
      ctx.turns.push({ input: line, kind: 'cmd', output, ms: Date.now() - at });
      return;
    }
    const menu = session.orchestrator.engine.menu(session.actorId);
    const result = await session.orchestrator.runTurn(line, {
      signal: AbortSignal.timeout(o.timeoutMs),
    });
    ctx.turns.push({ input: line, kind: 'say', result, menu, ms: Date.now() - at });
  };
  const started = Date.now();
  let error = null;
  let schemaError = false;
  try {
    // A step is a player line, or a function (ctx) for setup and loops.
    for (const step of c.steps) {
      if (typeof step === 'function') await step(ctx);
      else await ctx.send(step);
    }
  } catch (e) {
    schemaError = e instanceof LlmError;
    error = e instanceof Error ? e.message : String(e);
    if (unreachable(e)) throw e;
  }
  let verdict = error === null ? c.check(ctx) : `turn failed: ${error}`;
  if (verdict !== true && typeof verdict !== 'string') verdict = 'check returned a non-true value';
  const logs = session.orchestrator.logs;
  return {
    run,
    id: c.id,
    category: c.category,
    kind: kindOf(c),
    known: c.known ?? null,
    pass: verdict === true,
    reason: verdict === true ? null : verdict,
    schemaError,
    ms: Date.now() - started,
    modelCalls: logs.reduce((n, l) => n + l.prompts.length, 0),
    turns: ctx.turns.map((t) =>
      t.kind === 'cmd'
        ? { input: t.input, output: t.output }
        : {
            input: t.input,
            status: t.result.status,
            facts: t.result.facts.map((f) => f.text),
            clarification: t.result.clarification?.message ?? null,
            narration: t.result.narration,
          },
    ),
    raw: logs.flatMap((l) => l.rawResponses),
  };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) return console.log(HELP);
  const cases = selectCases(o);
  if (o.list) {
    for (const c of cases) console.log(`${c.category.padEnd(10)} ${kindOf(c).padEnd(9)} ${c.id}`);
    return undefined;
  }
  if (!cases.length) throw new Error('No cases match --only / --kind');
  const { client, model } = await makeClient(o);
  const catalog = loadCatalog();
  const results = [];
  for (let run = 1; run <= o.runs; run += 1) {
    for (const c of cases) {
      const r = await runCase(c, o, client, catalog, run);
      results.push(r);
      if (!o.json) process.stderr.write(r.pass ? '.' : 'x');
    }
  }
  if (!o.json) process.stderr.write('\n\n');
  if (o.out) writeFileSync(o.out, `${results.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const meta = {
    model,
    url: o.provider === 'gemini' && !o.urlSet ? 'gemini' : o.url,
    runs: o.runs,
  };
  const summary = report(meta, results, o);
  if (o.failUnder !== undefined && summary.pass < o.failUnder) {
    console.error(`pass rate ${summary.pass}% is below --fail-under ${o.failUnder}%`);
    process.exit(2);
  }
  return undefined;
}

main().catch((e) => {
  const m = e instanceof Error ? e.message : String(e);
  console.error(e?.cause?.code ? `${m} (${e.cause.code})` : m);
  process.exit(1);
});
