import type { RawAbilityScore, RawCondition, RawDamageType, RawSkill } from './raw-types.js';
import type { RuleEntry } from './schema-items.js';

const entry = (
  r: { index: string; name: string; url: string },
  text: string,
  ability: string | null,
): RuleEntry => ({ id: r.index, name: r.name, text, ability, source: r.url });

export const normalizeConditions = (rows: readonly RawCondition[]): RuleEntry[] =>
  rows.map((r) => entry(r, r.description, null));

export const normalizeDamageTypes = (rows: readonly RawDamageType[]): RuleEntry[] =>
  rows.map((r) => entry(r, r.description, null));

export const normalizeAbilityScores = (rows: readonly RawAbilityScore[]): RuleEntry[] =>
  rows.map((r) => entry(r, r.description, null));

export const normalizeSkills = (rows: readonly RawSkill[]): RuleEntry[] =>
  rows.map((r) => entry(r, r.description, r.ability_score.index));
