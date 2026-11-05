# @iron-scribe/llm

## Purpose

Providers for OpenAI-compatible local servers (llama.cpp, LM Studio, Ollama,
KoboldCpp) and a Gemini adapter. One interface; no game-package imports.
Forced JSON, flat schemas, one repair retry.

## Public interface

- `toFlatJsonSchema(name, zodSchema)` checks the flat-schema rule and strips `$schema`.
  Nullable fields may be `type: ["string", "null"]` or Zod 4's `anyOf` with `{ type: "null" }`.
- `createLlmClient(adapter)`:
  - `generateObject` validates JSON against the Zod schema. It strips `<think>` blocks,
    a stray `</think>`, and Harmony `<|channel|>final` text, then allows one repair retry.
  - `generateText` and `streamText` return narration with reasoning removed. No repair retry.
- `StructuredPrompt` is `{ prefix, scene }`. Adapters send `prefix` first so a prompt cache
  can reuse it. A JSON schema is appended to the latest user message, not the prefix.
- `createOpenAiCompatibleAdapter({ baseUrl, model?, apiKey?, schemaMode? })` talks to
  llama.cpp, LM Studio, Ollama, and KoboldCpp at `/v1/chat/completions`. Default
  `schemaMode` is `json_schema`; HTTP 400 or 422 retries once as `json_object`.
  `detectOpenAiModel(baseUrl)` reads the first id from `/v1/models`.
- `createGeminiAdapter({ apiKey, model?, baseUrl? })` calls `generateContent`. The prefix
  is `systemInstruction`. Object calls set `responseMimeType` and `responseJsonSchema`.
- `createScriptedLlmAdapter` / `createScriptedLlmClient` replay canned replies in tests.
- `runEvalSuite(client)` scores `DEFAULT_EVAL_CASES`: menu aliases, an empty target list,
  a spawn that must not invent hit points, a check that must use SRD ids (`dex`, `stealth`),
  and narration that must not contradict the resolved facts.

## CLI

Build first, then score the server that is loaded (one local model at a time):

```bash
pnpm --filter @iron-scribe/llm build
pnpm --filter @iron-scribe/llm eval -- --url http://127.0.0.1:5001
```

The process exits 0 when the server answers, including when the model misses cases.
It exits 1 when the server cannot be reached.

Advanced run (more cases, `--runs N`, per-category scores, streaming check, raw replies
saved with `--out file.jsonl`, `--json`, `--fail-under <pct>` exits 2):

```bash
node packages/llm/bin/eval-advanced.mjs --url http://127.0.0.1:5001 --runs 3 --out eval.jsonl
```

## Test rules

- Unit-test adapters with mocked HTTP; do not require a live model in CI.
- Schema fixtures must stay flat (enums, strings, booleans, integers,
  `additionalProperties: false`, every field required).
- Keep files under about 300 lines.
