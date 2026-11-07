# @iron-scribe/cli

## Purpose

Single-player theater-of-the-mind REPL. Free text and slash commands go through
`@iron-scribe/orchestrator`, which is the only caller of the engine. The
player is one Level 1 Rogue (`defaultAdventurerSheet`, default) or Sorcerer
(`defaultSorcererSheet`, `--archetype sorcerer`). The model may suggest
a name and a backstory. It does not draft scores, hit points, or gear.

## Public interface

- `createCliSession({ seed, character, characterName, backstory?, archetype?, llm, catalog })`
  spawns the hero before the orchestrator exists, so `/undo` cannot remove them
- `handleCliLine(session, line, writer)` — `/status`, `/sheet`, `/act`, `/spawn`,
  `/init`, `/undo`, `/redo`, `/log`, `/save`, `/help`, `/quit`. Read-only
  commands do not touch undo or redo
- `/save` writes seed, actor id, name, backstory, state, commits, and logs.
  It never writes an API key
- `bin/play.mjs` (`pnpm play`) reads `--api-key` or `GEMINI_API_KEY` /
  `GOOGLE_API_KEY` / `OPENAI_API_KEY` and passes the key only to the adapter

- `eval/legacy/eval-play.mjs` is a live eval (not run in CI): 53 cases against a real
  model and the real D&D rules, in seven categories (spawn, clarify, action, check,
  narration, command, e2e), positive and negative. Cases live in `eval-play-*cases.mjs`. `e2e-three-encounters` is one long
  session: friendly, neutral and hostile creatures, a target shift, a target
  going down (engine setup step, then real attacks), an attack on the fallen
  target (negative), and a scene shift to a new fight.
  Flags: `--only`, `--kind`, `--runs`, `--seed`, `--out`, `--json`, `--list`,
  `--fail-under` (exit 2). A case with `known:` is a documented gap and is left
  out of the pass rate.

  ```bash
  pnpm --filter @iron-scribe/cli build
  node apps/cli/eval/legacy/eval-play.mjs --url http://127.0.0.1:5001 --runs 3 --out play.jsonl
  ```

- `eval/run.mjs` is the Stage 7A live eval (`pnpm --filter @iron-scribe/cli eval:7a -- <flags>`), replacing
  `eval/legacy/eval-play.mjs` for combat work. It reports three layers apart: **engine invariants** (audited on
  every turn of every case: HP range, one initiative per encounter, round +1 per hero action, order
  respected, nobody acts when down, no mechanics in narration), **case goals**, and **model behavior**
  (target and weapon accuracy, narration probes, latency p50/p95, calls, repairs, tokens). Tiers: `engine`
  (monsters from `/spawn`, dice pinned by setup commits) and `full` (prose spawns, policy-driven
  fights). `--provider oracle` is a rule-based stand-in: it proves the harness with no server and
  gives a ceiling. Dice-dependent cases skip (not fail) when the situation did not occur. `--summary`
  plus `--compare` diff two models. Files: `eval/cases/*` (cases), `eval/lib/*` (driver, audit,
  policy, soft probes, report).

## Archetypes and spells (7B.2)

`src/archetypes.ts`: `ARCHETYPES`, `defaultSheet(archetype)`, `SORCERER_ALLOWLIST` (fire-bolt,
ray-of-frost, mage-hand, prestidigitation, burning-hands, magic-missile; no Sacred Flame or Cure
Wounds, which are tested with a test-only Cleric fixture in the system package). The Sorcerer is the
SRD Level 1 sheet: 8 HP, AC 12, CHA 16, dagger and light crossbow, two level 1 slots; Innate Sorcery is
deferred. `createCliSession` validates every spell id against the catalog. `/sheet` shows spell attack,
save DC, cantrips, prepared spells, and slots left. `/act A# [T#] [T#] [T#]` names up to three
targets (area spells, Magic Missile); `/undo` restores spent slots with the rest of the turn.

## Combat

`/status` shows `Combat: round N`, with a suspended note when the hero cannot act, and
`Status: DYING (successes S/3, failures F/3)` or `Status: DEAD`. While dying, any input rolls a death save.

## Test rules

- End-to-end tests use `createScriptedLlmClient` and the real D&D system.
- A Stealth check before an attack must not grant Invisible or Advantage.
- Keep files under about 300 lines. Eval files (everything under `eval/`) are exempt.
