import { createScriptedRng } from '@iron-scribe/dice';
import {
  applyEvents,
  createInitialState,
  EngineError,
  type Entity,
  type GameState,
} from '@iron-scribe/engine-core';
import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../catalog/catalog.js';
import { monsterToEntity } from '../catalog/spawn.js';
import { characterToEntity } from './character.js';
import { readConditions } from './conditions.js';
import {
  downedOutcome,
  exhaustionOutcome,
  FRESH_DEATH_SAVES,
  healEvents,
  isDead,
  isDying,
  readDeathSaves,
  type DeathSaveState,
} from './death-saves.js';
import { createDnd5eSystem } from './system.js';
import { sampleCharacter } from './testing/sample.js';

const catalog = loadCatalog();
const system = createDnd5eSystem({ catalog });
const goblin = catalog.monsters.get('goblin-warrior');
if (!goblin) throw new Error('missing goblin');

function hero(options: { hp?: number; tally?: DeathSaveState | null; exhaustion?: number } = {}) {
  const base = characterToEntity(sampleCharacter({ hpMax: 10 }), 'hero', { name: 'Hero' });
  const hp = options.hp ?? 0;
  const down = hp === 0;
  return {
    ...base,
    hp: { current: hp, max: 10 },
    system: {
      ...base.system,
      conditions: { ids: down ? ['unconscious'] : [], exhaustion: options.exhaustion ?? 0 },
      deathSaves: down ? (options.tally ?? FRESH_DEATH_SAVES) : null,
    },
  } as Entity;
}

function scene(entity: Entity, extra: Entity[] = []): GameState {
  return applyEvents(
    createInitialState({ seed: 1 }),
    [entity, ...extra].map((e) => ({ type: 'entity.spawned' as const, entity: e })),
  );
}

function save(state: GameState, values: number[]) {
  const resolution = system.runProcedure?.(
    state,
    { kind: 'deathSave', actorId: 'hero' },
    createScriptedRng(values),
  );
  if (!resolution) throw new Error('no procedure handler');
  return { resolution, next: applyEvents(state, resolution.events, system) };
}

const tallyOf = (state: GameState) => readDeathSaves(state.entities['hero']);
const texts = (r: { facts: readonly { text: string }[] }) => r.facts.map((f) => f.text);

