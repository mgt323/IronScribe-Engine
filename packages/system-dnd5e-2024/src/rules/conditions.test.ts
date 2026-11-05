import {
  applyEvents,
  createInitialState,
  type Entity,
  type GameState,
} from '@iron-scribe/engine-core';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../catalog/catalog.js';
import { monsterToEntity } from '../catalog/spawn.js';
import { characterToEntity } from './character.js';
import { sampleCharacter } from './testing/sample.js';
import { conditionEvents, readConditions, rollEffects, type ConditionState } from './conditions.js';
import { readCreature } from './creature.js';

const catalog = loadCatalog();
const none: ConditionState = { ids: [], exhaustion: 0 };
const withIds = (...ids: string[]): ConditionState => ({ ids, exhaustion: 0 });

function hero(conditions?: ConditionState): Entity {
  const entity = characterToEntity(sampleCharacter(), 'hero');
  if (!conditions) return entity;
  return { ...entity, system: { ...entity.system, conditions } };
}

function apply(entity: Entity, events: ReturnType<typeof conditionEvents>): GameState {
  return applyEvents(createInitialState({ seed: 1 }), [
    { type: 'entity.spawned', entity },
    ...events,
  ]);
}

describe('condition storage', () => {
  it('starts empty and add/remove write entity.system.conditions', () => {
    const entity = hero();
    expect(readConditions(entity)).toEqual(none);
    const added = conditionEvents(entity, { op: 'add', id: 'poisoned' }, []);
    const afterAdd = apply(entity, added);
    const poisoned = afterAdd.entities['hero'];
    if (!poisoned) throw new Error('missing');
    expect(readConditions(poisoned).ids).toEqual(['poisoned']);
    const removed = conditionEvents(poisoned, { op: 'remove', id: 'poisoned' }, []);
    const afterRemove = applyEvents(afterAdd, removed);
    const clean = afterRemove.entities['hero'];
    if (!clean) throw new Error('missing');
    expect(readConditions(clean).ids).toEqual([]);
  });

  it('does nothing when the condition is already there, absent, or the creature is immune', () => {
    const template = catalog.monsters.get('skeleton');
    if (!template) throw new Error('missing skeleton');
    const skeleton = monsterToEntity(template, 's');
    const immune = readCreature(skeleton, catalog).conditionImmunities;
    expect(conditionEvents(skeleton, { op: 'add', id: 'poisoned' }, immune)).toEqual([]);
    expect(conditionEvents(skeleton, { op: 'setExhaustion', level: 3 }, immune)).toEqual([]);
    const poisoned = hero(withIds('poisoned'));
    expect(conditionEvents(poisoned, { op: 'add', id: 'poisoned' }, [])).toEqual([]);
    expect(conditionEvents(hero(), { op: 'remove', id: 'prone' }, [])).toEqual([]);
  });

  it('exhaustion is a level, and 2 is the penalty per level (SRD 2024 Exhaustion)', () => {
    const entity = hero();
    const events = conditionEvents(entity, { op: 'setExhaustion', level: 2 }, []);
    const state = apply(entity, events);
    const updated = state.entities['hero'];
    if (!updated) throw new Error('missing');
    expect(readConditions(updated).exhaustion).toBe(2);
    expect(
      rollEffects({ kind: 'check', ability: 'str', conditions: readConditions(updated) }).penalty,
    ).toBe(4);
    expect(() => conditionEvents(entity, { op: 'setExhaustion', level: 7 }, [])).toThrow(
      /exhaustion/,
    );
  });
});

describe('roll effects (SRD 5.2.1 conditions)', () => {
  it('poisoned hinders attacks and checks, not saves', () => {
    const poisoned = withIds('poisoned');
    expect(rollEffects({ kind: 'check', ability: 'dex', conditions: poisoned }).disadvantage).toBe(
      true,
    );
    expect(rollEffects({ kind: 'save', ability: 'dex', conditions: poisoned }).disadvantage).toBe(
      false,
    );
    expect(
      rollEffects({ kind: 'attack', attackKind: 'melee', attacker: poisoned, target: none })
        .disadvantage,
    ).toBe(true);
  });

  it('prone: melee against you has advantage, ranged has disadvantage', () => {
    const prone = withIds('prone');
    const melee = rollEffects({
      kind: 'attack',
      attackKind: 'melee',
      attacker: none,
      target: prone,
    });
    const ranged = rollEffects({
      kind: 'attack',
      attackKind: 'ranged',
      attacker: none,
      target: prone,
    });
    expect(melee.advantage).toBe(true);
    expect(melee.disadvantage).toBe(false);
    expect(ranged.advantage).toBe(false);
    expect(ranged.disadvantage).toBe(true);
  });

  it('paralyzed, stunned and unconscious auto-fail Strength and Dexterity saves', () => {
    for (const id of ['paralyzed', 'stunned', 'unconscious']) {
      expect(rollEffects({ kind: 'save', ability: 'str', conditions: withIds(id) }).autoFail).toBe(
        true,
      );
      expect(rollEffects({ kind: 'save', ability: 'dex', conditions: withIds(id) }).autoFail).toBe(
        true,
      );
      expect(rollEffects({ kind: 'save', ability: 'wis', conditions: withIds(id) }).autoFail).toBe(
        false,
      );
    }
  });

  it('a melee hit on a paralyzed or unconscious creature is a critical hit', () => {
    for (const id of ['paralyzed', 'unconscious']) {
      const melee = rollEffects({
        kind: 'attack',
        attackKind: 'melee',
        attacker: none,
        target: withIds(id),
      });
      const ranged = rollEffects({
        kind: 'attack',
        attackKind: 'ranged',
        attacker: none,
        target: withIds(id),
      });
      expect(melee.autoCrit).toBe(true);
      expect(ranged.autoCrit).toBe(false);
    }
  });

  it('unconscious includes prone, so a ranged attack has both advantage and disadvantage', () => {
    const effects = rollEffects({
      kind: 'attack',
      attackKind: 'ranged',
      attacker: none,
      target: withIds('unconscious'),
    });
    expect(effects.advantage).toBe(true);
    expect(effects.disadvantage).toBe(true);
  });

  it('invisible grants advantage on initiative; restrained hinders Dexterity saves', () => {
    expect(rollEffects({ kind: 'initiative', conditions: withIds('invisible') }).advantage).toBe(
      true,
    );
    expect(
      rollEffects({ kind: 'save', ability: 'dex', conditions: withIds('restrained') }).disadvantage,
    ).toBe(true);
    expect(
      rollEffects({ kind: 'save', ability: 'str', conditions: withIds('restrained') }).disadvantage,
    ).toBe(false);
  });
});
