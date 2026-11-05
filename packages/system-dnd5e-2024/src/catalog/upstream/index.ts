// COPIED FROM UPSTREAM - DO NOT EDIT. Written only by `pnpm srd:import`.
// Source: https://github.com/5e-bits/5e-srd-api/blob/6dfaa6e2f1aefc466fb45b9a64e4dd11a537ca53/packages/5e-database/(generated) (MIT, see LICENSE.md)
import { AbilityScoreSchema } from './schemas/5e-SRD-Ability-Scores.js';
import { AlignmentSchema } from './schemas/5e-SRD-Alignments.js';
import { BackgroundSchema } from './schemas/5e-SRD-Backgrounds.js';
import { ClassSchema } from './schemas/5e-SRD-Classes.js';
import { ConditionSchema } from './schemas/5e-SRD-Conditions.js';
import { DamageTypeSchema } from './schemas/5e-SRD-Damage-Types.js';
import { EquipmentCategorySchema } from './schemas/5e-SRD-Equipment-Categories.js';
import { EquipmentSchema } from './schemas/5e-SRD-Equipment.js';
import { FeatSchema } from './schemas/5e-SRD-Feats.js';
import { FeatureSchema } from './schemas/5e-SRD-Features.js';
import { LanguageSchema } from './schemas/5e-SRD-Languages.js';
import { LevelSchema } from './schemas/5e-SRD-Levels.js';
import { MagicItemSchema } from './schemas/5e-SRD-Magic-Items.js';
import { MagicSchoolSchema } from './schemas/5e-SRD-Magic-Schools.js';
import { MonsterSchema } from './schemas/5e-SRD-Monsters.js';
import { PoisonSchema } from './schemas/5e-SRD-Poisons.js';
import { ProficiencySchema } from './schemas/5e-SRD-Proficiencies.js';
import { SkillSchema } from './schemas/5e-SRD-Skills.js';
import { SpeciesSchema } from './schemas/5e-SRD-Species.js';
import { SpellsSchema } from './schemas/5e-SRD-Spells.js';
import { SubclassSchema } from './schemas/5e-SRD-Subclasses.js';
import { SubspeciesSchema } from './schemas/5e-SRD-Subspecies.js';
import { TraitSchema } from './schemas/5e-SRD-Traits.js';
import { WeaponMasteryPropertySchema } from './schemas/5e-SRD-Weapon-Mastery-Properties.js';
import { WeaponPropertySchema } from './schemas/5e-SRD-Weapon-Properties.js';

export const UPSTREAM_FILES = [
  { upstream: '5e-SRD-Ability-Scores.json', raw: 'ability-scores.json', schema: AbilityScoreSchema },
  { upstream: '5e-SRD-Alignments.json', raw: 'alignments.json', schema: AlignmentSchema },
  { upstream: '5e-SRD-Backgrounds.json', raw: 'backgrounds.json', schema: BackgroundSchema },
  { upstream: '5e-SRD-Classes.json', raw: 'classes.json', schema: ClassSchema },
  { upstream: '5e-SRD-Conditions.json', raw: 'conditions.json', schema: ConditionSchema },
  { upstream: '5e-SRD-Damage-Types.json', raw: 'damage-types.json', schema: DamageTypeSchema },
  { upstream: '5e-SRD-Equipment-Categories.json', raw: 'equipment-categories.json', schema: EquipmentCategorySchema },
  { upstream: '5e-SRD-Equipment.json', raw: 'equipment.json', schema: EquipmentSchema },
  { upstream: '5e-SRD-Feats.json', raw: 'feats.json', schema: FeatSchema },
  { upstream: '5e-SRD-Features.json', raw: 'features.json', schema: FeatureSchema },
  { upstream: '5e-SRD-Languages.json', raw: 'languages.json', schema: LanguageSchema },
  { upstream: '5e-SRD-Levels.json', raw: 'levels.json', schema: LevelSchema },
  { upstream: '5e-SRD-Magic-Items.json', raw: 'magic-items.json', schema: MagicItemSchema },
  { upstream: '5e-SRD-Magic-Schools.json', raw: 'magic-schools.json', schema: MagicSchoolSchema },
  { upstream: '5e-SRD-Monsters.json', raw: 'monsters.json', schema: MonsterSchema },
  { upstream: '5e-SRD-Poisons.json', raw: 'poisons.json', schema: PoisonSchema },
  { upstream: '5e-SRD-Proficiencies.json', raw: 'proficiencies.json', schema: ProficiencySchema },
  { upstream: '5e-SRD-Skills.json', raw: 'skills.json', schema: SkillSchema },
  { upstream: '5e-SRD-Species.json', raw: 'species.json', schema: SpeciesSchema },
  { upstream: '5e-SRD-Spells.json', raw: 'spells.json', schema: SpellsSchema },
  { upstream: '5e-SRD-Subclasses.json', raw: 'subclasses.json', schema: SubclassSchema },
  { upstream: '5e-SRD-Subspecies.json', raw: 'subspecies.json', schema: SubspeciesSchema },
  { upstream: '5e-SRD-Traits.json', raw: 'traits.json', schema: TraitSchema },
  { upstream: '5e-SRD-Weapon-Mastery-Properties.json', raw: 'weapon-mastery-properties.json', schema: WeaponMasteryPropertySchema },
  { upstream: '5e-SRD-Weapon-Properties.json', raw: 'weapon-properties.json', schema: WeaponPropertySchema },
] as const;
