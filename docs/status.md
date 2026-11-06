# Status

| Stage | Name                                  | Status      |
| ----- | ------------------------------------- | ----------- |
| 0     | Monorepo, lint, Vitest, AGENTS.md, CI | Done        |
| 1     | dice                                  | Done        |
| 2     | engine-core                           | Done        |
| 3     | SRD import                            | Done        |
| 3b    | Full SRD import (all 25 files)        | Done        |
| 4     | D&D rules                             | Done        |
| 5     | LLM providers + eval                  | Done        |
| 6     | CLI play                              | Done        |
| 7     | Encounters (7A, 7B.1 done; rest open) | In progress |
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
- Deferred at stage 4 (Multiattack, NPC action choice, turn advancement and the
  default variant are done in 7A; the rest is in `docs/stage-7-encounters.md`, 7B): Multiattack, save actions, spells on the menu, NPC
  action choice, turn advancement, death saves, exhaustion level 6 death,
  default variant for generic spawn names (see Stage 6 known gap)

## Stage 5 notes

- `@iron-scribe/llm` has one client over an OpenAI-compatible adapter (llama.cpp,
  LM Studio, Ollama, KoboldCpp) and a Gemini adapter. Game packages stay out of it
- Model schemas are flat Zod objects. `generateObject` allows one repair retry, then
  throws `repair_exhausted` with both attempts. Text and streaming calls do not retry
- Replies may include a `<think>` block, a stray `</think>`, or a Harmony final channel.
  Those are removed before JSON parsing and before narration is returned
- The stable `prefix` is the first message. The JSON schema is appended to the scene
  so per-turn aliases do not bust the prompt cache. `json_schema` falls back to
  `json_object` on HTTP 400 or 422
- Live eval against KoboldCpp at `127.0.0.1:5001`, model
  `koboldcpp/gemma-4-26B-A4B-it-qat-uncensored-heretic-UDmerge-Q4_K_XXL`:
  6/6 first-try schema, 0 repairs, 7/7 semantic, mean 888 ms (p50 663, max 1525).
  Load another model and rerun `pnpm --filter @iron-scribe/llm eval` to compare.
  GPT OSS 20B and Ornith-1.5-35B-A3B were not loaded during this run

## Stage 6 notes

- `@iron-scribe/orchestrator` is the only caller that changes state during play.
  One player actor. NPC turns run in the combat loop (Stage 7A)
- Free text is two model calls: an intent (spawn, check, wants an action — no
  aliases and no DC), then a decision from the menu rebuilt after those commits.
  An empty alias list is `null`, never an empty enum
- `resolveCheckDc` is engine-owned. Official SRD typical DCs are 5 / 10 / 15 /
  20 / 25 / 30. Unbanded checks use `PROJECT_DEFAULT_CHECK_DC` (12), a temporary
  fallback, not an SRD band
- Stealth is a normal ability check. The fact is `Stealth N vs DC 12, success|failure`.
  It does not grant Invisible, change Advantage, or spend an action
- `undoTurn` / `redoTurn` restore one `EngineSnapshot` for the whole turn.
  Clarify, none, `/status`, and `/sheet` do not push history or clear redo.
  A failed object call restores the pre-turn snapshot with no redo trace.
  Narration runs after that history entry; a broken stream keeps partial text
- Spawn count is 1..10. Ambiguous catalog matches are capped at 10. `goblin`
  and `goblins` stay the three SRD goblins, including Goblin Boss
- Known gap: a generic plural ("two goblins") makes the GM ask which variant
  (warrior, minion, boss). A real game must not ask. Accepted for now. Planned
  for Stage 7: the engine picks a default variant for a generic name (a "default
  variant" field in catalog overrides) and asks only when the player names a
  variant or role. Encounter definitions from a GM or scene (Stage 9) would
  replace player-driven spawning. The answer keeps the original count, attitude
  and intent (`spawnCount` survives the clarify turn)
- Stage 7 design note, engagement: combat should not be inferred from "a hostile
  is present and the player has a targeted action". Each entity (the player
  included) needs an `engaged` flag, set by the engine on an attack or an
  explicit encounter trigger. `engaged` needs per-entity perception first: who
  can see whom, and who is aware of whom (a creature the player has not been
  noticed by is not engaged with the player; a hidden player is not visible to
  it). Initiative is then rolled for the engaged participants only. Surprise
  (the `surprised` list that `rollInitiative` already accepts) comes with that
  work and is not implemented now. Until then `encounterStart` rolls initiative
  before the first targeted attack when a hostile is present, with nobody
  surprised
