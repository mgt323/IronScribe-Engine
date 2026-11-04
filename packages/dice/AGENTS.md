# @iron-scribe/dice

## Purpose

Dice formulas, advantage/disadvantage, and seeded RNG. Leaf package: no
workspace dependencies. The rules engine is the only caller that rolls.

## Public interface

Callers must inject an `Rng`. Nothing in this package uses `Math.random`.

- `createRng(seed)`, `restoreRng(state)`, `createScriptedRng(values)` — RNG
- `parseFormula(text)`, `formatFormula(ast)`, `DiceFormulaError`
- `roll(formula, rng, options?)` — formula roll with breakdown; `{ critical: true }`
  doubles each dice term and leaves constants alone
- `resolveRollMode({ advantage, disadvantage })`, `rollD20(rng, { mode, modifier })`

## Test rules

- Prefer seeded tests so rolls are deterministic.
- Cover formula parsing, advantage/disadvantage, and seed reproducibility.
- Use `createScriptedRng` when a test needs an exact die face.
- Keep files under about 300 lines.
