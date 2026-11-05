// COPIED FROM UPSTREAM - DO NOT EDIT. Written only by `pnpm srd:import`.
// Source: https://github.com/5e-bits/5e-srd-api/blob/6dfaa6e2f1aefc466fb45b9a64e4dd11a537ca53/packages/5e-database/src/2024/schemas/5e-SRD-Spells.ts (MIT, see LICENSE.md)
import { z } from 'zod';
import { APIReferenceSchema, AreaOfEffectSchema } from '../common.js';

const SpellDamageSchema = z.strictObject({
  damage_type: APIReferenceSchema.optional(),
  damage_at_slot_level: z.record(z.string(), z.string()).optional(),
  damage_at_character_level: z.record(z.string(), z.string()).optional(),
});

const SpellDCSchema = z.strictObject({
  dc_type: APIReferenceSchema,
  dc_success: z.string(),
  desc: z.string().optional(),
});

export const SpellsSchema = z.strictObject({
  index: z.string(),
  name: z.string(),
  description: z.string(),
  higher_level: z.string().optional(),
  range: z.string(),
  components: z.array(z.string()),
  material: z.string().optional(),
  ritual: z.boolean(),
  duration: z.string(),
  concentration: z.boolean(),
  casting_time: z.string(),
  level: z.number(),
  attack_type: z.string().optional(),
  damage: SpellDamageSchema.optional(),
  dc: SpellDCSchema.optional(),
  area_of_effect: AreaOfEffectSchema.optional(),
  heal_at_slot_level: z.record(z.string(), z.string()).optional(),
  school: APIReferenceSchema,
  classes: z.array(APIReferenceSchema),
  subclasses: z.array(APIReferenceSchema).optional(),
  url: z.string(),
});
