import {
  createEngine,
  createInitialState,
  EngineError,
  type RuleSystem,
} from '@iron-scribe/engine-core';
import { createFakeSystem, makeEntity } from '@iron-scribe/engine-core/testing';
import { createScriptedLlmClient } from '@iron-scribe/llm';
import { describe, expect, it } from 'vitest';

import { advanceCombatUntilPlayer, MAX_COMBAT_STEPS } from './combat.js';
import { createOrchestrator } from './orchestrator.js';

const tick = { kind: 'check', actorId: 'hero', ability: 'dex', skill: null, dc: 10 } as const;

function setup(system: RuleSystem) {
  const engine = createEngine({ system, initialState: createInitialState({ seed: 'combat' }) });
  engine.commit('hero', [{ type: 'entity.spawned', entity: makeEntity('hero') }]);
  return engine;
}

describe('engine-run combat loop', () => {
  it('stops at MAX_COMBAT_STEPS and rolls the whole turn back', async () => {
    const system: RuleSystem = {
      ...createFakeSystem(),
      nextCombatStep: () => ({ kind: 'procedure', label: 'again', procedure: tick }),
    };
    const engine = setup(system);
    expect(() => advanceCombatUntilPlayer(engine, system, 'hero')).toThrow(/32 steps/);
    expect(MAX_COMBAT_STEPS).toBe(32);

    const orchestrator = createOrchestrator({
      engine,
      system,
      llm: createScriptedLlmClient([]),
      actorId: 'hero',
    });
    const before = engine.snapshot();
    const commitsBefore = engine.commits.length;
    await expect(orchestrator.runProcedureTurn('go', tick)).rejects.toBeInstanceOf(EngineError);
    expect(engine.commits).toHaveLength(commitsBefore);
    expect(engine.snapshot()).toEqual(before);
    expect(orchestrator.canUndoTurn).toBe(false);
  });

  it('an action step is always followed by the end of that turn', () => {
    let step = 0;
    const log: string[] = [];
    const system: RuleSystem = {
      ...createFakeSystem(),
      nextCombatStep: () =>
        step++ === 0
          ? { kind: 'action', request: { actorId: 'rat_1', actionAlias: 'A2', targetAlias: null } }
          : null,
      turnEnd: (_state, actorId) => {
        log.push(actorId);
        return tick;
      },
    };
    const engine = setup(system);
    engine.commit('rat', [{ type: 'entity.spawned', entity: makeEntity('rat_1') }]);
    const facts = advanceCombatUntilPlayer(engine, system, 'hero');
    expect(log).toEqual(['rat_1']);
    // The fake turn-end procedure (`check`) reports its fact too.
    expect(facts.map((fact) => fact.key)).toEqual(['wait', 'check']);
  });
});
