import {
  applyEvents,
  createEngine,
  createInitialState,
  type Entity,
  type GameState,
} from '@iron-scribe/engine-core';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../catalog/catalog.js';
import type { DamageType } from '../catalog/schema.js';
import { monsterToEntity } from '../catalog/spawn.js';
import { characterToEntity } from './character.js';
import { dealDamage } from './deal-damage.js';
import { readHydraState } from './hydra.js';
import { createDnd5eSystem } from './system.js';
import { sampleCharacter } from './testing/sample.js';

const catalog = loadCatalog();
const system = createDnd5eSystem({ catalog });
const template = catalog.monsters.get('hydra');
if (!template) throw new Error('missing hydra');

function fight(hydraTurn: boolean): GameState {
  const hydra = {
    ...monsterToEntity(template, 'hyd'),
    system: { ...monsterToEntity(template, 'hyd').system, attitude: 'hostile' },
  } as Entity;
  const hero = characterToEntity(sampleCharacter({ hpMax: 50 }), 'hero', { name: 'Hero' });
  const order = hydraTurn ? ['hyd', 'hero'] : ['hero', 'hyd'];
  return applyEvents(createInitialState({ seed: 1 }), [
    { type: 'entity.spawned', entity: hydra },
    { type: 'entity.spawned', entity: hero },
    {
      type: 'state.systemDataSet',
      key: 'encounter',
      value: {
        round: 1,
        turnIndex: 0,
        acted: [],
        order: order.map((entityId) => ({ entityId, total: 10 })),
      },
    },
  ]);
}

function hit(state: GameState, amount: number, type: DamageType = 'slashing') {
  const dealt = dealDamage(state, 'hyd', [{ type, amount }], false, catalog);
  return { state: applyEvents(state, dealt.events), facts: dealt.facts };
}

const heads = (state: GameState) => readHydraState(state.entities['hyd'] as Entity)?.heads;

describe('Hydra, Multiple Heads', () => {
  it('starts with five heads and takes 25 damage in a turn to lose one', () => {
    let state = fight(true);
    expect(heads(state)).toBe(5);
    const small = hit(state, 24);
    expect(heads(small.state)).toBe(5);
    state = hit(small.state, 1).state;
    expect(heads(state)).toBe(4);
    expect(readHydraState(state.entities['hyd'] as Entity)).toMatchObject({
      damageThisTurn: 25,
      headsLostSinceLastTurn: 1,
    });
    const more = hit(state, 30);
    expect(heads(more.state)).toBe(4);
    expect(more.facts.some((f) => f.key === 'hydra')).toBe(false);
  });

  it('regrows two heads and heals 20 HP at the end of its turn without fire damage', () => {
    const lost = hit(fight(true), 25);
    expect(lost.facts).toContainEqual({ key: 'hydra', text: 'hyd loses a head (4 remaining)' });
    const engine = createEngine({ system, initialState: lost.state });
    engine.runProcedure('turn end', { kind: 'advanceTurn' });
    const hydra = engine.state.entities['hyd'] as Entity;
    expect(readHydraState(hydra)).toEqual({
      heads: 6,
      damageThisTurn: 0,
      headsLostSinceLastTurn: 0,
      fireDamageSinceLastTurn: false,
    });
    expect(hydra.hp.current).toBe(184 - 25 + 20);
  });

  it('fire damage since its last turn suppresses regrowth', () => {
    const lost = hit(fight(true), 25, 'fire');
    const engine = createEngine({ system, initialState: lost.state });
    engine.runProcedure('turn end', { kind: 'advanceTurn' });
    const hydra = engine.state.entities['hyd'] as Entity;
    expect(readHydraState(hydra)).toMatchObject({
      heads: 4,
      headsLostSinceLastTurn: 0,
      fireDamageSinceLastTurn: false,
    });
    expect(hydra.hp.current).toBe(184 - 25);
  });

  it("damage taken on another creature's turn resets at that turn's end", () => {
    const state = hit(fight(false), 20).state;
    const engine = createEngine({ system, initialState: state });
    engine.runProcedure('turn end', { kind: 'advanceTurn' });
    expect(readHydraState(engine.state.entities['hyd'] as Entity)?.damageThisTurn).toBe(0);
  });

  it('dies at once when the last head is lost', () => {
    const last = {
      ...fight(true),
    };
    const hydra = last.entities['hyd'] as Entity;
    const state = applyEvents(last, [
      {
        type: 'entity.systemDataSet',
        entityId: 'hyd',
        key: 'hydra',
        value: {
          heads: 1,
          damageThisTurn: 24,
          headsLostSinceLastTurn: 4,
          fireDamageSinceLastTurn: false,
        },
      },
    ]);
    const result = hit(state, 1);
    expect(result.state.entities['hyd']?.hp.current).toBe(0);
    expect(result.facts).toContainEqual({ key: 'defeated', text: 'hyd' });
    expect(hydra.hp.max).toBe(184);
  });
});
