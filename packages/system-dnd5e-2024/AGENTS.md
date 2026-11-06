# @iron-scribe/system-dnd5e-2024

## Purpose

D&D 5e 2024 rules plus SRD 5.2.1 data import (own schema). Implements
`RuleSystem`. Must not import `@iron-scribe/llm` or the orchestrator. Ship
required CC-BY-4.0 SRD attribution; no non-SRD Wizards content.

## Public interface

Catalog (stages 3 and 3b) and rules (stage 4). `createDnd5eSystem({ catalog })`
implements `RuleSystem`.

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
- `Character` lives in `entity.system.character` (level, abilities, save and skill
  proficiencies, weapon proficiencies, carried weapon ids, armor id or null,
  shield, `hpMax`). `characterToEntity` / `readCharacter`. No class or features
- `readCreature(entity, catalog)` is the shared view: mods, AC, saves, skills,
  initiative (Dexterity modifier only), defenses, condition immunities
- Menu: `weapon:<id>` for each carried weapon, `monster:<actionId>` for each
  melee or ranged monster attack, with `monster:multiattack` first when
  `expandMultiattack` accepts it (fixed integer steps, no options, all attacks). Targets are other present creatures above 0 HP.
  Incapacitated creatures (including paralyzed, stunned, unconscious) offer nothing
- `resolve` rolls the attack, then damage, then immunity / resistance /
  vulnerability. Facts are engine text (`attack`, `damage`, `hp`). A character
  at 0 HP gains Unconscious; a monster is marked defeated. No death saves
- `runProcedure`: `check` `{ actorId, ability, skill|null, dc }`, `save`
  `{ actorId, ability, dc }`, `initiative` `{ surprised }`. Payloads are
  Zod-checked. Initiative writes `state.system.encounter`
- `checkCatalog` lists abilities and skill ids. `resolveCheckDc(state, context)`
  returns `SRD_TYPICAL_DC` when `context.difficulty` is set: Very Easy 5, Easy 10,
  Medium 15, Hard 20, Very Hard 25, Nearly Impossible 30. Otherwise it returns
  `PROJECT_DEFAULT_CHECK_DC` (12). That 12 is a Stage 6 fallback, not an SRD band,
  and the model never supplies it
- Combat (7A): `state.system.encounter` is `{round, turnIndex, acted, order}`.
  `initiative` gives one shared d20 per `templateRef` (ties: total, DEX score,
  player, spawn order). Procedures `advanceTurn`, `advanceRound`, `endEncounter`
  are dice-free. `nextCombatStep` has NPCs take their first menu action against
  the player; null means the player is up or combat is suspended (player down,
  hostiles alive). `endEncounter` only when no living present hostile remains
- `resolveSpawn` priority: exact id/name, `DEFAULT_MONSTER_VARIANTS` (an Iron
  Scribe UX policy, not SRD), then `catalog.monsters.find`. Refused with
  `combat_active` during an encounter. A plural is singularized only when
  that lookup is empty (`wolves` → `wolf`). Ambiguous matches are capped at 10.
  Count is 1..10. Attitude is `hostile`, `neutral`, or `friendly` (default
  `hostile`) and is stored on `entity.system.attitude`
- A Stealth check is only the check fact (`Stealth N vs DC …, success|failure`).
  It does not grant Invisible, change Advantage, or spend an action. Hide is
  Stage 7. `resolve-attack.ts` is unchanged
- Pure helpers: `abilityModifier`, `proficiencyBonus`, `abilityCheck`,
  `skillCheck`, `savingThrow`, `attackRoll`, `weaponAttackBonus`,
  `rollWeaponDamage`, `rollMonsterDamage`, `applyDefenses`, `rollInitiative`,
  `conditionEvents`, `rollEffects`, `readConditions`

Theater of the mind: melee counts as within 5 feet and ranged does not, so
Prone and the paralyzed/unconscious critical-hit rule need no grid. Conditional
defenses stay notes and do not change damage. Monster initiative has no bonus
beyond Dexterity. Spells and class features are not actions yet.

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
