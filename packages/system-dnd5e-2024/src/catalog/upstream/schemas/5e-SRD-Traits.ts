// COPIED FROM UPSTREAM - DO NOT EDIT. Written only by `pnpm srd:import`.
// Source: https://github.com/5e-bits/5e-srd-api/blob/6dfaa6e2f1aefc466fb45b9a64e4dd11a537ca53/packages/5e-database/src/2024/schemas/5e-SRD-Traits.ts (MIT, see LICENSE.md)
import { z } from 'zod';
import { APIReferenceSchema, ChoiceSchema } from '../common.js';

const SpellTraitSchema = z.strictObject({
  spell: APIReferenceSchema,
  uses: z.string().optional(),
  recovery: z.string().optional(),
});

export const TraitSchema = z.strictObject({
  index: z.string(),
  name: z.string(),
  url: z.string(),
  description: z.string(),
  species: z.array(APIReferenceSchema),
  spells: z.array(SpellTraitSchema).optional(),
  subspecies: z.array(APIReferenceSchema).optional(),
  proficiency_choices: ChoiceSchema.optional(),
  speed: z.number().optional(),
});
