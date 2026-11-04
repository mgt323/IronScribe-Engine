# @iron-scribe/system-dnd5e-2024

## Purpose

D&D 5e 2024 rules plus SRD 5.2.1 data import (own schema). Implements
`RuleSystem`. Must not import `@iron-scribe/llm` or the orchestrator. Ship
required CC-BY-4.0 SRD attribution; no non-SRD Wizards content.

## Public interface

TBD in Stages 3–4.

## Test rules

- Write failing tests from SRD examples (checks, attacks, damage, conditions),
  then implement until they pass.
- Catalog lookups must not invent hit points or armor class.
- Keep files under about 300 lines.
