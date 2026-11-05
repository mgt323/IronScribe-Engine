import { resolveRollMode, rollD20, type Rng, type RollMode } from '@iron-scribe/dice';

import type { Ability, Weapon } from '../catalog/schema.js';
import type { Character } from './character.js';
import { rollEffects, type ConditionState } from './conditions.js';
import { abilityModifier, proficiencyBonus } from './modifiers.js';

export interface AttackInput {
  readonly bonus: number;
  readonly ac: number;
  readonly attackKind: 'melee' | 'ranged';
  readonly attacker: ConditionState;
  readonly target: ConditionState;
  readonly advantage?: boolean;
  readonly disadvantage?: boolean;
}

export interface AttackResult {
  readonly mode: RollMode;
  readonly rolls: readonly number[];
  readonly natural: number;
  readonly modifier: number;
  readonly total: number;
  readonly ac: number;
  readonly hit: boolean;
  readonly critical: boolean;
}

export interface WeaponAttack {
  readonly ability: Ability;
  readonly modifier: number;
  readonly proficient: boolean;
  readonly bonus: number;
}

/** Finesse uses the better of Strength and Dexterity. Other ranged weapons use Dexterity. */
export function weaponAttackBonus(character: Character, weapon: Weapon): WeaponAttack {
  const str = abilityModifier(character.abilities.str);
  const dex = abilityModifier(character.abilities.dex);
  let ability: Ability;
  let modifier: number;
  if (weapon.properties.includes('finesse')) {
    ability = dex > str ? 'dex' : 'str';
    modifier = dex > str ? dex : str;
  } else if (weapon.kind === 'ranged') {
    ability = 'dex';
    modifier = dex;
  } else {
    ability = 'str';
    modifier = str;
  }
  const proficient =
    character.weaponProficiencies.includes(weapon.id) ||
    character.weaponProficiencies.includes(weapon.category);
  const bonus = modifier + (proficient ? proficiencyBonus(character.level) : 0);
  return { ability, modifier, proficient, bonus };
}

/**
 * SRD 5.2.1, "Attack Rolls": d20 + bonus vs AC.
 * A natural 20 hits and is a critical hit. A natural 1 misses.
 */
export function attackRoll(rng: Rng, input: AttackInput): AttackResult {
  const effects = rollEffects({
    kind: 'attack',
    attackKind: input.attackKind,
    attacker: input.attacker,
    target: input.target,
  });
  const mode = resolveRollMode({
    advantage: effects.advantage || input.advantage === true,
    disadvantage: effects.disadvantage || input.disadvantage === true,
  });
  const modifier = input.bonus - effects.penalty;
  const rolled = rollD20(rng, { mode, modifier });
  const natural20 = rolled.natural === 20;
  const natural1 = rolled.natural === 1;
  const hit = natural20 || (!natural1 && rolled.total >= input.ac);
  return {
    mode,
    rolls: rolled.rolls,
    natural: rolled.natural,
    modifier,
    total: rolled.total,
    ac: input.ac,
    hit,
    critical: hit && (natural20 || effects.autoCrit),
  };
}
