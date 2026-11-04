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

## CLI

Build first, then roll from the repo root:

```bash
pnpm --filter @iron-scribe/dice build
pnpm roll -- 2d6+3
pnpm roll -- d20 --adv -m 5 --seed 42
pnpm roll -- 1d8+2 --crit
```

## Test rules

- Prefer seeded tests so rolls are deterministic.
- Cover formula parsing, advantage/disadvantage, and seed reproducibility.
- Use `createScriptedRng` when a test needs an exact die face.
- Keep files under about 300 lines.
