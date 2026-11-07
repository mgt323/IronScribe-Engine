import type { Entity } from '@iron-scribe/engine-core';
import { z } from 'zod';

import type { Catalog } from '../catalog/catalog.js';
import type { Ability } from '../catalog/schema.js';
import type { Spell } from '../catalog/schema-spell.js';
import { readCharacter, type Character } from './character.js';
import { abilityModifier, proficiencyBonus } from './modifiers.js';

/** Action ids: `spell:<id>` (needs a target) and `spell:<id>:self` (a heal on the caster). */
export const SPELL_PREFIX = 'spell:';

const SlotsUsed = z.record(z.string(), z.number().int().min(0));

/** Spent spell slots by level, from `entity.system.spellSlotsUsed`. */
export function readSlotsUsed(entity: Entity): Record<string, number> {
  return SlotsUsed.parse(entity.system['spellSlotsUsed'] ?? {});
}

export function slotsLeft(sheet: Character, used: Record<string, number>, level: number): number {
  const key = String(level);
  return (sheet.spellSlots[key] ?? 0) - (used[key] ?? 0);
}

/** A spell the rules can resolve: an effect with damage, or a heal. Text-only spells are not offered. */
export function isResolvableSpell(spell: Spell): boolean {
  if (spell.mechanics === 'text-only') return false;
  if (spell.heal !== null) return true;
  return spell.resolution !== 'none' && spell.damage !== null;
}

/** Cantrips always; prepared spells only while a slot of their level is left. Menu order. */
export function castableSpells(actor: Entity, catalog: Catalog): Spell[] {
  const sheet = readCharacter(actor);
  if (sheet.spellcastingAbility === null) return [];
  const used = readSlotsUsed(actor);
  const spells: Spell[] = [];
  for (const id of [...sheet.cantrips, ...sheet.preparedSpells]) {
    const spell = catalog.spells.get(id);
    if (!spell) throw new Error(`unknown spell: ${id}`);
    if (!isResolvableSpell(spell)) continue;
    if (spell.level > 0 && slotsLeft(sheet, used, spell.level) <= 0) continue;
    spells.push(spell);
  }
  return spells;
}

/** The ability modifier a spell uses. Throws for a sheet that casts nothing. */
export function castingMod(sheet: Character): number {
  const ability: Ability | null = sheet.spellcastingAbility;
  if (ability === null) throw new Error('this character does not cast spells');
  return abilityModifier(sheet.abilities[ability]);
}

/** SRD 5.2.1, "Spellcasting": attack bonus is proficiency + the spellcasting modifier. */
export function spellAttackBonus(sheet: Character): number {
  return proficiencyBonus(sheet.level) + castingMod(sheet);
}

/** SRD 5.2.1, "Spellcasting": save DC is 8 + proficiency + the spellcasting modifier. */
export function spellSaveDc(sheet: Character): number {
  return 8 + spellAttackBonus(sheet);
}

/** Cantrip dice grow with character level. Other spells use their base dice. */
export function spellDamageDice(spell: Spell, level: number): string {
  if (spell.damage === null) throw new Error(`${spell.id} has no damage`);
  const tier = spell.cantripDice?.filter((entry) => entry.minLevel <= level).at(-1);
  return tier?.dice ?? spell.damage.dice;
}

/** How many targets the menu lets the player name. */
export function spellMaxTargets(spell: Spell): number {
  if (spell.resolution === 'save') return 3;
  if (spell.projectiles !== null) return Math.min(3, spell.projectiles);
  return 1;
}
