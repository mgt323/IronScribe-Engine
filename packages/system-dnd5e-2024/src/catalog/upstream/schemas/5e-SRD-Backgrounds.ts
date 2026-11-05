// COPIED FROM UPSTREAM - DO NOT EDIT. Written only by `pnpm srd:import`.
// Source: https://github.com/5e-bits/5e-srd-api/blob/6dfaa6e2f1aefc466fb45b9a64e4dd11a537ca53/packages/5e-database/src/2024/schemas/5e-SRD-Backgrounds.ts (MIT, see LICENSE.md)
import { z } from 'zod';
import { APIReferenceSchema, ChoiceSchema } from '../common.js';

const BackgroundFeatReferenceSchema = z.strictObject({
  index: z.string(),
  name: z.string(),
  url: z.string(),
  note: z.string().optional(),
});

export const BackgroundSchema = z.strictObject({
  index: z.string(),
  name: z.string(),
  ability_scores: z.array(APIReferenceSchema),
  feat: BackgroundFeatReferenceSchema,
  proficiencies: z.array(APIReferenceSchema),
  proficiency_choices: z.array(ChoiceSchema).optional(),
  equipment_options: z.array(ChoiceSchema).optional(),
  url: z.string(),
});
