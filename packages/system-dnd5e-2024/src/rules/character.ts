import type { Entity, EntityId } from '@iron-scribe/engine-core';
import { z } from 'zod';

import type { Catalog } from '../catalog/catalog.js';
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
  /** Null for a character who casts nothing. */
  spellcastingAbility: Ability.nullable().default(null),
  /** Catalog spell ids. Cantrips cost nothing; prepared spells spend a slot of their level. */
  cantrips: z.array(z.string()).default([]),
  preparedSpells: z.array(z.string()).default([]),
  /** Total spell slots by level ("1": 2). Spent slots live in `entity.system.spellSlotsUsed`. */
  spellSlots: z.record(z.string(), z.number().int().min(0)).default({}),
});
export type Character = z.infer<typeof Character>;
export type CharacterInput = z.input<typeof Character>;

/**
 * Every spell id on the sheet must exist in the catalog (and in `allowlist` when given).
 * Throws a plain Error naming the first bad id.
 */
export function validateCharacterSpells(
  character: Character,
  catalog: Pick<Catalog, 'spells'>,
  allowlist?: ReadonlySet<string>,
): void {
  for (const id of [...character.cantrips, ...character.preparedSpells]) {
    const spell = catalog.spells.get(id);
    if (!spell) throw new Error(`unknown spell: ${id}`);
    if (allowlist && !allowlist.has(id)) throw new Error(`spell not allowed: ${id}`);
  }
  if (
    (character.cantrips.length > 0 || character.preparedSpells.length > 0) &&
    character.spellcastingAbility === null
  ) {
    throw new Error('a sheet with spells needs a spellcastingAbility');
  }
}

/** Spawn a player character. Hit points are the sheet maximum, never rolled here. */
export function characterToEntity(
  character: CharacterInput,
  entityId: EntityId,
  options?: { name?: string },
): Entity {
  const parsed = Character.parse(character);
  return {
    id: entityId,
    name: options?.name ?? 'Adventurer',
    templateRef: null,
    proximity: 'engaged',
    hp: { current: parsed.hpMax, max: parsed.hpMax },
    system: { character: parsed },
  };
}

/** Read the sheet back. Throws if it is missing or no longer valid. */
export function readCharacter(entity: Entity): Character {
  return Character.parse(entity.system['character']);
}
