import { createScriptedRng } from '@iron-scribe/dice';
import {
  applyEvents,
  createInitialState,
  EngineError,
  type Entity,
  type GameState,
  type ResolvedRequest,
} from '@iron-scribe/engine-core';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../catalog/catalog.js';
import { monsterToEntity } from '../catalog/spawn.js';
import { characterToEntity } from './character.js';
import { readDeathSaves } from './death-saves.js';
import { readSlotsUsed } from './spell-data.js';
import { createDnd5eSystem } from './system.js';
import { clericSheet, sorcererSheet } from './testing/sample.js';

const catalog = loadCatalog();
const system = createDnd5eSystem({ catalog });

function monster(templateId: string, id: string): Entity {
  const template = catalog.monsters.get(templateId);
  if (!template) throw new Error(`missing ${templateId}`);
  return monsterToEntity(template, id);
}

function scene(...entities: Entity[]): GameState {
  return applyEvents(
    createInitialState({ seed: 1 }),
    entities.map((entity) => ({ type: 'entity.spawned' as const, entity })),
  );
}

const sorcerer = () => characterToEntity(sorcererSheet(), 'hero', { name: 'Hero' });
const ogres = () => [
  monster('ogre', 'ogre_1'),
  monster('ogre', 'ogre_2'),
  monster('ogre', 'ogre_3'),
];

function labels(state: GameState, actorId = 'hero') {
  return system.availableActions(state, actorId).actions.map((a) => a.label);
}

/** Run a menu action through the real menu, with scripted dice. */
function run(state: GameState, actionId: string, targetIds: string[], values: number[]) {
  const menu = system.availableActions(state, 'hero');
  const action = menu.actions.find((a) => a.actionId === actionId);
  if (!action) throw new Error(`not on the menu: ${actionId}`);
  const targets = targetIds.map((id) => {
    const found = menu.targets.find((t) => t.entityId === id);
    if (!found) throw new Error(`not a target: ${id}`);
    return found;
  });
  const request: ResolvedRequest = {
    actorId: 'hero',
    action,
    target: targets[0] ?? null,
    targets,
  };
  const resolution = system.resolve(state, request, createScriptedRng(values));
  return { resolution, next: applyEvents(state, resolution.events, system) };
}

const hp = (state: GameState, id: string) => state.entities[id]?.hp.current ?? -1;
const texts = (r: { facts: readonly { text: string }[] }) => r.facts.map((f) => f.text);

describe('spell menu (Sorcerer)', () => {
  it('lists weapons, then spells with a rules effect; text-only cantrips stay off', () => {
    expect(labels(scene(sorcerer(), ...ogres()))).toEqual([
      'Dagger',
      'Light Crossbow',
      'Fire Bolt',
      'Ray of Frost',
      'Burning Hands',
      'Magic Missile',
    ]);
  });

  it('offers up to 3 targets for an area save spell and for Magic Missile, one for attacks', () => {
    const { actions } = system.availableActions(scene(sorcerer(), ...ogres()), 'hero');
    const max = (label: string) => actions.find((a) => a.label === label)?.maxTargets;
    expect(max('Burning Hands')).toBe(3);
    expect(max('Magic Missile')).toBe(3);
    expect(max('Fire Bolt')).toBeUndefined();
  });

  it('drops leveled spells once the slots are spent, keeping cantrips', () => {
    const base = scene(sorcerer(), ...ogres());
    const spent = applyEvents(base, [
      { type: 'entity.systemDataSet', entityId: 'hero', key: 'spellSlotsUsed', value: { '1': 2 } },
    ]);
    expect(labels(spent)).toEqual(['Dagger', 'Light Crossbow', 'Fire Bolt', 'Ray of Frost']);
  });
});

