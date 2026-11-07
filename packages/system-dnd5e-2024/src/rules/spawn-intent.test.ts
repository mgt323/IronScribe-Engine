import { createInitialState } from '@iron-scribe/engine-core';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../catalog/catalog.js';
import { DEFAULT_MONSTER_VARIANTS } from '../catalog/overrides.js';
import { readMonsterSnapshot } from '../catalog/spawn.js';
import { PROJECT_DEFAULT_CHECK_DC, SRD_TYPICAL_DC, resolveDndCheckDc } from './check-dc.js';
import { resolveDndSpawn } from './spawn-intent.js';

const catalog = loadCatalog();
const state = createInitialState({ seed: 1 });

describe('resolveDndCheckDc', () => {
  it('uses the SRD table for a band and never calls 12 medium', () => {
    expect(SRD_TYPICAL_DC).toEqual({
      veryEasy: 5,
      easy: 10,
      medium: 15,
      hard: 20,
      veryHard: 25,
      nearlyImpossible: 30,
    });
    expect(Object.values(SRD_TYPICAL_DC)).not.toContain(12);
    const context = { actorId: 'hero', ability: 'dex', skill: 'stealth' as string | null };
    expect(resolveDndCheckDc(state, { ...context, difficulty: 'medium' })).toBe(15);
    expect(resolveDndCheckDc(state, { ...context, difficulty: 'easy' })).toBe(10);
    expect(resolveDndCheckDc(state, context)).toBe(PROJECT_DEFAULT_CHECK_DC);
    expect(PROJECT_DEFAULT_CHECK_DC).toBe(12);
  });
});

describe('resolveDndSpawn', () => {
  it('spawns one wolf from the plural, with catalog HP and AC', () => {
    const wolf = catalog.monsters.get('wolf');
    if (!wolf) throw new Error('missing wolf');
    const result = resolveDndSpawn(state, { query: 'wolves', count: 1 }, catalog);
    expect(result.status).toBe('matched');
    if (result.status !== 'matched') return;
    expect(result.entities.map((entity) => entity.id)).toEqual(['wolf_1']);
    expect(result.entities[0]?.hp).toEqual({ current: wolf.hp, max: wolf.hp });
    expect(readMonsterSnapshot(result.entities[0]!).ac).toBe(wolf.ac);
    expect(result.entities[0]?.system['attitude']).toBe('hostile');
    expect(result.facts[0]?.text).toBe(
      `spawn: wolf_1 (${wolf.name}) ${String(wolf.hp)}/${String(wolf.hp)} HP, AC ${String(wolf.ac)}, hostile`,
    );
  });

  it('singularizes skeletons and zombies to one template each', () => {
    const skeletons = resolveDndSpawn(state, { query: 'skeletons', count: 1 }, catalog);
    const zombies = resolveDndSpawn(
      state,
      { query: 'zombies', count: 2, attitude: 'neutral' },
      catalog,
    );
    expect(skeletons.status).toBe('matched');
    expect(zombies.status).toBe('matched');
    if (zombies.status !== 'matched') return;
    expect(zombies.entities.map((entity) => entity.id)).toEqual(['zombie_1', 'zombie_2']);
    expect(zombies.entities.every((entity) => entity.system['attitude'] === 'neutral')).toBe(true);
  });

  it('every default variant points at a real template', () => {
    for (const [family, id] of Object.entries(DEFAULT_MONSTER_VARIANTS)) {
      expect(catalog.monsters.get(id), `${family} -> ${id}`).toBeTruthy();
    }
  });

  it('resolves exact variant, then default family variant, then catalog search', () => {
    const ids = (query: string, count = 1) => {
      const result = resolveDndSpawn(state, { query, count }, catalog);
      return result.status === 'matched' ? result.entities.map((e) => e.id) : result.status;
    };
    expect(ids('goblin boss')).toEqual(['goblin_boss_1']);
    expect(ids('Goblin Minion')).toEqual(['goblin_minion_1']);
    expect(ids('goblin')).toEqual(['goblin_warrior_1']);
    expect(ids('goblins', 2)).toEqual(['goblin_warrior_1', 'goblin_warrior_2']);
    expect(ids('dragon')).toBe('ambiguous');
    expect(ids('giant')).toBe('ambiguous');
  });

  it('refuses to spawn while an encounter is active and changes nothing', () => {
    const active = {
      ...state,
      system: { encounter: { round: 1, turnIndex: 0, acted: [], order: [] } },
    };
    expect(resolveDndSpawn(active, { query: 'wolf', count: 1 }, catalog)).toEqual({
      status: 'combat_active',
      query: 'wolf',
    });
    expect(active.spawnOrder).toEqual([]);
  });

  it('caps a long ambiguous list at 10', () => {
    const broad = catalog.monsters.find('dragon');
    expect(broad.length).toBeGreaterThan(10);
    const dragons = resolveDndSpawn(state, { query: 'dragon', count: 1 }, catalog);
    expect(dragons.status).toBe('ambiguous');
    if (dragons.status !== 'ambiguous') return;
    expect(dragons.candidates).toHaveLength(10);
    expect(dragons.candidates.map((candidate) => candidate.id)).toEqual(
      broad.slice(0, 10).map((monster) => monster.id),
    );
  });

  it('a red dragon query keeps the young red dragon among the candidates', () => {
    const dragons = resolveDndSpawn(state, { query: 'red dragon', count: 1 }, catalog);
    expect(dragons.status).toBe('ambiguous');
    if (dragons.status !== 'ambiguous') return;
    expect(dragons.candidates.map((candidate) => candidate.id)).toContain('young-red-dragon');
  });

  it('rejects a turn whose slots add up to more than 10', () => {
    expect(() =>
      resolveDndSpawn(state, { query: 'wolf', count: 4, turnTotal: 11 }, catalog),
    ).toThrow();
    const allowed = resolveDndSpawn(state, { query: 'wolf', count: 4, turnTotal: 10 }, catalog);
    expect(allowed.status).toBe('matched');
    if (allowed.status !== 'matched') return;
    expect(allowed.entities).toHaveLength(4);
  });

  it('an unknown name is not found, and count or attitude outside the rules throws', () => {
    expect(resolveDndSpawn(state, { query: 'xyzzy', count: 1 }, catalog).status).toBe('not_found');
    expect(() => resolveDndSpawn(state, { query: 'wolf', count: 0 }, catalog)).toThrow();
    expect(() => resolveDndSpawn(state, { query: 'wolf', count: 11 }, catalog)).toThrow();
    expect(() =>
      resolveDndSpawn(state, { query: 'wolf', count: 1, attitude: 'angry' }, catalog),
    ).toThrow();
  });

  it('skips entity ids that are already in the scene', () => {
    const first = resolveDndSpawn(state, { query: 'wolf', count: 1 }, catalog);
    if (first.status !== 'matched') throw new Error('expected a wolf');
    const wolf = first.entities[0];
    if (!wolf) throw new Error('missing');
    const next = resolveDndSpawn(
      { ...state, entities: { wolf_1: wolf }, spawnOrder: ['wolf_1'] },
      { query: 'wolf', count: 1 },
      catalog,
    );
    expect(next.status).toBe('matched');
    if (next.status !== 'matched') return;
    expect(next.entities[0]?.id).toBe('wolf_2');
  });
});
