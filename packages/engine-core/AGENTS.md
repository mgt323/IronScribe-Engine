# @iron-scribe/engine-core

## Purpose

Events, game state, undo, and the `RuleSystem` interface. The only writer of
game state. Depends on `@iron-scribe/dice`. Must not import LLM, orchestrator,
or concrete system packages.

## Public interface

- `createInitialState({ seed })`, `GameState` (`rng`, `entities`, `spawnOrder`,
  global `system` bag), `Entity` (hp, per-entity `system` bag, `proximity`:
  `engaged` | `nearby` | `gone`). `engaged` is an encounter participant, not
  melee reach. `nearby` is in the area but not in the fight. `gone` has left.
  `entity.presenceSet` writes `proximity`. An actor who is `gone` is
  `actor_not_present`
- `createEngine({ system, initialState })` -> `Engine`: `state`, `commits`,
  `canUndo`, `canRedo`, `menu(actorId)`, `perform(ActionRequest)`,
  `runProcedure(label, Procedure)`, `commit(label, events)` (request and
  procedure `null`), `undo()`, `redo()`, `snapshot()`, `restore(snapshot)`
- `EngineSnapshot` is `{ commits, redo }`. `restore` rebuilds state from those
  commits and puts `redo` back. It does not push the dropped commits onto redo
  (unlike `undo`)
- `Commit` carries `request` (player action) or `procedure` (engine-triggered
  roll), never both
- `applyEvent`, `applyEvents` (pure), `replay(initial, commits, system)`,
  `validateRequest(menu, request)` -> `ResolvedRequest`
- `RuleSystem`: `availableActions`, `resolve(state, ResolvedRequest, rng)`,
  optional `runProcedure(state, Procedure, rng)`, optional `applySystemEvent`,
  optional `checkCatalog`, optional `resolveCheckDc(state, CheckDcContext)`,
  optional `resolveSpawn(state, SpawnRequest)`, optional `encounterStart`,
  `nextCombatStep(state, playerId)` (a `CombatStep`: `action` or `procedure`, or
  null when it is the player's turn, suspended, or over) and `turnEnd(state,
actorId)` (the procedure that ends a turn taken by acting). Optional
  `playerTurnProcedure(state, actorId)` (the actor's whole turn when no menu applies,
  e.g. a death save) and `isActorDefeated(state, actorId)` (terminal: the hero is dead)
- Several targets (7B.2): `ActionRequest.targetAliases` (optional list; `targetAlias`, if also
  set, must be its first entry), `MenuAction.maxTargets` (default 1). `validateRequest` dedupes,
  checks every alias, rejects more than `maxTargets` (`unexpected_target`), and returns
  `ResolvedRequest` with `target` (first) and `targets` (all, in order, `[]` when none)
- `Fact` is `{ key, text }` plus optional `source` and `targetIds`, set only by the orchestrator on facts an NPC
  step produced (who acted, who it was aimed at). Rule systems never set them.
- `CheckDcContext` is typed (`actorId`, `ability`, `skill`, optional
  `procedureId`, optional `difficulty` band). No free-form model text
- `SpawnRequest.attitude` is an optional string. The concrete ruleset validates
  it. Optional `turnTotal` is the sum of every spawn count in the turn (this
  request included); absent means this request is the whole turn. Optional
  `proximity` is `engaged` (default) or `nearby`. `SpawnResolution` is `matched`,
  `not_found`, `ambiguous`, or `combat_active` (spawn refused, nothing changed).
  Optional `afterSpawn(state, entityIds)` returns a procedure that adds engaged
  reinforcements to an encounter already under way, or null
- `Procedure` is `{ kind, ...payload }` with JSON-safe values
- `EngineError` with a `code`

Notes:

- Only the engine emits `rng.advanced`; rule systems, `runProcedure`, and
  `commit()` get `forbidden_event`. Undo and replay restore the dice stream
  through it.
- `runProcedure` is missing -> `no_procedure_handler`, and nothing is committed.
- One undo step is one commit.
- Combat state (round, turn, initiative) lives in the rule system's global
  `system` bag, not in the core.
- Fake rule system for tests: `src/testing/fake-system.ts`, also exported as
  `@iron-scribe/engine-core/testing`. `rat` matches, `goblin` is ambiguous,
  anything else is not found. `resolveCheckDc` returns 12. `{ kind: 'check' }`
  records a fact and does not roll.

## Test rules

- Cover event application, state transitions, and undo/redo.
- Tests must not depend on a concrete ruleset until a fake `RuleSystem` is used.
- Keep files under about 300 lines.
