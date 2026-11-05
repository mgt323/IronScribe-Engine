import { z } from 'zod';

import { Ability, DamageType, DiceString, Range, Source } from './schema.js';

// Stored whole in entity.system.monster, so every value must be JSON-safe: null, never undefined.

const Usage = z.strictObject({
  type: z.enum(['recharge', 'perDay', 'perRest']),
  /** Recharge: lowest d6 roll that recharges (5 means 5-6). */
  min: z.number().int().nullable(),
  /** Per day: number of uses. */
  times: z.number().int().nullable(),
});

const Spellcasting = z.strictObject({
  ability: Ability,
  dc: z.number().int().nullable(),
  attackBonus: z.number().int().nullable(),
  spells: z.array(
    z.strictObject({
      id: z.string(),
      level: z.number().int(),
      usage: z.strictObject({ type: z.string(), times: z.number().int().nullable() }).nullable(),
    }),
  ),
});

/** A number, or the rule's own words when the count varies (the Hydra's "Number of Heads"). */
const Count = z.union([z.number().int(), z.string()]);

const Multiattack = z.strictObject({
  steps: z.array(z.strictObject({ action: z.string(), count: Count })),
  /** "Choose N of these" part. Each choice is one or more steps taken together. */
  options: z
    .strictObject({
      choose: z.number().int(),
      choices: z.array(z.array(z.strictObject({ action: z.string(), count: Count }))),
    })
    .nullable(),
});

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
  /** Present whenever the stat block gives a DC, even on an attack (e.g. a grapple escape DC). */
  save: z
    .strictObject({
      ability: Ability,
      dc: z.number().int().nullable(),
      onSuccess: z.enum(['none', 'half', 'other']),
    })
    .nullable(),
  usage: Usage.nullable(),
  multiattack: Multiattack.nullable(),
  spellcasting: Spellcasting.nullable(),
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

const feet = z.number().int().nullable();

export const Monster = z.strictObject({
  id: z.string(),
  name: z.string(),
  sizes: z.array(z.enum(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'])).min(1),
  type: z.string(),
  subtype: z.string().nullable(),
  alignment: z.string(),
  ac: z.number().int(),
  hp: z.number().int().positive(),
  hpFormula: DiceString,
  speed: z.strictObject({
    walk: feet,
    climb: feet,
    fly: feet,
    swim: feet,
    burrow: feet,
    hover: z.boolean(),
  }),
  senses: z.strictObject({
    passivePerception: z.number().int(),
    blindsight: feet,
    darkvision: feet,
    tremorsense: feet,
    truesight: feet,
  }),
  languages: z.string(),
  abilities: AbilityScores,
  /** All six saving-throw bonuses, always filled in. */
  saves: AbilityScores,
  /** Only skills the stat block lists; others fall back to the ability modifier. */
  skills: z.record(z.string(), z.number().int()),
  resistances: z.array(DamageType),
  vulnerabilities: z.array(DamageType),
  immunities: z.array(DamageType),
  /** Defenses with a qualifier ("... from weapons wielded by ..."); `type` when one is named. */
  conditionalDefenses: z.array(
    z.strictObject({
      kind: z.enum(['resistance', 'vulnerability', 'immunity']),
      type: DamageType.nullable(),
      text: z.string(),
    }),
  ),
  conditionImmunities: z.array(z.string()),
  actions: z.array(MonsterAction),
  bonusActions: z.array(MonsterAction),
  reactions: z.array(MonsterAction),
  legendaryActions: z.array(MonsterAction),
  traits: z.array(
    z.strictObject({
      name: z.string(),
      text: z.string(),
      spellcasting: Spellcasting.nullable(),
    }),
  ),
  /** Ids of the other stat blocks this creature can change into. */
  forms: z.array(z.string()),
  cr: z.number(),
  xp: z.number().int(),
  xpInLair: z.number().int().nullable(),
  proficiencyBonus: z.number().int(),
  source: Source,
});
export type Monster = z.infer<typeof Monster>;
