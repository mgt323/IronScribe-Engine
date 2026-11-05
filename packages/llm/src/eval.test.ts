import { describe, expect, it } from 'vitest';

import { DEFAULT_EVAL_CASES, runEvalSuite, type EvalCase } from './eval.js';
import { createScriptedLlmClient } from './testing/fake-client.js';

const ANSWERS = [
  { kind: 'action', actionAlias: 'A1', targetAlias: 'T1' },
  { kind: 'action', actionAlias: 'A2', targetAlias: 'T1' },
  { kind: 'action', actionAlias: 'A3', targetAlias: null },
  { kind: 'none', actionAlias: null, targetAlias: null },
  { query: 'goblin', count: 1, attitude: 'hostile' },
  { ability: 'dex', skill: 'stealth' },
];

function objectCase(id: string): Extract<EvalCase, { mode: 'object' }> {
  const found = DEFAULT_EVAL_CASES.find((entry) => entry.id === id);
  if (!found || found.mode !== 'object') throw new Error(`missing ${id}`);
  return found;
}

describe('eval suite', () => {
  it('scores a scripted model that answers every case', async () => {
    const steps = [
      ...ANSWERS.map((answer) => ({ text: JSON.stringify(answer) })),
      { text: 'The dagger deals 6 piercing and the goblin is at 4/10, still standing.' },
    ];
    const report = await runEvalSuite(createScriptedLlmClient(steps));
    expect(report.firstTryPasses).toBe(6);
    expect(report.repaired).toBe(0);
    expect(report.exhausted).toBe(0);
    expect(report.semanticMatches).toBe(7);
    expect(report.results).toHaveLength(7);
  });

  it('counts one repair without losing the semantic match', async () => {
    const steps = [
      { text: 'nope' },
      ...ANSWERS.map((answer) => ({ text: JSON.stringify(answer) })),
      { text: '6 piercing damage leaves the goblin at 4/10.' },
    ];
    const report = await runEvalSuite(createScriptedLlmClient(steps));
    expect(report.firstTryPasses).toBe(5);
    expect(report.repaired).toBe(1);
    expect(report.exhausted).toBe(0);
    expect(report.semanticMatches).toBe(7);
    expect(report.results[0]?.detail).toBe('repaired');
  });

  it('uses SRD ids and rejects display names or invented hit points', () => {
    const check = objectCase('check_intent').schema;
    expect(check.safeParse({ ability: 'Dexterity', skill: 'Stealth' }).success).toBe(false);
    expect(check.safeParse({ ability: 'dex', skill: 'sleight_of_hand' }).success).toBe(false);
    expect(check.safeParse({ ability: 'dex', skill: 'stealth' }).success).toBe(true);
    expect(check.safeParse({ ability: 'dex', skill: 'sleight-of-hand' }).success).toBe(true);
    expect(check.safeParse({ ability: 'dex', skill: null }).success).toBe(true);
    const spawn = objectCase('spawn_intent').schema;
    expect(spawn.safeParse({ query: 'goblin', count: 1, attitude: 'hostile', hp: 7 }).success).toBe(
      false,
    );
    const empty = objectCase('decision_empty_scene').schema;
    expect(empty.safeParse({ kind: 'none', actionAlias: null, targetAlias: 'T1' }).success).toBe(
      false,
    );
  });

  it('rejects narration that contradicts the resolved facts', async () => {
    const narration = DEFAULT_EVAL_CASES.find((entry) => entry.id === 'narration_facts');
    if (!narration) throw new Error('missing narration');
    const report = await runEvalSuite(
      createScriptedLlmClient([{ text: 'The goblin is killed outright.' }]),
      { cases: [narration] },
    );
    expect(report.results[0]?.schemaOk).toBe(true);
    expect(report.semanticMatches).toBe(0);
    expect(report.firstTryPasses).toBe(0);
  });
});
