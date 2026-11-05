// COPIED FROM UPSTREAM - DO NOT EDIT. Written only by `pnpm srd:import`.
// Source: https://github.com/5e-bits/5e-srd-api/blob/6dfaa6e2f1aefc466fb45b9a64e4dd11a537ca53/packages/5e-database/src/2024/schemas/5e-SRD-Levels.ts (MIT, see LICENSE.md)
import { z } from 'zod';
import { APIReferenceSchema } from '../common.js';

const ClassSpecificSchema = z.strictObject({
  bardic_inspiration_die: z.number().optional(),
  channel_divinity_charges: z.number().optional(),
  eldritch_invocations: z.number().optional(),
  favored_enemies: z.number().optional(),
  focus_points: z.number().optional(),
  martial_arts_die: z.number().optional(),
  rage_count: z.number().optional(),
  rage_damage_bonus: z.number().optional(),
  second_wind_uses: z.number().optional(),
  sneak_attack: z.strictObject({ dice_count: z.number(), dice_value: z.number() }).optional(),
  sorcery_points: z.number().optional(),
  unarmored_movement_bonus: z.number().optional(),
  weapon_mastery: z.number().optional(),
  wild_shape_uses: z.number().optional(),
});

const LevelSpellcastingSchema = z.strictObject({
  cantrips_known: z.number().optional(),
  prepared_spells: z.number().optional(),
  spell_slots_level_1: z.number(),
  spell_slots_level_2: z.number(),
  spell_slots_level_3: z.number(),
  spell_slots_level_4: z.number(),
  spell_slots_level_5: z.number(),
  spell_slots_level_6: z.number().optional(),
  spell_slots_level_7: z.number().optional(),
  spell_slots_level_8: z.number().optional(),
  spell_slots_level_9: z.number().optional(),
});

export const LevelSchema = z.strictObject({
  index: z.string(),
  name: z.string(),
  level: z.number(),
  prof_bonus: z.number().optional(),
  features: z.array(APIReferenceSchema).optional(),
  class: APIReferenceSchema,
  subclass: APIReferenceSchema.optional(),
  class_specific: ClassSpecificSchema.optional(),
  spellcasting: LevelSpellcastingSchema.optional(),
  url: z.string(),
});
