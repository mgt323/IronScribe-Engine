#!/usr/bin/env node
/**
 * Advanced live eval for @iron-scribe/llm.
 *
 *   pnpm --filter @iron-scribe/llm build
 *   node packages/llm/bin/eval-advanced.mjs --url http://127.0.0.1:5001 --runs 3 --out eval.jsonl
 *
 * Beyond eval.mjs: more cases (menus, refusals, injection, checks, spawns, narration),
 * repeated runs with pass rates, per-category scores, token usage, a streaming check,
 * raw replies saved as JSONL, a --json report and a --fail-under gate.
 *
 * Exit codes: 0 ok, 1 server unreachable / bad arguments, 2 score below --fail-under.
 */
import { writeFileSync } from 'node:fs';
import {
  DEFAULT_EVAL_CASES,
  LlmError,
  createGeminiAdapter,
  createLlmClient,
  createOpenAiCompatibleAdapter,
  detectOpenAiModel,
} from '../dist/index.js';
import { ADVANCED_CASES, PREFIX, STREAM_CASE } from './eval-advanced-cases.mjs';

const HELP = `Usage: node packages/llm/bin/eval-advanced.mjs [options]
  --url <url>          server (default http://127.0.0.1:5001)
  --provider <p>       openai (default) | gemini
  --model <name>       model id (default: detected)
  --schema-mode <m>    json_schema (default) | json_object
  --api-key <key>      Gemini key (or GEMINI_API_KEY / GOOGLE_API_KEY)
  --suite <s>          all (default) | default | advanced
  --only <text>        run cases whose id or category contains <text>
  --runs <n>           repeat every case n times (default 1)
  --temperature <t>    override sampling temperature (default 0)
  --timeout-ms <n>     per-call limit (default 180000)
  --out <file>         write one JSON line per call (prompt, raw replies, verdict)
  --json               print the report as JSON instead of text
  --fail-under <pct>   exit 2 when the semantic pass rate is below pct
  --verbose            print every failing reply
  --help, -h`;

function parseArgs(argv) {
  const o = {
    url: 'http://127.0.0.1:5001', urlSet: false, provider: 'openai', model: undefined,
    schemaMode: 'json_schema', apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
    suite: 'all', only: undefined, runs: 1, temperature: 0, timeoutMs: 180_000,
    out: undefined, json: false, failUnder: undefined, verbose: false, help: false,
  };
  const val = (i) => {
    if (argv[i] === undefined || argv[i].startsWith('--')) throw new Error(`Missing value for ${argv[i - 1]}`);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') continue;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--json') o.json = true;
    else if (a === '--verbose') o.verbose = true;
    else if (a === '--url') { o.url = val(++i); o.urlSet = true; }
    else if (a === '--provider') o.provider = val(++i);
    else if (a === '--model') o.model = val(++i);
    else if (a === '--schema-mode') o.schemaMode = val(++i);
    else if (a === '--api-key') o.apiKey = val(++i);
    else if (a === '--suite') o.suite = val(++i);
    else if (a === '--only') o.only = val(++i);
    else if (a === '--out') o.out = val(++i);
    else if (a === '--runs') o.runs = Number(val(++i));
    else if (a === '--temperature') o.temperature = Number(val(++i));
    else if (a === '--timeout-ms') o.timeoutMs = Number(val(++i));
    else if (a === '--fail-under') o.failUnder = Number(val(++i));
    else throw new Error(`Unknown argument: ${a}`);
  }
  const bad = (m) => { throw new Error(m); };
  if (!['openai', 'gemini'].includes(o.provider)) bad('--provider must be openai or gemini');
  if (!['json_schema', 'json_object'].includes(o.schemaMode)) bad('--schema-mode must be json_schema or json_object');
  if (!['all', 'default', 'advanced'].includes(o.suite)) bad('--suite must be all, default or advanced');
  if (!Number.isInteger(o.runs) || o.runs < 1) bad('--runs must be a positive integer');
  if (!Number.isFinite(o.temperature) || o.temperature < 0) bad('--temperature must be >= 0');
  if (!Number.isFinite(o.timeoutMs) || o.timeoutMs <= 0) bad('--timeout-ms must be positive');
  if (o.failUnder !== undefined && !(o.failUnder >= 0 && o.failUnder <= 100)) bad('--fail-under must be 0-100');
  return o;
}

function unreachable(e) {
  const c = e?.cause;
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|fetch failed|network/i.test(
    [e?.code, e?.message, c?.code, c?.message].filter(Boolean).join(' '),
  );
}

