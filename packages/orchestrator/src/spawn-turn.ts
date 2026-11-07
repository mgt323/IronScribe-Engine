import {
  EngineError,
  type Engine,
  type Entity,
  type Fact,
  type GameState,
  type RuleSystem,
  type SpawnCandidate,
  type SpawnResolution,
} from '@iron-scribe/engine-core';

import { spawnSlotsOf, type TurnIntent } from './schemas.js';
import type { TurnClarification } from './types.js';

type Unmatched = Exclude<SpawnResolution, { status: 'matched' }>;

/** A spawn the model asked for, not yet committed. */
export interface OpenSlot {
  readonly index: 1 | 2 | 3;
  readonly query: string;
  readonly count: number;
  readonly attitude: string;
  readonly proximity: 'engaged' | 'nearby';
}

export interface MatchedGroup {
  readonly entities: readonly Entity[];
  readonly facts: readonly Fact[];
}

/**
 * A turn paused on one ambiguous slot. Earlier slots are already matched and held
 * here; nothing is committed until every remaining slot matches.
 */
export interface PendingSpawn {
  readonly input: string;
  readonly intent: TurnIntent;
  readonly matched: readonly MatchedGroup[];
  readonly open: readonly OpenSlot[];
  readonly candidates: readonly SpawnCandidate[];
}

export interface SpawnProgress {
  readonly intent: TurnIntent;
  readonly matched: readonly MatchedGroup[];
  readonly open: readonly OpenSlot[];
  readonly candidates: readonly SpawnCandidate[];
}

export function clarificationFor(resolution: Unmatched): TurnClarification {
  if (resolution.status === 'combat_active') {
    return {
      reason: 'combat_active',
      query: resolution.query,
      candidates: [],
      message: 'Cannot spawn new creatures during active combat.',
    };
  }
  if (resolution.status === 'not_found') {
    return {
      reason: 'unknown_spawn',
      query: resolution.query,
      candidates: [],
      message: `No catalog match for "${resolution.query}".`,
    };
  }
  const names = resolution.candidates.map((candidate) => candidate.name).join(', ');
  return {
    reason: 'ambiguous_spawn',
    query: resolution.query,
    candidates: resolution.candidates,
    message: `"${resolution.query}" matches ${names}. Which one?`,
  };
}

/** Slots the model filled, in order. A gap or a total above 10 is rejected. */
export function filledSlots(intent: TurnIntent): OpenSlot[] {
  const slots = spawnSlotsOf(intent);
  const filled: OpenSlot[] = [];
  for (const [offset, slot] of slots.entries()) {
    if (slot.query === null && slot.count === null && slot.attitude === null) continue;
    if (slot.query === null || slot.count === null || slot.attitude === null) {
      throw new EngineError('invalid_amount', 'Spawn needs a query, a count, and an attitude');
    }
    const query = slot.query.trim();
    if (query === '') {
      throw new EngineError('invalid_amount', 'Spawn needs a query, a count, and an attitude');
    }
    filled.push({
      index: (offset + 1) as 1 | 2 | 3,
      query,
      count: slot.count,
      attitude: slot.attitude,
      proximity: slot.proximity === 'nearby' ? 'nearby' : 'engaged',
    });
  }
  filled.forEach((slot, index) => {
    if (slot.index !== index + 1) {
      throw new EngineError('invalid_amount', 'Spawn slots must be filled in order');
    }
  });
  const total = filled.reduce((sum, slot) => sum + slot.count, 0);
  if (total > 10) {
    throw new EngineError('invalid_amount', 'A turn can spawn at most 10 creatures');
  }
  return filled;
}

function overlay(state: GameState, entities: readonly Entity[]): GameState {
  if (entities.length === 0) return state;
  const extra: Record<string, Entity> = {};
  for (const entity of entities) extra[entity.id] = entity;
  return {
    ...state,
    entities: { ...state.entities, ...extra },
    spawnOrder: [...state.spawnOrder, ...entities.map((entity) => entity.id)],
  };
}

function creaturesOf(matched: readonly MatchedGroup[]): Entity[] {
  return matched.flatMap((group) => [...group.entities]);
}

/** Commits the creatures, then lets engaged reinforcements join an active encounter. */
export function commitSpawn(
  ctx: { engine: Engine; system: RuleSystem },
  entities: readonly Entity[],
  facts: readonly Fact[],
): Fact[] {
  if (entities.length === 0) return [...facts];
  ctx.engine.commit(
    'spawn',
    entities.map((entity) => ({ type: 'entity.spawned' as const, entity })),
  );
  const procedure =
    ctx.system.afterSpawn?.(
      ctx.engine.state,
      entities.map((entity) => entity.id),
    ) ?? null;
  const joined = procedure ? ctx.engine.runProcedure('reinforcements', procedure).facts : [];
  return [...facts, ...joined];
}

/**
 * Resolves every spawn slot, then commits them as one spawn. An ambiguous slot
 * returns progress and commits nothing, so the answer can resume the same turn.
 */
export function spawnFrom(
  ctx: { engine: Engine; system: RuleSystem },
  intent: TurnIntent,
  resume: PendingSpawn | null = null,
): { facts: Fact[]; clarification: TurnClarification | null; progress: SpawnProgress | null } {
  const stored = resume?.intent ?? intent;
  const matched: MatchedGroup[] = [...(resume?.matched ?? [])];
  const open: OpenSlot[] = resume ? [...resume.open] : intent.spawnIsNew ? filledSlots(intent) : [];
  if (open.length === 0 && matched.length === 0) {
    return { facts: [], clarification: null, progress: null };
  }
  if (!ctx.system.resolveSpawn) {
    throw new EngineError('no_procedure_handler', 'This system cannot spawn');
  }
  const turnTotal = creaturesOf(matched).length + open.reduce((sum, slot) => sum + slot.count, 0);
  if (turnTotal > 10) {
    throw new EngineError('invalid_amount', 'A turn can spawn at most 10 creatures');
  }

  while (open.length > 0) {
    const slot = open[0];
    if (!slot) break;
    if (ctx.engine.state.entities[slot.query] !== undefined) {
      open.shift();
      continue;
    }
    const resolution = ctx.system.resolveSpawn(overlay(ctx.engine.state, creaturesOf(matched)), {
      query: slot.query,
      count: slot.count,
      attitude: slot.attitude,
      proximity: slot.proximity,
      turnTotal,
    });
    if (resolution.status === 'matched') {
      matched.push({ entities: resolution.entities, facts: resolution.facts });
      open.shift();
      continue;
    }
    const clarification = clarificationFor(resolution);
    return {
      facts: [],
      clarification,
      progress:
        resolution.status === 'ambiguous'
          ? { intent: stored, matched, open, candidates: resolution.candidates }
          : null,
    };
  }

  const entities = creaturesOf(matched);
  if (entities.length === 0) return { facts: [], clarification: null, progress: null };
  return {
    facts: commitSpawn(
      ctx,
      entities,
      matched.flatMap((group) => [...group.facts]),
    ),
    clarification: null,
    progress: null,
  };
}
