import { createScriptedRng } from '@iron-scribe/dice';
import {
  createEngine,
  createInitialState,
  type CoreEvent,
  type Entity,
  type RuleSystem,
} from '@iron-scribe/engine-core';
import { createScriptedLlmClient, type ScriptedStep } from '@iron-scribe/llm';
import { createOrchestrator } from '@iron-scribe/orchestrator';
import {
  characterToEntity,
  createDnd5eSystem,
  loadCatalog,
  monsterToEntity,
  readDeathSaves,
  readEncounter,
  type DeathSaveState,
  type EncounterState,
} from '@iron-scribe/system-dnd5e-2024';
import { describe, expect, it } from 'vitest';

import { defaultAdventurerSheet, formatSceneStatus } from './index.js';

const catalog = loadCatalog();
const base = createDnd5eSystem({ catalog });

const FRESH: DeathSaveState = { successes: 0, failures: 0, stable: false, dead: false };
const intent = JSON.stringify({
  spawnIsNew: false,
  spawnQuery: null,
  spawnCount: null,
  spawnAttitude: null,
  checkAbility: null,
  checkSkill: null,
  wantsAction: true,
});
const decision = JSON.stringify({
  kind: 'action',
  actionAlias: 'A1',
  targetAlias: 'T1',
  secondaryTargetAlias: null,
  tertiaryTargetAlias: null,
});

/**
 * A real D&D system whose dice come from one scripted RNG (die faces, in order),
 * a hero with 8 HP, and a goblin pinned into the given initiative order.
 */
function setup(options: {
  order: string[];
  dice: number[];
  tally?: DeathSaveState;
  llm?: ScriptedStep[];
}) {
  const rng = createScriptedRng(options.dice);
  const system: RuleSystem = {
    ...base,
    resolve: (state, request) => base.resolve(state, request, rng),
    runProcedure: (state, procedure) => {
      if (!base.runProcedure) throw new Error('no procedure handler');
      return base.runProcedure(state, procedure, rng);
    },
  };
  const engine = createEngine({ system, initialState: createInitialState({ seed: 'dying' }) });
  const sheet = characterToEntity({ ...defaultAdventurerSheet(), hpMax: 8 }, 'hero', {
    name: 'Nyx',
  });
  const hero: Entity = options.tally
    ? {
        ...sheet,
        hp: { current: 0, max: 8 },
        system: {
          ...sheet.system,
          conditions: { ids: ['unconscious'], exhaustion: 0 },
          deathSaves: options.tally,
        },
      }
    : sheet;
  const template = catalog.monsters.get('goblin-warrior');
  if (!template) throw new Error('missing goblin');
  const goblin = monsterToEntity(template, 'goblin_1');
  const encounter: EncounterState = {
    round: 1,
    turnIndex: 0,
    acted: [],
    order: options.order.map((entityId) => ({ entityId, total: 10 })),
  };
  const events: CoreEvent[] = [
    { type: 'entity.spawned', entity: hero },
    {
      type: 'entity.spawned',
      entity: {
        ...goblin,
        hp: { current: 500, max: 500 },
        system: { ...goblin.system, attitude: 'hostile' },
      },
    },
    { type: 'state.systemDataSet', key: 'encounter', value: encounter as never },
  ];
  engine.commit('setup', events);
  const llm = createScriptedLlmClient(options.llm ?? [{ text: 'The scene.' }]);
  const orchestrator = createOrchestrator({ engine, system, llm, actorId: 'hero' });
  return { engine, orchestrator };
}

const keys = (facts: readonly { key: string }[]) => facts.map((f) => f.key);

describe('the hero is downed before their turn', () => {
  it('a faster goblin drops the hero; the declared attack is skipped; the hero is dying', async () => {
    // Goblin: d20 15 (19 vs AC 14, hit), d6 6 (+2 = 8 damage) takes the hero from 8 to 0.
    const { engine, orchestrator } = setup({ order: ['goblin_1', 'hero'], dice: [15, 6] });
    const before = engine.state;
    const result = await orchestrator.runAction({
      actorId: 'hero',
      actionAlias: 'A1',
      targetAlias: 'T1',
    });
    expect(keys(result.facts)).toEqual(['npc_attack', 'damage', 'hp', 'condition']);
    expect(result.facts.some((f) => f.key === 'attack')).toBe(false);
    const hero = engine.state.entities['hero'];
    expect(hero?.hp.current).toBe(0);
    expect(readDeathSaves(hero)).toEqual(FRESH);
    expect(engine.state.entities['goblin_1']?.hp.current).toBe(500);
    // It is the hero's turn (index 1), nobody has gone twice, and the fight is not over.
    expect(readEncounter(engine.state)).toMatchObject({
      round: 1,
      turnIndex: 1,
      acted: ['goblin_1'],
    });
    const status = formatSceneStatus(engine.state, 'hero', catalog, engine.menu('hero'));
    expect(status).toContain('Status: DYING (successes 0/3, failures 0/3)');
    orchestrator.undoTurn();
    expect(engine.state).toEqual(before);
  });
});

