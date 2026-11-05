import { z } from 'zod';

import { Ability, DamageType, DiceString } from './schema.js';

export const Spell = z
  .strictObject({
    id: z.string(),
    name: z.string(),
    level: z.number().int().min(0).max(9),
    school: z.string(),
    castingTime: z.string(),
    range: z.string(),
    /** null for Self and Touch. */
    rangeFeet: z.number().int().nullable(),
    concentration: z.boolean(),
    resolution: z.enum(['attack', 'save', 'auto', 'none']),
    attack: z.enum(['melee', 'ranged']).nullable(),
    save: z.strictObject({ ability: Ability, onSuccess: z.enum(['half', 'none']) }).nullable(),
    damage: z
      .strictObject({ dice: DiceString, type: DamageType, addSpellcastingMod: z.boolean() })
      .nullable(),
    heal: z.strictObject({ dice: DiceString, addSpellcastingMod: z.boolean() }).nullable(),
    /** Separate hits, e.g. Magic Missile darts. */
    projectiles: z.number().int().positive().nullable(),
    /** Damage dice by character level (cantrips). */
    cantripDice: z
      .array(z.strictObject({ minLevel: z.number().int(), dice: DiceString }))
      .nullable(),
    /** What each slot level above the spell's level adds. */
    upcast: z
      .strictObject({
        dicePerSlot: DiceString.nullable(),
        projectilesPerSlot: z.number().int().positive().nullable(),
      })
      .nullable(),
    text: z.string(),
    source: z.string().startsWith('/api/2024/'),
  })
  .superRefine((s, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (s.resolution === 'attack' && (s.attack === null || s.save !== null)) {
      bad("resolution 'attack' needs attack and no save");
    }
    if (s.resolution === 'save' && (s.save === null || s.attack !== null)) {
      bad("resolution 'save' needs save and no attack");
    }
    if ((s.resolution === 'auto' || s.resolution === 'none') && (s.attack || s.save)) {
      bad(`resolution '${s.resolution}' must have null attack and save`);
    }
    if (s.cantripDice !== null && s.level !== 0) bad('cantripDice only on cantrips');
  });
export type Spell = z.infer<typeof Spell>;
