import type { RawMonster } from './raw-schema.js';
import { ABILITIES, Monster, type MonsterAction, type Ability } from './schema.js';

const SCORE_KEYS = {
  str: 'strength',
  dex: 'dexterity',
  con: 'constitution',
  int: 'intelligence',
  wis: 'wisdom',
  cha: 'charisma',
} as const;

export const abilityMod = (score: number): number => Math.floor((score - 10) / 2);

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const feet = (s: string | undefined): number | null => {
  const m = s ? /(\d+)/.exec(s) : null;
  return m?.[1] ? Number(m[1]) : null;
};

function normalizeAction(a: RawMonster['actions'][number]): MonsterAction {
  const desc = a.desc;
  const melee = /melee/i.test(desc.split('Hit:')[0] ?? '');
  const ranged = /ranged/i.test(desc.split('Hit:')[0] ?? '');
  const isAttack = a.attack_bonus !== undefined;
  const kind =
    a.dc !== undefined
      ? 'save'
      : !isAttack
        ? 'other'
        : melee && ranged
          ? 'meleeOrRanged'
          : ranged
            ? 'ranged'
            : 'melee';
  const reach = /reach (\d+)/i.exec(desc);
  const range = /range (\d+)\/(\d+)/i.exec(desc);
  const advantageRider = /if the attack roll had advantage/i.test(desc);
  return {
    id: slug(a.name),
    name: a.name,
    kind,
    attackBonus: a.attack_bonus ?? null,
    reach: reach?.[1] ? Number(reach[1]) : null,
    range: range?.[1] && range[2] ? { normal: Number(range[1]), long: Number(range[2]) } : null,
    damage: (a.damage ?? []).map((d, i) => ({
      dice: d.damage_dice.replace(/\s+/g, ''),
      type: d.damage_type.index as never,
      // Upstream lists the rider as an ordinary extra damage entry.
      condition: advantageRider && i > 0 ? ('advantage' as const) : null,
    })),
    text: desc,
  };
}

export function normalizeMonster(raw: RawMonster): Monster {
  const abilities = Object.fromEntries(ABILITIES.map((k) => [k, raw[SCORE_KEYS[k]]])) as Record<
    Ability,
    number
  >;
  const saves = { ...Object.fromEntries(ABILITIES.map((k) => [k, abilityMod(abilities[k])])) };
  const skills: Record<string, number> = {};
  for (const p of raw.proficiencies) {
    const id = p.proficiency.index;
    if (id.startsWith('saving-throw-')) {
      saves[id.slice('saving-throw-'.length)] = p.value;
    } else if (id.startsWith('skill-')) {
      skills[id.slice('skill-'.length)] = p.value;
    }
  }
  const speed = (k: string) => feet(raw.speed[k]);
  return Monster.parse({
    id: raw.index,
    name: raw.name,
    sizes: raw.size.toLowerCase().split(/\s+or\s+/),
    type: raw.type,
    ac: raw.armor_class[0]?.value,
    hp: raw.hit_points,
    hpFormula: raw.hit_points_roll.replace(/\s+/g, ''),
    speed: {
      walk: speed('walk'),
      climb: speed('climb'),
      fly: speed('fly'),
      swim: speed('swim'),
      burrow: speed('burrow'),
    },
    abilities,
    saves,
    skills,
    resistances: raw.damage_resistances,
    vulnerabilities: raw.damage_vulnerabilities,
    immunities: raw.damage_immunities,
    conditionImmunities: raw.condition_immunities.map((c) => c.index),
    actions: raw.actions.map(normalizeAction),
    traits: (raw.special_abilities ?? []).map((t) => ({ name: t.name, text: t.desc })),
    cr: raw.challenge_rating,
    xp: raw.xp,
    proficiencyBonus: raw.proficiency_bonus,
    source: raw.url,
  });
}
