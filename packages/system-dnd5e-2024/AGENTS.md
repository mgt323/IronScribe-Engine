# @iron-scribe/system-dnd5e-2024

## Purpose

D&D 5e 2024 rules plus SRD 5.2.1 data import (own schema). Implements
`RuleSystem`. Must not import `@iron-scribe/llm` or the orchestrator. Ship
required CC-BY-4.0 SRD attribution; no non-SRD Wizards content.

## Public interface

Stages 3 and 3b (catalog); rules arrive in Stage 4.

- `loadCatalog()` -> `{ monsters, weapons, armor, gear, magicItems, spells,
conditions, damageTypes, abilityScores, skills }`, each a `CatalogSection`
  with `get(id)`, `find(query)`, `list()`
- `find`: exact id/name match (case, punctuation and `-`/`_` insensitive) wins;
  otherwise every entry whose name contains all query words as whole words.
  1 result = proceed, 0 or many = ask the user
- `monsterToEntity(template, entityId, { name? })` copies HP and stores the full
  `Monster` in `entity.system.monster`; `readMonsterSnapshot(entity)` reads it
- Schemas: `Monster`, `Weapon`, `Armor` (`body` | `shield`), `Gear`, `MagicItem`,
  `RuleEntry`, `Spell` (`mechanics`: `override` | `parsed` | `text-only`)
- Dice strings are plain dice only (validated with `parseFormula`); spells use
  `addSpellcastingMod`; spell `save` is `{ ability, onSuccess: 'half' | 'none' }`

## Data

- `data/srd-5.2.1/raw` is the full 2024 data set (25 files) from 5e-srd-api,
  pinned in `SOURCE.json`. Refresh with
  `pnpm --filter @iron-scribe/system-dnd5e-2024 srd:import`; never in CI
- `src/catalog/upstream/` is copied from the same commit by `srd:import`. Never
  edit it by hand. It is exempt from style rules (Prettier, max-lines, lint style)
  but not from typecheck or the strict validation test. Handwritten production
  code may only `import type` from it (ESLint enforces this)
- Validation: committed data is checked against upstream's strict schemas in
  `srd:import` and `raw-validation.test.ts`, and against our own schemas in
  `catalog-data.test.ts`. `loadCatalog()` trusts it and runs no Zod. Data from
  outside the repo (saves, future content packs) must be validated when loaded
- `src/catalog/overrides.ts` holds rules data upstream lacks; every entry must
  cite its SRD 5.2.1 section
- Zod 4 API only (`z.strictObject`, `{ error }`); no `zod/v3`

## Test rules

- Write failing tests from SRD examples (checks, attacks, damage, conditions),
  then implement until they pass.
- Catalog lookups must not invent hit points or armor class.
- Keep files under about 300 lines.
