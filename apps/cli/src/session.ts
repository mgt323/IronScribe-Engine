import { writeFileSync } from 'node:fs';

import { createEngine, createInitialState, type SpawnRequest } from '@iron-scribe/engine-core';
import type { LlmClient } from '@iron-scribe/llm';
import { createOrchestrator, type Orchestrator, type TurnResult } from '@iron-scribe/orchestrator';
import {
  characterToEntity,
  createDnd5eSystem,
  type Catalog,
  type Character,
} from '@iron-scribe/system-dnd5e-2024';

import { formatCharacterSheet, formatSceneStatus } from './setup.js';

const ATTITUDES = ['hostile', 'neutral', 'friendly'] as const;
type Attitude = (typeof ATTITUDES)[number];

export interface LineWriter {
  write(text: string): void;
}

export interface CliSession {
  readonly seed: string | number;
  readonly actorId: 'hero';
  readonly characterName: string;
  readonly backstory: string | null;
  readonly catalog: Catalog;
  readonly orchestrator: Orchestrator;
}

export function createCliSession(options: {
  seed: string | number;
  character: Character;
  characterName: string;
  backstory?: string;
  llm: LlmClient;
  catalog: Catalog;
}): CliSession {
  const system = createDnd5eSystem({ catalog: options.catalog });
  const engine = createEngine({
    system,
    initialState: createInitialState({ seed: options.seed }),
  });
  engine.commit('character', [
    {
      type: 'entity.spawned',
      entity: characterToEntity(options.character, 'hero', { name: options.characterName }),
    },
  ]);
  return {
    seed: options.seed,
    actorId: 'hero',
    characterName: options.characterName,
    backstory: options.backstory ?? null,
    catalog: options.catalog,
    orchestrator: createOrchestrator({
      engine,
      system,
      llm: options.llm,
      actorId: 'hero',
    }),
  };
}

function isAttitude(value: string): value is Attitude {
  return (ATTITUDES as readonly string[]).includes(value);
}

function parseSpawn(rest: string): SpawnRequest {
  const tokens = rest
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '');
  if (tokens.length === 0) {
    throw new Error('Usage: /spawn <query> [count] [hostile|neutral|friendly]');
  }
  let attitude: Attitude | undefined;
  const attitudeToken = tokens[tokens.length - 1];
  if (attitudeToken && isAttitude(attitudeToken)) {
    attitude = attitudeToken;
    tokens.pop();
  }
  const countToken = tokens[tokens.length - 1];
  let count = 1;
  if (countToken && /^\d+$/.test(countToken)) {
    count = Number(tokens.pop());
  }
  const query = tokens.join(' ');
  if (!query) throw new Error('Usage: /spawn <query> [count] [hostile|neutral|friendly]');
  return attitude === undefined ? { query, count } : { query, count, attitude };
}

function parseAct(rest: string): { actionAlias: string; targetAlias: string | null } {
  const tokens = rest
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '');
  const actionAlias = tokens[0];
  const targetAlias = tokens[1] ?? null;
  if (!actionAlias || !/^A\d+$/.test(actionAlias) || tokens.length > 2) {
    throw new Error('Usage: /act A# [T#]');
  }
  if (targetAlias !== null && !/^T\d+$/.test(targetAlias)) throw new Error('Usage: /act A# [T#]');
  return { actionAlias, targetAlias };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printStatus(session: CliSession, writer: LineWriter): void {
  const { engine } = session.orchestrator;
  writer.write(
    formatSceneStatus(engine.state, session.actorId, session.catalog, engine.menu(session.actorId)),
  );
}

async function printTurn(
  session: CliSession,
  writer: LineWriter,
  run: (onChunk: (chunk: string) => void) => Promise<TurnResult>,
): Promise<void> {
  let streamed = false;
  const result = await run((chunk) => {
    streamed = true;
    writer.write(chunk);
  });
  if (streamed) writer.write('\n');
  else if (result.narration) writer.write(`${result.narration}\n`);
  for (const fact of result.facts) writer.write(`${fact.text}\n`);
  if (result.clarification) {
    writer.write(`${result.clarification.message}\n`);
    for (const candidate of result.clarification.candidates) {
      writer.write(`${candidate.id}\n`);
    }
  }
  if (result.narrationError) {
    writer.write(`[Narration interrupted: ${result.narrationError}]\n`);
  }
  if (result.status === 'none') writer.write('Nothing happens.\n');
}

