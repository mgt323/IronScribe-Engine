import { z } from 'zod';

// Loose schemas: only the upstream (5e-bits 2024) fields we read. Unknown fields are ignored.

const Ref = z.object({ index: z.string(), name: z.string(), url: z.string() });

const RawDamage = z.object({ damage_type: Ref, damage_dice: z.string() });

const RawAction = z.object({
  name: z.string(),
  desc: z.string(),
  attack_bonus: z.number().optional(),
  damage: z.array(RawDamage).optional(),
  dc: z.unknown().optional(),
});

export const RawMonster = z.object({
  index: z.string(),
  url: z.string(),
  name: z.string(),
  size: z.string(),
  type: z.string(),
  armor_class: z.array(z.object({ value: z.number() })).min(1),
  hit_points: z.number(),
  hit_points_roll: z.string(),
  speed: z.record(z.string(), z.string()),
  strength: z.number(),
  dexterity: z.number(),
  constitution: z.number(),
  intelligence: z.number(),
  wisdom: z.number(),
  charisma: z.number(),
  damage_resistances: z.array(z.string()),
  damage_vulnerabilities: z.array(z.string()),
  damage_immunities: z.array(z.string()),
  condition_immunities: z.array(Ref),
  proficiencies: z.array(z.object({ value: z.number(), proficiency: Ref })),
  challenge_rating: z.number(),
  xp: z.number(),
  proficiency_bonus: z.number(),
  special_abilities: z.array(z.object({ name: z.string(), desc: z.string() })).optional(),
  actions: z.array(RawAction),
});
export type RawMonster = z.infer<typeof RawMonster>;

const RawDie = z.object({ damage_dice: z.string(), damage_type: Ref });
const RawRange = z.object({ normal: z.number(), long: z.number().optional() });

export const RawEquipment = z.object({
  index: z.string(),
  url: z.string(),
  name: z.string(),
  equipment_categories: z.array(Ref),
  damage: RawDie.optional(),
  two_handed_damage: RawDie.optional(),
  properties: z.array(Ref).optional(),
  mastery: Ref.optional(),
  range: RawRange.optional(),
  throw_range: RawRange.optional(),
  armor_class: z
    .object({ base: z.number(), dex_bonus: z.boolean(), max_bonus: z.number().optional() })
    .optional(),
  str_minimum: z.number().optional(),
  stealth_disadvantage: z.boolean().optional(),
});
export type RawEquipment = z.infer<typeof RawEquipment>;

export const RawSpell = z.object({
  index: z.string(),
  url: z.string(),
  name: z.string(),
  level: z.number(),
  school: Ref,
  casting_time: z.string(),
  range: z.string(),
  concentration: z.boolean(),
  description: z.string(),
  damage: z
    .object({ damage_type: Ref, damage_at_slot_level: z.record(z.string(), z.string()) })
    .optional(),
});
export type RawSpell = z.infer<typeof RawSpell>;

export const RawProperty = z.object({
  index: z.string(),
  name: z.string(),
  description: z.string(),
  url: z.string(),
});
