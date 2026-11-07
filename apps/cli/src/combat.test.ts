import { createScriptedLlmClient } from '@iron-scribe/llm';
import {
  loadCatalog,
  monsterToEntity,
  readEncounter,
  type EncounterState,
} from '@iron-scribe/system-dnd5e-2024';
import { describe, expect, it } from 'vitest';

import { createCliSession, defaultAdventurerSheet, formatSceneStatus } from './index.js';

const catalog = loadCatalog();

/** A tough hero and goblin, so dice never end the fight mid-test. */
function fight(order: string[]) {
  const session = createCliSession({
    seed: 'combat-order',
    character: { ...defaultAdventurerSheet(), hpMax: 200 },
    characterName: 'Nyx',
    llm: createScriptedLlmClient([{ text: 'Steel rings.' }, { text: 'Steel rings.' }]),
    catalog,
  });
  const engine = session.orchestrator.engine;
  const goblin = catalog.monsters.get('goblin-warrior');
  if (!goblin) throw new Error('missing goblin');
  const base = monsterToEntity(goblin, 'goblin_1');
  engine.commit('spawn', [
    {
      type: 'entity.spawned',
      entity: {
        ...base,
        hp: { current: 500, max: 500 },
        system: { ...base.system, attitude: 'hostile' },
      },
    },
    {
      type: 'state.systemDataSet',
      key: 'encounter',
      value: {
        round: 1,
        turnIndex: 0,
        acted: [],
        order: order.map((entityId) => ({ entityId, total: 10 })),
      } satisfies EncounterState as never,
    },
  ]);
  return { session, engine };
}

const attack = { actorId: 'hero', actionAlias: 'A1', targetAlias: 'T1' };

describe('combat turn order through the orchestrator', () => {
  it('an NPC ahead of the player attacks before the player does', async () => {
    const { session, engine } = fight(['goblin_1', 'hero']);
    const result = await session.orchestrator.runAction(attack);
    const keys = result.facts.map((fact) => fact.key);
    expect(keys.indexOf('npc_attack')).toBeGreaterThanOrEqual(0);
    expect(keys.indexOf('npc_attack')).toBeLessThan(keys.indexOf('attack'));
    expect(result.facts.find((f) => f.key === 'npc_attack')?.text).toMatch(
      /^Goblin Warrior \(Scimitar\): /,
    );
    // goblin, hero, next round, goblin again, then it is the hero's turn.
    expect(readEncounter(engine.state)).toMatchObject({
      round: 2,
      turnIndex: 1,
      acted: ['goblin_1'],
    });
  });

  it('the player acts first, then the NPC, then the round turns over', async () => {
    const { session, engine } = fight(['hero', 'goblin_1']);
    const result = await session.orchestrator.runAction(attack);
    const keys = result.facts.map((fact) => fact.key);
    expect(keys.indexOf('attack')).toBeLessThan(keys.indexOf('npc_attack'));
    expect(readEncounter(engine.state)).toMatchObject({ round: 2, turnIndex: 0, acted: [] });
    const status = formatSceneStatus(engine.state, 'hero', catalog, engine.menu('hero'));
    expect(status).toContain('Combat: round 2');
  });

  it('a reinforcement joins the order without moving the current turn', async () => {
    const { session, engine } = fight(['hero', 'goblin_1']);
    const result = await session.orchestrator.runSpawn({ query: 'wolf', count: 1 });
    expect(result.status).toBe('resolved');
    expect(engine.state.entities['wolf_1']?.proximity).toBe('engaged');
    const encounter = readEncounter(engine.state);
    const index = encounter?.order.findIndex((entry) => entry.entityId === 'wolf_1') ?? -1;
    expect(index).toBeGreaterThanOrEqual(0);
    expect(encounter?.order[encounter.turnIndex]?.entityId).toBe('hero');
    if (index < (encounter?.turnIndex ?? 0)) expect(encounter?.acted).toContain('wolf_1');
    else expect(encounter?.acted).not.toContain('wolf_1');
  });
});
