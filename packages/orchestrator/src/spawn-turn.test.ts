import {
  createEngine,
  createInitialState,
  EngineError,
  type GameState,
  type RuleSystem,
  type SpawnRequest,
  type SpawnResolution,
} from '@iron-scribe/engine-core';
import { createFakeSystem, makeEntity } from '@iron-scribe/engine-core/testing';
import { createScriptedLlmClient } from '@iron-scribe/llm';
import { describe, expect, it } from 'vitest';

import { matchCandidate } from './helpers.js';
import { createOrchestrator } from './orchestrator.js';
import { filledSlots } from './spawn-turn.js';
import type { TurnIntent } from './schemas.js';

const empty = {
  spawn1Query: null,
  spawn1Count: null,
  spawn1Attitude: null,
  spawn2Query: null,
  spawn2Count: null,
  spawn2Attitude: null,
  spawn3Query: null,
  spawn3Count: null,
  spawn3Attitude: null,
  checkAbility: null,
  checkSkill: null,
  wantsAction: false,
} as const;

function intent(value: Partial<TurnIntent> & Pick<TurnIntent, 'spawnIsNew'>): string {
  return JSON.stringify({ ...empty, ...value });
}

const REDS = [
  { id: 'adult-red-dragon', name: 'Adult Red Dragon' },
  { id: 'ancient-red-dragon', name: 'Ancient Red Dragon' },
  { id: 'red-dragon-wyrmling', name: 'Red Dragon Wyrmling' },
  { id: 'young-red-dragon', name: 'Young Red Dragon' },
];

const GOBLINS = [
  { id: 'goblin-minion', name: 'Goblin Minion' },
  { id: 'goblin-warrior', name: 'Goblin Warrior' },
  { id: 'rat', name: 'Rat' },
];

function named(
  state: GameState,
  request: SpawnRequest,
  idBase: string,
  name: string,
): SpawnResolution {
  const taken = new Set(Object.keys(state.entities));
  const entities = [];
  for (let i = 0; i < request.count; i += 1) {
    let n = 1;
    while (taken.has(`${idBase}_${String(n)}`)) n += 1;
    const id = `${idBase}_${String(n)}`;
    taken.add(id);
    entities.push(
      makeEntity(id, {
        name,
        templateRef: idBase,
        system: { attitude: request.attitude ?? 'hostile' },
      }),
    );
  }
  return {
    status: 'matched',
    entities,
    facts: entities.map((entity) => ({ key: 'spawn', text: `${entity.id} (${entity.name})` })),
  };
}

function mixedSystem(): RuleSystem {
  const base = createFakeSystem();
  const single: Record<string, string> = {
    wolf: 'Wolf',
    bandit: 'Bandit',
    'bandit-captain': 'Bandit Captain',
    ogre: 'Ogre',
    'ogre-zombie': 'Ogre Zombie',
  };
  return {
    ...base,
    resolveSpawn(state, request) {
      const query = request.query.trim().toLowerCase();
      if (query === 'bandit') {
        return {
          status: 'ambiguous',
          query: request.query,
          candidates: [
            { id: 'bandit', name: 'Bandit' },
            { id: 'bandit-captain', name: 'Bandit Captain' },
          ],
        };
      }
      if (query === 'ogres') {
        return {
          status: 'ambiguous',
          query: request.query,
          candidates: [
            { id: 'ogre', name: 'Ogre' },
            { id: 'ogre-zombie', name: 'Ogre Zombie' },
          ],
        };
      }
      const name = single[query];
      if (name) return named(state, request, query.replaceAll('-', '_'), name);
      return base.resolveSpawn?.(state, request) ?? { status: 'not_found', query: request.query };
    },
  };
}

function play(system: RuleSystem, steps: Parameters<typeof createScriptedLlmClient>[0]) {
  const engine = createEngine({ system, initialState: createInitialState({ seed: 'slots' }) });
  engine.commit('hero', [{ type: 'entity.spawned', entity: makeEntity('hero') }]);
  const orchestrator = createOrchestrator({
    engine,
    system,
    llm: createScriptedLlmClient(steps),
    actorId: 'hero',
  });
  return { engine, orchestrator };
}

describe('candidate replies', () => {
  it('takes an exact name, an id, or the one candidate the tokens fit', () => {
    expect(matchCandidate(REDS, 'The young red dragon.')?.id).toBe('young-red-dragon');
    expect(matchCandidate(REDS, 'young-red-dragon')?.id).toBe('young-red-dragon');
    expect(matchCandidate(REDS, 'young red')?.id).toBe('young-red-dragon');
    expect(matchCandidate(REDS, 'wyrmling')?.id).toBe('red-dragon-wyrmling');
    expect(matchCandidate(REDS, 'red')).toBeNull();
    expect(matchCandidate(REDS, 'red dragon')).toBeNull();
    expect(matchCandidate(GOBLINS, 'warrior')?.id).toBe('goblin-warrior');
    expect(matchCandidate(GOBLINS, 'The Goblin Warrior!')?.id).toBe('goblin-warrior');
    expect(matchCandidate(GOBLINS, 'goblin')).toBeNull();
    expect(matchCandidate(GOBLINS, 'the rat')?.id).toBe('rat');
  });
});

