# @iron-scribe/cli

## Purpose

Single-player theater-of-the-mind REPL. Free text and slash commands go through
`@iron-scribe/orchestrator`, which is the only caller of the engine. The
player is one Level 1 Rogue (`defaultAdventurerSheet`). The model may suggest
a name and a backstory. It does not draft scores, hit points, or gear.

## Public interface

- `createCliSession({ seed, character, characterName, backstory?, llm, catalog })`
  spawns the hero before the orchestrator exists, so `/undo` cannot remove them
- `handleCliLine(session, line, writer)` — `/status`, `/sheet`, `/act`, `/spawn`,
  `/init`, `/undo`, `/redo`, `/log`, `/save`, `/help`, `/quit`. Read-only
  commands do not touch undo or redo
- `/save` writes seed, actor id, name, backstory, state, commits, and logs.
  It never writes an API key
- `bin/play.mjs` (`pnpm play`) reads `--api-key` or `GEMINI_API_KEY` /
  `GOOGLE_API_KEY` / `OPENAI_API_KEY` and passes the key only to the adapter

- `bin/eval-play.mjs` is a live eval (not run in CI): 52 cases against a real
  model and the real D&D rules, in six categories (spawn, clarify, action, check,
  narration, command), positive and negative. Cases live in `eval-play-*cases.mjs`.
  Flags: `--only`, `--kind`, `--runs`, `--seed`, `--out`, `--json`, `--list`,
  `--fail-under` (exit 2). A case with `known:` is a documented gap and is left
  out of the pass rate.

  ```bash
  pnpm --filter @iron-scribe/cli build
  node apps/cli/bin/eval-play.mjs --url http://127.0.0.1:5001 --runs 3 --out play.jsonl
  ```

## Test rules

- End-to-end tests use `createScriptedLlmClient` and the real D&D system.
- A Stealth check before an attack must not grant Invisible or Advantage.
- Keep files under about 300 lines.
