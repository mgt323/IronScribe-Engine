# @iron-scribe/orchestrator

## Purpose

Turn loop: intent, NPC turn, memory. Calls `RuleSystem.availableActions`,
asks the LLM for aliases or narration, then asks the engine to execute.
Depends on `@iron-scribe/engine-core` and `@iron-scribe/llm`. Must not import
a concrete system package.

## Public interface

TBD in Stage 6 (CLI play) and Stage 9 (memory).

## Test rules

- Use a fake `RuleSystem` and a fake LLM client in unit tests.
- Assert that invalid aliases abort with no state change after one repair retry.
- Keep files under about 300 lines.
