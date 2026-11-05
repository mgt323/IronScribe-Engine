import { ABILITIES, DamageType, type Ability } from './schema.js';

export const abilityMod = (score: number): number => Math.floor((score - 10) / 2);

export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** First integer in a string like "40 ft." or "150 feet"; null if absent. */
export const feet = (s: string | undefined): number | null => {
  const m = s ? /(\d+)/.exec(s) : null;
  return m?.[1] ? Number(m[1]) : null;
};

/** Upstream writes dice as "2d6 + 4"; our dice strings have no spaces. */
export const compactDice = (s: string): string => s.replace(/\s+/g, '');

export function toDamageType(s: string): DamageType {
  const r = DamageType.safeParse(s.toLowerCase());
  if (!r.success) throw new Error(`unknown damage type "${s}"`);
  return r.data;
}

export function toAbility(s: string): Ability {
  const found = ABILITIES.find((a) => a === s.toLowerCase());
  if (!found) throw new Error(`unknown ability "${s}"`);
  return found;
}

/** Damage types named at the start of a qualified defense ("piercing damage from ..."). */
export function leadingDamageType(text: string): DamageType | null {
  const word = /^([a-z]+) damage\b/i.exec(text)?.[1];
  const r = word ? DamageType.safeParse(word.toLowerCase()) : undefined;
  return r?.success ? r.data : null;
}
