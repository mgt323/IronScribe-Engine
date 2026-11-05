import { EngineError, type Entity } from '@iron-scribe/engine-core';

import type { Catalog } from '../catalog/catalog.js';
import { readMonsterSnapshot } from '../catalog/spawn.js';
import { ABILITIES, type Ability, type DamageType } from '../catalog/schema.js';
import type { Monster } from '../catalog/schema-monster.js';
import { readCharacter, type Character } from './character.js';
import { abilityModifier, proficiencyBonus } from './modifiers.js';

export interface Creature {
  readonly kind: 'character' | 'monster';
  readonly name: string;
  readonly abilities: Readonly<Record<Ability, number>>;
  abilityMod(ability: Ability): number;
  readonly ac: number;
  saveBonus(ability: Ability): number;
  skillBonus(skillId: string): number;
  readonly initiativeBonus: number;
  readonly dexScore: number;
  readonly immunities: readonly DamageType[];
  readonly resistances: readonly DamageType[];
  readonly vulnerabilities: readonly DamageType[];
  readonly conditionalDefenses: Monster['conditionalDefenses'];
  readonly conditionImmunities: readonly string[];
}

/** Heavy armor (dexCap 0) adds nothing. A positive cap is a maximum, so a penalty still applies. */
function armorDex(dexMod: number, cap: number | null): number {
  if (cap === null) return dexMod;
  if (cap <= 0) return 0;
  return Math.min(dexMod, cap);
}

function skillAbility(catalog: Catalog, skillId: string): Ability {
  const found = ABILITIES.find((a) => a === catalog.skills.get(skillId)?.ability);
  if (!found) throw new Error(`unknown skill: ${skillId}`);
  return found;
}

function characterAc(character: Character, catalog: Catalog): number {
  const dex = abilityModifier(character.abilities.dex);
  let ac: number;
  if (character.armor === null) {
    ac = 10 + dex;
  } else {
    const armor = catalog.armor.get(character.armor);
    if (!armor || armor.kind !== 'body') {
      throw new Error(`not body armor: ${character.armor}`);
    }
    ac = armor.baseAc + armorDex(dex, armor.dexCap);
  }
  if (character.shield) {
    const shield = catalog.armor.get('shield');
    if (!shield || shield.kind !== 'shield') throw new Error('catalog is missing the shield');
    ac += shield.acBonus;
  }
  return ac;
}

function fromCharacter(name: string, character: Character, catalog: Catalog): Creature {
  const pb = proficiencyBonus(character.level);
  return {
    kind: 'character',
    name,
    abilities: character.abilities,
    abilityMod: (ability) => abilityModifier(character.abilities[ability]),
    ac: characterAc(character, catalog),
    saveBonus(ability) {
      const mod = abilityModifier(character.abilities[ability]);
      return character.saveProficiencies.includes(ability) ? mod + pb : mod;
    },
    skillBonus(skillId) {
      const mod = abilityModifier(character.abilities[skillAbility(catalog, skillId)]);
      const prof = character.skillProficiencies.find((s) => s.skill === skillId);
      if (!prof) return mod;
      return mod + (prof.expertise ? 2 : 1) * pb;
    },
    initiativeBonus: abilityModifier(character.abilities.dex),
    dexScore: character.abilities.dex,
    immunities: [],
    resistances: [],
    vulnerabilities: [],
    conditionalDefenses: [],
    conditionImmunities: [],
  };
}

function fromMonster(name: string, monster: Monster, catalog: Catalog): Creature {
  return {
    kind: 'monster',
    name,
    abilities: monster.abilities,
    abilityMod: (ability) => abilityModifier(monster.abilities[ability]),
    ac: monster.ac,
    saveBonus: (ability) => monster.saves[ability],
    skillBonus(skillId) {
      const listed = monster.skills[skillId];
      if (listed !== undefined) return listed;
      return abilityModifier(monster.abilities[skillAbility(catalog, skillId)]);
    },
    initiativeBonus: abilityModifier(monster.abilities.dex),
    dexScore: monster.abilities.dex,
    immunities: monster.immunities,
    resistances: monster.resistances,
    vulnerabilities: monster.vulnerabilities,
    conditionalDefenses: monster.conditionalDefenses,
    conditionImmunities: monster.conditionImmunities,
  };
}

/** A character sheet or a monster snapshot, read the same way by the rules. */
export function readCreature(entity: Entity, catalog: Catalog): Creature {
  if (entity.system['character'] !== undefined) {
    return fromCharacter(entity.name, readCharacter(entity), catalog);
  }
  if (entity.system['monster'] !== undefined) {
    return fromMonster(entity.name, readMonsterSnapshot(entity), catalog);
  }
  throw new EngineError('invalid_entity', `${entity.id} has no character or monster`);
}
