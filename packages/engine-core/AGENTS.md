# @iron-scribe/engine-core

## Purpose

Events, game state, undo, and the `RuleSystem` interface. The only writer of
game state. Depends on `@iron-scribe/dice`. Must not import LLM, orchestrator,
or concrete system packages.

## Public interface

TBD in Stage 2.

## Test rules

- Cover event application, state transitions, and undo/redo.
- Tests must not depend on a concrete ruleset until a fake `RuleSystem` is used.
- Keep files under about 300 lines.
