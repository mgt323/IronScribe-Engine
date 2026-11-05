import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { LlmError } from './errors.js';
import { toFlatJsonSchema } from './schema.js';

describe('toFlatJsonSchema', () => {
  it('strips $schema and keeps a nullable enum as anyOf', () => {
    const flat = toFlatJsonSchema(
      'choice',
      z.strictObject({
        kind: z.enum(['action', 'none']),
        targetAlias: z.enum(['T1', 'T2']).nullable(),
        note: z.string().nullable(),
        count: z.number().int(),
        ok: z.boolean(),
      }),
    );
    expect(flat.name).toBe('choice');
    expect(flat.jsonSchema).not.toHaveProperty('$schema');
    expect(flat.jsonSchema['additionalProperties']).toBe(false);
    const properties = flat.jsonSchema['properties'] as {
      targetAlias: { anyOf: unknown[] };
      note: { type: unknown };
    };
    expect(properties.targetAlias.anyOf).toEqual([
      { type: 'string', enum: ['T1', 'T2'] },
      { type: 'null' },
    ]);
    expect(properties.note.type).toEqual(['string', 'null']);
  });

  it('allows a null-only field when there is no legal alias', () => {
    const flat = toFlatJsonSchema('empty', z.strictObject({ targetAlias: z.null() }));
    expect(flat.jsonSchema['properties']).toMatchObject({ targetAlias: { type: 'null' } });
  });

  it.each([
    ['nested object', z.strictObject({ child: z.strictObject({ ok: z.boolean() }) })],
    ['array', z.strictObject({ ids: z.array(z.string()) })],
    ['optional field', z.object({ name: z.string(), extra: z.string().optional() })],
    ['float', z.strictObject({ amount: z.number() })],
    ['union', z.strictObject({ value: z.union([z.string(), z.number().int()]) })],
    ['open object', z.strictObject({ name: z.string() }).passthrough()],
  ])('rejects a %s', (_label, schema) => {
    expect(() => toFlatJsonSchema('bad', schema)).toThrow(LlmError);
    try {
      toFlatJsonSchema('bad', schema);
    } catch (error) {
      expect(error).toBeInstanceOf(LlmError);
      expect((error as LlmError).code).toBe('non_flat_schema');
    }
  });
});
