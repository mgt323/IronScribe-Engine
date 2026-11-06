import {
  EngineError,
  type Engine,
  type EntityId,
  type Fact,
  type Procedure,
  type RuleSystem,
} from '@iron-scribe/engine-core';

/** A hard stop on the engine-run combat loop. Hitting it rolls the whole turn back. */
export const MAX_COMBAT_STEPS = 32;

/** NPC attacks are told apart from the player's, with who attacked and with what. */
function npcFacts(name: string, label: string, facts: readonly Fact[]): Fact[] {
  return facts.map((fact) =>
    fact.key === 'attack' ? { key: 'npc_attack', text: `${name} (${label}): ${fact.text}` } : fact,
  );
}

/**
 * Runs every non-player step of the encounter, in initiative order, until control is
 * the player's, combat is suspended, or it ends. `action` steps are always followed
 * by the turn's end. Throws past MAX_COMBAT_STEPS (the caller restores its snapshot).
 */
export function advanceCombatUntilPlayer(
  engine: Engine,
  system: RuleSystem,
  actorId: EntityId,
): Fact[] {
  const facts: Fact[] = [];
  if (!system.nextCombatStep) return facts;
  for (let steps = 0; steps < MAX_COMBAT_STEPS; steps += 1) {
    const step = system.nextCombatStep(engine.state, actorId);
    if (step === null) return facts;
    if (step.kind === 'procedure') {
      facts.push(...engine.runProcedure('combat', step.procedure).facts);
      continue;
    }
    const name = engine.state.entities[step.request.actorId]?.name ?? step.request.actorId;
    const commit = engine.perform(step.request);
    facts.push(...npcFacts(name, commit.label, commit.facts));
    const end = system.turnEnd?.(engine.state, step.request.actorId) ?? null;
    if (end) engine.runProcedure('combat', end);
  }
  throw new EngineError(
    'combat_loop_exceeded',
    `Combat ran past ${String(MAX_COMBAT_STEPS)} steps`,
  );
}

/**
 * A turn the hero spends dying (D&D: a Death Saving Throw). No model call picks anything.
 * NPCs ahead of the hero act first, then the procedure rolls at the start of the hero's turn.
 * Still at 0 HP and alive: the turn ends and NPCs act until the hero's next turn. Back on
 * their feet (a natural 20, or a solo rest after stabilizing) or dead: nothing else runs, so
 * a revived hero keeps the turn and takes a real action next.
 */
export function runDyingTurn(
  engine: Engine,
  system: RuleSystem,
  actorId: EntityId,
  procedure: Procedure,
): Fact[] {
  const facts = advanceCombatUntilPlayer(engine, system, actorId);
  facts.push(...engine.runProcedure('death save', procedure).facts);
  const hero = engine.state.entities[actorId];
  const stillDown =
    (hero?.hp.current ?? 0) <= 0 && system.isActorDefeated?.(engine.state, actorId) !== true;
  if (!stillDown) return facts;
  const end = system.turnEnd?.(engine.state, actorId) ?? null;
  if (end) engine.runProcedure('combat', end);
  facts.push(...advanceCombatUntilPlayer(engine, system, actorId));
  return facts;
}

/** Rolls the system's opening procedure (initiative) before the first targeted action. */
export function openEncounter(engine: Engine, system: RuleSystem, actorId: EntityId): Fact[] {
  const procedure = system.encounterStart?.(engine.state, actorId) ?? null;
  if (procedure === null) return [];
  return [...engine.runProcedure('encounter', procedure).facts];
}

/**
 * One player turn inside combat: open the encounter, let faster NPCs act, run the
 * player's action (skipped when the player went down first), end their turn, then
 * let the NPCs after them act until it is the player's turn again.
 */
export function runPlayerTurn(
  engine: Engine,
  system: RuleSystem,
  actorId: EntityId,
  targeted: boolean,
  act: () => Fact[],
): Fact[] {
  const started = engine.commits.length;
  const facts = targeted ? openEncounter(engine, system, actorId) : [];
  facts.push(...advanceCombatUntilPlayer(engine, system, actorId));
  const progressed = engine.commits.length > started;
  if (progressed && engine.menu(actorId).actions.length === 0) return facts;
  facts.push(...act());
  const end = system.turnEnd?.(engine.state, actorId) ?? null;
  if (end) engine.runProcedure('combat', end);
  facts.push(...advanceCombatUntilPlayer(engine, system, actorId));
  return facts;
}
