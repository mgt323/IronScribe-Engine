# @iron-scribe/orchestrator

## Purpose

Turn loop for one player actor. The model picks spawn, a check, or a menu
alias, then narrates facts the engine already resolved. Depends on
`@iron-scribe/engine-core` and `@iron-scribe/llm`. Must not import a concrete
system package. It never rolls dice, never chooses a DC, and never writes
state except by calling the engine.

## Public interface

- `createOrchestrator({ engine, system, llm, actorId })`
- `runTurn(input)` — intent, then spawn, check, and a decision from the menu
  rebuilt after those commits. Narration is last
- `runSpawn`, `runAction`, `runProcedureTurn` share that undo history
- The decision prompt names the last target (or T1) as the default when the
  player names none or says "again". The schema still rejects a null target for
  a targeted action
- No decision call when no menu action is usable (every action needs a target
  and none is present): the turn ends as `none`
- `undoTurn` / `redoTurn` each call `engine.restore` once for the whole turn.
  Clarify, none, and a failed object call do not push history. A failed object
  call restores the pre-turn snapshot and does not leave those commits on the
  engine redo stack
- The narration prompt adds plain `Outcome:` lines (an `attack` fact with "miss"
  is a MISS, otherwise a HIT; no `damage`/`hp` fact means nobody is wounded) and
  labels `initiative` facts as turn order, so a terse roll line cannot be narrated
  as its opposite
- Narration is recorded after the history entry. A stream that throws keeps
  the partial text and sets `narrationError`. The mechanics stay committed
- `buildIntentSchema` / `buildDecisionSchema` are flat. An empty alias list is
  `z.null()`, never `z.enum([])`. Intent has no aliases and no DC. `spawnIsNew` is required and comes first: when it is false the spawn fields are ignored, so "a goblin" for one already present spawns nothing
- Mixed spawns (7C.2, proximity in 7C.3): three slots, `spawn1` … `spawn3`, each query, count, attitude and proximity (`engaged` or `nearby`), all required and nullable. A null proximity on a filled slot is engaged. Slots are filled in order. Each count is 1..10 and the sum is at most 10. `spawnFrom` resolves every slot, then commits them as one `spawn`. Engaged creatures spawned during an encounter join that order (`afterSpawn`). An ambiguous slot is kept on the orchestrator with the original line, the check, `wantsAction`, the creatures already matched, and the slots still open. The reply is matched against those candidates (exact id or name, or tokens that fit exactly one) and the intent model is not called. The next ambiguous slot is asked the same way. Then the stored check or action runs. A reply that fits none or several is a new turn
- Combat loop (`combat.ts`): `runPlayerTurn` opens the encounter, runs
  `advanceCombatUntilPlayer` (NPCs ahead of the player), skips the player's action
  if they went down, then calls `turnEnd` and the loop again. `/init` also runs
  the loop. `MAX_COMBAT_STEPS = 32`; past it the turn is restored and
  `combat_loop_exceeded` thrown. NPC attack facts are key `npc_attack`:
  `Name (Action): <roll text>`. A `combat_active` spawn is a clarification
- Dying turn: when `system.playerTurnProcedure` returns a procedure, `runTurn` / `runAction` skip
  intent and decision (no model call but narration). NPCs ahead act, the procedure runs at the start
  of the hero's turn, and the player's text goes to the narration as flavor only. Still down: the turn
  ends and NPCs act to the hero's next turn. Back up (natural 20, solo rest) or dead: no `turnEnd`,
  so a revived hero keeps the turn. `isActorDefeated`: the turn is `none`, no model call. A hero
  downed by a faster NPC skips the declared action
- Several targets (7B.2): `DecisionSchema` stays flat: `targetAlias`, `secondaryTargetAlias`,
  `tertiaryTargetAlias` (all required, nullable enums). Refinements: tertiary needs secondary,
  no repeats, no more than the action's `maxTargets`, none for a no-target action. `steps.ts`
  sends `targetAliases` to `perform` when more than one is named (`targetAliasesOf`). The decision
  prompt marks actions that take several targets. Narration prompt turns `save` facts into plain
  `Outcome:` lines. NPC facts: only `attack` becomes `npc_attack`; spells and save actions add a
  `use` fact (`<id> uses Acid Breath`)
- Intent prompt lists `Present` (engaged) and `Nearby (not engaged)`. `spawnIsNew` is false for either list. Narration prompt (7C.1, `prompts.ts`, `outcomes.ts`): "Creatures in scene" lists engaged creatures only. Only
  they may be shown as here, acting or touching anything; off-screen or backstory people may appear as memory
  only when the player line or facts establish them; a creature the engine did not spawn never enters, even if
  the player names it. The player line is labelled tone and intent only. Inner states (notices, feels, intends)
  need a fact; visible reactions caused by facts are allowed. `Outcome:` lines use display names, never ids:
  "Your attack HITS/MISSES" for the hero, "<Name>'s attack ..." for an NPC, save and defeat lines by name. "You
  take no damage from the enemy attack" is emitted only when a hostile step was aimed at the hero and none of
  its facts records applied damage or a downing for the hero. The combat loop tags NPC-step facts with
  `source` and `targetIds` (resolved from the NPC's menu before it acts), so this never infers from a missing
  `hp` fact.
- Logs hold prompts, raw replies, facts, narration, and the RNG. No API key

## Test rules

- Use `@iron-scribe/engine-core/testing` and `createScriptedLlmClient`.
- An invalid alias aborts with no state change after one repair retry.
- Keep files under about 300 lines.
