export const name = 'system-dnd5e-2024';

export { loadCatalog, type Catalog } from './catalog/catalog.js';
export type { CatalogSection } from './catalog/section.js';
export { monsterToEntity, readMonsterSnapshot } from './catalog/spawn.js';
export { Armor, Weapon } from './catalog/schema.js';
export { Monster, MonsterAction } from './catalog/schema-monster.js';
export { Gear, MagicItem, RuleEntry } from './catalog/schema-items.js';
export { Spell } from './catalog/schema-spell.js';