function buildCases(o) {
  const defaults = DEFAULT_EVAL_CASES.map((c) => ({
    id: c.id, category: 'default', mode: c.mode, schemaName: c.schemaName, schema: c.schema,
    prefix: c.prompt.prefix, scene: c.prompt.scene, expect: c.expect,
  }));
  const adv = ADVANCED_CASES.map((c) => ({ ...c, prefix: PREFIX }));
  let cases = o.suite === 'default' ? defaults : o.suite === 'advanced' ? adv : [...defaults, ...adv];
  if (o.only) cases = cases.filter((c) => c.id.includes(o.only) || c.category.includes(o.only));
  return cases;
}

const LEAK = /<think>|<\/think>|<\|channel\|>|<\|message\|>/i;

async function runObject(client, c, prompt, signal) {
  const base = { id: c.id, category: c.category, kind: 'object' };
  try {
    const r = await client.generateObject({ name: c.schemaName, schema: c.schema, prompt, signal });
    return {
      ...base, schemaOk: true, attempts: r.attempts.length, semantic: Boolean(c.expect(r.data)),
      latencyMs: r.totalLatencyMs, usage: r.usage, reply: r.data, raw: r.attempts.map((a) => a.rawText),
      error: null,
    };
  } catch (e) {
    const attempts = e instanceof LlmError ? e.attempts : [];
    return {
      ...base, schemaOk: false, attempts: attempts.length, semantic: false, latencyMs: 0, usage: null,
      reply: null, raw: attempts.map((a) => a.rawText), error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function runText(client, c, prompt, signal) {
  const base = { id: c.id, category: c.category, kind: 'text', attempts: 1 };
  try {
    const r = await client.generateText({ prompt, signal });
    const clean = !LEAK.test(r.text);
    return {
      ...base, schemaOk: clean, semantic: clean && Boolean(c.expect(r.text)), latencyMs: r.latencyMs,
      usage: r.usage, reply: r.text, raw: [r.text], error: clean ? null : 'reasoning tags leaked',
    };
  } catch (e) {
    return {
      ...base, schemaOk: false, semantic: false, latencyMs: 0, usage: null, reply: null, raw: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function runStream(client, prompt, signal) {
  const base = { id: STREAM_CASE.id, category: 'stream', kind: 'stream', attempts: 1, usage: null };
  const started = Date.now();
  let first = null;
  let chunks = 0;
  let text = '';
  try {
    for await (const piece of client.streamText({ prompt, signal })) {
      if (first === null) first = Date.now() - started;
      chunks += 1;
      text += piece;
    }
    const ok = text.trim().length > 0 && !LEAK.test(text);
    return {
      ...base, schemaOk: ok, semantic: ok && chunks > 1, latencyMs: Date.now() - started,
      firstChunkMs: first, chunks, reply: text, raw: [text], error: ok ? null : 'empty or leaked reasoning',
    };
  } catch (e) {
    return {
      ...base, schemaOk: false, semantic: false, latencyMs: Date.now() - started, reply: null, raw: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);
function stats(values) {
  if (!values.length) return { mean: 0, p50: 0, p95: 0, max: 0 };
  const s = [...values].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
  return { mean: Math.round(values.reduce((a, b) => a + b, 0) / values.length), p50: at(0.5), p95: at(0.95), max: s[s.length - 1] };
}

function summarize(results, runs) {
  const group = (rows) => ({
    calls: rows.length,
    semantic: pct(rows.filter((r) => r.semantic).length, rows.length),
    schema: pct(rows.filter((r) => r.schemaOk).length, rows.length),
  });
  const byCase = {};
  const byCategory = {};
  for (const r of results) (byCase[r.id] ??= []).push(r);
  for (const r of results) (byCategory[r.category] ??= []).push(r);
  const objects = results.filter((r) => r.kind === 'object');
  const tokens = results.reduce((s, r) => s + (r.usage?.totalTokens ?? 0), 0);
  return {
    runs,
    total: group(results),
    firstTry: pct(objects.filter((r) => r.schemaOk && r.attempts === 1).length, objects.length),
    repaired: objects.filter((r) => r.schemaOk && r.attempts === 2).length,
    exhausted: objects.filter((r) => !r.schemaOk).length,
    flaky: Object.entries(byCase).filter(([, rows]) => rows.some((r) => r.semantic) && rows.some((r) => !r.semantic)).map(([id]) => id),
    categories: Object.fromEntries(Object.entries(byCategory).map(([k, rows]) => [k, group(rows)])),
    cases: Object.fromEntries(Object.entries(byCase).map(([k, rows]) => [k, group(rows)])),
    latencyMs: stats(results.filter((r) => r.latencyMs > 0).map((r) => r.latencyMs)),
    firstChunkMs: stats(results.filter((r) => r.firstChunkMs != null).map((r) => r.firstChunkMs)),
    totalTokens: tokens,
  };
}

function printText(meta, results, s, verbose) {
  console.log(`model: ${meta.model}\nurl: ${meta.url}\nruns: ${s.runs}  temperature: ${meta.temperature}\n`);
  for (const [id, g] of Object.entries(s.cases)) {
    const mark = g.semantic === 100 ? 'ok  ' : g.semantic === 0 ? 'FAIL' : 'FLAKY';
    const rows = results.filter((r) => r.id === id);
    console.log(`${mark.padEnd(5)} ${id.padEnd(22)} ${String(g.semantic).padStart(5)}% semantic  ${String(g.schema).padStart(5)}% schema  ${stats(rows.map((r) => r.latencyMs)).p50}ms p50`);
    if (verbose || g.semantic < 100) {
      for (const r of rows.filter((x) => !x.semantic).slice(0, verbose ? rows.length : 1)) {
        console.log(`        reply: ${JSON.stringify(r.error ?? r.reply).slice(0, 160)}`);
      }
    }
  }
  console.log('\nBy category:');
  for (const [k, g] of Object.entries(s.categories)) console.log(`  ${k.padEnd(10)} semantic ${g.semantic}%  schema ${g.schema}%  (${g.calls} calls)`);
  console.log(`\nsemantic: ${s.total.semantic}%   schema: ${s.total.schema}%   first-try JSON: ${s.firstTry}%`);
  console.log(`repaired: ${s.repaired}   exhausted: ${s.exhausted}   flaky cases: ${s.flaky.join(', ') || 'none'}`);
  const l = s.latencyMs;
  console.log(`latency ms: mean ${l.mean} p50 ${l.p50} p95 ${l.p95} max ${l.max}`);
  if (s.firstChunkMs.max > 0) console.log(`stream first chunk ms: mean ${s.firstChunkMs.mean} max ${s.firstChunkMs.max}`);
  console.log(`tokens: ${s.totalTokens || 'not reported'}`);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) return console.log(HELP);
  const cases = buildCases(o);
  if (!cases.length) throw new Error('No cases match --only');

  let model = o.model ?? (o.provider === 'gemini' ? 'gemini-2.5-flash' : '');
  if (o.provider === 'openai' && !o.model) {
    try { model = await detectOpenAiModel(o.url); } catch (e) {
      if (unreachable(e)) throw e;
      model = 'local';
    }
  }
  if (o.provider === 'gemini' && !o.apiKey) throw new Error('Gemini needs --api-key or GEMINI_API_KEY.');
  const adapter = o.provider === 'gemini'
    ? createGeminiAdapter({ apiKey: o.apiKey, model, ...(o.urlSet ? { baseUrl: o.url } : {}) })
    : createOpenAiCompatibleAdapter({ baseUrl: o.url, model, schemaMode: o.schemaMode });
  const client = createLlmClient(adapter);

  const results = [];
  const jsonl = [];
  const wantStream = !o.only || 'stream'.includes(o.only) || STREAM_CASE.id.includes(o.only);
  for (let run = 1; run <= o.runs; run += 1) {
    const plan = [...cases, ...(wantStream && o.suite !== 'default' ? [STREAM_CASE] : [])];
    for (const c of plan) {
      const prompt = { prefix: c.prefix ?? PREFIX, scene: c.scene, temperature: o.temperature, maxOutputTokens: 2048 };
      const signal = AbortSignal.timeout(o.timeoutMs);
      const r = c === STREAM_CASE ? await runStream(client, prompt, signal)
        : c.mode === 'text' ? await runText(client, c, prompt, signal)
        : await runObject(client, c, prompt, signal);
      results.push(r);
      jsonl.push(JSON.stringify({ run, ...r, prompt }));
      if (!o.json) process.stderr.write(r.semantic ? '.' : 'x');
    }
  }
  if (!o.json) process.stderr.write('\n\n');
  if (o.out) writeFileSync(o.out, `${jsonl.join('\n')}\n`);

  const summary = summarize(results, o.runs);
  const meta = { model, url: o.provider === 'gemini' && !o.urlSet ? 'gemini' : o.url, temperature: o.temperature };
  if (o.json) console.log(JSON.stringify({ ...meta, summary }, null, 2));
  else printText(meta, results, summary, o.verbose);
  if (o.failUnder !== undefined && summary.total.semantic < o.failUnder) {
    console.error(`semantic ${summary.total.semantic}% is below --fail-under ${o.failUnder}%`);
    process.exit(2);
  }
}

main().catch((e) => {
  const c = e?.cause;
  const m = e instanceof Error ? e.message : String(e);
  console.error(c?.code ? `${m} (${c.code})` : m);
  process.exit(1);
});
