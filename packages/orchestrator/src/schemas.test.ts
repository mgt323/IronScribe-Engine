import type { ActionMenu } from '@iron-scribe/engine-core';
import { toFlatJsonSchema } from '@iron-scribe/llm';
import { describe, expect, it } from 'vitest';

import { buildDecisionSchema, buildIntentSchema, nullableEnum } from './schemas.js';

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
  spawnQuery: null,
  spawnCount: null,
  spawnAttitude: null,
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
    expect(empty.safeParse({ kind: 'none', actionAlias: null, targetAlias: null }).success).toBe(
      true,
    );
    expect(empty.safeParse({ kind: 'action', actionAlias: null, targetAlias: null }).success).toBe(
      false,
    );
  });

  it('requires a complete spawn and refuses a DC or a count outside 1..10', () => {
    const schema = buildIntentSchema(catalog, true);
    expect(
      schema.safeParse({ ...intent, spawnQuery: 'rat', spawnCount: 1, spawnAttitude: 'hostile' })
        .success,
    ).toBe(true);
    expect(schema.safeParse({ ...intent, spawnQuery: 'rat' }).success).toBe(false);
    expect(
      schema.safeParse({ ...intent, spawnQuery: '   ', spawnCount: 1, spawnAttitude: 'hostile' })
        .success,
    ).toBe(false);
    expect(schema.safeParse({ ...intent, spawnCount: 11 }).success).toBe(false);
    expect(schema.safeParse({ ...intent, spawnCount: 0 }).success).toBe(false);
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
    expect(schema.safeParse({ kind: 'action', actionAlias: 'A1', targetAlias: 'T1' }).success).toBe(
      true,
    );
    expect(schema.safeParse({ kind: 'action', actionAlias: 'A1', targetAlias: null }).success).toBe(
      false,
    );
    expect(schema.safeParse({ kind: 'action', actionAlias: 'A2', targetAlias: null }).success).toBe(
      true,
    );
    expect(schema.safeParse({ kind: 'action', actionAlias: 'A2', targetAlias: 'T1' }).success).toBe(
      false,
    );
    expect(schema.safeParse({ kind: 'none', actionAlias: null, targetAlias: null }).success).toBe(
      true,
    );
    expect(schema.safeParse({ kind: 'none', actionAlias: 'A2', targetAlias: null }).success).toBe(
      false,
    );
    const noTargets = buildDecisionSchema({ ...menu, targets: [] });
    expect(
      noTargets.safeParse({ kind: 'action', actionAlias: 'A1', targetAlias: null }).success,
    ).toBe(false);
    expect(
      noTargets.safeParse({ kind: 'none', actionAlias: null, targetAlias: null }).success,
    ).toBe(true);
  });
});