describe('Death Saving Throw (SRD 5.2.1)', () => {
  it('10 or higher is a success, 9 or lower a failure, no modifiers', () => {
    const ok = save(scene(hero()), [10]);
    expect(texts(ok.resolution)).toEqual(['Death save 10 vs DC 10, success']);
    expect(tallyOf(ok.next)).toEqual({ successes: 1, failures: 0, stable: false, dead: false });
    const bad = save(scene(hero()), [9]);
    expect(texts(bad.resolution)).toEqual(['Death save 9 vs DC 10, failure']);
    expect(tallyOf(bad.next)).toMatchObject({ successes: 0, failures: 1 });
  });

  it('Exhaustion lowers the total by 2 per level: a raw 10 at level 1 fails', () => {
    const { resolution, next } = save(scene(hero({ exhaustion: 1 })), [10]);
    expect(texts(resolution)).toEqual(['Death save 8 vs DC 10, failure']);
    expect(tallyOf(next)).toMatchObject({ successes: 0, failures: 1 });
  });

  it('a raw 12 at Exhaustion 1 (total 10) still succeeds', () => {
    const { next } = save(scene(hero({ exhaustion: 1 })), [12]);
    expect(tallyOf(next)).toMatchObject({ successes: 1 });
  });

  it('a natural 1 is two failures, read from the unmodified die', () => {
    const { resolution, next } = save(scene(hero()), [1]);
    expect(texts(resolution)).toEqual(['Death save: natural 1, two failures']);
    expect(tallyOf(next)).toMatchObject({ failures: 2, dead: false });
  });

  it('a natural 20 wakes the hero at 1 HP even at Exhaustion 3', () => {
    const { resolution, next } = save(scene(hero({ exhaustion: 3 })), [20]);
    const woken = next.entities['hero'];
    expect(woken?.hp.current).toBe(1);
    expect(readConditions(woken as Entity).ids).toEqual([]);
    expect(readConditions(woken as Entity).exhaustion).toBe(3);
    expect(tallyOf(next)).toBeNull();
    expect(resolution.facts.map((f) => f.key)).toEqual(['death_save', 'hp']);
  });

  it('a natural 20 never counts as a failure after a penalty drops it below 10', () => {
    const { next } = save(scene(hero({ exhaustion: 5 })), [20]);
    expect(next.entities['hero']?.hp.current).toBe(1);
  });

  it('three failures kill', () => {
    const state = scene(hero({ tally: { successes: 1, failures: 2, stable: false, dead: false } }));
    const { resolution, next } = save(state, [4]);
    expect(resolution.facts.map((f) => f.key)).toEqual(['death_save', 'dead']);
    expect(tallyOf(next)).toMatchObject({ failures: 3, dead: true });
    expect(isDead(next.entities['hero'])).toBe(true);
    expect(isDying(next.entities['hero'])).toBe(false);
  });

  it('a natural 1 on the second failure also kills', () => {
    const state = scene(hero({ tally: { successes: 0, failures: 2, stable: false, dead: false } }));
    expect(tallyOf(save(state, [1]).next)).toMatchObject({ failures: 3, dead: true });
  });

  it('three successes with a friendly ally make the hero stable and clear the counters', () => {
    const guard: Entity = {
      ...monsterToEntity(goblin, 'guard_1'),
      system: { ...monsterToEntity(goblin, 'guard_1').system, attitude: 'friendly' },
    };
    const state = scene(
      hero({ tally: { successes: 2, failures: 1, stable: false, dead: false } }),
      [guard],
    );
    const { resolution, next } = save(state, [15]);
    expect(tallyOf(next)).toEqual({ successes: 0, failures: 0, stable: true, dead: false });
    expect(next.entities['hero']?.hp.current).toBe(0);
    expect(resolution.facts.some((f) => f.key === 'recovery')).toBe(false);
    expect(isDying(next.entities['hero'])).toBe(false);
  });

  it('a solo hero who stabilizes rests 1d4 hours, regains 1 HP and the encounter ends', () => {
    const state = applyEvents(
      scene(hero({ tally: { successes: 2, failures: 0, stable: false, dead: false } }), [
        { ...monsterToEntity(goblin, 'goblin_1'), system: { attitude: 'hostile' } },
      ]),
      [
        {
          type: 'state.systemDataSet',
          key: 'encounter',
          value: { round: 2, turnIndex: 0, acted: [], order: [{ entityId: 'hero', total: 9 }] },
        },
      ],
    );
    const { resolution, next } = save(state, [15, 3]);
    expect(texts(resolution)).toContain('hero regains 1 HP after 3 hours');
    expect(next.entities['hero']?.hp.current).toBe(1);
    expect(readConditions(next.entities['hero'] as Entity).ids).toEqual([]);
    expect(tallyOf(next)).toBeNull();
    expect(next.system['encounter']).toBeNull();
  });

  it('refuses a death save for a hero who is not dying', () => {
    expect(() => save(scene(hero({ hp: 5 })), [10])).toThrow(EngineError);
    const dead = hero({ tally: { successes: 0, failures: 3, stable: false, dead: true } });
    expect(() => save(scene(dead), [10])).toThrow(EngineError);
  });
});

