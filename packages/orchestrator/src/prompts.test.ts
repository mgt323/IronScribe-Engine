import { applyEvents, createInitialState, type Fact } from '@iron-scribe/engine-core';
import { makeEntity } from '@iron-scribe/engine-core/testing';
import { describe, expect, it } from 'vitest';

import { buildDecisionPrompt, buildNarrationPrompt } from './prompts.js';

const named = (id: string, name: string, attitude: string, present = true) =>
  makeEntity(id, { name, present, system: { attitude } });

const state = applyEvents(
  createInitialState({ seed: 1 }),
  [
    makeEntity('hero', { name: 'Mira' }),
    named('rat_1', 'Rat', 'hostile'),
    named('rat_2', 'Rat', 'hostile'),
    named('guard_1', 'Guard', 'friendly'),
    named('wolf_1', 'Wolf', 'hostile', false),
  ].map((entity) => ({ type: 'entity.spawned' as const, entity })),
);

const scene = (facts: Fact[], input = 'I attack') =>
  buildNarrationPrompt(input, facts, state, 'hero').scene;

/** Facts an NPC step produced, tagged the way the combat loop tags them. */
const npc = (source: string, targetIds: string[], facts: Array<[string, string]>): Fact[] =>
  facts.map(([key, text]) => ({ key, text, source, targetIds }));

describe('prompts for spells and several targets', () => {
  it('says which actions take several targets', () => {
    const prompt = buildDecisionPrompt(
      {
        actions: [
          { alias: 'A1', actionId: 'weapon:dagger', label: 'Dagger', needsTarget: true },
          {
            alias: 'A2',
            actionId: 'spell:burning-hands',
            label: 'Burning Hands',
            needsTarget: true,
            maxTargets: 3,
          },
        ],
        targets: [{ alias: 'T1', entityId: 'rat_1', label: 'Rat' }],
      },
      'burn them',
    );
    expect(prompt.scene).toContain('A1 weapon:dagger — Dagger\n');
    expect(prompt.scene).toContain('A2 spell:burning-hands — Burning Hands (up to 3 targets)');
    expect(prompt.scene).toContain('secondaryTargetAlias');
  });

  it('turns a save fact into a plain outcome with display names, not ids', () => {
    const text = scene([
      { key: 'use', text: 'hero casts Burning Hands' },
      { key: 'save', text: 'rat_1 Dexterity save 4 vs DC 13, failure' },
      { key: 'save', text: 'rat_2 Dexterity save 19 vs DC 13, success' },
      { key: 'damage', text: '9 fire' },
    ]);
    expect(text).toContain('Outcome: Rat fails the saving throw and takes the effect in full.');
    expect(text).toContain('Outcome: Rat makes the saving throw and avoids most of the effect.');
    expect(text).not.toContain('Outcome: rat_');
    expect(text).not.toContain('Nobody is wounded');
  });
});

describe('7C.1 narration grounding', () => {
  it('lists only present creatures and separates scene presence from memory', () => {
    const text = scene([{ key: 'attack', text: '9 vs AC 12, hit' }], 'I attack the wolf');
    expect(text).toContain('Creatures in scene:\nrat_1 = Rat\nrat_2 = Rat\nguard_1 = Guard\n');
    expect(text).not.toContain('wolf_1');
    expect(text).not.toContain('hero = ');
    expect(text).toContain('memory or background only');
    expect(text).toContain('Never bring in a creature that is not listed');
    expect(text).toContain('Player line (tone and intent only, not an event');
  });

  it('does not ban history outright: off-screen mentions stay allowed as background', () => {
    const text = scene([{ key: 'attack', text: '9 vs AC 12, hit' }]);
    expect(text).not.toMatch(/never mention any other/i);
    expect(text).toContain('may be mentioned as memory or background');
  });

  it('forbids unrolled inner states but allows visible reactions to the facts', () => {
    const text = scene([{ key: 'attack', text: '9 vs AC 12, hit' }]);
    expect(text).toContain('secretly notices, spots, feels, thinks, or means to do next');
    expect(text).toContain('a flinch from a hit');
  });
});

