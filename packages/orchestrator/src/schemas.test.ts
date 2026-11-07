import type { ActionMenu } from '@iron-scribe/engine-core';
import { toFlatJsonSchema } from '@iron-scribe/llm';
import { describe, expect, it } from 'vitest';

import {
  buildDecisionSchema,
  buildIntentSchema,
  nullableEnum,
  targetAliasesOf,
} from './schemas.js';

const catalog = {
  abilities: ['str', 'dex'],
  skills: ['stealth'],
};

const menu: ActionMenu = {
  actions: [
    { alias: 'A1', actionId: 'poke', label: 'Poke', needsTarget: true },
    { alias: 'A2', actionId: 'wait', label: 'Wait', needsTarget: false },
  ],
  targets: [{ alias: 'T1', entityId: 'rat_1', label: 'Rat' }],
};

const intent = {
  spawnIsNew: true,
  spawn1Query: null,
  spawn1Count: null,
  spawn1Attitude: null,
  spawn2Query: null,
  spawn2Count: null,
  spawn2Attitude: null,
  spawn3Query: null,
  spawn3Count: null,
  spawn3Attitude: null,
  spawn1Proximity: null,
  spawn2Proximity: null,
  spawn3Proximity: null,
  checkAbility: null,
  checkSkill: null,
  wantsAction: false,
};

