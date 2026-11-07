import type { ActionMenu, Entity, GameState } from '@iron-scribe/engine-core';
import type { LlmClient } from '@iron-scribe/llm';
import { ORCHESTRATOR_PREFIX } from '@iron-scribe/orchestrator';
import {
  proficiencyBonus,
  readCharacter,
  readSlotsUsed,
  spellAttackBonus,
  spellSaveDc,
  readConditions,
  readCreature,
  combatPhase,
  readDeathSaves,
  readEncounter,
  type Catalog,
  type CombatPhase,
} from '@iron-scribe/system-dnd5e-2024';
import { z } from 'zod';

import { ARCHETYPE_LABEL, type Archetype } from './archetypes.js';

/** Name and backstory only. The model never chooses scores, hit points, or gear. */
export const characterIdentitySchema = z.strictObject({
  name: z.string(),
  backstory: z.string(),
});

export async function suggestCharacterIdentity(
  llm: LlmClient,
  description: string,
  archetype: Archetype = 'rogue',
): Promise<{ name: string; backstory: string }> {
  const result = await llm.generateObject({
    name: 'character_identity',
    schema: characterIdentitySchema,
    prompt: {
      prefix: ORCHESTRATOR_PREFIX,
      scene: [
        `Suggest a name and a short backstory for this Level 1 ${ARCHETYPE_LABEL[archetype].name}.`,
        'Do not choose ability scores, hit points, armor class, or equipment.',
        `Description: ${description}`,
      ].join('\n'),
      temperature: 0,
      maxOutputTokens: 512,
    },
  });
  return result.data;
}

function signed(value: number): string {
  return value >= 0 ? `+${String(value)}` : String(value);
}

const ABILITY_CODE = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };

function spellLines(entity: Entity, catalog: Catalog): string[] {
  const sheet = readCharacter(entity);
  if (sheet.spellcastingAbility === null) return [];
  const names = (ids: readonly string[]) =>
    ids.map((id) => catalog.spells.get(id)?.name ?? id).join(', ') || 'none';
  const used = readSlotsUsed(entity);
  const slots = Object.entries(sheet.spellSlots)
    .map(
      ([level, total]) => `level ${level}: ${String(total - (used[level] ?? 0))}/${String(total)}`,
    )
    .join(', ');
  return [
    `Spellcasting: ${ABILITY_CODE[sheet.spellcastingAbility]}, spell attack ${signed(spellAttackBonus(sheet))}, save DC ${String(spellSaveDc(sheet))}`,
    `Cantrips: ${names(sheet.cantrips)}`,
    `Prepared spells: ${names(sheet.preparedSpells)}`,
    `Spell slots: ${slots || 'none'}`,
  ];
}

/** Level 1 sheet. Class and hit die are labels; the numbers come from the entity. */
export function formatCharacterSheet(
  entity: Entity,
  catalog: Catalog,
  backstory: string | null,
  archetype: Archetype = 'rogue',
): string {
  const sheet = readCharacter(entity);
  const view = readCreature(entity, catalog);
  const label = ARCHETYPE_LABEL[archetype];
  const skills = sheet.skillProficiencies
    .map((entry) => {
      const name = catalog.skills.get(entry.skill)?.name ?? entry.skill;
      return entry.expertise ? `${name} (Expertise)` : name;
    })
    .join(', ');
  const saves = sheet.saveProficiencies
    .map((ability) => `${ABILITY_CODE[ability]} ${signed(view.saveBonus(ability))}`)
    .join(', ');
  const lines = [
    entity.name,
    backstory ?? 'No backstory.',
    `Level 1 ${label.name}`,
    `Hit Die ${label.hitDie}`,
    `HP ${String(entity.hp.current)}/${String(entity.hp.max)}`,
    `Proficiency Bonus ${signed(proficiencyBonus(sheet.level))}`,
    `Saving throws: ${saves}`,
    `Skills: ${skills}`,
    `Weapons: ${sheet.weapons.join(', ')}`,
    ...spellLines(entity, catalog),
    `Armor: ${sheet.armor ?? 'none'}`,
    `AC ${String(view.ac)}`,
  ];
  return `${lines.join('\n')}\n`;
}

function entityLine(state: GameState, id: string, catalog: Catalog): string {
  const entity = state.entities[id];
  if (!entity) return id;
  const view = readCreature(entity, catalog);
  const conditions = readConditions(entity).ids;
  const attitude = entity.system['attitude'];
  const extras = [
    conditions.length > 0 ? conditions.join(', ') : '',
    typeof attitude === 'string' ? attitude : '',
  ].filter((part) => part !== '');
  const tail = extras.length > 0 ? `, ${extras.join(', ')}` : '';
  return `${entity.name} (${entity.id}) ${String(entity.hp.current)}/${String(entity.hp.max)} HP, AC ${String(view.ac)}${tail}`;
}

/** Dying and dead are explicit; stable and active heroes need no extra line. */
function heroStatusLine(state: GameState, actorId: string, phase: CombatPhase): string[] {
  if (phase === 'dead') return ['Status: DEAD'];
  if (phase !== 'dying') return [];
  const tally = readDeathSaves(state.entities[actorId]);
  return [
    `Status: DYING (successes ${String(tally?.successes ?? 0)}/3, failures ${String(tally?.failures ?? 0)}/3). Any input rolls your death save.`,
  ];
}

/** Present creatures plus the legal A# / T# menu. */
export function formatSceneStatus(
  state: GameState,
  actorId: string,
  catalog: Catalog,
  menu: ActionMenu,
): string {
  const present = state.spawnOrder.filter((id) => state.entities[id]?.present === true);
  const scene =
    present.length > 0 ? present.map((id) => entityLine(state, id, catalog)) : ['(nobody)'];
  const actions =
    menu.actions.length > 0
      ? menu.actions.map((action) => `${action.alias} ${action.label}`)
      : ['(none)'];
  const targets =
    menu.targets.length > 0
      ? menu.targets.map((target) => `${target.alias} ${target.label}`)
      : ['(none)'];
  const encounter = readEncounter(state);
  const phase = combatPhase(state, actorId);
  const combat = encounter
    ? [
        `Combat: round ${String(encounter.round)}` +
          (phase === 'suspended' ? ' (suspended: you cannot act)' : ''),
      ]
    : [];
  return [
    scene.join('\n'),
    ...combat,
    ...heroStatusLine(state, actorId, phase),
    `You: ${actorId}`,
    `Actions: ${actions.join(', ')}`,
    `Targets: ${targets.join(', ')}`,
    '',
  ].join('\n');
}
