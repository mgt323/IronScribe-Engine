# @iron-scribe/orchestrator

## Purpose

Turn loop for one player actor. The model picks spawn, a check, or a menu
alias, then narrates facts the engine already resolved. Depends on
`@iron-scribe/engine-core` and `@iron-scribe/llm`. Must not import a concrete
system package. It never rolls dice, never chooses a DC, and never writes
state except by calling the engine.

## Public interface

- `createOrchestrator({ engine, system, llm, actorId })`
- `runTurn(input)` — intent, then spawn, check, and a decision from the menu
  rebuilt after those commits. Narration is last
- `runSpawn`, `runAction`, `runProcedureTurn` share that undo history
- No decision call when no menu action is usable (every action needs a target
  and none is present): the turn ends as `none`
- `undoTurn` / `redoTurn` each call `engine.restore` once for the whole turn.
  Clarify, none, and a failed object call do not push history. A failed object
  call restores the pre-turn snapshot and does not leave those commits on the
  engine redo stack
- Narration is recorded after the history entry. A stream that throws keeps
  the partial text and sets `narrationError`. The mechanics stay committed
- `buildIntentSchema` / `buildDecisionSchema` are flat. An empty alias list is
  `z.null()`, never `z.enum([])`. Intent has no aliases and no DC
- Logs hold prompts, raw replies, facts, narration, and the RNG. No API key

## Test rules

- Use `@iron-scribe/engine-core/testing` and `createScriptedLlmClient`.
- An invalid alias aborts with no state change after one repair retry.
- Keep files under about 300 lines.
