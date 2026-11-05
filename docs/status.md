# Status

| Stage | Name                                  | Status      |
| ----- | ------------------------------------- | ----------- |
| 0     | Monorepo, lint, Vitest, AGENTS.md, CI | Done        |
| 1     | dice                                  | Done        |
| 2     | engine-core                           | Done        |
| 3     | SRD import                            | Done        |
| 4     | D&D rules                             | Not started |
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

- Raw SRD subset (pinned 5e-database commit) lives in
  `packages/system-dnd5e-2024/data/srd-5.2.1/raw`; `pnpm --filter
@iron-scribe/system-dnd5e-2024 srd:import` refreshes it by hand (never in CI)
- Raw JSON is converted to our own Zod schema when the catalog loads; rules data
  upstream lacks lives in `overrides.ts` (spell mechanics, Cultist necrotic)
- Zod 4 is used only inside `system-dnd5e-2024` to validate data; model-facing
  schemas still belong to Stage 5 (same zod version)
- Catalog: 11 monsters, 14 weapons, 4 armor (shield is `kind: 'shield'`, adds
  to AC), 5 spells. `find()` is exact id/name first, then whole-word match
- `monsterToEntity` copies HP and stores the full stat block in
  `entity.system.monster`; `readMonsterSnapshot` reads it back
- Dice strings hold dice only; spell modifiers use `addSpellcastingMod`
