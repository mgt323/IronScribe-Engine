# Iron Scribe — agent notes

## Product rules

- The **rules engine is the only writer of game state**.
- The language model is a peripheral: it selects an action alias from a menu
  the engine built, or it writes narration from facts the engine resolved.
- The model never rolls dice, never sets hit points, and never writes the
  database.
- Primary ruleset: D&D 5e 2024 / SRD 5.2.1 (CC-BY-4.0). No non-SRD Wizards
  content. Daggerheart is a later second system in a separate data package.
- Version 1: theater-of-the-mind, single player. UI language: **English**.

## Architecture

```
apps/          → orchestrator, engine-core, llm, system packages
orchestrator/  → engine-core (RuleSystem), llm
system-*/      → engine-core, dice
engine-core/   → dice
llm/           → (no game packages)
dice/          → (leaf)
```

Dependencies point **inward**. A rules package must not import the LLM client.
The orchestrator knows `RuleSystem`, not a concrete D&D package. One
`RuleSystem` interface from the start; no plugin framework until Daggerheart.

## Working style

- **One stage per chat.** Stop when that stage's tests pass. Do not scaffold
  the whole product in one session.
- Prefer files under about **300 lines**. Live eval suites and their cases
  (`apps/cli/eval/`, including `legacy/`) are exempt: they may run longer.
- Write **failing tests from SRD examples**, then implement until they pass.
- Each package has a short `AGENTS.md` (purpose, public interface, test rules).
- Keep `docs/status.md` current.
- Copied upstream code (`packages/system-dnd5e-2024/src/catalog/upstream/`) and
  raw SRD data (`.../data/srd-5.2.1/raw/`) are written only by `srd:import`. They
  are exempt from style rules (Prettier, the 300-line limit, lint style rules)
  but not from correctness checks (typecheck, strict schema validation in tests).
- Zod schemas (when added) are validation rules, JSON Schema for the model,
  and UI types. Keep model schemas flat: enums, strings, booleans, integers,
  `additionalProperties: false`, every field required.

## Stages (summary)

| Stage               | Done when                                              |
| ------------------- | ------------------------------------------------------ |
| 0. Monorepo tooling | `pnpm check` passes                                    |
| 1. dice             | Formulas, advantage, seed                              |
| 2. engine-core      | Events, state, undo, RuleSystem                        |
| 3. SRD import       | Own schema; ~10 monsters, weapons, spells              |
| 4. D&D rules        | Checks, saves, attacks, damage, conditions, initiative |
| 5. LLM + eval       | Forced JSON, one repair retry                          |
| 6. CLI play         | Free text → intent → roll → narration                  |
| 7+                  | Encounters, web, memory, desktop, Daggerheart          |

Stage 6 is the gate before UI work.
