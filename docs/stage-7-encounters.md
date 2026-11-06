# Stage 7: Encounters

Stage 7 is split in three. 7A is done. 7B (combat rules) and 7C (scene, spawns,
narration) are backlogs, not yet planned in detail. All three come before the
web UI (Stage 8).
Day-to-day progress lives in `docs/status.md`; this file is the scope record.

## 7A: done

Goal: a fight that actually runs. The engine, not the model, owns turn order
and NPC actions.

| Area                | What exists                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initiative order    | NPCs ahead of the player act before the player's action, on a targeted action and after `/init`. A downed or incapacitated player's pending action is skipped                     |
| Turn progression    | `advanceTurn` after every combatant's turn (even an NPC with no action or target). `advanceRound` only after everyone has acted. Encounter is `{round, turnIndex, acted, order}`  |
| Loop safety         | `MAX_COMBAT_STEPS = 32`. Any failure restores the pre-turn snapshot (`combat_loop_exceeded` past the limit)                                                                       |
| Group initiative    | Monsters with the same non-null `templateRef` share one d20. Ties: total, DEX score, player, spawn order. Only living, present creatures roll                                     |
| Suspended vs ended  | Player down with hostiles alive: `encounter` stays, `nextCombatStep` returns null. `endEncounter` only when no living present hostile remains                                     |
| NPC policy          | Deterministic, no model: first menu action against the player. Non-hostile NPCs skip their turn                                                                                   |
| Multiattack         | Conservative `expandMultiattack`: fixed integer counts, no `options`, every step an attack. Offered as `monster:multiattack` (A1). One target, sequential, stops at 0 HP          |
| Spawn rules         | Spawns refused while an encounter is active (`combat_active`, nothing committed). Resolution: exact id/name, then `DEFAULT_MONSTER_VARIANTS` (Iron Scribe UX policy), then search |
| Facts and narration | NPC attacks are `npc_attack` facts: `Name (Action): <roll text>`. Narration prompt gets an `Outcome:` line per NPC attack                                                         |
| CLI                 | `/status` shows `Combat: round N`, with a suspended note when the hero cannot act                                                                                                 |
| Interface additions | engine-core: `CombatStep`, `RuleSystem.nextCombatStep`, `RuleSystem.turnEnd`, `SpawnResolution.combat_active`, error codes `combat_loop_exceeded` and `invalid_combat_state`      |
| Tests and eval      | Unit tests per package, CLI integration tests (NPC-first, player-first, spawn refusal). Live `eval-play` is 100% with the eval hero at 200 HP (`EVAL_HERO_HP`)                    |

Design decisions worth remembering:

- `turnEnd` is a hook so the orchestrator never reads D&D encounter state.
- `action` steps are followed by `turnEnd`; `procedure` steps end their own turn.
- `DEFAULT_MONSTER_VARIANTS` is not SRD. "goblin" now spawns a Goblin Warrior
  with no question; named variants still win; broad families stay ambiguous.

## 7B: combat rules

Phased. 7B.1 is done (below). 7B.2 (spells, save actions, shared dispatcher, AoE, Magic Missile) and
7B.3 (Multiattack variants, Hydra, recharge, NPC policy) follow.

### 7B.1: done (dying and death saves)

Death saves with Exhaustion on the total (natural 1 and 20 read from the raw die), massive damage,
damage at 0 HP, healing revival, Exhaustion 6 death, a solo-stable 1d4-hour rest (Iron Scribe rule),
explicit `combatPhase` (`none | active | dying | suspended | dead`), a dying turn that skips the model
(player text is narration flavor), natural 20 keeps the turn, and a hero downed before their turn skips
the declared action. Dead keeps the encounter state and ends all play (not `endEncounter`). Hostiles
holding against a dying hero is an Iron Scribe policy, not SRD. Item 1 below is covered; item 6's
orchestrator test lives in `apps/cli/src/dying.test.ts` (a scripted RNG, real D&D rules). Eval:
`loop-hero-down-dying` replaces `loop-hero-down-suspends`; `e2e-hero-falls` now expects death saves.

Items still open:

