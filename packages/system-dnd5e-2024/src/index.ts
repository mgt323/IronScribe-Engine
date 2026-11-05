export const name = 'system-dnd5e-2024';

export { loadCatalog, type Catalog } from './catalog/catalog.js';
export type { CatalogSection } from './catalog/section.js';
export { monsterToEntity, readMonsterSnapshot } from './catalog/spawn.js';
export { Armor, Monster, MonsterAction, Weapon } from './catalog/schema.js';
export { Spell } from './catalog/schema-spell.js';