describe('spell attacks and slots', () => {
  it('Fire Bolt rolls to hit with proficiency + Charisma, then 1d10 fire; no slot is spent', () => {
    const state = scene(sorcerer(), monster('goblin-warrior', 'goblin_1'));
    const { resolution, next } = run(state, 'spell:fire-bolt', ['goblin_1'], [15, 4]);
    expect(texts(resolution).slice(0, 3)).toEqual([
      'hero casts Fire Bolt',
      '20 vs AC 15, hit',
      '4 fire',
    ]);
    expect(hp(next, 'goblin_1')).toBe(hp(state, 'goblin_1') - 4);
    expect(readSlotsUsed(next.entities['hero'] as Entity)).toEqual({});
  });

  it('a critical hit doubles the spell dice', () => {
    const state = scene(sorcerer(), monster('ogre', 'ogre_1'));
    const { resolution } = run(state, 'spell:fire-bolt', ['ogre_1'], [20, 3, 9]);
    expect(texts(resolution)).toContain('12 fire');
  });

  it('Ray of Frost is a ranged spell attack for 1d8 cold', () => {
    const state = scene(sorcerer(), monster('ogre', 'ogre_1'));
    const { resolution } = run(state, 'spell:ray-of-frost', ['ogre_1'], [18, 6]);
    expect(texts(resolution)).toContain('6 cold');
  });

  it('a leveled spell spends one slot as an event, and a third cast is refused', () => {
    const state = scene(sorcerer(), ...ogres());
    const one = run(state, 'spell:magic-missile', ['ogre_1'], [1, 1, 1]);
    expect(one.resolution.events).toContainEqual({
      type: 'entity.systemDataSet',
      entityId: 'hero',
      key: 'spellSlotsUsed',
      value: { '1': 1 },
    });
    const two = run(one.next, 'spell:magic-missile', ['ogre_1'], [1, 1, 1]);
    expect(readSlotsUsed(two.next.entities['hero'] as Entity)).toEqual({ '1': 2 });
    expect(() => run(two.next, 'spell:magic-missile', ['ogre_1'], [1, 1, 1])).toThrow(
      /not on the menu/,
    );
  });
});

describe('save spells share one damage roll', () => {
  it('Burning Hands: 3d6 once, a failed save takes it all, a success takes half rounded down', () => {
    const state = scene(sorcerer(), ...ogres());
    // 3d6 = 6+5+4 = 15, then each target's d20: 1 fails, 20 succeeds.
    const { resolution, next } = run(
      state,
      'spell:burning-hands',
      ['ogre_1', 'ogre_2'],
      [6, 5, 4, 1, 20],
    );
    expect(texts(resolution)).toContain('ogre_1 Dexterity save 0 vs DC 13, failure');
    expect(hp(next, 'ogre_1')).toBe(hp(state, 'ogre_1') - 15);
    expect(hp(next, 'ogre_2')).toBe(hp(state, 'ogre_2') - 7);
    expect(hp(next, 'ogre_3')).toBe(hp(state, 'ogre_3'));
    expect(readSlotsUsed(next.entities['hero'] as Entity)).toEqual({ '1': 1 });
  });

  it('deduplicates targets, so a creature saves and takes damage once', () => {
    const state = scene(sorcerer(), monster('ogre', 'ogre_1'));
    const { resolution } = run(state, 'spell:burning-hands', ['ogre_1', 'ogre_1'], [1, 1, 1, 1]);
    expect(texts(resolution).filter((t) => t.includes('save'))).toHaveLength(1);
  });

  it('Sacred Flame (Cleric fixture): Wisdom DC, no damage on a success', () => {
    const cleric = characterToEntity(clericSheet(), 'hero', { name: 'Cleric' });
    const state = scene(cleric, monster('ogre', 'ogre_1'));
    const { resolution, next } = run(state, 'spell:sacred-flame', ['ogre_1'], [4, 20]);
    expect(texts(resolution)).toContain('ogre_1 Dexterity save 19 vs DC 13, success');
    expect(hp(next, 'ogre_1')).toBe(hp(state, 'ogre_1'));
  });
});