describe('intent and decision schemas', () => {
  it('stays flat, and an empty alias list is null rather than an empty enum', () => {
    expect(() => nullableEnum([])).not.toThrow();
    const empty = buildDecisionSchema({ actions: [], targets: [] });
    expect(toFlatJsonSchema('decision', empty).jsonSchema['type']).toBe('object');
    expect(
      toFlatJsonSchema('turn_intent', buildIntentSchema(catalog, true)).jsonSchema,
    ).toMatchObject({
      additionalProperties: false,
    });
    expect(
      toFlatJsonSchema('turn_intent', buildIntentSchema(undefined, false)).jsonSchema,
    ).toMatchObject({
      additionalProperties: false,
    });
    expect(
      empty.safeParse({
        kind: 'none',
        actionAlias: null,
        targetAlias: null,
        secondaryTargetAlias: null,
        tertiaryTargetAlias: null,
      }).success,
    ).toBe(true);
    expect(
      empty.safeParse({
        kind: 'action',
        actionAlias: null,
        targetAlias: null,
        secondaryTargetAlias: null,
        tertiaryTargetAlias: null,
      }).success,
    ).toBe(false);
  });

  it('requires a complete spawn and refuses a DC or a count outside 1..10', () => {
    const schema = buildIntentSchema(catalog, true);
    expect(
      schema.safeParse({ ...intent, spawn1Query: 'rat', spawn1Count: 1, spawn1Attitude: 'hostile' })
        .success,
    ).toBe(true);
    expect(schema.safeParse({ ...intent, spawn1Query: 'rat' }).success).toBe(false);
    expect(
      schema.safeParse({ ...intent, spawn1Query: '   ', spawn1Count: 1, spawn1Attitude: 'hostile' })
        .success,
    ).toBe(false);
    expect(schema.safeParse({ ...intent, spawn1Count: 11 }).success).toBe(false);
    expect(schema.safeParse({ ...intent, spawn1Count: 0 }).success).toBe(false);
    expect(
      schema.safeParse({
        ...intent,
        spawn1Query: 'wolf',
        spawn1Count: 1,
        spawn1Attitude: 'hostile',
        spawn2Query: 'bandit',
        spawn2Count: 2,
        spawn2Attitude: 'hostile',
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        ...intent,
        spawn1Query: 'wolf',
        spawn1Count: 6,
        spawn1Attitude: 'hostile',
        spawn2Query: 'bandit',
        spawn2Count: 5,
        spawn2Attitude: 'hostile',
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...intent,
        spawn2Query: 'bandit',
        spawn2Count: 1,
        spawn2Attitude: 'hostile',
      }).success,
    ).toBe(false);
    const flat = toFlatJsonSchema('turn_intent', schema).jsonSchema;
    expect(flat['required']).toEqual([
      'spawnIsNew',
      'spawn1Query',
      'spawn1Count',
      'spawn1Attitude',
      'spawn1Proximity',
      'spawn2Query',
      'spawn2Count',
      'spawn2Attitude',
      'spawn2Proximity',
      'spawn3Query',
      'spawn3Count',
      'spawn3Attitude',
      'spawn3Proximity',
      'checkAbility',
      'checkSkill',
      'wantsAction',
    ]);
    expect(JSON.stringify(flat)).not.toContain('"array"');
    expect(schema.safeParse({ ...intent, checkSkill: 'stealth' }).success).toBe(false);
    expect(
      schema.safeParse({ ...intent, checkAbility: 'dex', checkSkill: 'stealth' }).success,
    ).toBe(true);
    expect(
      'checkDc' in (toFlatJsonSchema('turn_intent', schema).jsonSchema['properties'] as object),
    ).toBe(false);
  });

  it('a targeted action needs a target alias, and none clears both', () => {
    const schema = buildDecisionSchema(menu);
    expect(
      schema.safeParse({
        kind: 'action',
        actionAlias: 'A1',
        targetAlias: 'T1',
        secondaryTargetAlias: null,
        tertiaryTargetAlias: null,
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        kind: 'action',
        actionAlias: 'A1',
        targetAlias: null,
        secondaryTargetAlias: null,
        tertiaryTargetAlias: null,
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        kind: 'action',
        actionAlias: 'A2',
        targetAlias: null,
        secondaryTargetAlias: null,
        tertiaryTargetAlias: null,
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        kind: 'action',
        actionAlias: 'A2',
        targetAlias: 'T1',
        secondaryTargetAlias: null,
        tertiaryTargetAlias: null,
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        kind: 'none',
        actionAlias: null,
        targetAlias: null,
        secondaryTargetAlias: null,
        tertiaryTargetAlias: null,
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        kind: 'none',
        actionAlias: 'A2',
        targetAlias: null,
        secondaryTargetAlias: null,
        tertiaryTargetAlias: null,
      }).success,
    ).toBe(false);
    const noTargets = buildDecisionSchema({ ...menu, targets: [] });
    expect(
      noTargets.safeParse({
        kind: 'action',
        actionAlias: 'A1',
        targetAlias: null,
        secondaryTargetAlias: null,
        tertiaryTargetAlias: null,
      }).success,
    ).toBe(false);
    expect(
      noTargets.safeParse({
        kind: 'none',
        actionAlias: null,
        targetAlias: null,
        secondaryTargetAlias: null,
        tertiaryTargetAlias: null,
      }).success,
    ).toBe(true);
  });

  describe('several targets', () => {
    const wide = buildDecisionSchema({
      actions: [
        { alias: 'A1', actionId: 'stab', label: 'Stab', needsTarget: true },
        { alias: 'A2', actionId: 'burst', label: 'Burst', needsTarget: true, maxTargets: 3 },
        { alias: 'A3', actionId: 'wait', label: 'Wait', needsTarget: false },
      ],
      targets: [
        { alias: 'T1', entityId: 'a', label: 'A' },
        { alias: 'T2', entityId: 'b', label: 'B' },
        { alias: 'T3', entityId: 'c', label: 'C' },
      ],
    });
    const pick = (action: string, t1: string | null, t2: string | null, t3: string | null) =>
      wide.safeParse({
        kind: 'action',
        actionAlias: action,
        targetAlias: t1,
        secondaryTargetAlias: t2,
        tertiaryTargetAlias: t3,
      }).success;

    it('accepts up to the action limit, in flat fields', () => {
      expect(pick('A2', 'T1', 'T2', 'T3')).toBe(true);
      expect(pick('A2', 'T3', 'T1', null)).toBe(true);
      expect(pick('A1', 'T1', null, null)).toBe(true);
    });

    it('rejects extra targets on a single-target action, gaps and targets on a no-target action', () => {
      expect(pick('A1', 'T1', 'T2', null)).toBe(false);
      expect(pick('A2', 'T1', null, 'T3')).toBe(false);
      expect(pick('A3', null, 'T2', null)).toBe(false);
      expect(pick('A2', null, 'T2', null)).toBe(false);
    });

    it('allows a repeated target: one slot per dart or sub-attack', () => {
      expect(pick('A2', 'T1', 'T1', 'T2')).toBe(true);
      expect(pick('A2', 'T1', 'T2', 'T2')).toBe(true);
      expect(pick('A2', 'T1', 'T1', 'T1')).toBe(true);
    });

    it('stays flat: no arrays, every field required', () => {
      const flat = toFlatJsonSchema('decision', wide).jsonSchema;
      expect(flat['required']).toEqual([
        'kind',
        'actionAlias',
        'targetAlias',
        'secondaryTargetAlias',
        'tertiaryTargetAlias',
      ]);
      expect(JSON.stringify(flat)).not.toContain('"array"');
    });

    it('lists the targets in order', () => {
      expect(
        targetAliasesOf({
          targetAlias: 'T2',
          secondaryTargetAlias: null,
          tertiaryTargetAlias: null,
        }),
      ).toEqual(['T2']);
    });
  });
});