Rules the engine still lacks. Nothing here needs new scene concepts.

1. **Death saves** and the dying state for the player. Today a character at 0 HP
   is just Unconscious and the encounter is suspended with no way out.
   Exhaustion level 6 death belongs here too.
2. **Dynamic Multiattack.** Hydra heads ("Number of Heads"), `options` /
   "choose N" lists, and non-attack steps. Currently not offered at all.
3. **Multi-target Multiattack.** Splitting sub-attacks across targets.
4. **Save actions and spells on the menu** (monster and player), including
   spellcasting data already in the catalog.
5. **NPC policy beyond "first action".** Pick a sensible action (ranged vs
   melee, save actions, recharge), and allow non-player targets once allies exist.
6. Test follow-up: an orchestrator-level test for "player downed before their
   action", using a system wrapper that feeds `createScriptedRng` to `resolve`.
   Decide whether the eval hero keeps 200 HP, or cases get controlled dice.

## 7C: scene, spawns and narration (to do)

Who is in the scene, how they get there, and how it is told. Order is a
suggestion. Narration grounding (item 1) is small and can be done first, on its
own.

### Narration

1. **Narration grounded in facts.** The player's text stays in the narration
   call, because the model needs it to continue the story. Constrain it instead:
   label it as context for tone and intent only, state that the facts are the
   only events, and list the creatures that exist and forbid mentioning others.
   Add an eval case: a creature the player names but the engine did not spawn
   must not appear in the narration. A later hard check could scan the narration
   for catalog creature names that are not in the scene (eval report, Open 2,
   option 1).
2. Label the player's outcome line ("Your attack MISSES") so it cannot be
   confused with `Wolf's attack MISSES`.
3. Do not state what a creature notices, feels or intends unless a fact says so.

### Awareness and presence

4. **Engagement, visibility, Hide, surprise.** Needs per-entity perception
   (who can see or has noticed whom) before initiative. `rollInitiative`
   already accepts `surprised`. A Stealth success is still only a fact.
   Motivating case from play: "he hasn't seen me yet" is ignored, and the spawn
   narration can invent that the wolf noticed the hero.
5. **Proximity levels (design idea, replaces the `present` boolean).** Three
   levels, for example engaged, nearby, gone. Only engaged creatures are in the
   model's scene list, are valid targets, and roll initiative. Nearby creatures
   (the gate guards while the player talks to a beggar) are remembered by the
   engine. When they intervene in a fight they become engaged, roll initiative
   and join the existing order. Open points:
   - `spawnIsNew` compares against the scene list, so nearby creatures must stay
     visible to it (a separate "Nearby (not engaged)" line with ids), or the
     model will spawn a second set of guards.
   - The model only picks from a fixed menu ("talks to <id>"). The engine
     validates and writes. Escalation (guards joining) comes from rules, such as
     an attack or hostile act in view, not free model judgement.
   - Core needs at least the engaged-or-not bit, since menu targets filter on
     it. Finer levels can live in the D&D system data.
   - Keep awareness (item 4) separate from distance.
     This subsumes items 6 and 7.
6. **Scene shifts and presence.** Nothing emits `entity.presenceSet`, so
   creatures never leave. Spawns during combat are refused, so a new fight needs
   a scene or location concept that ends or restarts the encounter.
7. **Mid-combat spawns** (reinforcements), once item 5 gives them a legal path.

### Spawn and intent

8. **Mixed groups** in one sentence ("a wolf and a bandit"): the known
   `spawn-mixed-group` gap in `docs/stage-6-cli-play-report.md`. Default variants
   (done in 7A) were the other half of that recommendation. Preferred design:
   fixed flat slots (`spawn1…spawn3`, each with query, count, attitude), each
   slot with its own clarification and, with item 5, its own proximity. Fall
   back to a `moreSpawns` flag with a follow-up intent call if the model fills
   slots badly. Measure with `--runs 3`. Asking the player to repeat is rejected.

## Later stages

Encounter definitions from a GM or scene belong to Stage 9 (campaign memory),
not 7C. Improvised spawns from player prose stay needed even then. Web UI is
Stage 8, desktop 10, Daggerheart 11.
