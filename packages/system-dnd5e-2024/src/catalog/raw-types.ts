import type { z } from 'zod';

import type { AbilityScoreSchema } from './upstream/schemas/5e-SRD-Ability-Scores.js';
import type { AlignmentSchema } from './upstream/schemas/5e-SRD-Alignments.js';
import type { BackgroundSchema } from './upstream/schemas/5e-SRD-Backgrounds.js';
import type { ClassSchema } from './upstream/schemas/5e-SRD-Classes.js';
import type { ConditionSchema } from './upstream/schemas/5e-SRD-Conditions.js';
import type { DamageTypeSchema } from './upstream/schemas/5e-SRD-Damage-Types.js';
import type { EquipmentCategorySchema } from './upstream/schemas/5e-SRD-Equipment-Categories.js';
import type { EquipmentSchema } from './upstream/schemas/5e-SRD-Equipment.js';
import type { FeatSchema } from './upstream/schemas/5e-SRD-Feats.js';
import type { FeatureSchema } from './upstream/schemas/5e-SRD-Features.js';
import type { LanguageSchema } from './upstream/schemas/5e-SRD-Languages.js';
import type { LevelSchema } from './upstream/schemas/5e-SRD-Levels.js';
import type { MagicItemSchema } from './upstream/schemas/5e-SRD-Magic-Items.js';
import type { MagicSchoolSchema } from './upstream/schemas/5e-SRD-Magic-Schools.js';
import type { MonsterSchema } from './upstream/schemas/5e-SRD-Monsters.js';
import type { PoisonSchema } from './upstream/schemas/5e-SRD-Poisons.js';
import type { ProficiencySchema } from './upstream/schemas/5e-SRD-Proficiencies.js';
import type { SkillSchema } from './upstream/schemas/5e-SRD-Skills.js';
import type { SpeciesSchema } from './upstream/schemas/5e-SRD-Species.js';
import type { SpellsSchema } from './upstream/schemas/5e-SRD-Spells.js';
import type { SubclassSchema } from './upstream/schemas/5e-SRD-Subclasses.js';
import type { SubspeciesSchema } from './upstream/schemas/5e-SRD-Subspecies.js';
import type { TraitSchema } from './upstream/schemas/5e-SRD-Traits.js';
import type { WeaponMasteryPropertySchema } from './upstream/schemas/5e-SRD-Weapon-Mastery-Properties.js';
import type { WeaponPropertySchema } from './upstream/schemas/5e-SRD-Weapon-Properties.js';

// Types only: committed data was validated by the strict upstream schemas in
// `srd:import` and in raw-validation.test.ts, so production code never runs them.
export type RawAbilityScore = z.infer<typeof AbilityScoreSchema>;
export type RawAlignment = z.infer<typeof AlignmentSchema>;
export type RawBackground = z.infer<typeof BackgroundSchema>;
export type RawClass = z.infer<typeof ClassSchema>;
export type RawCondition = z.infer<typeof ConditionSchema>;
export type RawDamageType = z.infer<typeof DamageTypeSchema>;
export type RawEquipmentCategory = z.infer<typeof EquipmentCategorySchema>;
export type RawEquipment = z.infer<typeof EquipmentSchema>;
export type RawFeat = z.infer<typeof FeatSchema>;
export type RawFeature = z.infer<typeof FeatureSchema>;
export type RawLanguage = z.infer<typeof LanguageSchema>;
export type RawLevel = z.infer<typeof LevelSchema>;
export type RawMagicItem = z.infer<typeof MagicItemSchema>;
export type RawMagicSchool = z.infer<typeof MagicSchoolSchema>;
export type RawMonster = z.infer<typeof MonsterSchema>;
export type RawPoison = z.infer<typeof PoisonSchema>;
export type RawProficiency = z.infer<typeof ProficiencySchema>;
export type RawSkill = z.infer<typeof SkillSchema>;
export type RawSpecies = z.infer<typeof SpeciesSchema>;
export type RawSpell = z.infer<typeof SpellsSchema>;
export type RawSubclass = z.infer<typeof SubclassSchema>;
export type RawSubspecies = z.infer<typeof SubspeciesSchema>;
export type RawTrait = z.infer<typeof TraitSchema>;
export type RawWeaponMasteryProperty = z.infer<typeof WeaponMasteryPropertySchema>;
export type RawWeaponProperty = z.infer<typeof WeaponPropertySchema>;

/** Raw file name -> entry type. */
export interface RawFiles {
  'ability-scores.json': RawAbilityScore;
  'alignments.json': RawAlignment;
  'backgrounds.json': RawBackground;
  'classes.json': RawClass;
  'conditions.json': RawCondition;
  'damage-types.json': RawDamageType;
  'equipment-categories.json': RawEquipmentCategory;
  'equipment.json': RawEquipment;
  'feats.json': RawFeat;
  'features.json': RawFeature;
  'languages.json': RawLanguage;
  'levels.json': RawLevel;
  'magic-items.json': RawMagicItem;
  'magic-schools.json': RawMagicSchool;
  'monsters.json': RawMonster;
  'poisons.json': RawPoison;
  'proficiencies.json': RawProficiency;
  'skills.json': RawSkill;
  'species.json': RawSpecies;
  'spells.json': RawSpell;
  'subclasses.json': RawSubclass;
  'subspecies.json': RawSubspecies;
  'traits.json': RawTrait;
  'weapon-mastery-properties.json': RawWeaponMasteryProperty;
  'weapon-properties.json': RawWeaponProperty;
}
