// COPIED FROM UPSTREAM - DO NOT EDIT. Written only by `pnpm srd:import`.
// Source: https://github.com/5e-bits/5e-srd-api/blob/6dfaa6e2f1aefc466fb45b9a64e4dd11a537ca53/packages/5e-database/src/2024/schemas/5e-SRD-Weapon-Mastery-Properties.ts (MIT, see LICENSE.md)
import { z } from 'zod';

export const WeaponMasteryPropertySchema = z.strictObject({
  index: z.string(),
  name: z.string(),
  description: z.string(),
  url: z.string(),
});
