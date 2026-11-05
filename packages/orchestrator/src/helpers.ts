import {
  EngineError,
  type Commit,
  type Engine,
  type Fact,
  type GameState,
  type RuleSystem,
  type SpawnCandidate,
  type SpawnRequest,
} from '@iron-scribe/engine-core';
import type { StructuredPrompt } from '@iron-scribe/llm';

import type { TurnIntent } from './schemas.js';
import { clarificationFor } from './steps.js';
import type { TurnClarification, TurnLogEntry, TurnResult, TurnStatus } from './types.js';

/* Pure helpers for orchestrator.ts. */

export type RngState = GameState['rng'];

export interface Draft {
  readonly input: string;
  readonly prompts: readonly StructuredPrompt[];
  readonly rawResponses: readonly string[];
  readonly commits: readonly Commit[];
  readonly facts: readonly Fact[];
  readonly rngBefore: RngState;
  readonly status: TurnStatus;
  readonly clarification: TurnClarification | null;
}

export interface Applied {
  readonly commits: readonly Commit[];
  readonly facts: readonly Fact[];
  readonly clarification: TurnClarification | null;
}

export function resultOf(logEntry: TurnLogEntry): Omit<TurnResult, 'clarification'> {
  return {
    status: logEntry.status,
    commits: logEntry.commits,
    facts: logEntry.facts,
    narration: logEntry.narration,
    narrationError: logEntry.narrationError,
    logEntry,
  };
}

export function draftOf(
  input: string,
  prompts: readonly StructuredPrompt[],
  rawResponses: readonly string[],
  commits: readonly Commit[],
  facts: readonly Fact[],
  rngBefore: RngState,
  status: TurnStatus,
  clarification: TurnClarification | null,
): Draft {
  return { input, prompts, rawResponses, commits, facts, rngBefore, status, clarification };
}

export function performed(engine: Engine, run: () => Commit): Applied {
  const started = engine.commits.length;
  const commit = run();
  return { commits: engine.commits.slice(started), facts: [...commit.facts], clarification: null };
}

export function spawnDirect(engine: Engine, system: RuleSystem, request: SpawnRequest): Applied {
  if (!system.resolveSpawn)
    throw new EngineError('no_procedure_handler', 'This system cannot spawn');
  const started = engine.commits.length;
  const resolution = system.resolveSpawn(engine.state, request);
  if (resolution.status !== 'matched') {
    return { commits: [], facts: [], clarification: clarificationFor(resolution) };
  }
  engine.commit(
    'spawn',
    resolution.entities.map((entity) => ({ type: 'entity.spawned' as const, entity })),
  );
  return {
    commits: engine.commits.slice(started),
    facts: [...resolution.facts],
    clarification: null,
  };
}

export function normal(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The player's reply names one of the offered candidates: resume the stored intent. */
export function answerOf(
  waiting: { input: string; intent: TurnIntent; candidates: readonly SpawnCandidate[] },
  reply: string,
): { input: string; intent: TurnIntent } | null {
  const said = normal(reply);
  const match = waiting.candidates.find(
    (candidate) => normal(candidate.id) === said || normal(candidate.name) === said,
  );
  if (!match) return null;
  return { input: waiting.input, intent: { ...waiting.intent, spawnQuery: match.id } };
}