describe('7C.1 outcome attribution', () => {
  it('labels the hero attack as yours and an NPC attack by its name', () => {
    const mine = scene([{ key: 'attack', text: '4 vs AC 12, miss' }]);
    expect(mine).toContain('Outcome: Your attack MISSES.');
    const hit = scene([{ key: 'attack', text: '15 vs AC 12, hit' }]);
    expect(hit).toContain('Outcome: Your attack HITS.');
    const theirs = scene([
      { key: 'npc_attack', text: 'Rat (Bite): 4 vs AC 12, miss', source: 'rat_1' },
    ]);
    expect(theirs).toContain("Outcome: Rat's attack MISSES.");
    expect(theirs).not.toContain('Your attack');
  });

  it('names a defeated creature by display name', () => {
    const text = scene([
      { key: 'attack', text: '15 vs AC 12, hit' },
      { key: 'defeated', text: 'rat_1' },
    ]);
    expect(text).toContain('Outcome: Rat is DEFEATED and falls.');
    expect(text).not.toContain('rat_1 is DEFEATED');
  });

  it('says the hero is unharmed when a hostile step aimed at them landed nothing', () => {
    const text = scene([
      { key: 'attack', text: '15 vs AC 12, hit' },
      { key: 'damage', text: '3 piercing' },
      { key: 'hp', text: 'rat_2 1/10' },
      ...npc('rat_1', ['hero'], [['npc_attack', 'Rat (Bite): 4 vs AC 12, miss']]),
    ]);
    expect(text).toContain('You take no damage from the enemy attack.');
  });

  it('never says unharmed when one sub-attack of a Multiattack hit the hero', () => {
    const text = scene(
      npc(
        'rat_1',
        ['hero'],
        [
          ['npc_attack', 'Rat (Bite): 4 vs AC 12, miss'],
          ['npc_attack', 'Rat (Bite): 16 vs AC 12, hit'],
          ['damage', '2 piercing'],
          ['hp', 'hero 6/10'],
        ],
      ),
    );
    expect(text).not.toContain('You take no damage');
  });

  it('never says unharmed when the NPC aimed at an ally, or when nobody was aimed at', () => {
    const ally = scene(npc('rat_1', ['guard_1'], [['npc_attack', 'Rat (Bite): 4 vs AC 12, miss']]));
    expect(ally).not.toContain('You take no damage');
    const none = scene([{ key: 'attack', text: '15 vs AC 12, hit' }]);
    expect(none).not.toContain('You take no damage');
  });

  it('a hero heal earlier in the turn does not stand in for an enemy hit', () => {
    const text = scene([
      { key: 'heal', text: 'hero regains 4 HP' },
      { key: 'hp', text: 'hero 10/10' },
      ...npc('rat_1', ['hero'], [['npc_attack', 'Rat (Bite): 4 vs AC 12, miss']]),
    ]);
    expect(text).toContain('You take no damage from the enemy attack.');
  });

  it('ignores a friendly NPC step when deciding the hero was unharmed', () => {
    const text = scene(
      npc('guard_1', ['hero'], [['npc_attack', 'Guard (Spear): 4 vs AC 12, miss']]),
    );
    expect(text).not.toContain('You take no damage');
  });

  it('a failed save aimed at the hero is not unharmed; a made save with no damage is', () => {
    const hit = scene(
      npc(
        'rat_1',
        ['hero'],
        [
          ['use', 'rat_1 uses Acid Spit'],
          ['save', 'hero Dexterity save 4 vs DC 12, failure'],
          ['damage', '5 acid'],
          ['hp', 'hero 5/10'],
        ],
      ),
    );
    expect(hit).toContain('Outcome: You fail the saving throw and take the effect in full.');
    expect(hit).not.toContain('You take no damage');
    const dodged = scene(
      npc(
        'rat_1',
        ['hero'],
        [
          ['use', 'rat_1 uses Acid Spit'],
          ['save', 'hero Dexterity save 18 vs DC 12, success'],
        ],
      ),
    );
    expect(dodged).toContain('Outcome: You make the saving throw and avoid most of the effect.');
    expect(dodged).toContain('You take no damage from the enemy attack.');
  });
});
