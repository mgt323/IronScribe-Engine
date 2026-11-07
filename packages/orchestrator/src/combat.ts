import {
  EngineError,
  type ActionMenu,
  type ActionRequest,
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
    if (end) facts.push(...engine.runProcedure('combat', end).facts);
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
  if (end) facts.push(...engine.runProcedure('combat', end).facts);
  facts.push(...advanceCombatUntilPlayer(engine, system, actorId));
  return facts;
}

/**
 * The request was written against the menu the player saw. NPCs ahead of the actor may act
 * first and change who is a legal target (a creature falls), which renumbers the T# aliases.
 * Re-aim the request at the same creatures and action under the current menu. A target that
 * is gone is dropped; with none left (or the action gone) the action is skipped: null.
 * Aliases the old menu did not list are left alone, so the engine still rejects them.
 */
export function rebindRequest(
  engine: Engine,
  request: ActionRequest,
  before: ActionMenu,
): ActionRequest | null {
  const now = engine.menu(request.actorId);
  const oldAction = before.actions.find((a) => a.alias === request.actionAlias);
  const action = oldAction ? now.actions.find((a) => a.actionId === oldAction.actionId) : undefined;
  if (oldAction && !action) return null;
  const wanted = request.targetAliases?.length
    ? request.targetAliases
    : request.targetAlias === null
      ? []
      : [request.targetAlias];
  const aliases: string[] = [];
  for (const alias of wanted) {
    const old = before.targets.find((t) => t.alias === alias);
    if (!old) {
      aliases.push(alias);
      continue;
    }
    const target = now.targets.find((t) => t.entityId === old.entityId);
    if (target) aliases.push(target.alias);
  }
  if (wanted.length > 0 && aliases.length === 0) return null;
  return {
    actorId: request.actorId,
    actionAlias: action?.alias ?? request.actionAlias,
    targetAlias: aliases[0] ?? null,
    ...(aliases.length > 1 ? { targetAliases: aliases } : {}),
  };
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
  if (end) facts.push(...engine.runProcedure('combat', end).facts);
  facts.push(...advanceCombatUntilPlayer(engine, system, actorId));
  return facts;
}
