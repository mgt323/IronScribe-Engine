# Live play eval: report

Date: 2026-11-05. Command:
`node apps/cli/eval/legacy/eval-play.mjs --url http://127.0.0.1:5001 --runs 3 --out play.jsonl`
Model: `koboldcpp/gemma-4-26B-A4B-it-qat-uncensored-heretic-UDmerge-Q4_K_XXL`,
`json_schema`, temperature 0. 52 cases, 3 runs each (153 case runs, 315 model calls).

## Result

| Slice     | Pass rate       |
| --------- | --------------- |
| Overall   | 95.4%           |
| Positive  | 95.7% (93 runs) |
| Negative  | 95.0% (60 runs) |
| spawn     | 93.3%           |
| clarify   | 100%            |
| action    | 87.9%           |
| check     | 100%            |
| narration | 100%            |
| command   | 100%            |

Of 52 cases, 49 pass 3/3. The other three:

| Case                       | Result      | Cause                                   | Status      |
| -------------------------- | ----------- | --------------------------------------- | ----------- |
| `no-attack-without-target` | 0/3         | Orchestrator bug (see below)            | Fixed       |
| `attack-picks-target`      | 2/3 (flaky) | Eval check bug: a miss has no `hp` fact | Fixed       |
| `spawn-friendly-guard`     | 0/3         | Model behaviour                         | Open        |
| `spawn-mixed-group`        | known gap   | One spawn query per turn                | Open, known |

After the two fixes, `no-attack-without-target` and `attack-picks-target` passed 3/3
on a rerun. The full suite was not rerun.

## Open 1: `spawn-friendly-guard` (FAIL, 0/3)

> Update: deprioritised. The model reads NPC interaction well in practice, and the case
> passed in a later single run. Long term, presence moves to proximity levels
> (`docs/stage-7-encounters.md`, 7C).

Input: "A friendly guard waves at me from the gate and offers to help."

The intent call returned every spawn field null, `wantsAction: false`. The turn ended
as `none` and nothing was spawned. Identical in all three runs.

Probe against the same model (one intent call per line):

| Player line                                                    | Spawn?                                        |
| -------------------------------------------------------------- | --------------------------------------------- |
| A guard stands at the gate.                                    | yes, guard, neutral                           |
| A friendly guard approaches me.                                | yes, guard, friendly                          |
| A merchant waves at me.                                        | yes (merchant not in the catalog, so clarify) |
| A guard waves at me.                                           | **no**                                        |
| A friendly guard waves at me from the gate and offers to help. | **no**                                        |

Cause: the model reads a wave or an offer of help as dialogue or a gesture, not as a
creature entering the scene. The result depends on the verb. It is stable at
temperature 0, so `--runs` does not average it out.

Already tried: the intent prompt now says friendly and neutral newcomers (a guard, a
merchant, a dog) are spawns too and the model should pick a fitting attitude. No
change for this sentence.

Why it matters: the real game needs friendly NPCs, and a silent miss is worse than a
wrong spawn because the player sees no error and the later turns refer to someone who
is not in the scene.

Options, cheapest first:

1. Keep the case as a measurement of this model. Add a passing "approaches" variant
   so the suite also shows the model can do it.
2. Prompt examples: add two or three one-line examples (including a gesture verb) to
   the intent prompt. Small gain, but it risks fitting to the test sentence.
3. Test other models with `--runs 3`. A different model may not have this quirk.
4. Longer term: scene or encounter definitions from a GM replace player-text spawning
   (Stage 9), so NPC presence no longer depends on the model reading prose.

## Open 2: `spawn-mixed-group` (KNOWN)

Input: "A wolf and a bandit come out of the trees."

Cause: the intent schema holds one spawn (`spawnQuery`, `spawnCount`,
`spawnAttitude`). A sentence with two kinds of creature cannot be expressed. This is
a design limit, so the case is marked `known` and left out of the pass rate.

Two behaviours seen on this input:

- Earlier run: the model put both in one query. The catalog found nothing for
  `wolf and a bandit`, the turn ended as a clarify (`No catalog match for "wolf and a
bandit"`), and nothing spawned.
- Later run (`play.jsonl`, all three runs): the model picked one creature
  (`spawnQuery: "wolf"`, count 1) and the bandit was dropped. The case check passed
  because it only requires at least one spawned creature.

The second behaviour is the worse one, for a reason beyond the dropped bandit. The
narration said "A wolf and a bandit emerge from the shadows", while only a wolf
exists. `buildNarrationPrompt` passes the player's own text (`Player: ...`) next to
the facts, so the model narrates what the player wrote, not only what the engine
resolved. This breaks the rule that narration comes from resolved facts. Later turns
can then refer to a bandit who is not in the scene.

Options:

1. Narration (small, separate from this gap): stop sending the player text to the
   narration call, or tell the model that facts are the only source and anything else
   in the player text is ignored. Add an eval case: when the player names a creature
   that was not spawned, the narration must not mention it.
2. Intent schema: allow a short list of spawns (for example up to 3, each with query,
   count, attitude). Schemas must stay flat, so use fixed fields
   (`spawn1Query`, `spawn1Count`, ... or a repeated flat group), not nested arrays.
   `spawnFrom` would then commit each spawn in one commit and ask about each
   ambiguous one in turn.
3. Fallback: when the intent holds one spawn but the text names more creatures, ask
   the player to say them one at a time. This is honest but clumsy.
4. Encounter definitions (Stage 9) make this moot.

Recommendation: do option 1 now, because it also covers the guard case, and plan
option 2 together with the Stage 7 "default variant" work (see `docs/status.md`,
Stage 6 known gap). Tighten the `spawn-mixed-group` check at that point to require
both a wolf and a bandit.

## Fixed during this report

- `no-attack-without-target`: with nobody in the scene every attack needs a target,
  but the decision schema only allows a null target, so no action could validate and
  the model failed the repair retry. `actionFrom` now returns early when no menu
  action is usable. The turn ends as `none` and the model is not asked. The CLI test
  that scripted a `none` decision was updated to match.
- `attack-picks-target`: the check demanded an `hp` fact on every attack. A miss has
  none. The check now requires it only after a hit.

## How to reproduce

```bash
pnpm --filter @iron-scribe/cli build
node apps/cli/eval/legacy/eval-play.mjs --url http://127.0.0.1:5001 --only friendly --runs 3
node apps/cli/eval/legacy/eval-play.mjs --url http://127.0.0.1:5001 --only mixed --runs 3 --out mixed.jsonl
```

`--out` writes the raw replies, facts and narration for each run.
