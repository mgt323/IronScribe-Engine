import { parseFormula } from '@iron-scribe/dice';
import { z } from 'zod';

/** Plain dice plus constants only ("2d8", "1d4+1"). Ability modifiers are never in a formula. */
export const DiceString = z.string().refine(
  (s) => {
    try {
      parseFormula(s);
      return true;
    } catch {
      return false;
    }
  },
  { error: 'not a valid dice formula' },
);

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export const Ability = z.enum(ABILITIES);
export type Ability = z.infer<typeof Ability>;

export const DamageType = z.enum([
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
]);
export type DamageType = z.infer<typeof DamageType>;

const Damage = z.strictObject({ dice: DiceString, type: DamageType });
const Range = z.strictObject({ normal: z.number().int(), long: z.number().int().nullable() });
/** Upstream API path; every entry must come from the 2024 data set. */
const Source = z.string().startsWith('/api/2024/');

// ---- Monster (stored whole in entity.system.monster, so it must be JSON-safe: null, never undefined)

export const MonsterAction = z.strictObject({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['melee', 'ranged', 'meleeOrRanged', 'save', 'other']),
  attackBonus: z.number().int().nullable(),
  reach: z.number().int().nullable(),
  range: Range.nullable(),
  /** Dice already include the modifier, exactly as the stat block prints them. */
  damage: z.array(
    z.strictObject({
      dice: DiceString,
      type: DamageType,
      condition: z.literal('advantage').nullable(),
    }),
  ),
  text: z.string(),
});
export type MonsterAction = z.infer<typeof MonsterAction>;

const AbilityScores = z.strictObject({
  str: z.number().int(),
  dex: z.number().int(),
  con: z.number().int(),
  int: z.number().int(),
  wis: z.number().int(),
  cha: z.number().int(),
});

export const Monster = z.strictObject({
  id: z.string(),
  name: z.string(),
  sizes: z.array(z.enum(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'])).min(1),
  type: z.string(),
  ac: z.number().int(),
  hp: z.number().int().positive(),
  hpFormula: DiceString,
  speed: z.strictObject({
    walk: z.number().int().nullable(),
    climb: z.number().int().nullable(),
    fly: z.number().int().nullable(),
    swim: z.number().int().nullable(),
    burrow: z.number().int().nullable(),
  }),
  abilities: AbilityScores,
  /** All six saving-throw bonuses, always filled in. */
  saves: AbilityScores,
  /** Only skills the stat block lists; others fall back to the ability modifier. */
  skills: z.record(z.string(), z.number().int()),
  resistances: z.array(DamageType),
  vulnerabilities: z.array(DamageType),
  immunities: z.array(DamageType),
  conditionImmunities: z.array(z.string()),
  actions: z.array(MonsterAction),
  traits: z.array(z.strictObject({ name: z.string(), text: z.string() })),
  cr: z.number(),
  xp: z.number().int(),
  proficiencyBonus: z.number().int(),
  source: Source,
});
export type Monster = z.infer<typeof Monster>;

// ---- Weapon / Armor

export const WEAPON_PROPERTIES = [
  'ammunition',
  'finesse',
  'heavy',
  'light',
  'loading',
  'range',
  'reach',
  'thrown',
  'two-handed',
  'versatile',
] as const;
export const MASTERIES = [
  'cleave',
  'graze',
  'nick',
  'push',
  'sap',
  'slow',
  'topple',
  'vex',
] as const;

export const Weapon = z.strictObject({
  id: z.string(),
  name: z.string(),
  category: z.enum(['simple', 'martial']),
  kind: z.enum(['melee', 'ranged']),
  /** Weapon dice only; Stage 4 adds the ability modifier. */
  damage: Damage,
  versatileDamage: Damage.nullable(),
  properties: z.array(z.enum(WEAPON_PROPERTIES)),
  mastery: z.enum(MASTERIES),
  range: Range,
  throwRange: Range.nullable(),
  source: Source,
});
export type Weapon = z.infer<typeof Weapon>;

const BodyArmor = z.strictObject({
  kind: z.literal('body'),
  id: z.string(),
  name: z.string(),
  category: z.enum(['light', 'medium', 'heavy']),
  baseAc: z.number().int(),
  /** null = no limit, a number = cap, 0 = no Dexterity bonus. */
  dexCap: z.number().int().nullable(),
  strMin: z.number().int().nullable(),
  stealthDisadvantage: z.boolean(),
  source: Source,
});
const ShieldArmor = z.strictObject({
  kind: z.literal('shield'),
  id: z.string(),
  name: z.string(),
  /** Adds to current AC; does not set it. */
  acBonus: z.number().int(),
  source: Source,
});
export const Armor = z.discriminatedUnion('kind', [BodyArmor, ShieldArmor]);
export type Armor = z.infer<typeof Armor>;
