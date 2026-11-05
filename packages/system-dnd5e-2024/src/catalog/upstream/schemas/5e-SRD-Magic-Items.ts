// COPIED FROM UPSTREAM - DO NOT EDIT. Written only by `pnpm srd:import`.
// Source: https://github.com/5e-bits/5e-srd-api/blob/6dfaa6e2f1aefc466fb45b9a64e4dd11a537ca53/packages/5e-database/src/2024/schemas/5e-SRD-Magic-Items.ts (MIT, see LICENSE.md)
import { z } from 'zod';
import { APIReferenceSchema } from '../common.js';

const RaritySchema = z.strictObject({
  name: z.string(),
});

export const MagicItemSchema = z.strictObject({
  name: z.string(),
  index: z.string(),
  url: z.string(),
  image: z.string(),
  equipment_category: APIReferenceSchema,
  variant: z.boolean(),
  variants: z.array(APIReferenceSchema),
  attunement: z.boolean(),
  rarity: RaritySchema,
  desc: z.array(z.string()),
  'limited-to': z.string().optional(),
});
