#!/usr/bin/env node
/**
 * Score a live model on the Stage 5 tasks.
 *
 *   pnpm --filter @iron-scribe/llm build
 *   pnpm --filter @iron-scribe/llm eval -- --url http://127.0.0.1:5001
 *
 * Exits 0 when the server answers, even if the model misses cases.
 * Exits 1 when the server cannot be reached.
 */
import {
  createGeminiAdapter,
  createLlmClient,
  createOpenAiCompatibleAdapter,
  detectOpenAiModel,
  runEvalSuite,
} from '../dist/index.js';

function printHelp() {
  console.log(`Usage:
  pnpm --filter @iron-scribe/llm eval -- [options]

Options:
  --url <url>            OpenAI-compatible server (default http://127.0.0.1:5001)
  --model <name>         model id (default: first id from /v1/models, else "local")
  --provider <name>      openai (default) or gemini
  --schema-mode <mode>   json_schema (default) or json_object
  --api-key <key>        Gemini key (or GEMINI_API_KEY / GOOGLE_API_KEY)
  --timeout-ms <n>       per-case limit (default 180000)
  --help, -h
`);
}

function required(argv, index) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error('Missing value for the previous flag');
  return value;
}

function parseArgs(argv) {
  const options = {
    url: 'http://127.0.0.1:5001',
    urlSet: false,
    model: undefined,
    provider: 'openai',
    schemaMode: 'json_schema',
    apiKey: process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY'],
    timeoutMs: 180_000,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--url') {
      options.url = required(argv, (index += 1));
      options.urlSet = true;
    } else if (arg === '--model') options.model = required(argv, (index += 1));
    else if (arg === '--provider') options.provider = required(argv, (index += 1));
    else if (arg === '--schema-mode') options.schemaMode = required(argv, (index += 1));
    else if (arg === '--api-key') options.apiKey = required(argv, (index += 1));
    else if (arg === '--timeout-ms') options.timeoutMs = Number(required(argv, (index += 1)));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function unreachable(error) {
  const cause = error && typeof error === 'object' ? error.cause : undefined;
  const parts = [error?.code, error?.message, cause?.code, cause?.message].filter(Boolean);
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|fetch failed|network/i.test(
    parts.join(' '),
  );
}

function printReport(model, url, report) {
  const objects = report.results.filter((result) => result.kind === 'object').length;
  console.log(`model: ${model}`);
  console.log(`url: ${url}`);
  console.log('');
  for (const result of report.results) {
    const mark = result.schemaOk && result.semanticMatch ? 'ok  ' : 'FAIL';
    const semantic = result.semanticMatch ? 'semantic' : 'semantic-miss';
    console.log(
      `${mark} ${result.id}  ${result.detail}  ${semantic}  ${String(result.latencyMs)}ms`,
    );
  }
  console.log('');
  console.log(`first-try schema: ${String(report.firstTryPasses)}/${String(objects)}`);
  console.log(`repaired: ${String(report.repaired)}`);
  console.log(`exhausted: ${String(report.exhausted)}`);
  console.log(`semantic: ${String(report.semanticMatches)}/${String(report.results.length)}`);
  console.log(
    `latency ms: mean ${String(report.latencyMs.mean)} p50 ${String(report.latencyMs.p50)} max ${String(report.latencyMs.max)}`,
  );
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}
if (options.provider !== 'openai' && options.provider !== 'gemini') {
  console.error('--provider must be openai or gemini');
  process.exit(1);
}
if (options.schemaMode !== 'json_schema' && options.schemaMode !== 'json_object') {
  console.error('--schema-mode must be json_schema or json_object');
  process.exit(1);
}
if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
  console.error('--timeout-ms must be a positive number');
  process.exit(1);
}

try {
  let model = options.model ?? (options.provider === 'gemini' ? 'gemini-2.5-flash' : '');
  if (options.provider === 'openai' && !options.model) {
    try {
      model = await detectOpenAiModel(options.url);
    } catch (error) {
      if (unreachable(error)) throw error;
      model = 'local';
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not read /v1/models (${message}). Using model "${model}".`);
    }
  }
  if (options.provider === 'gemini' && !options.apiKey) {
    console.error('Gemini needs --api-key or GEMINI_API_KEY.');
    process.exit(1);
  }

  const adapter =
    options.provider === 'gemini'
      ? createGeminiAdapter({
          apiKey: options.apiKey,
          model,
          ...(options.urlSet ? { baseUrl: options.url } : {}),
        })
      : createOpenAiCompatibleAdapter({
          baseUrl: options.url,
          model,
          schemaMode: options.schemaMode,
        });
  const report = await runEvalSuite(createLlmClient(adapter), { timeoutMs: options.timeoutMs });
  printReport(
    model,
    options.provider === 'gemini' && !options.urlSet ? 'gemini' : options.url,
    report,
  );
} catch (error) {
  const cause = error && typeof error === 'object' ? error.cause : undefined;
  const message = error instanceof Error ? error.message : String(error);
  console.error(cause?.code ? `${message} (${cause.code})` : message);
  process.exit(1);
}
