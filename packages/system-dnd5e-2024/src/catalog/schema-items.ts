import { z } from 'zod';

import { Source } from './schema.js';

export const GEAR_KINDS = [
  'ammunition',
  'tool',
  'instrument',
  'gaming-set',
  'focus',
  'pack',
  'gear',
] as const;

/** Non-weapon, non-armor equipment. */
export const Gear = z.strictObject({
  id: z.string(),
  name: z.string(),
  kind: z.enum(GEAR_KINDS),
  cost: z.strictObject({ quantity: z.number(), unit: z.string() }),
  weight: z.number().nullable(),
  text: z.string(),
  source: Source,
});
export type Gear = z.infer<typeof Gear>;

export const MagicItem = z.strictObject({
  id: z.string(),
  name: z.string(),
  /** Equipment category id: wondrous-items, weapons, armor, rings, potions, wands, staffs. */
  category: z.string(),
  /** Kept as printed: some items list several rarities ("Uncommon (+1), Rare (+2), ..."). */
  rarity: z.string(),
  attunement: z.boolean(),
  variantOf: z.string().nullable(),
  variants: z.array(z.string()),
  text: z.string(),
  source: Source,
});
export type MagicItem = z.infer<typeof MagicItem>;

/** Rules reference entries: conditions, damage types, ability scores, skills. */
export const RuleEntry = z.strictObject({
  id: z.string(),
  name: z.string(),
  text: z.string(),
  /** Skills only: the ability id (str, dex, ...). */
  ability: z.string().nullable(),
  source: Source,
});
export type RuleEntry = z.infer<typeof RuleEntry>;
