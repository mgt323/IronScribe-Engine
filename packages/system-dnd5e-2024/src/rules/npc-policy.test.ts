import { createScriptedRng } from '@iron-scribe/dice';
import {
  applyEvents,
  createInitialState,
  type CombatStep,
  type Entity,
  type GameState,
} from '@iron-scribe/engine-core';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../catalog/catalog.js';
import { monsterToEntity } from '../catalog/spawn.js';
import { characterToEntity } from './character.js';
import { readEncounter } from './combat.js';
import { averageDice } from './npc-policy.js';
import { resolveAction } from './resolve-action.js';
import { createDnd5eSystem } from './system.js';
import { sampleCharacter } from './testing/sample.js';
import { readUsage, runRecharge } from './usage.js';

const catalog = loadCatalog();
const system = createDnd5eSystem({ catalog });

function monster(templateId: string, id: string, attitude: string, hp?: number): Entity {
  const template = catalog.monsters.get(templateId);
  if (!template) throw new Error(`missing ${templateId}`);
  const base = monsterToEntity(template, id);
  return {
    ...base,
    hp: { current: hp ?? base.hp.current, max: Math.max(hp ?? 0, base.hp.max), temp: 0 },
    system: { ...base.system, attitude },
  };
}
const hero = (hp = 50): Entity => ({
  ...characterToEntity(sampleCharacter({ hpMax: 50 }), 'hero', { name: 'Hero' }),
  hp: { current: hp, max: 50 },
});

function scene(npcId: string, entities: Entity[]): GameState {
  const base = applyEvents(
    createInitialState({ seed: 1 }),
    entities.map((entity) => ({ type: 'entity.spawned' as const, entity })),
  );
  return applyEvents(base, [
    {
      type: 'state.systemDataSet',
      key: 'encounter',
      value: {
        round: 1,
        turnIndex: 0,
        acted: [],
        order: [npcId, 'hero'].map((entityId) => ({ entityId, total: 10 })),
      },
    },
  ]);
}

const step = (state: GameState): CombatStep | null =>
  system.nextCombatStep?.(state, 'hero') ?? null;

/** The entity ids a request names, in order. */
function aimedAt(state: GameState, npcId: string, step: CombatStep | null): string[] {
  if (step?.kind !== 'action') throw new Error('not an action step');
  const menu = system.availableActions(state, npcId);
  const aliases = step.request.targetAliases ?? [step.request.targetAlias ?? ''];
  return aliases.map((a) => menu.targets.find((t) => t.alias === a)?.entityId ?? '?');
}

describe('averageDice', () => {
  it('averages plain formulas', () => {
    expect(averageDice('17d6')).toBe(59.5);
    expect(averageDice('1d10+8')).toBe(13.5);
    expect(averageDice('2d4-1')).toBe(4);
  });
});