describe('dropping to 0 HP and damage at 0 HP', () => {
  const alive = () => hero({ hp: 6 });

  it('reduced to 0: Unconscious and a fresh tally', () => {
    const out = downedOutcome(alive(), [], { total: 6, critical: false });
    const next = applyEvents(scene(alive()), out.events, system);
    expect(readConditions(next.entities['hero'] as Entity).ids).toEqual(['unconscious']);
    expect(tallyOf(next)).toEqual(FRESH_DEATH_SAVES);
    expect(out.facts).toEqual([{ key: 'condition', text: 'hero unconscious' }]);
  });

  it('still above 0: nothing happens', () => {
    expect(downedOutcome(alive(), [], { total: 5, critical: false })).toEqual({
      events: [],
      facts: [],
    });
  });

  it('massive damage: the remainder at or above the maximum kills at once', () => {
    // 6 HP, 16 damage: 10 left over = hit point maximum.
    const out = downedOutcome(alive(), [], { total: 16, critical: false });
    const next = applyEvents(scene(alive()), out.events, system);
    expect(tallyOf(next)).toMatchObject({ dead: true });
    expect(out.facts.map((f) => f.text)).toContain('hero dies (massive damage)');
    // One short of that is only unconscious.
    const short = downedOutcome(alive(), [], { total: 15, critical: false });
    expect(applyEvents(scene(alive()), short.events, system).entities['hero']).toBeDefined();
    expect(tallyOf(applyEvents(scene(alive()), short.events, system))).toEqual(FRESH_DEATH_SAVES);
  });

  it('damage at 0 HP is one failure, two on a critical hit, and ends stability', () => {
    const stable = hero({ tally: { successes: 0, failures: 0, stable: true, dead: false } });
    const hit = applyEvents(
      scene(stable),
      downedOutcome(stable, [], { total: 3, critical: false }).events,
      system,
    );
    expect(tallyOf(hit)).toEqual({ successes: 0, failures: 1, stable: false, dead: false });
    const crit = applyEvents(
      scene(hero()),
      downedOutcome(hero(), [], { total: 3, critical: true }).events,
      system,
    );
    expect(tallyOf(crit)).toMatchObject({ failures: 2, dead: false });
  });

  it('the third failure from damage kills', () => {
    const dying = hero({ tally: { successes: 1, failures: 2, stable: false, dead: false } });
    const out = downedOutcome(dying, [], { total: 1, critical: false });
    expect(out.facts.map((f) => f.key)).toEqual(['death_save', 'dead']);
    expect(tallyOf(applyEvents(scene(dying), out.events, system))).toMatchObject({ dead: true });
  });

  it('the dead take no further effect', () => {
    const dead = hero({ tally: { successes: 0, failures: 3, stable: false, dead: true } });
    expect(downedOutcome(dead, [], { total: 3, critical: true }).events).toEqual([]);
  });
});

describe('healing and exhaustion level 6', () => {
  it('healing a hero at 0 HP wakes them and clears the tally', () => {
    const dying = hero({ tally: { successes: 1, failures: 2, stable: false, dead: false } });
    const out = healEvents(dying, 4);
    const next = applyEvents(scene(dying), out.events, system);
    expect(next.entities['hero']?.hp.current).toBe(4);
    expect(readConditions(next.entities['hero'] as Entity).ids).toEqual([]);
    expect(tallyOf(next)).toBeNull();
    expect(out.facts.map((f) => f.key)).toEqual(['heal', 'condition', 'hp']);
  });

  it('healing a stable hero also wakes them', () => {
    const stable = hero({ tally: { successes: 0, failures: 0, stable: true, dead: false } });
    const next = applyEvents(scene(stable), healEvents(stable, 1).events, system);
    expect(next.entities['hero']?.hp.current).toBe(1);
    expect(tallyOf(next)).toBeNull();
  });

  it('healing a conscious hero only restores HP; the dead are not healed', () => {
    const out = healEvents(hero({ hp: 3 }), 4);
    expect(out.events).toHaveLength(1);
    const dead = hero({ tally: { successes: 0, failures: 3, stable: false, dead: true } });
    expect(healEvents(dead, 4).events).toEqual([]);
  });

  it('Exhaustion 6 kills a hero: unconscious, 0 HP, dead', () => {
    const entity = hero({ hp: 7, exhaustion: 5 });
    const out = exhaustionOutcome(entity, 6, []);
    const next = applyEvents(scene(entity), out.events, system);
    expect(next.entities['hero']?.hp.current).toBe(0);
    expect(isDead(next.entities['hero'])).toBe(true);
    expect(readConditions(next.entities['hero'] as Entity)).toEqual({
      ids: ['unconscious'],
      exhaustion: 6,
    });
    expect(out.facts).toEqual([{ key: 'dead', text: 'hero dies of exhaustion' }]);
  });

  it('Exhaustion 6 drops a monster to 0 HP', () => {
    const entity = monsterToEntity(goblin, 'goblin_1');
    const next = applyEvents(
      scene(hero({ hp: 5 }), [entity]),
      exhaustionOutcome(entity, 6, []).events,
      system,
    );
    expect(next.entities['goblin_1']?.hp.current).toBe(0);
  });

  it('lower exhaustion levels are not fatal', () => {
    const out = exhaustionOutcome(hero({ hp: 5 }), 4, []);
    expect(out.facts).toEqual([]);
    expect(out.events).toHaveLength(1);
  });
});