const HELP = `Commands:
  /status, /scene     who is here, and the legal A# / T# menu
  /sheet              Level 1 Rogue sheet
  /act A# [T#]        take a menu action
  /spawn <query> [count] [hostile|neutral|friendly]
  /init               roll initiative
  /undo, /redo        one whole turn
  /log                prompts, facts, narration, RNG
  /save <path>        session JSON (no API key)
  /help, /quit
`;

function saveSession(session: CliSession, path: string): void {
  const { engine, logs } = session.orchestrator;
  const body = {
    seed: session.seed,
    actorId: session.actorId,
    characterName: session.characterName,
    backstory: session.backstory,
    state: engine.state,
    commits: engine.commits,
    logs,
  };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
}

function printLog(session: CliSession, writer: LineWriter): void {
  const { logs } = session.orchestrator;
  if (logs.length === 0) {
    writer.write('No turns yet.\n');
    return;
  }
  for (const entry of logs) {
    writer.write(`#${String(entry.turnIndex)} ${entry.status} ${entry.input}\n`);
    for (const fact of entry.facts) writer.write(`  ${fact.text}\n`);
    if (entry.narration) writer.write(`  ${entry.narration}\n`);
    if (entry.narrationError) writer.write(`  [Narration interrupted: ${entry.narrationError}]\n`);
    writer.write(`  rng ${String(entry.rngBefore.seed)} -> ${String(entry.rngAfter.seed)}\n`);
  }
}

/** Slash commands that change state go through the orchestrator. Returns true to quit. */
export async function handleCliLine(
  session: CliSession,
  line: string,
  writer: LineWriter,
): Promise<boolean> {
  const trimmed = line.trim();
  if (trimmed === '') return false;
  try {
    if (!trimmed.startsWith('/')) {
      await printTurn(session, writer, (onNarrationChunk) =>
        session.orchestrator.runTurn(trimmed, { onNarrationChunk }),
      );
      return false;
    }
    const [command, ...restParts] = trimmed.split(/\s+/);
    const rest = restParts.join(' ');
    const hero = session.orchestrator.engine.state.entities[session.actorId];
    switch (command) {
      case '/status':
      case '/scene':
        printStatus(session, writer);
        return false;
      case '/sheet':
        if (!hero) throw new Error('No character');
        writer.write(formatCharacterSheet(hero, session.catalog, session.backstory));
        return false;
      case '/act': {
        const request = parseAct(rest);
        await printTurn(session, writer, (onNarrationChunk) =>
          session.orchestrator.runAction(
            { actorId: session.actorId, ...request },
            { onNarrationChunk },
          ),
        );
        return false;
      }
      case '/spawn':
        await printTurn(session, writer, (onNarrationChunk) =>
          session.orchestrator.runSpawn(parseSpawn(rest), { onNarrationChunk }),
        );
        return false;
      case '/init':
        await printTurn(session, writer, (onNarrationChunk) =>
          session.orchestrator.runProcedureTurn(
            'initiative',
            { kind: 'initiative', surprised: [] },
            { onNarrationChunk },
          ),
        );
        return false;
      case '/undo':
        session.orchestrator.undoTurn();
        writer.write('Undone.\n');
        printStatus(session, writer);
        return false;
      case '/redo':
        session.orchestrator.redoTurn();
        writer.write('Redone.\n');
        printStatus(session, writer);
        return false;
      case '/log':
        printLog(session, writer);
        return false;
      case '/save':
        if (!rest) throw new Error('Usage: /save <path>');
        saveSession(session, rest);
        writer.write(`Saved ${rest}\n`);
        return false;
      case '/help':
        writer.write(HELP);
        return false;
      case '/quit':
        return true;
      default:
        writer.write('Unknown command. Type /help.\n');
        return false;
    }
  } catch (error) {
    writer.write(`${messageOf(error)}\n`);
    return false;
  }
}
