import { normalizeAction, normalizeSpellcasting } from './normalize-action.js';
import { abilityMod, compactDice, feet, leadingDamageType } from './normalize-util.js';
import type { RawMonster } from './raw-types.js';
import { ABILITIES, DamageType, type Ability } from './schema.js';
import type { Monster } from './schema-monster.js';

export { abilityMod } from './normalize-util.js';

const SCORE_KEYS = {
  str: 'strength',
  dex: 'dexterity',
  con: 'constitution',
  int: 'intelligence',
  wis: 'wisdom',
  cha: 'charisma',
} as const;

const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;

const toSize = (s: string): Monster['sizes'][number] => {
  const found = SIZES.find((x) => x === s);
  if (!found) throw new Error(`unknown size "${s}"`);
  return found;
};

/** Plain damage types go in the list; anything with a qualifier keeps its text. */
function defenses(
  kind: Monster['conditionalDefenses'][number]['kind'],
  values: readonly string[],
): { plain: DamageType[]; qualified: Monster['conditionalDefenses'] } {
  const plain: DamageType[] = [];
  const qualified: Monster['conditionalDefenses'] = [];
  for (const v of values) {
    const t = DamageType.safeParse(v.toLowerCase());
    if (t.success) plain.push(t.data);
    else qualified.push({ kind, type: leadingDamageType(v), text: v });
  }
  return { plain, qualified };
}

/** 2024 proficiency bonus by challenge rating; used only if upstream omits it. */
const proficiencyFromCr = (cr: number): number => 2 + Math.floor((Math.max(cr, 1) - 1) / 4);

export function normalizeMonster(raw: RawMonster): Monster {
  const abilities = Object.fromEntries(ABILITIES.map((k) => [k, raw[SCORE_KEYS[k]]])) as Record<
    Ability,
    number
  >;
  const saves = Object.fromEntries(ABILITIES.map((k) => [k, abilityMod(abilities[k])])) as Record<
    Ability,
    number
  >;
  const skills: Record<string, number> = {};
  for (const p of raw.proficiencies) {
    const id = p.proficiency.index;
    if (id.startsWith('saving-throw-')) {
      const ability = ABILITIES.find((a) => a === id.slice('saving-throw-'.length));
      if (!ability) throw new Error(`${raw.index}: unknown save ${id}`);
      saves[ability] = p.value;
    } else if (id.startsWith('skill-')) {
      skills[id.slice('skill-'.length)] = p.value;
    }
  }
  const speed = (k: 'walk' | 'climb' | 'fly' | 'swim' | 'burrow') => feet(raw.speed[k]);
  const sense = (k: 'blindsight' | 'darkvision' | 'tremorsense' | 'truesight') =>
    feet(raw.senses[k]);
  const resist = defenses('resistance', raw.damage_resistances);
  const vuln = defenses('vulnerability', raw.damage_vulnerabilities);
  const immune = defenses('immunity', raw.damage_immunities);
  const ac = raw.armor_class[0];
  if (!ac) throw new Error(`${raw.index}: no armor class`);
  return {
    id: raw.index,
    name: raw.name,
    sizes: raw.size
      .toLowerCase()
      .split(/\s+or\s+/)
      .map(toSize),
    type: raw.type,
    subtype: raw.subtype ?? null,
    alignment: raw.alignment,
    ac: ac.value,
    hp: raw.hit_points,
    hpFormula: compactDice(raw.hit_points_roll),
    speed: {
      walk: speed('walk'),
      climb: speed('climb'),
      fly: speed('fly'),
      swim: speed('swim'),
      burrow: speed('burrow'),
      hover: raw.speed.hover ?? false,
    },
    senses: {
      passivePerception: raw.senses.passive_perception,
      blindsight: sense('blindsight'),
      darkvision: sense('darkvision'),
      tremorsense: sense('tremorsense'),
      truesight: sense('truesight'),
    },
    languages: raw.languages,
    abilities,
    saves,
    skills,
    resistances: resist.plain,
    vulnerabilities: vuln.plain,
    immunities: immune.plain,
    conditionalDefenses: [...resist.qualified, ...vuln.qualified, ...immune.qualified],
    conditionImmunities: raw.condition_immunities.map((c) => c.index),
    actions: (raw.actions ?? []).map(normalizeAction),
    bonusActions: (raw.bonus_actions ?? []).map(normalizeAction),
    reactions: (raw.reactions ?? []).map(normalizeAction),
    legendaryActions: (raw.legendary_actions ?? []).map(normalizeAction),
    traits: (raw.special_abilities ?? []).map((t) => ({
      name: t.name,
      text: t.desc,
      spellcasting: normalizeSpellcasting(t.spellcasting),
    })),
    forms: (raw.forms ?? []).map((f) => f.index),
    cr: raw.challenge_rating,
    xp: raw.xp,
    xpInLair: raw.xp_in_lair ?? null,
    proficiencyBonus: raw.proficiency_bonus ?? proficiencyFromCr(raw.challenge_rating),
    source: raw.url,
  };
}
