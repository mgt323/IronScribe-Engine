import type {
  ActionRequest,
  Commit,
  Engine,
  EntityId,
  Fact,
  GameState,
  Procedure,
  SpawnCandidate,
  SpawnRequest,
} from '@iron-scribe/engine-core';
import type { StructuredPrompt } from '@iron-scribe/llm';

type RngState = GameState['rng'];

export type TurnStatus = 'resolved' | 'none' | 'clarify';

export interface TurnClarification {
  readonly reason: 'unknown_spawn' | 'ambiguous_spawn' | 'combat_active';
  readonly query: string;
  readonly candidates: readonly SpawnCandidate[];
  readonly message: string;
}

export interface TurnLogEntry {
  readonly turnIndex: number;
  readonly input: string;
  readonly status: TurnStatus;
  readonly prompts: readonly StructuredPrompt[];
  readonly rawResponses: readonly string[];
  readonly commits: readonly Commit[];
  readonly facts: readonly Fact[];
  readonly narration: string | null;
  readonly narrationError: string | null;
  readonly rngBefore: RngState;
  readonly rngAfter: RngState;
}

export interface TurnResult {
  readonly status: TurnStatus;
  readonly commits: readonly Commit[];
  readonly facts: readonly Fact[];
  readonly narration: string | null;
  readonly narrationError: string | null;
  readonly clarification: TurnClarification | null;
  readonly logEntry: TurnLogEntry;
}

export interface RunTurnOptions {
  readonly onNarrationChunk?: (chunk: string) => void;
  readonly signal?: AbortSignal;
}

export interface Orchestrator {
  readonly engine: Engine;
  readonly actorId: EntityId;
  readonly logs: readonly TurnLogEntry[];
  readonly canUndoTurn: boolean;
  readonly canRedoTurn: boolean;
  runTurn(input: string, options?: RunTurnOptions): Promise<TurnResult>;
  runAction(request: ActionRequest, options?: RunTurnOptions): Promise<TurnResult>;
  runSpawn(request: SpawnRequest, options?: RunTurnOptions): Promise<TurnResult>;
  runProcedureTurn(
    label: string,
    procedure: Procedure,
    options?: RunTurnOptions,
  ): Promise<TurnResult>;
  undoTurn(): void;
  redoTurn(): void;
}
