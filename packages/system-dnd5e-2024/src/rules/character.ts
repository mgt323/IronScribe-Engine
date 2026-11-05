import type { Entity, EntityId } from '@iron-scribe/engine-core';
import { z } from 'zod';

import { Ability } from '../catalog/schema.js';

const AbilityScores = z.strictObject({
  str: z.number().int(),
  dex: z.number().int(),
  con: z.number().int(),
  int: z.number().int(),
  wis: z.number().int(),
  cha: z.number().int(),
});

const SkillProficiency = z.strictObject({
  skill: z.string().min(1),
  expertise: z.boolean(),
});

/**
 * A hand-built player sheet. No class, species or features: those stay raw
 * until a character stage. `weaponProficiencies` holds `simple`, `martial`, or a weapon id.
 */
export const Character = z.strictObject({
  level: z.number().int().min(1).max(20),
  abilities: AbilityScores,
  saveProficiencies: z.array(Ability),
  skillProficiencies: z.array(SkillProficiency),
  weaponProficiencies: z.array(z.string()),
  weapons: z.array(z.string()),
  /** Body armor catalog id, or null when unarmored. */
  armor: z.string().nullable(),
  shield: z.boolean(),
  hpMax: z.number().int().positive(),
});
export type Character = z.infer<typeof Character>;

/** Spawn a player character. Hit points are the sheet maximum, never rolled here. */
export function characterToEntity(
  character: Character,
  entityId: EntityId,
  options?: { name?: string },
): Entity {
  const parsed = Character.parse(character);
  return {
    id: entityId,
    name: options?.name ?? 'Adventurer',
    templateRef: null,
    present: true,
    hp: { current: parsed.hpMax, max: parsed.hpMax },
    system: { character: parsed },
  };
}

/** Read the sheet back. Throws if it is missing or no longer valid. */
export function readCharacter(entity: Entity): Character {
  return Character.parse(entity.system['character']);
}