describe('recharge', () => {
  const spent = (state: GameState): GameState =>
    applyEvents(state, [
      {
        type: 'entity.systemDataSet',
        entityId: 'drag',
        key: 'usage',
        value: { expended: ['fire-breath'], counts: {} },
      },
    ]);
  const ally = monster('goblin-warrior', 'ally', 'friendly', 7);
  const state = () => scene('drag', [monster('adult-red-dragon', 'drag', 'hostile'), hero(), ally]);

  it('with two targets the dragon breathes first, and the breath is spent', () => {
    const open = state();
    const first = step(open);
    expect(first).toMatchObject({ kind: 'action', request: { actionAlias: 'A3' } });
    expect(system.availableActions(open, 'drag').actions[2]?.label).toBe('Fire Breath');
    expect(aimedAt(open, 'drag', first).sort()).toEqual(['ally', 'hero']);
    const menu = system.availableActions(open, 'drag');
    const action = menu.actions[2];
    if (!action) throw new Error('menu');
    const request = {
      actorId: 'drag',
      action,
      target: menu.targets[0] ?? null,
      targets: menu.targets,
    };
    const rolled = resolveAction(
      open,
      request,
      createScriptedRng([...Array<number>(17).fill(1), 1, 1]),
      catalog,
    );
    const after = applyEvents(open, rolled.events, system);
    expect(readUsage(after.entities['drag'] as Entity).expended).toEqual(['fire-breath']);
  });

  it('rolls 1d6 at the start of its next turn: below 5 it uses Multiattack, 5 or more recharges', () => {
    const open = spent(state());
    expect(step(open)).toMatchObject({
      kind: 'procedure',
      label: 'Adult Red Dragon recharge',
      procedure: { kind: 'recharge', actorId: 'drag' },
    });
    const miss = runRecharge(open, 'drag', createScriptedRng([4]));
    expect(miss.facts).toEqual([
      {
        key: 'recharge',
        text: 'Adult Red Dragon Fire Breath recharge d6=4 (needs 5+): not recharged',
      },
    ]);
    const tried = applyEvents(open, miss.events);
    expect(readEncounter(tried)?.recharged).toEqual(['drag']);
    expect(step(tried)).toMatchObject({ kind: 'action', request: { actionAlias: 'A1' } });
    expect(system.availableActions(tried, 'drag').actions[0]?.actionId).toBe('monster:multiattack');

    const hit = runRecharge(open, 'drag', createScriptedRng([5]));
    expect(hit.facts[0]?.text).toContain('d6=5 (needs 5+): recharged');
    const ready = applyEvents(open, hit.events);
    expect(readUsage(ready.entities['drag'] as Entity).expended).toEqual([]);
    expect(step(ready)).toMatchObject({ kind: 'action', request: { actionAlias: 'A3' } });
  });

  it('a new turn clears the once-per-turn marker', () => {
    const tried = applyEvents(
      spent(state()),
      runRecharge(spent(state()), 'drag', createScriptedRng([1])).events,
    );
    const engineState = applyEvents(
      tried,
      system.runProcedure?.(tried, { kind: 'advanceTurn' }, createScriptedRng([1]))?.events ?? [],
    );
    expect(readEncounter(engineState)?.recharged).toBeUndefined();
  });
});

describe('NPC target and action policy', () => {
  it('splits a Multiattack across two targets when the first would fall to one step', () => {
    const state = scene('abo', [
      monster('aboleth', 'abo', 'hostile'),
      hero(1),
      monster('goblin-warrior', 'ally', 'friendly', 40),
    ]);
    const chosen = step(state);
    expect(chosen).toMatchObject({ kind: 'action', request: { actionAlias: 'A1' } });
    expect(aimedAt(state, 'abo', chosen)).toEqual(['hero', 'ally']);
  });

  it('keeps one target when the first survives a step', () => {
    const state = scene('abo', [
      monster('aboleth', 'abo', 'hostile'),
      hero(50),
      monster('goblin-warrior', 'ally', 'friendly', 60),
    ]);
    const chosen = step(state);
    expect(chosen).toMatchObject({ kind: 'action', request: { actionAlias: 'A1' } });
    expect(aimedAt(state, 'abo', chosen)).toEqual(['hero']);
  });

  it('attacks the lowest-HP target, the hero on a tie, and never another hostile', () => {
    const state = scene('gob', [
      monster('goblin-warrior', 'gob', 'hostile'),
      monster('goblin-warrior', 'mate', 'hostile', 1),
      hero(7),
      monster('goblin-warrior', 'ally', 'friendly', 7),
    ]);
    expect(aimedAt(state, 'gob', step(state))).toEqual(['hero']);
  });

  it('a dying hero is not a target: hostiles go for a friendly, else they hold', () => {
    const down = {
      ...hero(0),
      system: {
        ...hero(0).system,
        conditions: { ids: ['unconscious'], exhaustion: 0 },
        deathSaves: { successes: 0, failures: 0, stable: false, dead: false },
      },
    };
    const alone = scene('gob', [monster('goblin-warrior', 'gob', 'hostile'), down]);
    expect(step(alone)).toMatchObject({ kind: 'procedure', label: 'Goblin Warrior holds' });
    const withAlly = scene('gob', [
      monster('goblin-warrior', 'gob', 'hostile'),
      down,
      monster('goblin-warrior', 'ally', 'friendly', 7),
    ]);
    expect(aimedAt(withAlly, 'gob', step(withAlly))).toEqual(['ally']);
  });
});
