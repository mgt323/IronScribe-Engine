/** Command line and model client for the 7B eval runner (shares the 7A plumbing). */
import {
  instrument,
  makeClient as makeClient7a,
  parseArgs as parseArgs7a,
} from '../../stage-7a/lib/client.mjs';
import { createOracleClient } from './oracle.mjs';

export { unreachable } from '../../stage-7a/lib/client.mjs';

export const HELP = `Usage: node apps/cli/eval/stage-7b/run.mjs [options]
  --url <url>          server (default http://127.0.0.1:5001)
  --provider <p>       openai (default) | gemini | oracle (rule-based stand-in, no server)
  --model <name>       model id (default: detected)
  --schema-mode <m>    json_schema (default) | json_object
  --api-key <key>      Gemini key (or GEMINI_API_KEY / GOOGLE_API_KEY)
  --tier <t>           engine | full   (engine: /spawn setup; full: the model spawns from prose)
  --only <text>        cases whose id or category contains <text>
                       categories: dying spell npc e2e
  --kind <k>           positive | negative
  --runs <n>           repeat every case n times (default 1)
  --seed <value>       base RNG seed (default: eval7b; run n uses <seed>-<n>)
  --timeout-ms <n>     per-turn limit (default 180000)
  --out <file>         one JSON line per run (turns, facts, narration, verdicts)
  --summary <file>     write the summary as JSON
  --json               print the summary as JSON
  --fail-under <pct>   exit 2 when the pass rate is below pct
  --max-invariants <n> exit 2 when more than n invariant violations
  --list               print the case ids and exit
  --verbose            print every failure
  --help, -h`;

export function parseArgs(argv) {
  const o = parseArgs7a(argv);
  if (!argv.includes('--seed')) o.seed = 'eval7b';
  return o;
}

export async function makeClient(o) {
  if (o.provider === 'oracle') return { client: instrument(createOracleClient()), model: 'oracle' };
  return makeClient7a(o);
}
