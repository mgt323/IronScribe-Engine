import { createEngine, createInitialState, EngineError } from '@iron-scribe/engine-core';
import { createFakeSystem, makeEntity } from '@iron-scribe/engine-core/testing';
import { LlmError, createScriptedLlmClient, type LlmClient } from '@iron-scribe/llm';
import { describe, expect, it } from 'vitest';

import { createOrchestrator } from './orchestrator.js';

const intent = (value: Record<string, unknown>) => JSON.stringify(value);
const idle = {
  spawnIsNew: true,
  spawnQuery: null,
  spawnCount: null,
  spawnAttitude: null,
  checkAbility: null,
  checkSkill: null,
  wantsAction: false,
};

function scene(steps: Parameters<typeof createScriptedLlmClient>[0]) {
  const system = createFakeSystem();
  const engine = createEngine({ system, initialState: createInitialState({ seed: 'stage6' }) });
  engine.commit('hero', [{ type: 'entity.spawned', entity: makeEntity('hero') }]);
  const llm = createScriptedLlmClient(steps);
  const orchestrator = createOrchestrator({ engine, system, llm, actorId: 'hero' });
  return { engine, orchestrator };
}

function failingStream(client: LlmClient, after: number): LlmClient {
  return {
    generateObject: (request) => client.generateObject(request),
    generateText: (request) => client.generateText(request),
    async *streamText(request) {
      let seen = 0;
      for await (const chunk of client.streamText(request)) {
        yield chunk;
        seen += 1;
        if (seen >= after) throw new Error('timeout');
      }
    },
  };
}