describe('a dying turn', () => {
  it('rolls the death save, skips every model call but narration, and one undo reverts it all', async () => {
    const { engine, orchestrator } = setup({
      order: ['hero', 'goblin_1'],
      dice: [12],
      tally: FRESH,
      llm: [{ text: 'You cling to a memory of sunlit woods.' }],
    });
    const before = engine.state;
    const result = await orchestrator.runTurn('I remember the sunlit woods of home.');
    expect(result.status).toBe('resolved');
    expect(result.facts.map((f) => f.text)).toEqual(['Death save 12 vs DC 10, success']);
    expect(readDeathSaves(engine.state.entities['hero'])).toMatchObject({ successes: 1 });
    // The goblin held its turn, the round turned over, and the hero is up again.
    expect(readEncounter(engine.state)).toMatchObject({ round: 2, turnIndex: 0 });
    expect(result.logEntry.prompts).toHaveLength(1);
    expect(result.logEntry.prompts[0]?.scene).toContain('brink of death');
    expect(result.logEntry.prompts[0]?.scene).toContain('I remember the sunlit woods');
    orchestrator.undoTurn();
    expect(engine.state).toEqual(before);
    orchestrator.redoTurn();
    expect(readEncounter(engine.state)).toMatchObject({ round: 2 });
  });

  it('a natural 20 wakes the hero and keeps their turn for a real action', async () => {
    const { engine, orchestrator } = setup({
      order: ['hero', 'goblin_1'],
      // death save 20; then the hero's dagger misses (2), and so does the goblin (2).
      dice: [20, 2, 2],
      tally: { successes: 1, failures: 2, stable: false, dead: false },
      llm: [
        { text: 'Against all odds you gasp awake.' },
        { text: intent },
        { text: decision },
        { text: 'Your dagger glances off.' },
      ],
    });
    const revived = await orchestrator.runTurn('I want to attack the goblin!');
    expect(keys(revived.facts)).toEqual(['death_save', 'hp']);
    expect(engine.state.entities['hero']?.hp.current).toBe(1);
    expect(readDeathSaves(engine.state.entities['hero'])).toBeNull();
    // The flavor line was not read as an action: no attack, and no NPC acted.
    expect(readEncounter(engine.state)).toMatchObject({ round: 1, turnIndex: 0, acted: [] });
    expect(engine.state.entities['goblin_1']?.hp.current).toBe(500);

    const acted = await orchestrator.runTurn('I slash the goblin.');
    const order = keys(acted.facts);
    expect(order.indexOf('attack')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('attack')).toBeLessThan(order.indexOf('npc_attack'));
    expect(readEncounter(engine.state)).toMatchObject({ round: 2, turnIndex: 0 });
  });

  it('the third failure is death, which is terminal: later input does nothing and calls no model', async () => {
    const { engine, orchestrator } = setup({
      order: ['hero', 'goblin_1'],
      dice: [5],
      tally: { successes: 0, failures: 2, stable: false, dead: false },
      llm: [{ text: 'The light fades.' }],
    });
    const result = await orchestrator.runTurn('...');
    expect(keys(result.facts)).toEqual(['death_save', 'dead']);
    expect(readDeathSaves(engine.state.entities['hero'])).toMatchObject({ dead: true });
    const status = formatSceneStatus(engine.state, 'hero', catalog, engine.menu('hero'));
    expect(status).toContain('Status: DEAD');
    const frozen = engine.state;
    const after = await orchestrator.runTurn('I get up.');
    expect(after.status).toBe('none');
    expect(engine.state).toEqual(frozen);
  });

  it('a solo hero who stabilizes rests, wakes at 1 HP, and the encounter ends', async () => {
    const { engine, orchestrator } = setup({
      order: ['hero', 'goblin_1'],
      dice: [15, 3],
      tally: { successes: 2, failures: 0, stable: false, dead: false },
      llm: [{ text: 'You come to hours later.' }],
    });
    const result = await orchestrator.runTurn('I hold on.');
    expect(keys(result.facts)).toEqual(['death_save', 'death_save', 'recovery', 'hp']);
    expect(result.facts.find((f) => f.key === 'recovery')?.text).toBe(
      'hero regains 1 HP after 3 hours',
    );
    expect(engine.state.entities['hero']?.hp.current).toBe(1);
    expect(readEncounter(engine.state)).toBeNull();
    expect(formatSceneStatus(engine.state, 'hero', catalog, engine.menu('hero'))).not.toContain(
      'Status:',
    );
  });
});
