#!/usr/bin/env node
/**
 * Solo theater-of-the-mind session.
 *
 *   pnpm --filter @iron-scribe/cli build
 *   pnpm play -- --url http://127.0.0.1:5001
 *
 * The API key is read from --api-key or GEMINI_API_KEY / GOOGLE_API_KEY /
 * OPENAI_API_KEY. It is passed only to the adapter and never printed.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import {
  createGeminiAdapter,
  createLlmClient,
  createOpenAiCompatibleAdapter,
  detectOpenAiModel,
} from '@iron-scribe/llm';
import { loadCatalog } from '@iron-scribe/system-dnd5e-2024';

import {
  createCliSession,
  defaultAdventurerSheet,
  formatCharacterSheet,
  handleCliLine,
  suggestCharacterIdentity,
} from '../dist/index.js';

function printHelp() {
  console.log(`Usage:
  pnpm play -- [options]

Options:
  --url <url>            OpenAI-compatible server (default http://127.0.0.1:5001)
  --provider <name>      openai (default) or gemini
  --model <name>         model id (openai: detected from /v1/models when omitted)
  --schema-mode <mode>   json_schema (default) or json_object
  --api-key <key>        or GEMINI_API_KEY / GOOGLE_API_KEY / OPENAI_API_KEY
  --seed <value>         RNG seed (default: play)
  --help, -h
`);
}

function required(argv, index) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error('Missing value for the previous flag');
  return value;
}

function envKey() {
  return (
    process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY'] ?? process.env['OPENAI_API_KEY']
  );
}

function parseArgs(argv) {
  const options = {
    url: 'http://127.0.0.1:5001',
    urlSet: false,
    provider: 'openai',
    model: undefined,
    schemaMode: 'json_schema',
    apiKey: envKey(),
    seed: 'play',
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--url') {
      options.url = required(argv, (index += 1));
      options.urlSet = true;
    } else if (arg === '--provider') options.provider = required(argv, (index += 1));
    else if (arg === '--model') options.model = required(argv, (index += 1));
    else if (arg === '--schema-mode') options.schemaMode = required(argv, (index += 1));
    else if (arg === '--api-key') options.apiKey = required(argv, (index += 1));
    else if (arg === '--seed') options.seed = required(argv, (index += 1));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function seedOf(raw) {
  return /^-?\d+$/.test(raw) ? Number(raw) : raw;
}

async function adapterFor(options) {
  if (options.provider === 'gemini') {
    if (!options.apiKey) {
      console.error('Gemini needs an API key (GEMINI_API_KEY, GOOGLE_API_KEY, or --api-key).');
      process.exit(1);
    }
    return createGeminiAdapter({
      apiKey: options.apiKey,
      ...(options.model ? { model: options.model } : {}),
      ...(options.urlSet ? { baseUrl: options.url } : {}),
    });
  }
  if (options.provider !== 'openai') throw new Error(`Unknown provider: ${options.provider}`);
  if (options.schemaMode !== 'json_schema' && options.schemaMode !== 'json_object') {
    throw new Error(`Unknown schema mode: ${options.schemaMode}`);
  }
  const model = options.model ?? (await detectOpenAiModel(options.url));
  return createOpenAiCompatibleAdapter({
    baseUrl: options.url,
    model,
    schemaMode: options.schemaMode,
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
  });
}

async function confirmHero(llm, catalog) {
  const sheet = defaultAdventurerSheet();
  const preview = {
    id: 'hero',
    name: 'Adventurer',
    templateRef: null,
    present: true,
    hp: { current: sheet.hpMax, max: sheet.hpMax },
    system: { character: sheet },
  };
  stdout.write(formatCharacterSheet(preview, catalog, null));
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const description = await rl.question(
      'Describe your rogue, or press Enter to keep the default name: ',
    );
    if (!description.trim()) return { sheet, name: 'Adventurer', backstory: undefined };
    const identity = await suggestCharacterIdentity(llm, description.trim());
    stdout.write(`Name: ${identity.name}\n${identity.backstory}\n`);
    const answer = await rl.question('Use this name and backstory? [Y/n] ');
    if (answer.trim() !== '' && !/^y(es)?$/i.test(answer.trim())) {
      return { sheet, name: 'Adventurer', backstory: undefined };
    }
    return { sheet, name: identity.name, backstory: identity.backstory };
  } finally {
    rl.close();
  }
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const catalog = loadCatalog();
const llm = createLlmClient(await adapterFor(options));
const hero = await confirmHero(llm, catalog);
const session = createCliSession({
  seed: seedOf(options.seed),
  character: hero.sheet,
  characterName: hero.name,
  ...(hero.backstory ? { backstory: hero.backstory } : {}),
  llm,
  catalog,
});

const rl = createInterface({ input: stdin, output: stdout });
try {
  stdout.write('Type a sentence, or /help.\n');
  for (;;) {
    const line = await rl.question('> ');
    const quit = await handleCliLine(session, line, { write: (text) => stdout.write(text) });
    if (quit) break;
  }
} finally {
  rl.close();
}
