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
- Menu: `weapon:<id>` for each carried weapon, then character spells (below); `monster:<actionId>` for each
  melee or ranged monster attack, with `monster:multiattack` first when
  `expandMultiattack` accepts it (fixed integer steps, no options, all attacks), then supported
  monster save actions. Targets are other present creatures above 0 HP.
  Incapacitated creatures (including paralyzed, stunned, unconscious) offer nothing
- `resolve` is `resolveAction` (`resolve-action.ts`), the one dispatcher: weapon and monster attacks,
  Multiattack, monster save actions, character spells. An attack rolls to hit, then damage, then
  immunity / resistance / vulnerability (`dealDamage`, shared by every effect). Facts are engine
  text (`attack`, `damage`, `hp`, `use`, `save`, `spell`). Death rules: see Dying below
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
  are dice-free. `nextCombatStep` has NPCs follow `chooseNpcAction` (`npc-policy.ts`); null means the player is up or combat is suspended (player down,
  hostiles alive). `endEncounter` only when no living present hostile remains
- `resolveSpawn` priority: exact id/name, `DEFAULT_MONSTER_VARIANTS` (an Iron
  Scribe UX policy, not SRD), then `catalog.monsters.find`. Refused with
  `combat_active` during an encounter. A plural is singularized only when
  that lookup is empty (`wolves` → `wolf`). Ambiguous matches are capped at 10.
  Count is 1..10. Attitude is `hostile`, `neutral`, or `friendly` (default
  `hostile`) and is stored on `entity.system.attitude`
- Dying (7B.1, SRD 5.2.1): `entity.system.deathSaves` is `{successes, failures, stable, dead}`
  (null = not dying). Reduced to 0 HP: Unconscious plus a fresh tally; a remainder at or above
  the HP maximum is instant death. Damage at 0 HP: 1 failure (2 on a critical hit), ends
  stability. Procedure `deathSave { actorId }`: d20 minus 2 per Exhaustion level against DC 10;
  natural 1 (two failures) and natural 20 (1 HP, wakes) read the unmodified die. 3 successes:
  stable; 3 failures: dead. `healEvents` wakes a hero at 0 HP. Exhaustion 6 is death
  (`exhaustionOutcome`). Iron Scribe rules, not SRD: a solo hero (no conscious friendly ally)
  who stabilizes rests 1d4 hours, regains 1 HP and the encounter ends (no soft-lock, no world
  clock); hostiles hold their turn against a dying hero so the solo hero rolls saves turn by turn
  (the dying hero is not on any NPC target list). `combatPhase` is `none | active | dying |
suspended | dead`; dead keeps the encounter but nothing runs. `playerTurnProcedure` returns the
  death save, `isActorDefeated` is dead
- Spells (7B.2): `Character` has optional `spellcastingAbility`, `cantrips`, `preparedSpells`,
  `spellSlots` (totals by level; defaults mean "casts nothing"). `validateCharacterSpells(sheet,
catalog, allowlist?)`. Spent slots are `entity.system.spellSlotsUsed` (`{ "1": 1 }`), written
  only by the cast's events. A spell is on the menu only if the rules can resolve it (heal, or an
  effect with damage; `mechanics: 'text-only'` is never offered, e.g. Mage Hand) and, above level 0,
  a slot of its level is left. No upcasting: a spell uses its own level's slot. Attack spells use
  prof + casting mod and cantrip dice by character level; save spells use DC 8 + prof + casting
  mod. Save effects (spells and monster save actions) roll the damage ONCE, then each living,
  deduplicated target saves: a failure takes it all, a success half (rounded down per damage part)
  or none; defenses apply per target. Magic Missile: dart i goes to `targets[i mod n]`, a dart whose
  target is down is lost, never redirected. Healing is `spell:<id>:self` (no target) or `spell:<id>`;
  healing a creature at 0 HP wakes it (`healEvents`). `maxTargets` is 3 for save effects and Magic
  Missile, else 1. Spell id sets for presets live in the CLI, not here
- Monster save actions (7B.2): offered only with `kind: 'save'`, a DC, damage dice and
  `onSuccess` of `half` or `none` (`other` is never read as "no damage"). Conditions the stat block adds on a
  failed save (Grappled, Restrained) are not applied yet. `entity.system.usage`
  (`{ expended, counts }`, `usage.ts`) records limited actions: recharge and per-rest actions become
  expended after one use, per-day actions count uses. Recharge rolls are 7B.3, so an expended
  action stays off the menu until then. Monster Spellcasting is not on the menu yet
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
beyond Dexterity. Class features are not actions yet (Innate Sorcery and similar are deferred).

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

## 7B.3: Multiattack variants, Hydra, recharge, NPC policy

- `expandMultiattackVariants(entity)` is pure: every complete variant (fixed steps plus each
  combination of `choose` options). A step must be an attack or a supported save action with uses
  left; one bad fixed step gives `[]`. `"Number of Heads"` reads `entity.system.hydra`. Step `i` aims
  at `targets[i]` (else the first); a step on a downed target is skipped, never redirected
- Hydra (`hydra.ts`, SRD 5.2.1 Multiple Heads): `entity.system.hydra` is written by events only.
  25 damage in a turn kills a head; no heads left kills it; at the end of its turn it regrows two
  heads per head lost and regains 20 HP, unless fire damage hurt it. Reactive Heads is out of scope
  (reactions). Turn damage resets at the end of every combatant's turn (`advanceTurn`)
- Recharge: procedure `{ kind: 'recharge', actorId }` rolls 1d6 for each expended recharge action at
  the start of an NPC's turn, once per turn (`encounter.recharged`, cleared by `advanceTurn`)
- Iron Scribe NPC tactical policy (not SRD, `npc-policy.ts`): targets are the hero and friendly NPCs
  above 0 HP, lowest HP first (ties: hero, spawn order); a dying hero is not a target, so hostiles
  hold. Actions by expected damage (save: 0.65 per creature, up to 3; attack: damage x hit chance);
  ties go to Multiattack, then melee, then menu order. A Multiattack splits across two targets when
  the first would fall to one step
