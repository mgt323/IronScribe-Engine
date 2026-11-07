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
import type { MonsterAction } from '../catalog/schema-monster.js';
import { monsterToEntity, readMonsterSnapshot } from '../catalog/spawn.js';
import { characterToEntity } from './character.js';
import { createDnd5eSystem } from './system.js';
import { sampleCharacter } from './testing/sample.js';
import { readUsage } from './usage.js';

const catalog = loadCatalog();
const system = createDnd5eSystem({ catalog });

function wyrmling(change?: (breath: MonsterAction) => MonsterAction): Entity {
  const template = catalog.monsters.get('black-dragon-wyrmling');
  if (!template) throw new Error('missing wyrmling');
  const entity = monsterToEntity(template, 'wyrm');
  if (!change) return entity;
  const actions = template.actions.map((a) => (a.id === 'acid-breath' ? change(a) : a));
  return { ...entity, system: { monster: { ...template, actions } } };
}

const pc = (id: string) =>
  characterToEntity(sampleCharacter({ hpMax: 60 }), id, { name: id.toUpperCase() });

function scene(...entities: Entity[]): GameState {
  return applyEvents(
    createInitialState({ seed: 1 }),
    entities.map((entity) => ({ type: 'entity.spawned' as const, entity })),
  );
}

const labels = (state: GameState) =>
  system.availableActions(state, 'wyrm').actions.map((a) => a.label);

function breathe(state: GameState, targetIds: string[], values: number[]) {
  const menu = system.availableActions(state, 'wyrm');
  const action = menu.actions.find((a) => a.actionId === 'monster:acid-breath');
  if (!action) throw new Error('breath is not on the menu');
  const targets = targetIds.map((id) => {
    const found = menu.targets.find((t) => t.entityId === id);
    if (!found) throw new Error(`not a target: ${id}`);
    return found;
  });
  const request: ResolvedRequest = { actorId: 'wyrm', action, target: targets[0] ?? null, targets };
  const resolution = system.resolve(state, request, createScriptedRng(values));
  return { resolution, next: applyEvents(state, resolution.events, system) };
}

/** The wyrmling's attacks: Multiattack (Rend x3) then Rend. */
const MELEE = ['Multiattack', 'Rend'];

const hp = (state: GameState, id: string) => state.entities[id]?.hp.current ?? -1;

describe('monster save actions', () => {
  it('are on the menu after the attacks, for up to three targets', () => {
    const { actions } = system.availableActions(scene(wyrmling(), pc('p1')), 'wyrm');
    expect(actions.map((a) => a.label)).toEqual([...MELEE, 'Acid Breath']);
    expect(actions.map((a) => a.maxTargets)).toEqual([3, undefined, 3]);
  });

  it('roll the damage once, then each target saves: full on a failure, half on a success', () => {
    const state = scene(wyrmling(), pc('p1'), pc('p2'));
    // 5d8 = 25. p1 rolls 5 (+0 vs DC 11) and fails; p2 rolls 15 and succeeds.
    const { resolution, next } = breathe(state, ['p1', 'p2'], [5, 5, 5, 5, 5, 5, 15]);
    expect(resolution.facts[0]).toEqual({ key: 'use', text: 'wyrm uses Acid Breath' });
    expect(resolution.facts.map((f) => f.text)).toContain('p1 Dexterity save 5 vs DC 11, failure');
    expect(hp(next, 'p1')).toBe(60 - 25);
    expect(hp(next, 'p2')).toBe(60 - 12);
  });

  it('record a recharge action as expended, and then it leaves the menu', () => {
    const state = scene(wyrmling(), pc('p1'));
    const { next } = breathe(state, ['p1'], [1, 1, 1, 1, 1, 20]);
    expect(readUsage(next.entities['wyrm'] as Entity).expended).toEqual(['acid-breath']);
    expect(labels(next)).toEqual(MELEE);
    const stale = (): unknown => breathe(next, ['p1'], [1]);
    expect(stale).toThrow('breath is not on the menu');
  });

  it('refuse an expended action even when asked directly', () => {
    const state = scene(wyrmling(), pc('p1'));
    const { next } = breathe(state, ['p1'], [1, 1, 1, 1, 1, 20]);
    const target = { alias: 'T1', entityId: 'p1', label: 'P1' };
    const request: ResolvedRequest = {
      actorId: 'wyrm',
      action: { alias: 'A2', actionId: 'monster:acid-breath', label: 'x', needsTarget: true },
      target,
      targets: [target],
    };
    expect(() => system.resolve(next, request, createScriptedRng([1]))).toThrow(EngineError);
  });

  it('a per-day action counts its uses and goes away at the limit', () => {
    const state = scene(
      wyrmling((a) => ({ ...a, usage: { type: 'perDay', min: null, times: 2 } })),
      pc('p1'),
    );
    const first = breathe(state, ['p1'], [1, 1, 1, 1, 1, 20]);
    expect(labels(first.next)).toEqual([...MELEE, 'Acid Breath']);
    expect(readUsage(first.next.entities['wyrm'] as Entity).counts).toEqual({ 'acid-breath': 1 });
    const second = breathe(first.next, ['p1'], [1, 1, 1, 1, 1, 20]);
    expect(labels(second.next)).toEqual(MELEE);
  });

  it('are not offered when the data cannot be resolved (onSuccess other, no DC, no damage)', () => {
    const save = (patch: Partial<NonNullable<MonsterAction['save']>>) => (a: MonsterAction) => ({
      ...a,
      save: { ...(a.save as NonNullable<MonsterAction['save']>), ...patch },
    });
    const other = scene(wyrmling(save({ onSuccess: 'other' })), pc('p1'));
    const noDc = scene(wyrmling(save({ dc: null })), pc('p1'));
    const noDamage = scene(
      wyrmling((a) => ({ ...a, damage: [] })),
      pc('p1'),
    );
    for (const state of [other, noDc, noDamage]) expect(labels(state)).toEqual(MELEE);
  });

  it('every catalog monster with a save action reads back as a valid snapshot', () => {
    const withSaves = catalog.monsters
      .list()
      .filter((m) => m.actions.some((a) => a.kind === 'save'));
    expect(withSaves.length).toBeGreaterThan(10);
    for (const m of withSaves.slice(0, 20)) {
      const entity = monsterToEntity(m, 'm');
      expect(readMonsterSnapshot(entity).id).toBe(m.id);
      expect(() => system.availableActions(scene(entity, pc('p1')), 'm')).not.toThrow();
    }
  });
});
