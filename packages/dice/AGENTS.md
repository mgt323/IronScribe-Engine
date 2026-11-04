# @iron-scribe/dice

## Purpose

Dice formulas, advantage/disadvantage, and seeded RNG. Leaf package: no
workspace dependencies. The rules engine is the only caller that rolls.

## Public interface

TBD in Stage 1.

## Test rules

- Prefer seeded tests so rolls are deterministic.
- Cover formula parsing, advantage/disadvantage, and seed reproducibility.
- Keep files under about 300 lines.