describe('mixed-group spawns', () => {
  it('rejects a turn total above 10', () => {
    const over = {
      spawnIsNew: true,
      ...empty,
      spawn1Query: 'rat',
      spawn1Count: 6,
      spawn1Attitude: 'hostile' as const,
      spawn2Query: 'rat',
      spawn2Count: 5,
      spawn2Attitude: 'hostile' as const,
    };
    expect(() => filledSlots(over)).toThrow(EngineError);
  });

  it('spawns two kinds in one commit, numbering a repeated template', async () => {
    const { engine, orchestrator } = play(createFakeSystem(), [
      {
        text: intent({
          spawnIsNew: true,
          spawn1Query: 'rat',
          spawn1Count: 1,
          spawn1Attitude: 'hostile',
          spawn2Query: 'rat',
          spawn2Count: 2,
          spawn2Attitude: 'friendly',
        }),
      },
      { text: 'Rats.' },
    ]);
    const result = await orchestrator.runTurn('Three rats, two of them tame.');
    expect(result.status).toBe('resolved');
    expect(result.commits).toHaveLength(1);
    expect(result.facts.map((fact) => fact.text)).toEqual([
      'rat_1 (Rat)',
      'rat_2 (Rat)',
      'rat_3 (Rat)',
    ]);
    expect(engine.state.entities['rat_2']?.system['attitude']).toBe('friendly');
    expect(engine.state.entities['rat_1']?.system['attitude']).toBe('hostile');
  });

  it('asks one slot at a time and commits every matched creature together', async () => {
    const { engine, orchestrator } = play(mixedSystem(), [
      {
        text: intent({
          spawnIsNew: true,
          spawn1Query: 'wolf',
          spawn1Count: 1,
          spawn1Attitude: 'hostile',
          spawn2Query: 'bandit',
          spawn2Count: 1,
          spawn2Attitude: 'hostile',
          spawn3Query: 'ogres',
          spawn3Count: 1,
          spawn3Attitude: 'neutral',
        }),
      },
      { text: 'They arrive.' },
    ]);
    const said = 'A wolf, a bandit and an ogre step out.';
    const first = await orchestrator.runTurn(said);
    expect(first.status).toBe('clarify');
    expect(first.clarification?.query).toBe('bandit');
    expect(engine.state.entities['wolf_1']).toBeUndefined();
    const second = await orchestrator.runTurn('captain');
    expect(second.status).toBe('clarify');
    expect(second.clarification?.query).toBe('ogres');
    expect(second.logEntry.prompts).toEqual([]);
    expect(engine.commits).toHaveLength(1);
    const third = await orchestrator.runTurn('Ogre');
    expect(third.status).toBe('resolved');
    expect(third.commits).toHaveLength(1);
    expect(third.logEntry.input).toBe(said);
    expect(third.logEntry.prompts[0]?.scene).toContain(said);
    expect(engine.state.entities['wolf_1']?.name).toBe('Wolf');
    expect(engine.state.entities['bandit_captain_1']?.name).toBe('Bandit Captain');
    expect(engine.state.entities['ogre_1']?.system['attitude']).toBe('neutral');
  });

  it('resumes the stored action after the last slot matches, without a new intent call', async () => {
    const { engine, orchestrator } = play(createFakeSystem(), [
      {
        text: intent({
          spawnIsNew: true,
          spawn1Query: 'goblin',
          spawn1Count: 2,
          spawn1Attitude: 'hostile',
          wantsAction: true,
        }),
      },
      {
        text: JSON.stringify({
          kind: 'action',
          actionAlias: 'A2',
          targetAlias: null,
          secondaryTargetAlias: null,
          tertiaryTargetAlias: null,
        }),
      },
      { text: 'Waited.' },
    ]);
    const said = 'Two goblins arrive and I wait.';
    const asked = await orchestrator.runTurn(said);
    expect(asked.status).toBe('clarify');
    const answered = await orchestrator.runTurn('the rat');
    expect(answered.status).toBe('resolved');
    expect(answered.logEntry.prompts[0]?.scene.startsWith('Actions:')).toBe(true);
    expect(answered.logEntry.prompts.some((prompt) => prompt.scene.startsWith('Actor:'))).toBe(
      false,
    );
    expect(answered.logEntry.input).toBe(said);
    expect(engine.state.entities['rat_1']).toBeTruthy();
    expect(engine.state.entities['rat_2']).toBeTruthy();
    expect(answered.facts.map((fact) => fact.key)).toEqual(['spawn', 'spawn', 'wait']);
  });

  it('does not guess when the reply fits more than one candidate', async () => {
    const { engine, orchestrator } = play(createFakeSystem(), [
      {
        text: intent({
          spawnIsNew: true,
          spawn1Query: 'goblin',
          spawn1Count: 2,
          spawn1Attitude: 'hostile',
        }),
      },
      { text: intent({ spawnIsNew: false }) },
    ]);
    const asked = await orchestrator.runTurn('Two goblins.');
    expect(asked.status).toBe('clarify');
    const again = await orchestrator.runTurn('goblin');
    expect(again.status).toBe('none');
    expect(engine.state.entities['rat_1']).toBeUndefined();
  });
});
