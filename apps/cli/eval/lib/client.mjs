/** Command line and model client for the eval runner. */
import { createOracleClient } from './oracle.mjs';
import {
  createGeminiAdapter,
  createLlmClient,
  createOpenAiCompatibleAdapter,
  detectOpenAiModel,
} from '@iron-scribe/llm';

export const HELP = `Usage: node apps/cli/eval/run.mjs [options]
  --url <url>          server (default http://127.0.0.1:5001)
  --provider <p>       openai (default) | gemini | oracle (rule-based stand-in, no server)
  --model <name>       model id (default: detected)
  --schema-mode <m>    json_schema (default) | json_object
  --api-key <key>      Gemini key (or GEMINI_API_KEY / GOOGLE_API_KEY)
  --tier <t>           engine | full   (engine: /spawn setup, model picks actions and narrates)
  --only <text>        cases whose id or category contains <text>
                       categories: loop flow e2e
  --kind <k>           positive | negative
  --runs <n>           repeat every case n times (default 1)
  --seed <value>       base RNG seed (default: eval7a; run n uses <seed>-<n>)
  --hero-hp <n>        override every case's hero HP (default: per case; sheet is 10)
  --timeout-ms <n>     per-turn limit (default 180000)
  --out <file>         one JSON line per run (turns, facts, narration, verdicts)
  --summary <file>     write the summary as JSON (input for --compare)
  --compare <file>     print deltas against an earlier --summary file
  --json               print the summary as JSON
  --fail-under <pct>   exit 2 when the pass rate is below pct
  --max-invariants <n> exit 2 when more than n invariant violations (default: no limit)
  --list               print the case ids and exit
  --verbose            print every failure
  --help, -h`;

const NUM = new Set(['runs', 'timeoutMs', 'failUnder', 'heroHp', 'maxInvariants']);
const FLAGS = {
  '--json': 'json',
  '--list': 'list',
  '--verbose': 'verbose',
  '--help': 'help',
  '-h': 'help',
};
const VALUES = {
  '--url': 'url',
  '--provider': 'provider',
  '--model': 'model',
  '--schema-mode': 'schemaMode',
  '--api-key': 'apiKey',
  '--tier': 'tier',
  '--only': 'only',
  '--kind': 'kind',
  '--runs': 'runs',
  '--seed': 'seed',
  '--hero-hp': 'heroHp',
  '--timeout-ms': 'timeoutMs',
  '--out': 'out',
  '--summary': 'summary',
  '--compare': 'compare',
  '--fail-under': 'failUnder',
  '--max-invariants': 'maxInvariants',
};

export function parseArgs(argv) {
  const o = {
    url: 'http://127.0.0.1:5001',
    urlSet: false,
    provider: 'openai',
    schemaMode: 'json_schema',
    apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
    runs: 1,
    seed: 'eval7a',
    timeoutMs: 180_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') continue;
    if (FLAGS[a]) o[FLAGS[a]] = true;
    else if (VALUES[a]) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`Missing value for ${a}`);
      o[VALUES[a]] = NUM.has(VALUES[a]) ? Number(v) : v;
      if (a === '--url') o.urlSet = true;
    } else throw new Error(`Unknown argument: ${a}`);
  }
  const bad = (m) => {
    throw new Error(m);
  };
  if (!['openai', 'gemini', 'oracle'].includes(o.provider))
    bad('--provider must be openai, gemini or oracle');
  if (!['json_schema', 'json_object'].includes(o.schemaMode)) bad('--schema-mode invalid');
  if (o.tier && !['engine', 'full'].includes(o.tier)) bad('--tier must be engine or full');
  if (o.kind && !['positive', 'negative'].includes(o.kind))
    bad('--kind must be positive or negative');
  if (!Number.isInteger(o.runs) || o.runs < 1) bad('--runs must be a positive integer');
  if (!(o.timeoutMs > 0)) bad('--timeout-ms must be positive');
  if (o.failUnder !== undefined && !(o.failUnder >= 0 && o.failUnder <= 100))
    bad('--fail-under must be 0-100');
  if (o.heroHp !== undefined && !(o.heroHp >= 1)) bad('--hero-hp must be >= 1');
  return o;
}

export const unreachable = (e) =>
  /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|fetch failed|network/i.test(
    [e?.code, e?.message, e?.cause?.code, e?.cause?.message].filter(Boolean).join(' '),
  );

/** Counts repairs and tokens per call, so the driver can report them per turn. */
export function instrument(inner) {
  const stats = { calls: 0, repairs: 0, tokens: 0 };
  const note = (r) => {
    stats.tokens += r?.usage?.totalTokens ?? 0;
  };
  const client = {
    stats,
    async generateObject(req) {
      stats.calls += 1;
      const r = await inner.generateObject(req);
      stats.repairs += Math.max(0, r.attempts.length - 1);
      note(r);
      return r;
    },
    async generateText(req) {
      stats.calls += 1;
      const r = await inner.generateText(req);
      note(r);
      return r;
    },
    streamText(req) {
      stats.calls += 1;
      return inner.streamText(req);
    },
  };
  return client;
}

export async function makeClient(o) {
  if (o.provider === 'oracle') return { client: instrument(createOracleClient()), model: 'oracle' };
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
  return { client: instrument(createLlmClient(adapter)), model };
}
