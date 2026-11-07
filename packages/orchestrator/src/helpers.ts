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

import { clarificationFor, type PendingSpawn } from './spawn-turn.js';
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

/** Lower case, hyphens and punctuation become spaces. */
export function normal(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function withoutArticles(text: string): string {
  return text.replace(/^(?:(?:the|a|an)\s+)+/, '');
}

/**
 * The reply names one offered candidate, or its tokens fit exactly one of them.
 * Zero matches and several matches are left unanswered.
 */
export function matchCandidate(
  candidates: readonly SpawnCandidate[],
  reply: string,
): SpawnCandidate | null {
  const said = withoutArticles(normal(reply));
  if (said === '') return null;
  const exact = candidates.filter(
    (candidate) =>
      normal(candidate.id) === said || withoutArticles(normal(candidate.name)) === said,
  );
  if (exact.length === 1) return exact[0] ?? null;
  if (exact.length > 1) return null;
  const tokens = said.split(' ').filter((token) => token.length > 0);
  const hits = candidates.filter((candidate) => {
    const bag = new Set(
      [
        ...withoutArticles(normal(candidate.name)).split(' '),
        ...normal(candidate.id).split(' '),
      ].filter((token) => token.length > 0),
    );
    return tokens.every((token) => bag.has(token));
  });
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

/** The player's reply names the slot we asked about. The rest of the turn stays stored. */
export function answerOf(waiting: PendingSpawn, reply: string): PendingSpawn | null {
  const match = matchCandidate(waiting.candidates, reply);
  const [current, ...rest] = waiting.open;
  if (!match || !current) return null;
  return { ...waiting, open: [{ ...current, query: match.id }, ...rest] };
}