- Stage 7 gap, scene shift: nothing emits `entity.presenceSet`, so creatures never
  leave. After the player moves on, the earlier guard, cultist and fallen
  creatures stay present, and no new initiative is rolled for the next fight
  because `state.system.encounter` already exists. Needs a scene or location
  concept that sets presence and ends or restarts the encounter. The eval case
  `e2e-three-encounters` only checks what exists today: a new hostile appears
  and becomes the target
- Intent has a required `spawnIsNew` flag. The model once spawned a third
  goblin for "ambush a goblin" with two already present; `spawnFrom` now ignores
  the spawn when the flag is false. Eval case `no-respawn-present-pair`
- Intent prompt: a stance or preparation ("I prepare to fight", "I ready my
  dagger") is not an action, so `wantsAction` stays false. Eval case
  `no-attack-on-stance` covers it
- Combat gaps: superseded by 7A (turns and NPC actions exist). Surprise from a
  Stealth success is still not modelled; see `docs/stage-7-encounters.md` (7C)
- The CLI hero is a fixed SRD 5.2.1 Level 1 Rogue (d8, 10 HP, proficiency +2,
  DEX and INT saves, four Rogue skills, Expertise in two). The model may only
  suggest a name and a backstory. The hero is spawned before the orchestrator,
  so `/undo` does not remove them
- `pnpm play` takes `--url`, `--provider`, `--model`, `--schema-mode`,
  `--api-key`, and `--seed`. The key may also come from `GEMINI_API_KEY`,
  `GOOGLE_API_KEY`, or `OPENAI_API_KEY`. It is never printed, logged, or saved

## Stage 7A notes (combat loop)

Scope record for 7A and the 7B and 7C backlogs: `docs/stage-7-encounters.md`.

- Initiative order is real. `state.system.encounter` is
  `{round, turnIndex, acted, order}`. After a player action, the engine runs
  `RuleSystem.turnEnd` (`advanceTurn`) and then `nextCombatStep` until it returns
  null (player's turn, suspended, or no encounter). NPCs ahead of the player act
  before the player's action, also after `/init`. If the player goes down first,
  their pending action is skipped
- NPC policy (deterministic, no model): the first menu action against the player.
  An NPC with no action or a non-hostile NPC still ends its turn. `advanceRound`
  runs only once everyone has acted
- `MAX_COMBAT_STEPS = 32`. Past it the whole turn is restored (`engine.restore`)
  and `combat_loop_exceeded` is thrown
- Group initiative (SRD): monsters with the same non-null `templateRef` share one
  d20. Ties: higher total, higher DEX score, player, spawn order. Only living,
  present creatures roll
- Suspended vs ended: with the player down and hostiles alive, `encounter` stays
  and `nextCombatStep` returns null. `endEncounter` runs only when no living
  present hostile remains, and sets `encounter` to null
- Multiattack: conservative `expandMultiattack`. Only fixed integer counts with
  no `options`, every step an attack. Otherwise (Hydra, options) it is not offered.
  Offered as `monster:multiattack` (A1). Sub-attacks hit one target, run in order
  on a running state, and stop at 0 HP
- Spawns are refused during an encounter (`combat_active`); nothing is committed
- `DEFAULT_MONSTER_VARIANTS` is an Iron Scribe UX policy, not SRD. Priority: exact
  id/name, default family variant, catalog search. A test checks every target id
  exists. "goblin" now spawns a Goblin Warrior without a question
- NPC attack facts use key `npc_attack`: `Name (Action): <roll text>`
- Out of scope (7B, 7C): death saves, dynamic Hydra heads, multi-target Multiattack,
  mid-combat spawns, Hide, surprise, scene shifts, spells

## Stage 7B.1 notes (dying and death saves)

Scope record: `docs/stage-7-encounters.md`.

- `entity.system.deathSaves` (`{successes, failures, stable, dead}`) is written only by events.
  `deathSave` is a procedure: d20 minus 2 per Exhaustion level vs DC 10; natural 1 and 20 use the raw
  die. Instant death on massive damage; damage at 0 HP adds failures; healing wakes; Exhaustion 6 kills
- Dying turn: `RuleSystem.playerTurnProcedure` makes the hero's turn a death save with no intent or
  decision call; player text is narration flavor only. Natural 20: no `turnEnd`, the hero keeps the turn.
  A hero downed by a faster NPC skips the declared action
- Iron Scribe rules (not SRD): a solo hero who stabilizes rests 1d4 hours, wakes at 1 HP and the
  encounter ends; hostiles hold against a dying hero
- `combatPhase`: none, active, dying, suspended (stable or incapacitated), dead (terminal, encounter kept).
  `/status` shows `Status: DYING (...)` or `Status: DEAD`
- Tests: `death-saves.test.ts`, `combat.test.ts` (system), `apps/cli/src/dying.test.ts`
  (scripted RNG, undo/redo). Oracle eval 100%, 0 invariant violations. Live model eval not rerun
