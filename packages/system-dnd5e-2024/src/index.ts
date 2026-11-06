export const name = 'system-dnd5e-2024';

export { loadCatalog, type Catalog } from './catalog/catalog.js';
export type { CatalogSection } from './catalog/section.js';
export { monsterToEntity, readMonsterSnapshot } from './catalog/spawn.js';
export { Armor, Weapon } from './catalog/schema.js';
export { Monster, MonsterAction } from './catalog/schema-monster.js';
export { Gear, MagicItem, RuleEntry } from './catalog/schema-items.js';
export { Spell } from './catalog/schema-spell.js';
export {
  attackRoll,
  weaponAttackBonus,
  type AttackResult,
  type WeaponAttack,
} from './rules/attack.js';
export { Character, characterToEntity, readCharacter } from './rules/character.js';
export { abilityCheck, savingThrow, skillCheck, type CheckResult } from './rules/checks.js';
export { PROJECT_DEFAULT_CHECK_DC, SRD_TYPICAL_DC, resolveDndCheckDc } from './rules/check-dc.js';
export {
  NO_CONDITIONS,
  conditionEvents,
  isIncapacitated,
  readConditions,
  rollEffects,
  type ConditionState,
} from './rules/conditions.js';
export { readCreature, type Creature } from './rules/creature.js';
export { applyDefenses, rollMonsterDamage, rollWeaponDamage } from './rules/damage.js';
export { DEFAULT_MONSTER_VARIANTS } from './catalog/overrides.js';
export {
  combatPhase,
  dndNextCombatStep,
  dndTurnEnd,
  readEncounter,
  type CombatPhase,
} from './rules/combat.js';
export {
  DeathSaveState,
  exhaustionOutcome,
  healEvents,
  isDead,
  isDying,
  readDeathSaves,
} from './rules/death-saves.js';
export { DEATH_SAVE_DC } from './rules/death-save-roll.js';
export { expandMultiattack } from './rules/multiattack.js';
export {
  rollInitiative,
  type EncounterOrderEntry,
  type EncounterState,
} from './rules/initiative.js';
export { abilityModifier, proficiencyBonus } from './rules/modifiers.js';
export { resolveDndSpawn } from './rules/spawn-intent.js';
export { createDnd5eSystem } from './rules/system.js';
