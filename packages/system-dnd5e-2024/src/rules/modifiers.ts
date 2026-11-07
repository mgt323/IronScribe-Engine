import type { Ability } from '../catalog/schema.js';

/** SRD 5.2.1, "Ability Scores": (score − 10) / 2, rounded down. */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * SRD 5.2.1, "Proficiency Bonus": +2 at level 1, then +1 at levels 5, 9, 13 and 17.
 */
export function proficiencyBonus(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`invalid level: ${String(level)}`);
  }
  return 2 + Math.floor((level - 1) / 4);
}

export const ABILITY_LABEL: Record<Ability, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};
