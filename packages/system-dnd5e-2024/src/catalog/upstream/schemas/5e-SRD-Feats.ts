// COPIED FROM UPSTREAM - DO NOT EDIT. Written only by `pnpm srd:import`.
// Source: https://github.com/5e-bits/5e-srd-api/blob/6dfaa6e2f1aefc466fb45b9a64e4dd11a537ca53/packages/5e-database/src/2024/schemas/5e-SRD-Feats.ts (MIT, see LICENSE.md)
import { z } from 'zod';
import { ChoiceSchema } from '../common.js';

const FeatPrerequisitesSchema = z.strictObject({
  minimum_level: z.number().optional(),
  feature_named: z.string().optional(),
});

export const FeatSchema = z.strictObject({
  index: z.string(),
  name: z.string(),
  description: z.string(),
  type: z.string(),
  repeatable: z.string().optional(),
  prerequisites: FeatPrerequisitesSchema.optional(),
  prerequisite_options: ChoiceSchema.optional(),
  url: z.string(),
});
