import { createScriptedRng } from '@iron-scribe/dice';
import {
  applyEvents,
  createInitialState,
  type Entity,
  type GameState,
  type ResolvedRequest,
} from '@iron-scribe/engine-core';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../catalog/catalog.js';
import type { Monster } from '../catalog/schema-monster.js';
import { monsterToEntity } from '../catalog/spawn.js';
import { characterToEntity } from './character.js';
import { expandMultiattack, expandMultiattackVariants } from './multiattack.js';
import { createDnd5eSystem } from './system.js';
import { sampleCharacter } from './testing/sample.js';

const catalog = loadCatalog();
const system = createDnd5eSystem({ catalog });

function template(id: string): Monster {
  const monster = catalog.monsters.get(id);
  if (!monster) throw new Error(`missing ${id}`);
  return monster;
}

const names = (variant: readonly { name: string }[]) => variant.map((a) => a.name);
const pc = (id: string, hpMax = 200) =>
  characterToEntity(sampleCharacter({ hpMax, weapons: ['dagger'] }), id, { name: id });

function scene(...entities: Entity[]): GameState {
  return applyEvents(
    createInitialState({ seed: 1 }),
    entities.map((entity) => ({ type: 'entity.spawned' as const, entity })),
  );
}

/** Aboleth with Dominate Mind given damage, so it becomes a second valid choice. */
function bendyAboleth(usage?: { type: 'perDay'; min: null; times: number }): Entity {
  const base = template('aboleth');
  const actions = base.actions.map((a) =>
    a.id === 'dominate-mind'
      ? {
          ...a,
          usage: usage ?? a.usage,
          damage: [{ dice: '1d4', type: 'psychic', condition: null }],
        }
      : a,
  );
  return monsterToEntity({ ...base, actions } as Monster, 'abo');
}

describe('expandMultiattackVariants', () => {
  it('Hydra: one Bite per head, five at the start', () => {
    const hydra = monsterToEntity(template('hydra'), 'hyd');
    const variants = expandMultiattackVariants(hydra);
    expect(variants).toHaveLength(1);
    expect(names(variants[0] ?? [])).toEqual(Array(5).fill('Bite'));
    expect(expandMultiattack(hydra)).toHaveLength(5);
    expect(expandMultiattack(template('hydra').actions)).toHaveLength(5);
    const hurt = {
      ...hydra,
      system: {
        ...hydra.system,
        hydra: {
          heads: 3,
          damageThisTurn: 0,
          headsLostSinceLastTurn: 2,
          fireDamageSinceLastTurn: false,
        },
      },
    };
    expect(expandMultiattack(hurt)).toHaveLength(3);
  });

  it('keeps only choices the rules can resolve (Aboleth, Adult Red Dragon)', () => {
    const aboleth = expandMultiattackVariants(monsterToEntity(template('aboleth'), 'abo'));
    expect(aboleth.map(names)).toEqual([['Tentacle', 'Tentacle', 'Consume Memories']]);
    const dragon = expandMultiattackVariants(monsterToEntity(template('adult-red-dragon'), 'd'));
    expect(dragon.map(names)).toEqual([['Rend', 'Rend', 'Rend']]);
  });

  it('expands every combination of valid choices, and skips a choice with no uses left', () => {
    expect(expandMultiattackVariants(bendyAboleth()).map(names)).toEqual([
      ['Tentacle', 'Tentacle', 'Consume Memories'],
      ['Tentacle', 'Tentacle', 'Dominate Mind'],
    ]);
    const spent = bendyAboleth({ type: 'perDay', min: null, times: 2 });
    const used = {
      ...spent,
      system: { ...spent.system, usage: { expended: [], counts: { 'dominate-mind': 2 } } },
    };
    expect(expandMultiattackVariants(used).map(names)).toEqual([
      ['Tentacle', 'Tentacle', 'Consume Memories'],
    ]);
  });

  it('never returns a partial Multiattack: an unresolvable fixed step empties it', () => {
    const base = template('aboleth');
    const actions = base.actions.filter((a) => a.id !== 'tentacle');
    const broken = monsterToEntity({ ...base, actions }, 'abo');
    expect(expandMultiattackVariants(broken)).toEqual([]);
  });

  it('offers a labelled menu entry per variant', () => {
    const state = scene(bendyAboleth(), pc('hero'));
    const menu = system.availableActions(state, 'abo');
    expect(menu.actions.slice(0, 2).map((a) => [a.actionId, a.label])).toEqual([
      ['monster:multiattack', 'Multiattack (Tentacle x2, Consume Memories)'],
      ['monster:multiattack:1', 'Multiattack (Tentacle x2, Dominate Mind)'],
    ]);
  });
});

describe('Multiattack resolution', () => {
  function run(
    state: GameState,
    targetIds: string[],
    values: number[],
    actionId = 'monster:multiattack',
  ) {
    const menu = system.availableActions(state, 'abo');
    const action = menu.actions.find((a) => a.actionId === actionId);
    if (!action) throw new Error('not on the menu');
    const targets = targetIds.map((id) => {
      const found = menu.targets.find((t) => t.entityId === id);
      if (!found) throw new Error(`not a target: ${id}`);
      return found;
    });
    const request: ResolvedRequest = {
      actorId: 'abo',
      action,
      target: targets[0] ?? null,
      targets,
    };
    const resolution = system.resolve(state, request, createScriptedRng(values));
    return { resolution, next: applyEvents(state, resolution.events, system) };
  }
  const hit = [15, 6, 6]; // d20 15 beats AC 10; 2d6+5 = 17

  it('sends sub-step i to target i, and the rest to the first target', () => {
    const state = scene(monsterToEntity(template('aboleth'), 'abo'), pc('p1'), pc('p2'));
    // Tentacle on p1, Tentacle on p2, Consume Memories (3d6 = 3) on p1, who fails the save.
    const { resolution, next } = run(state, ['p1', 'p2'], [...hit, ...hit, 1, 1, 1, 1]);
    expect(resolution.facts.filter((f) => f.key === 'attack')).toHaveLength(2);
    expect(resolution.facts.find((f) => f.key === 'save')?.text).toContain('p1 Intelligence save');
    expect(next.entities['p1']?.hp.current).toBe(200 - 17 - 3);
    expect(next.entities['p2']?.hp.current).toBe(200 - 17);
  });

  it('skips steps once the chosen target is down; nobody unchosen is hit', () => {
    const state = scene(monsterToEntity(template('aboleth'), 'abo'), pc('p1', 5), pc('p2'));
    const { resolution, next } = run(state, ['p1'], hit);
    expect(resolution.facts.filter((f) => f.key === 'attack')).toHaveLength(1);
    expect(next.entities['p1']?.hp.current).toBe(0);
    expect(next.entities['p2']?.hp.current).toBe(200);
  });

  it('records the use of a limited action as it is spent', () => {
    const spent = bendyAboleth({ type: 'perDay', min: null, times: 2 });
    const state = scene(spent, pc('p1'));
    // Tentacle x2, then Dominate Mind (1d4 = 1) and p1's WIS save of 1 fails.
    const { next } = run(state, ['p1'], [...hit, ...hit, 1, 1], 'monster:multiattack:1');
    expect(next.entities['abo']?.system['usage']).toEqual({
      expended: [],
      counts: { 'dominate-mind': 1 },
    });
  });
});