describe('turn history', () => {
  it('undoes a spawn, a check, and an attack as one snapshot', async () => {
    const { engine, orchestrator } = scene([
      {
        text: intent({
          ...idle,
          spawnQuery: 'rat',
          spawnCount: 1,
          spawnAttitude: 'hostile',
          checkAbility: 'dex',
          checkSkill: 'stealth',
          wantsAction: true,
        }),
      },
      { text: intent({ kind: 'action', actionAlias: 'A1', targetAlias: 'T1' }) },
      { chunks: ['The rat', ' falls.'] },
    ]);
    const before = engine.state.rng;
    const chunks: string[] = [];
    const result = await orchestrator.runTurn('I sneak up and poke the rat.', {
      onNarrationChunk: (chunk) => chunks.push(chunk),
    });
    expect(result.status).toBe('resolved');
    expect(result.commits).toHaveLength(3);
    expect(result.facts.map((fact) => fact.key)).toEqual(['spawn', 'check', 'poke']);
    expect(chunks.join('')).toBe('The rat falls.');
    expect(engine.state.entities['rat_1']).toBeTruthy();
    orchestrator.undoTurn();
    expect(engine.state.entities['rat_1']).toBeUndefined();
    expect(engine.state.rng).toEqual(before);
    expect(orchestrator.canUndoTurn).toBe(false);
    expect(orchestrator.canRedoTurn).toBe(true);
    orchestrator.redoTurn();
    expect(engine.state.entities['rat_1']?.hp.current).toBeLessThan(10);
    expect(engine.state.rng).toEqual(result.logEntry.rngAfter);
  });

  it('restores a failed decision without leaving the spawn on redo', async () => {
    const { engine, orchestrator } = scene([
      {
        text: intent({
          ...idle,
          spawnQuery: 'rat',
          spawnCount: 1,
          spawnAttitude: 'hostile',
          wantsAction: true,
        }),
      },
      { text: intent({ kind: 'action', actionAlias: null, targetAlias: null }) },
      { text: intent({ kind: 'action', actionAlias: null, targetAlias: null }) },
    ]);
    const before = engine.snapshot();
    await expect(orchestrator.runTurn('A rat appears and I poke it.')).rejects.toBeInstanceOf(
      LlmError,
    );
    expect(engine.commits).toEqual(before.commits);
    expect(engine.canRedo).toBe(false);
    expect(orchestrator.canUndoTurn).toBe(false);
    expect(engine.state.entities['rat_1']).toBeUndefined();
  });

  it('keeps an interrupted narration and the committed mechanics', async () => {
    const system = createFakeSystem();
    const engine = createEngine({ system, initialState: createInitialState({ seed: 'narr' }) });
    engine.commit('hero', [{ type: 'entity.spawned', entity: makeEntity('hero') }]);
    const orchestrator = createOrchestrator({
      engine,
      system,
      llm: failingStream(
        createScriptedLlmClient([
          { text: intent({ ...idle, wantsAction: true }) },
          { text: intent({ kind: 'action', actionAlias: 'A2', targetAlias: null }) },
          { chunks: ['The hero', ' waits.'] },
        ]),
        1,
      ),
      actorId: 'hero',
    });
    const chunks: string[] = [];
    const result = await orchestrator.runTurn('I wait.', {
      onNarrationChunk: (chunk) => chunks.push(chunk),
    });
    expect(result.status).toBe('resolved');
    expect(chunks).toEqual(['The hero']);
    expect(result.narration).toBe('The hero');
    expect(result.narrationError).toBe('timeout');
    expect(result.commits).toHaveLength(1);
    expect(orchestrator.canUndoTurn).toBe(true);
    expect(engine.commits.some((commit) => commit.label === 'Wait')).toBe(true);
  });

  it('does not record a clarification or a refusal on the undo stack', async () => {
    const { engine, orchestrator } = scene([
      { text: intent({ ...idle, wantsAction: true }) },
      { text: intent({ kind: 'action', actionAlias: 'A2', targetAlias: null }) },
      { text: 'Waited.' },
      { text: intent({ ...idle, spawnQuery: 'goblin', spawnCount: 1, spawnAttitude: 'hostile' }) },
      { text: intent({ ...idle, wantsAction: true }) },
      { text: intent({ kind: 'none', actionAlias: null, targetAlias: null }) },
    ]);
    await orchestrator.runTurn('I wait.');
    orchestrator.undoTurn();
    expect(orchestrator.canRedoTurn).toBe(true);
    const clarify = await orchestrator.runTurn('A goblin steps out.');
    expect(clarify.status).toBe('clarify');
    expect(clarify.clarification?.reason).toBe('ambiguous_spawn');
    expect(orchestrator.canUndoTurn).toBe(false);
    expect(orchestrator.canRedoTurn).toBe(true);
    const none = await orchestrator.runTurn('I stab the goblin.');
    expect(none.status).toBe('none');
    expect(orchestrator.canRedoTurn).toBe(true);
    expect(engine.canRedo).toBe(false);
  });

  it('keeps the spawn count when the player answers a clarification', async () => {
    const { engine, orchestrator } = scene([
      { text: intent({ ...idle, spawnQuery: 'goblin', spawnCount: 2, spawnAttitude: 'hostile' }) },
      { text: 'Two of them.' },
    ]);
    const asked = await orchestrator.runTurn('Two goblins in front of me.');
    expect(asked.status).toBe('clarify');
    const answered = await orchestrator.runTurn('Rat');
    expect(answered.status).toBe('resolved');
    expect(engine.state.entities['rat_1']).toBeTruthy();
    expect(engine.state.entities['rat_2']).toBeTruthy();
  });

  it('ignores a spawn query that is an id already in the scene', async () => {
    const { engine, orchestrator } = scene([
      { text: intent({ ...idle, spawnQuery: 'hero', spawnCount: 1, spawnAttitude: 'hostile' }) },
    ]);
    const result = await orchestrator.runTurn('I look at myself.');
    expect(result.status).toBe('none');
    expect(Object.keys(engine.state.entities)).toEqual(['hero']);
  });

  it('ignores a spawn when the player refers to someone already present', async () => {
    const { engine, orchestrator } = scene([
      { text: intent({ ...idle, spawnQuery: 'rat', spawnCount: 1, spawnAttitude: 'hostile' }) },
      { text: 'A rat.' },
      {
        text: intent({
          ...idle,
          spawnIsNew: false,
          spawnQuery: 'rat',
          spawnCount: 1,
          spawnAttitude: 'hostile',
        }),
      },
    ]);
    await orchestrator.runTurn('A rat scurries in.');
    const again = await orchestrator.runTurn('I stalk the rat.');
    expect(again.status).toBe('none');
    expect(Object.keys(engine.state.entities)).toEqual(['hero', 'rat_1']);
  });

  it('drops a bare ability check beside an action', async () => {
    const { orchestrator } = scene([
      { text: intent({ ...idle, checkAbility: 'dex', wantsAction: true }) },
      { text: intent({ kind: 'action', actionAlias: 'A2', targetAlias: null }) },
      { text: 'Waited.' },
    ]);
    const result = await orchestrator.runTurn('I wait again.');
    expect(result.facts.map((fact) => fact.key)).not.toContain('check');
  });

  it('a new resolved turn clears redo, and direct commands share that history', async () => {
    const { engine, orchestrator } = scene([
      { text: 'Noted.' },
      { text: 'Healed.' },
      { text: 'Done.' },
    ]);
    await orchestrator.runSpawn({ query: 'rat', count: 1, attitude: 'hostile' });
    orchestrator.undoTurn();
    expect(orchestrator.canRedoTurn).toBe(true);
    await orchestrator.runProcedureTurn('check', {
      kind: 'check',
      actorId: 'hero',
      ability: 'dex',
      skill: 'stealth',
      dc: 12,
    });
    expect(orchestrator.canRedoTurn).toBe(false);
    expect(engine.state.entities['rat_1']).toBeUndefined();
    const action = await orchestrator.runAction({
      actorId: 'hero',
      actionAlias: 'A2',
      targetAlias: null,
    });
    expect(action.status).toBe('resolved');
    orchestrator.undoTurn();
    orchestrator.undoTurn();
    expect(engine.commits).toHaveLength(1);
    expect(() => orchestrator.undoTurn()).toThrow(EngineError);
  });
});
