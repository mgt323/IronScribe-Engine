# Iron Scribe

Open-source AI game master for solo play. A deterministic rules engine owns
game state; a language model only picks legal actions or narrates resolved
facts. It never rolls dice, never sets hit points, and never writes the
database.

**Primary ruleset:** Dungeons & Dragons 5e 2024, using SRD 5.2.1 (CC-BY-4.0).
Version 1 is theater-of-the-mind and single player.

## Status

Stages 0-6 (tooling, dice, engine-core, SRD import, D&D rules, LLM providers, CLI play) are done, including the full SRD 5.2.1 data set (Stage 3b). See [docs/status.md](docs/status.md).

## License

Application code is licensed under the [Apache License 2.0](LICENSE).
See [NOTICE](NOTICE) for third-party attribution (SRD and others).

This project is **not affiliated with, endorsed by, or sponsored by**
Wizards of the Coast LLC. Dungeons & Dragons and related marks are
trademarks of Wizards of the Coast LLC.

## Requirements

- Node.js 22+ (see `.nvmrc`)
- pnpm 10 (via Corepack)

## Development

```bash
pnpm install
pnpm check
```

### Dice CLI

```bash
pnpm --filter @iron-scribe/dice build
pnpm roll -- 2d6+3
pnpm roll -- d20 --adv -m 5 --seed 42
```

### Play

Build first. A local OpenAI-compatible server needs no API key. Gemini needs
`GEMINI_API_KEY`, `GOOGLE_API_KEY`, or `--api-key` (the key is never printed
or written into `/save`).

```bash
pnpm --filter @iron-scribe/cli build
pnpm play -- --url http://127.0.0.1:5001
```

You confirm a Level 1 Rogue, then type. `/help` lists `/status`, `/sheet`,
`/act`, `/spawn`, `/init`, `/undo`, `/redo`, `/log`, and `/save`.

### LLM eval

Build first. The default server is `http://127.0.0.1:5001`.

```bash
pnpm --filter @iron-scribe/llm build
pnpm --filter @iron-scribe/llm eval -- --url http://127.0.0.1:5001
```
