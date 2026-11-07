import { createInitialState } from '@iron-scribe/engine-core';
import { describe, expect, it } from 'vitest';

import { buildDecisionPrompt, buildNarrationPrompt } from './prompts.js';

const state = createInitialState({ seed: 1 });

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

  it('turns a save fact into a plain outcome, so a terse roll is not read backwards', () => {
    const facts = [
      { key: 'use', text: 'hero casts Burning Hands' },
      { key: 'save', text: 'rat_1 Dexterity save 4 vs DC 13, failure' },
      { key: 'save', text: 'rat_2 Dexterity save 19 vs DC 13, success' },
      { key: 'damage', text: '9 fire' },
    ];
    const scene = buildNarrationPrompt('I burn them', facts, state, 'hero').scene;
    expect(scene).toContain('Outcome: rat_1 fails the saving throw and takes the effect in full.');
    expect(scene).toContain('Outcome: rat_2 makes the saving throw and avoids most of the effect.');
    expect(scene).not.toContain('Nobody is wounded');
  });
});
