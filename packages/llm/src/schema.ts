import { z } from 'zod';

import { LlmError } from './errors.js';
import type { FlatJsonSchema } from './types.js';

const PRIMITIVES = new Set(['string', 'integer', 'boolean', 'null']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `Array.isArray` narrows to `any[]`; this keeps the elements unknown. */
function unknownList(value: unknown): readonly unknown[] | null {
  if (!Array.isArray(value)) return null;
  return value as readonly unknown[];
}

/** Nested objects, arrays, and combinators other than a single nullable anyOf. */
function hasStructure(value: Record<string, unknown>): boolean {
  return (
    'properties' in value ||
    'items' in value ||
    'oneOf' in value ||
    'allOf' in value ||
    'not' in value ||
    '$ref' in value
  );
}

function isNullSchema(value: unknown): boolean {
  return isRecord(value) && !hasStructure(value) && !('anyOf' in value) && value['type'] === 'null';
}

/** A flat primitive, an enum, or Zod's `type: ["string", "null"]` form. */
function isFlatPrimitive(value: unknown): boolean {
  if (!isRecord(value) || hasStructure(value) || 'anyOf' in value) return false;
  const type = value['type'];
  if (typeof type === 'string') return PRIMITIVES.has(type);
  if (!Array.isArray(type) || !type.includes('null')) return false;
  const rest = type.filter((entry) => entry !== 'null');
  return (
    rest.length === 1 &&
    typeof rest[0] === 'string' &&
    rest[0] !== 'null' &&
    PRIMITIVES.has(rest[0])
  );
}

/**
 * Zod 4 emits `.nullable()` enums and integers as
 * `anyOf: [{ type, enum? }, { type: "null" }]`.
 */
function isNullableFlat(value: unknown): boolean {
  if (!isRecord(value) || hasStructure(value)) return false;
  const parts = unknownList(value['anyOf']);
  if (!parts || parts.length !== 2) return false;
  const nullPart = parts.find((part) => isNullSchema(part));
  const other = parts.find((part) => part !== nullPart);
  if (!nullPart || !isRecord(other) || hasStructure(other) || 'anyOf' in other) return false;
  const type = other['type'];
  return type === 'string' || type === 'integer' || type === 'boolean';
}

function assertFlatRoot(schema: Record<string, unknown>): void {
  if (schema['type'] !== 'object' || schema['additionalProperties'] !== false) {
    throw new LlmError(
      'non_flat_schema',
      'Root schema must be an object with additionalProperties: false',
    );
  }
  const properties = schema['properties'];
  if (!isRecord(properties)) {
    throw new LlmError('non_flat_schema', 'Root schema needs a properties object');
  }
  const keys = Object.keys(properties);
  const required = Array.isArray(schema['required'])
    ? schema['required'].filter((key): key is string => typeof key === 'string')
    : [];
  if (required.length !== keys.length || keys.some((key) => !required.includes(key))) {
    throw new LlmError('non_flat_schema', 'Every property must be required');
  }
  for (const key of keys) {
    const property = properties[key];
    if (!isFlatPrimitive(property) && !isNullableFlat(property)) {
      throw new LlmError('non_flat_schema', `Property "${key}" is not a flat primitive`);
    }
  }
}

/** Convert a Zod schema into the flat JSON Schema subset local models and strict modes accept. */
export function toFlatJsonSchema(name: string, schema: z.ZodType): FlatJsonSchema {
  const generated: unknown = z.toJSONSchema(schema);
  if (!isRecord(generated)) {
    throw new LlmError('non_flat_schema', 'JSON Schema root must be an object');
  }
  const jsonSchema: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(generated)) {
    if (key === '$schema') continue;
    jsonSchema[key] = value;
  }
  assertFlatRoot(jsonSchema);
  return { name, jsonSchema };
}
