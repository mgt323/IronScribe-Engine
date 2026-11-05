# Status

| Stage | Name                                  | Status      |
| ----- | ------------------------------------- | ----------- |
| 0     | Monorepo, lint, Vitest, AGENTS.md, CI | Done        |
| 1     | dice                                  | Done        |
| 2     | engine-core                           | Done        |
| 3     | SRD import                            | Done        |
| 3b    | Full SRD import (all 25 files)        | Done        |
| 4     | D&D rules                             | Done        |
| 5     | LLM providers + eval                  | Not started |
| 6     | CLI play                              | Not started |
| 7     | Combat                                | Not started |
| 8     | Web UI                                | Not started |
| 9     | Campaign memory                       | Not started |
| 10    | Desktop shell                         | Not started |
| 11    | Daggerheart                           | Not started |

## Stage 0 notes

- pnpm workspace with TypeScript, ESLint, Prettier, Vitest
- Packages: `dice`, `engine-core`, `system-dnd5e-2024`, `llm`, `orchestrator`
- License: Apache-2.0; SRD attribution placeholder in `NOTICE`
- CI workflow written under `.github/workflows/` (remote not configured yet)

## Stage 1 notes

- RNG: mulberry32 with FNV-1a string seeds; state is one uint32 for replay
- Formula grammar: `NdM` / `dM` / constants, `+`/`-`, optional `khK`/`klK`;
  count 1..100, sides 2..1000
- Critical: `roll(..., { critical: true })` doubles dice terms only
- Advantage: both advantage and disadvantage resolve to normal (SRD)

## Stage 2 notes

- State: entities (hp, `system` bag), `spawnOrder`, global `system` bag, `rng`
- Core events are a closed union; rule systems add events via `system` +
  `applySystemEvent`
- `perform` validates aliases, resolves with a restored RNG, then logs
  `rng.advanced` only if the RNG moved; replaying events alone rebuilds state
- One undo step is one commit; undo/redo restore the RNG
- Tested with a fake rule system (`poke`, `wait`)

## Stage 3 notes

- Superseded by Stage 3b below: the subset was widened to the full data set
- Zod 4 is used only inside `system-dnd5e-2024` to validate data; model-facing
  schemas still belong to Stage 5 (same zod version)
- Catalog: `find()` is exact id/name first, then whole-word match; armor
  `shield` is `kind: 'shield'` and adds to AC
- `monsterToEntity` copies HP and stores the full stat block in
  `entity.system.monster`; `readMonsterSnapshot` reads it back
- Dice strings hold dice only; spell modifiers use `addSpellcastingMod`

## Stage 3b notes (full SRD import)

Done in one chat by explicit choice, an exception to one stage per chat.

- Source: 5e-srd-api `packages/5e-database` at commit `6dfaa6e2` (5e-database
  is archived). All 25 files of `src/2024/en` are in
  `packages/system-dnd5e-2024/data/srd-5.2.1/raw`; `srd:import` fetches into a
  staging dir, validates it strictly, then swaps it in and rewrites `SOURCE.json`
- Upstream's Zod schemas are copied into `src/catalog/upstream/` (generated,
  never hand-edited, exempt from style rules but typechecked and tested).
  Production code may only type-import them (ESLint enforces this)
- Validation: raw data is checked against upstream's strict schemas in
  `srd:import` and in `raw-validation.test.ts`; `loadCatalog()` converts it
  without Zod. Our own schemas are checked over every entry in
  `catalog-data.test.ts`. Data from outside the repo (saves, future content
  packs) must be validated when loaded (`readMonsterSnapshot` does)
- Catalog sections: monsters (341), weapons (38), armor (13), gear (131),
  magicItems (262), spells (339), conditions, damageTypes, abilityScores, skills.
  Classes, levels, features, species, backgrounds etc. are imported and
  validated but stay raw until a character stage
- Monsters keep bonus actions, reactions, legendary actions, usage (recharge,
  per day), `save` DCs, Multiattack as data, spellcasting, senses, forms and
  `conditionalDefenses` (qualified defenses stay text). Flat damage upstream
  omits is added in `overrides.ts`; Goat's Ram is a known unresolved case
- Spells: `mechanics` is `override` (hand-checked), `parsed` (text parser,
  bails on ambiguity) or `text-only` (`resolution: 'none'`). Stage 4 should trust
  `override` first and treat `parsed` as best effort
- CI now runs on `master`

## Stage 4 notes

- `engine.runProcedure(label, procedure)` is the seeded, logged, undoable path
  for rolls the engine triggers (checks, saves, initiative). `commit()` still
  cannot roll. A system without `runProcedure` throws `no_procedure_handler`
- Characters are a minimal sheet in `entity.system.character`: level, abilities,
  proficiencies, weapons, armor, shield, hit point maximum. No classes, species
  or features (Sneak Attack waits for a character stage)
- Rules covered, with SRD 5.2.1 tests: ability modifiers, proficiency bonus,
  checks, saves, weapon and monster attacks, critical hits, damage,
  immunity/resistance/vulnerability, basic conditions, exhaustion (−2 per
  level), initiative
- Theater of the mind: melee is within 5 feet. Conditional defenses are noted
  and not applied. Monster initiative is Dexterity only
- Deferred to stage 7: Multiattack, save actions, spells on the menu, NPC
  action choice, turn advancement, death saves, exhaustion level 6 death
