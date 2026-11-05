# @iron-scribe/system-dnd5e-2024

## Purpose

D&D 5e 2024 rules plus SRD 5.2.1 data import (own schema). Implements
`RuleSystem`. Must not import `@iron-scribe/llm` or the orchestrator. Ship
required CC-BY-4.0 SRD attribution; no non-SRD Wizards content.

## Public interface

Stage 3 (catalog); rules arrive in Stage 4.

- `loadCatalog()` -> `{ monsters, weapons, armor, spells }`, each a
  `CatalogSection` with `get(id)`, `find(query)`, `list()`
- `find`: exact id/name match (case, punctuation and `-`/`_` insensitive) wins;
  otherwise every entry whose name contains all query words as whole words.
  1 result = proceed, 0 or many = ask the user
- `monsterToEntity(template, entityId, { name? })` copies HP and stores the full
  `Monster` in `entity.system.monster`; `readMonsterSnapshot(entity)` reads it
- Schemas: `Monster`, `Weapon`, `Armor` (`body` | `shield`), `Spell`
- Dice strings are plain dice only (validated with `parseFormula`); spells use
  `addSpellcastingMod`; spell `save` is `{ ability, onSuccess: 'half' | 'none' }`

## Data

- `data/srd-5.2.1/raw` is a pinned upstream subset (see `SOURCE.json`). Refresh
  with `pnpm --filter @iron-scribe/system-dnd5e-2024 srd:import`; never in CI
- `src/catalog/overrides.ts` holds rules data upstream lacks; every entry must
  cite its SRD 5.2.1 section
- Zod 4 API only (`z.strictObject`, `{ error }`); no `zod/v3`

## Test rules

- Write failing tests from SRD examples (checks, attacks, damage, conditions),
  then implement until they pass.
- Catalog lookups must not invent hit points or armor class.
- Keep files under about 300 lines.
