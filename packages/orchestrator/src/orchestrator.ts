import {
  EngineError,
  type Engine,
  type EngineSnapshot,
  type EntityId,
  type RuleSystem,
  type SpawnCandidate,
} from '@iron-scribe/engine-core';
import type { LlmClient, StructuredPrompt } from '@iron-scribe/llm';

import {
  answerOf,
  draftOf,
  performed,
  resultOf,
  spawnDirect,
  type Applied,
  type Draft,
} from './helpers.js';
import { narrateFacts } from './narrate.js';
import { buildNarrationPrompt } from './prompts.js';
import { advanceCombatUntilPlayer, runDyingTurn, runPlayerTurn } from './combat.js';
import { actionFrom, checkFrom, readIntent, spawnFrom } from './steps.js';
import type { TurnIntent } from './schemas.js';
import type {
  Orchestrator,
  RunTurnOptions,
  TurnLogEntry,
  TurnResult,
  TurnStatus,
} from './types.js';

interface HistoryEntry {
  readonly snapshotBefore: EngineSnapshot;
  readonly snapshotAfter: EngineSnapshot;
  readonly logEntry: TurnLogEntry;
}

export function createOrchestrator(options: {
  engine: Engine;
  system: RuleSystem;
  llm: LlmClient;
  actorId: EntityId;
}): Orchestrator {
  const { engine, system, llm, actorId } = options;
  const ctx = { engine, system, llm, actorId, memory: { lastTargetId: null as string | null } };
  let logs: TurnLogEntry[] = [];
  let undoStack: HistoryEntry[] = [];
  let redoStack: HistoryEntry[] = [];
  /** An ambiguous spawn waits here so the answer keeps count, attitude, and the rest. */
  let pending: { input: string; intent: TurnIntent; candidates: readonly SpawnCandidate[] } | null =
    null;

  const record = (
    draft: Draft,
    narration: string | null,
    narrationError: string | null,
  ): TurnResult => {
    const logEntry: TurnLogEntry = {
      turnIndex: logs.length,
      input: draft.input,
      status: draft.status,
      prompts: draft.prompts,
      rawResponses: draft.rawResponses,
      commits: draft.commits,
      facts: draft.facts,
      narration,
      narrationError,
      rngBefore: draft.rngBefore,
      rngAfter: engine.state.rng,
    };
    logs = [...logs, logEntry];
    return {
      status: draft.status,
      commits: draft.commits,
      facts: draft.facts,
      narration,
      narrationError,
      clarification: draft.clarification,
      logEntry,
    };
  };

  /** Mechanics are already committed. Narration failing leaves them committed. */
  const finishResolved = async (
    draft: Draft,
    snapBefore: EngineSnapshot,
    run: RunTurnOptions | undefined,
  ): Promise<TurnResult> => {
    const base: TurnLogEntry = {
      turnIndex: logs.length,
      input: draft.input,
      status: 'resolved',
      prompts: draft.prompts,
      rawResponses: draft.rawResponses,
      commits: draft.commits,
      facts: draft.facts,
      narration: null,
      narrationError: null,
      rngBefore: draft.rngBefore,
      rngAfter: engine.state.rng,
    };
    const entry: HistoryEntry = {
      snapshotBefore: snapBefore,
      snapshotAfter: engine.snapshot(),
      logEntry: base,
    };
    undoStack = [...undoStack, entry];
    redoStack = [];
    logs = [...logs, base];
    if (draft.facts.length === 0) {
      return { ...resultOf(base), clarification: null };
    }
    const prompt = buildNarrationPrompt(draft.input, draft.facts, engine.state, actorId);
    const told = await narrateFacts(llm, prompt, run);
    const logEntry: TurnLogEntry = {
      ...base,
      prompts: [...base.prompts, prompt],
      rawResponses: told.narration ? [...base.rawResponses, told.narration] : base.rawResponses,
      narration: told.narration,
      narrationError: told.narrationError,
    };
    undoStack = [...undoStack.slice(0, -1), { ...entry, logEntry }];
    logs = [...logs.slice(0, -1), logEntry];
    return { ...resultOf(logEntry), clarification: null };
  };

  async function runMechanics(
    rawInput: string,
    run: RunTurnOptions | undefined,
  ): Promise<TurnResult> {
    let input = rawInput;
    const snapBefore = engine.snapshot();
    const rngBefore = engine.state.rng;
    const started = engine.commits.length;
    const prompts: StructuredPrompt[] = [];
    const rawResponses: string[] = [];
    try {
      if (system.isActorDefeated?.(engine.state, actorId)) {
        // Terminal: the hero is dead. No model call, no state change.
        pending = null;
        const none = draftOf(input, [], [], [], [], rngBefore, 'none', null);
        return record(none, null, null);
      }
      const dying = system.playerTurnProcedure?.(engine.state, actorId) ?? null;
      if (dying) {
        // The player's text is flavor for the narration, never an action.
        pending = null;
        const facts = runDyingTurn(engine, system, actorId, dying);
        const commits = engine.commits.slice(started);
        const draft = draftOf(input, [], [], commits, facts, rngBefore, 'resolved', null);
        return await finishResolved(draft, snapBefore, run);
      }
      const answered = pending ? answerOf(pending, input) : null;
      pending = null;
      const intent =
        answered?.intent ?? (await readIntent(ctx, input, run?.signal, prompts, rawResponses));
      if (answered) input = answered.input;
      const spawned = spawnFrom(ctx, intent);
      if (spawned.clarification) {
        engine.restore(snapBefore);
        if (spawned.clarification.reason === 'ambiguous_spawn') {
          pending = { input, intent, candidates: spawned.clarification.candidates };
        }
        return record(
          draftOf(
            input,
            prompts,
            rawResponses,
            [],
            [],
            rngBefore,
            'clarify',
            spawned.clarification,
          ),
          null,
          null,
        );
      }
      const facts = [
        ...spawned.facts,
        ...checkFrom(ctx, intent),
        ...(await actionFrom(ctx, intent, input, prompts, rawResponses, run?.signal)),
      ];
      const commits = engine.commits.slice(started);
      const status: TurnStatus = commits.length === 0 ? 'none' : 'resolved';
      const draft = draftOf(input, prompts, rawResponses, commits, facts, rngBefore, status, null);
      if (commits.length === 0) return record(draft, null, null);
      return await finishResolved(draft, snapBefore, run);
    } catch (error) {
      engine.restore(snapBefore);
      throw error;
    }
  }

  async function runDirect(
    input: string,
    apply: () => Applied,
    run: RunTurnOptions | undefined,
  ): Promise<TurnResult> {
    const snapBefore = engine.snapshot();
    const rngBefore = engine.state.rng;
    try {
      const applied = apply();
      if (applied.clarification) {
        return record(
          draftOf(input, [], [], [], [], rngBefore, 'clarify', applied.clarification),
          null,
          null,
        );
      }
      if (applied.commits.length === 0) {
        return record(
          draftOf(input, [], [], [], applied.facts, rngBefore, 'none', null),
          null,
          null,
        );
      }
      return await finishResolved(
        draftOf(input, [], [], applied.commits, applied.facts, rngBefore, 'resolved', null),
        snapBefore,
        run,
      );
    } catch (error) {
      engine.restore(snapBefore);
      throw error;
    }
  }

  return {
    engine,
    actorId,
    get logs() {
      return logs;
    },
    get canUndoTurn() {
      return undoStack.length > 0;
    },
    get canRedoTurn() {
      return redoStack.length > 0;
    },
    runTurn: (input, run) => runMechanics(input, run),
    runAction: (request, run) =>
      runDirect(
        [
          'act',
          request.actionAlias,
          ...(request.targetAliases?.length ? request.targetAliases : [request.targetAlias ?? '']),
        ]
          .join(' ')
          .trim(),
        () => {
          const started = engine.commits.length;
          const dying = system.playerTurnProcedure?.(engine.state, actorId) ?? null;
          const facts = dying
            ? runDyingTurn(engine, system, actorId, dying)
            : runPlayerTurn(engine, system, actorId, request.targetAlias !== null, () => [
                ...engine.perform(request).facts,
              ]);
          return { commits: engine.commits.slice(started), facts, clarification: null };
        },
        run,
      ),
    runSpawn: (request, run) =>
      runDirect(`spawn ${request.query}`, () => spawnDirect(engine, system, request), run),
    runProcedureTurn: (label, procedure, run) =>
      runDirect(
        label,
        () =>
          performed(engine, () => {
            const commit = engine.runProcedure(label, procedure);
            const rest = advanceCombatUntilPlayer(engine, system, actorId);
            return { ...commit, facts: [...commit.facts, ...rest] };
          }),
        run,
      ),
    undoTurn() {
      const entry = undoStack.at(-1);
      if (!entry) throw new EngineError('nothing_to_undo', 'Nothing to undo');
      engine.restore(entry.snapshotBefore);
      undoStack = undoStack.slice(0, -1);
      redoStack = [...redoStack, entry];
    },
    redoTurn() {
      const entry = redoStack.at(-1);
      if (!entry) throw new EngineError('nothing_to_redo', 'Nothing to redo');
      engine.restore(entry.snapshotAfter);
      redoStack = redoStack.slice(0, -1);
      undoStack = [...undoStack, entry];
    },
  };
}
