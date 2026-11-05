import { z } from 'zod';

import type { StructuredPrompt } from './types.js';

/**
 * Stable instruction shared by every eval case so a local prompt cache can reuse the prefix.
 * The scene, including the menu, is the only part that changes per turn.
 */
const PREFIX =
  "You are Iron Scribe's rules clerk. You never roll dice, never invent hit points or armor class, and you only use ids the scene lists.";

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

/** SRD 5.2.1 skill ids. Display names such as "Stealth" are not accepted. */
const SKILLS = [
  'acrobatics',
  'animal-handling',
  'arcana',
  'athletics',
  'deception',
  'history',
  'insight',
  'intimidation',
  'investigation',
  'medicine',
  'nature',
  'perception',
  'performance',
  'persuasion',
  'religion',
  'sleight-of-hand',
  'stealth',
  'survival',
] as const;

const ATTITUDES = ['hostile', 'neutral', 'friendly'] as const;

function prompt(scene: string): StructuredPrompt {
  return { prefix: PREFIX, scene, temperature: 0, maxOutputTokens: 2048 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function aliasField(aliases: readonly string[]) {
  if (aliases.length === 0) return z.null();
  const [first, ...rest] = aliases;
  if (!first) return z.null();
  return z.enum([first, ...rest]).nullable();
}

function decisionSchema(actions: readonly string[], targets: readonly string[]) {
  return z.strictObject({
    kind: z.enum(['action', 'none']),
    actionAlias: aliasField(actions),
    targetAlias: aliasField(targets),
  });
}

function decisionScene(menu: string, player: string): string {
  return `${menu}\n\nPlayer: ${player}\n\nChoose one legal alias. Use kind "none" and null aliases when nothing legal matches. Do not invent a target.`;
}

interface DecisionExpected {
  readonly kind: 'action' | 'none';
  readonly actionAlias: string | null;
  readonly targetAlias: string | null;
}

function sameDecision(data: unknown, expected: DecisionExpected): boolean {
  if (!isRecord(data)) return false;
  return (
    data['kind'] === expected.kind &&
    data['actionAlias'] === expected.actionAlias &&
    data['targetAlias'] === expected.targetAlias
  );
}

function mentionedAmount(text: string, pattern: RegExp): boolean {
  for (const match of text.matchAll(pattern)) {
    if (match[1] !== '6') return false;
  }
  return true;
}

/** Non-empty prose that does not change the 6 piercing damage or the 4/10 hit points. */
function narrationMatches(text: string): boolean {
  if (text.trim() === '') return false;
  if (/\b(miss(?:ed|es)?|kill(?:ed|s)?|dies|dead|unconscious)\b/i.test(text)) return false;
  if (!mentionedAmount(text, /\b(\d+)\s+piercing\b/gi)) return false;
  if (!mentionedAmount(text, /\b(\d+)\s+damage\b/gi)) return false;
  if (!mentionedAmount(text, /\bdamage\b\s*[:=]?\s*(\d+)/gi)) return false;
  const hp = /(\d+)\s*\/\s*10/.exec(text);
  if (hp?.[1] && hp[1] !== '4') return false;
  return true;
}

interface ObjectEvalCase {
  readonly id: string;
  readonly mode: 'object';
  readonly schemaName: string;
  readonly schema: z.ZodType;
  readonly prompt: StructuredPrompt;
  readonly expect: (data: unknown) => boolean;
}

interface TextEvalCase {
  readonly id: string;
  readonly mode: 'text';
  readonly prompt: StructuredPrompt;
  readonly expect: (text: string) => boolean;
}

export type EvalCase = ObjectEvalCase | TextEvalCase;

const ATTACK_MENU = [
  'Actions:',
  'A1 weapon:dagger — Dagger, melee, needs a target',
  'A2 weapon:shortbow — Shortbow, ranged, needs a target',
  'Targets:',
  'T1 goblin_1 — Goblin Warrior',
].join('\n');

function decisionCase(
  id: string,
  menu: string,
  player: string,
  actions: readonly string[],
  targets: readonly string[],
  expected: DecisionExpected,
): ObjectEvalCase {
  return {
    id,
    mode: 'object',
    schemaName: 'decision',
    schema: decisionSchema(actions, targets),
    prompt: prompt(decisionScene(menu, player)),
    expect: (data) => sameDecision(data, expected),
  };
}

/** Representative turn tasks. Object cases use flat schemas; narration is free text. */
export const DEFAULT_EVAL_CASES: readonly EvalCase[] = [
  decisionCase(
    'decision_attack',
    ATTACK_MENU,
    'I sneak up and stab the goblin with my dagger.',
    ['A1', 'A2'],
    ['T1'],
    { kind: 'action', actionAlias: 'A1', targetAlias: 'T1' },
  ),
  decisionCase(
    'decision_ranged',
    ATTACK_MENU,
    'I shoot the goblin with my bow.',
    ['A1', 'A2'],
    ['T1'],
    { kind: 'action', actionAlias: 'A2', targetAlias: 'T1' },
  ),
  decisionCase(
    'decision_untargeted',
    [
      'Actions:',
      'A1 weapon:dagger — Dagger, melee, needs a target',
      'A3 action:dodge — Dodge, needs no target',
      'Targets:',
      'T1 goblin_1 — Goblin Warrior',
    ].join('\n'),
    'I focus on dodging incoming blows.',
    ['A1', 'A3'],
    ['T1'],
    { kind: 'action', actionAlias: 'A3', targetAlias: null },
  ),
  decisionCase(
    'decision_empty_scene',
    ['Actions:', 'A1 weapon:dagger — Dagger, melee, needs a target', 'Targets:', '(none)'].join(
      '\n',
    ),
    'I stab the goblin.',
    ['A1'],
    [],
    { kind: 'none', actionAlias: null, targetAlias: null },
  ),
  {
    id: 'spawn_intent',
    mode: 'object',
    schemaName: 'spawn_intent',
    schema: z.strictObject({
      query: z.string(),
      count: z.number().int(),
      attitude: z.enum(ATTITUDES),
    }),
    prompt: prompt(
      'Name a catalog query, a count, and an attitude. Do not invent hit points or armor class.\n\nPlayer: I enter the old armory. There is a hostile goblin inside.',
    ),
    expect: (data) =>
      isRecord(data) &&
      typeof data['query'] === 'string' &&
      /goblin/i.test(data['query']) &&
      data['count'] === 1 &&
      data['attitude'] === 'hostile',
  },
  {
    id: 'check_intent',
    mode: 'object',
    schemaName: 'check_intent',
    schema: z.strictObject({
      ability: z.enum(ABILITIES),
      skill: z.enum(SKILLS).nullable(),
    }),
    prompt: prompt(
      'Pick the ability id and the skill id for this action. Use null when no skill applies.\n\nPlayer: I try to sneak quietly past the sleeping guard.',
    ),
    expect: (data) => isRecord(data) && data['ability'] === 'dex' && data['skill'] === 'stealth',
  },
  {
    id: 'narration_facts',
    mode: 'text',
    prompt: prompt(
      [
        'Narrate only these resolved facts. Do not change the numbers.',
        '- Stealth 18 vs DC 12, success',
        '- attack: 17 vs AC 15, hit',
        '- damage: 6 piercing',
        '- hp: goblin_1 4/10',
      ].join('\n'),
    ),
    expect: narrationMatches,
  },
];
