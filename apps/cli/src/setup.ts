import type { ActionMenu, Entity, GameState } from '@iron-scribe/engine-core';
import type { LlmClient } from '@iron-scribe/llm';
import { ORCHESTRATOR_PREFIX } from '@iron-scribe/orchestrator';
import {
  Character,
  proficiencyBonus,
  readCharacter,
  readConditions,
  readCreature,
  combatPhase,
  readDeathSaves,
  readEncounter,
  type Catalog,
  type CombatPhase,
} from '@iron-scribe/system-dnd5e-2024';
import { z } from 'zod';

/**
 * SRD 5.2.1 Level 1 Rogue. The sheet stores no class: the label lives in the CLI.
 * Hit die d8, so hpMax is 8 + Constitution modifier (+2) = 10.
 * Proficiency bonus is +2 from `proficiencyBonus(1)`, not a field on the sheet.
 */
export function defaultAdventurerSheet(): Character {
  return Character.parse({
    level: 1,
    abilities: { str: 8, dex: 16, con: 14, int: 12, wis: 13, cha: 10 },
    saveProficiencies: ['dex', 'int'],
    skillProficiencies: [
      { skill: 'stealth', expertise: true },
      { skill: 'sleight-of-hand', expertise: true },
      { skill: 'perception', expertise: false },
      { skill: 'investigation', expertise: false },
    ],
    weaponProficiencies: [
      'simple',
      'shortsword',
      'rapier',
      'scimitar',
      'whip',
      'longsword',
      'hand-crossbow',
    ],
    weapons: ['dagger', 'shortbow'],
    armor: 'leather-armor',
    shield: false,
    hpMax: 10,
  });
}

/** Name and backstory only. The model never chooses scores, hit points, or gear. */
export const characterIdentitySchema = z.strictObject({
  name: z.string(),
  backstory: z.string(),
});

export async function suggestCharacterIdentity(
  llm: LlmClient,
  description: string,
): Promise<{ name: string; backstory: string }> {
  const result = await llm.generateObject({
    name: 'character_identity',
    schema: characterIdentitySchema,
    prompt: {
      prefix: ORCHESTRATOR_PREFIX,
      scene: [
        'Suggest a name and a short backstory for this Level 1 Rogue.',
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

/** Level 1 Rogue sheet. Class and hit die are labels; the numbers come from the entity. */
export function formatCharacterSheet(
  entity: Entity,
  catalog: Catalog,
  backstory: string | null,
): string {
  const sheet = readCharacter(entity);
  const view = readCreature(entity, catalog);
  const skills = sheet.skillProficiencies
    .map((entry) => {
      const name = catalog.skills.get(entry.skill)?.name ?? entry.skill;
      return entry.expertise ? `${name} (Expertise)` : name;
    })
    .join(', ');
  const lines = [
    entity.name,
    backstory ?? 'No backstory.',
    'Level 1 Rogue',
    'Hit Die d8',
    `HP ${String(entity.hp.current)}/${String(entity.hp.max)}`,
    `Proficiency Bonus ${signed(proficiencyBonus(sheet.level))}`,
    `Saving throws: DEX ${signed(view.saveBonus('dex'))}, INT ${signed(view.saveBonus('int'))}`,
    `Skills: ${skills}`,
    `Weapons: ${sheet.weapons.join(', ')}`,
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
