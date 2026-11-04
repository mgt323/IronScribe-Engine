# @iron-scribe/llm

## Purpose

Providers for OpenAI-compatible local servers (llama.cpp, LM Studio, Ollama,
KoboldCpp) and a Gemini adapter. One interface; no game-package imports.
Forced JSON, flat schemas, one repair retry.

## Public interface

TBD in Stage 5.

## Test rules

- Unit-test adapters with mocked HTTP; do not require a live model in CI.
- Schema fixtures must stay flat (enums, strings, booleans, integers,
  `additionalProperties: false`, every field required).
- Keep files under about 300 lines.
