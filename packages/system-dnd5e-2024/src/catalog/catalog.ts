import {
  isArmor,
  isWeapon,
  normalizeArmor,
  normalizeGear,
  normalizeMagicItems,
  normalizeWeapon,
} from './normalize-equipment.js';
import { normalizeMonster } from './normalize-monster.js';
import {
  normalizeAbilityScores,
  normalizeConditions,
  normalizeDamageTypes,
  normalizeSkills,
} from './normalize-reference.js';
import { normalizeSpell } from './normalize-spell.js';
import { withExtraDamage } from './overrides.js';
import { readRaw } from './raw-read.js';
import { createSection, type CatalogSection } from './section.js';
import type { Armor, Weapon } from './schema.js';
import type { Gear, MagicItem, RuleEntry } from './schema-items.js';
import type { Monster } from './schema-monster.js';
import type { Spell } from './schema-spell.js';

export interface Catalog {
  readonly monsters: CatalogSection<Monster>;
  readonly weapons: CatalogSection<Weapon>;
  readonly armor: CatalogSection<Armor>;
  readonly gear: CatalogSection<Gear>;
  readonly magicItems: CatalogSection<MagicItem>;
  readonly spells: CatalogSection<Spell>;
  readonly conditions: CatalogSection<RuleEntry>;
  readonly damageTypes: CatalogSection<RuleEntry>;
  readonly abilityScores: CatalogSection<RuleEntry>;
  readonly skills: CatalogSection<RuleEntry>;
}

let cached: Catalog | undefined;

/**
 * Builds the catalog from the committed raw files. No schema validation happens here:
 * committed data is checked in `srd:import` and in tests (raw-validation.test.ts and
 * catalog-data.test.ts), and does not change at runtime. Data from outside the repo
 * (saves, future content packs) must be validated when it is loaded.
 */
export function loadCatalog(): Catalog {
  if (cached) return cached;
  const equipment = readRaw('equipment.json');
  cached = {
    monsters: createSection(
      readRaw('monsters.json').map((r) => withExtraDamage(normalizeMonster(r))),
    ),
    weapons: createSection(equipment.filter(isWeapon).map(normalizeWeapon)),
    armor: createSection(equipment.filter(isArmor).map(normalizeArmor)),
    gear: createSection(equipment.filter((e) => !isWeapon(e) && !isArmor(e)).map(normalizeGear)),
    magicItems: createSection(normalizeMagicItems(readRaw('magic-items.json'))),
    spells: createSection(readRaw('spells.json').map(normalizeSpell)),
    conditions: createSection(normalizeConditions(readRaw('conditions.json'))),
    damageTypes: createSection(normalizeDamageTypes(readRaw('damage-types.json'))),
    abilityScores: createSection(normalizeAbilityScores(readRaw('ability-scores.json'))),
    skills: createSection(normalizeSkills(readRaw('skills.json'))),
  };
  return cached;
}
