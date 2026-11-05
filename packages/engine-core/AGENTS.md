# @iron-scribe/engine-core

## Purpose

Events, game state, undo, and the `RuleSystem` interface. The only writer of
game state. Depends on `@iron-scribe/dice`. Must not import LLM, orchestrator,
or concrete system packages.

## Public interface

- `createInitialState({ seed })`, `GameState` (`rng`, `entities`, `spawnOrder`,
  global `system` bag), `Entity` (hp, per-entity `system` bag)
- `createEngine({ system, initialState })` -> `Engine`: `state`, `commits`,
  `canUndo`, `canRedo`, `menu(actorId)`, `perform(ActionRequest)`,
  `runProcedure(label, Procedure)`, `commit(label, events)` (request and
  procedure `null`), `undo()`, `redo()`
- `Commit` carries `request` (player action) or `procedure` (engine-triggered
  roll), never both
- `applyEvent`, `applyEvents` (pure), `replay(initial, commits, system)`,
  `validateRequest(menu, request)` -> `ResolvedRequest`
- `RuleSystem`: `availableActions`, `resolve(state, ResolvedRequest, rng)`,
  optional `runProcedure(state, Procedure, rng)`, optional `applySystemEvent`
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
- Fake rule system for tests: `src/testing/fake-system.ts`.

## Test rules

- Cover event application, state transitions, and undo/redo.
- Tests must not depend on a concrete ruleset until a fake `RuleSystem` is used.
- Keep files under about 300 lines.