describe('Magic Missile darts', () => {
  const dart = (id: string, state: GameState, values: number[], targets: string[]) =>
    run(state, 'spell:magic-missile', targets, values).next.entities[id]?.hp.current;

  it('three targets take one dart each (1d4+1 force)', () => {
    const state = scene(sorcerer(), ...ogres());
    const targets = ['ogre_1', 'ogre_2', 'ogre_3'];
    const after = (id: string) => dart(id, state, [1, 2, 3], targets);
    expect(after('ogre_1')).toBe(hp(state, 'ogre_1') - 2);
    expect(after('ogre_2')).toBe(hp(state, 'ogre_2') - 3);
    expect(after('ogre_3')).toBe(hp(state, 'ogre_3') - 4);
  });

  it('two targets take darts one and three, and two', () => {
    const state = scene(sorcerer(), ...ogres());
    const after = (id: string) => dart(id, state, [1, 2, 3], ['ogre_1', 'ogre_2']);
    expect(after('ogre_1')).toBe(hp(state, 'ogre_1') - (2 + 4));
    expect(after('ogre_2')).toBe(hp(state, 'ogre_2') - 3);
  });

  it('one target takes all three', () => {
    const state = scene(sorcerer(), ...ogres());
    expect(dart('ogre_1', state, [1, 1, 1], ['ogre_1'])).toBe(hp(state, 'ogre_1') - 6);
  });

  it('a dart never moves to an unchosen creature when its target is already down', () => {
    const rat = monster('rat', 'rat_1');
    const state = scene(sorcerer(), rat, monster('ogre', 'ogre_1'), monster('ogre', 'ogre_2'));
    const { next } = run(state, 'spell:magic-missile', ['rat_1', 'ogre_1'], [4, 1]);
    expect(hp(next, 'rat_1')).toBe(0);
    expect(hp(next, 'ogre_1')).toBe(hp(state, 'ogre_1') - 2);
    expect(hp(next, 'ogre_2')).toBe(hp(state, 'ogre_2'));
  });
});

describe('healing spells (Cleric fixture)', () => {
  const cleric = () => characterToEntity(clericSheet(), 'hero', { name: 'Cleric' });
  const wounded = (hpNow: number) => ({ ...cleric(), hp: { current: hpNow, max: 10 } });

  it('Cure Wounds on self is a no-target menu entry and heals 2d8 + Wisdom', () => {
    const state = scene(wounded(2), monster('ogre', 'ogre_1'));
    expect(labels(state)).toContain('Cure Wounds (self)');
    const menu = system.availableActions(state, 'hero');
    expect(menu.actions.find((a) => a.label === 'Cure Wounds (self)')?.needsTarget).toBe(false);
    const { resolution, next } = run(state, 'spell:cure-wounds:self', [], [2, 3]);
    expect(texts(resolution)).toContain('hero regains 8 HP');
    expect(hp(next, 'hero')).toBe(10);
  });

  it('wakes an ally at 0 HP and clears the death save tally', () => {
    const ally = characterToEntity(sorcererSheet(), 'ally', { name: 'Ally' });
    const downed = {
      ...ally,
      hp: { current: 0, max: 8 },
      system: {
        ...ally.system,
        conditions: { ids: ['unconscious'], exhaustion: 0 },
        deathSaves: { successes: 0, failures: 2, stable: false, dead: false },
      },
    } as Entity;
    const state = scene(cleric(), downed);
    const request: ResolvedRequest = {
      actorId: 'hero',
      action: {
        alias: 'A3',
        actionId: 'spell:cure-wounds',
        label: 'Cure Wounds',
        needsTarget: true,
      },
      target: { alias: 'T1', entityId: 'ally', label: 'Ally' },
      targets: [{ alias: 'T1', entityId: 'ally', label: 'Ally' }],
    };
    const resolution = system.resolve(state, request, createScriptedRng([1, 1]));
    const next = applyEvents(state, resolution.events, system);
    expect(next.entities['ally']?.hp.current).toBe(5);
    expect(readDeathSaves(next.entities['ally'])).toBeNull();
    expect(next.entities['ally']?.system['conditions']).toEqual({ ids: [], exhaustion: 0 });
  });

  it('refuses a spell that is not on the sheet', () => {
    const state = scene(sorcerer(), monster('ogre', 'ogre_1'));
    const request: ResolvedRequest = {
      actorId: 'hero',
      action: { alias: 'A9', actionId: 'spell:cure-wounds:self', label: 'x', needsTarget: false },
      target: null,
      targets: [],
    };
    expect(() => system.resolve(state, request, createScriptedRng([1, 1]))).toThrow(EngineError);
  });
});
