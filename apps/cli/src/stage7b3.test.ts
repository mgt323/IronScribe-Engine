import { createScriptedRng } from '@iron-scribe/dice';
import {
  createEngine,
  createInitialState,
  type CoreEvent,
  type Entity,
  type RuleSystem,
} from '@iron-scribe/engine-core';
import { createScriptedLlmClient } from '@iron-scribe/llm';
import { createOrchestrator } from '@iron-scribe/orchestrator';
import {
  characterToEntity,
  createDnd5eSystem,
  loadCatalog,
  monsterToEntity,
  readEncounter,
} from '@iron-scribe/system-dnd5e-2024';
import { describe, expect, it } from 'vitest';

import { defaultAdventurerSheet } from './index.js';

const catalog = loadCatalog();
const base = createDnd5eSystem({ catalog });

/** A 200 HP hero and a hostile monster that acts first. Every die after the script is a 1. */
function setup(monsterId: string, system: Record<string, unknown>, hp: number, dice: number[]) {
  const rng = createScriptedRng([...dice, ...Array<number>(60).fill(1)]);
  const scripted: RuleSystem = {
    ...base,
    resolve: (state, request) => base.resolve(state, request, rng),
    runProcedure: (state, procedure) => {
      if (!base.runProcedure) throw new Error('no procedure handler');
      return base.runProcedure(state, procedure, rng);
    },
  };
  const engine = createEngine({
    system: scripted,
    initialState: createInitialState({ seed: 'b3' }),
  });
  const hero = characterToEntity({ ...defaultAdventurerSheet(), hpMax: 200 }, 'hero', {
    name: 'Nyx',
  });
  const template = catalog.monsters.get(monsterId);
  if (!template) throw new Error(`missing ${monsterId}`);
  const monster = monsterToEntity(template, 'mon');
  const entity: Entity = {
    ...monster,
    hp: { current: hp, max: template.hp },
    system: { ...monster.system, attitude: 'hostile', ...system },
  };
  const events: CoreEvent[] = [
    { type: 'entity.spawned', entity: hero },
    { type: 'entity.spawned', entity },
    {
      type: 'state.systemDataSet',
      key: 'encounter',
      value: {
        round: 1,
        turnIndex: 0,
        acted: [],
        order: ['mon', 'hero'].map((entityId) => ({ entityId, total: 10 })),
      },
    },
  ];
  engine.commit('setup', events);
  const llm = createScriptedLlmClient([{ text: 'The scene.' }]);
  return {
    engine,
    orchestrator: createOrchestrator({ engine, system: scripted, llm, actorId: 'hero' }),
  };
}

const act = { actorId: 'hero', actionAlias: 'A1', targetAlias: 'T1' };

describe('one undo and one redo span the whole turn', () => {
  it('a dragon recharge roll, its Multiattack, and the hero action', async () => {
    const { engine, orchestrator } = setup(
      'adult-red-dragon',
      { usage: { expended: ['fire-breath'], counts: {} } },
      256,
      [5],
    );
    const before = engine.state;
    const result = await orchestrator.runAction(act);
    expect(result.facts.find((f) => f.key === 'recharge')?.text).toContain(
      'd6=5 (needs 5+): recharged',
    );
    expect(result.facts.filter((f) => f.key === 'npc_attack')).toHaveLength(6); // three Rends before the hero, three after
    expect(engine.state.entities['mon']?.system['usage']).toEqual({ expended: [], counts: {} });
    const after = engine.state;
    orchestrator.undoTurn();
    expect(engine.state).toEqual(before);
    expect(readEncounter(engine.state)?.recharged).toBeUndefined();
    orchestrator.redoTurn();
    expect(engine.state).toEqual(after);
  });

  it('a Hydra that lost a head regrows two, with its HP, at the end of its turn', async () => {
    const lost = {
      heads: 4,
      damageThisTurn: 0,
      headsLostSinceLastTurn: 1,
      fireDamageSinceLastTurn: false,
    };
    const { engine, orchestrator } = setup('hydra', { hydra: lost }, 100, []);
    const before = engine.state;
    const result = await orchestrator.runAction(act);
    expect(result.facts.filter((f) => f.key === 'npc_attack')).toHaveLength(10); // four Bites before the hero, six after the regrowth
    expect(result.facts).toContainEqual({
      key: 'hydra',
      text: 'Hydra grows 2 heads and regains 20 HP',
    });
    expect(engine.state.entities['mon']?.hp.current).toBe(120);
    expect(engine.state.entities['mon']?.system['hydra']).toMatchObject({ heads: 6 });
    const after = engine.state;
    orchestrator.undoTurn();
    expect(engine.state).toEqual(before);
    orchestrator.redoTurn();
    expect(engine.state).toEqual(after);
  });
});
