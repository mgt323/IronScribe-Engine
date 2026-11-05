import { compactDice, slug, toAbility, toDamageType } from './normalize-util.js';
import type { MonsterAction } from './schema-monster.js';

type Usage = { type: string; min_value?: number | undefined; times?: number | undefined };

type Spellcasting = {
  ability: { index: string };
  dc?: number | undefined;
  modifier?: number | undefined;
  spells: readonly {
    index: string;
    level: number;
    usage?: { type: string; times?: number | undefined } | undefined;
  }[];
};

/** The part of a raw action, bonus action, reaction or legendary action we read. */
export interface RawActionLike {
  name: string;
  desc: string;
  attack_bonus?: number | undefined;
  dc?:
    | {
        dc_type: { index: string };
        dc_value?: number | undefined;
        success_type: 'none' | 'half' | 'other';
      }
    | undefined;
  damage?: readonly { damage_type: { index: string }; damage_dice: string }[] | undefined;
  usage?: Usage | undefined;
  spellcasting?: Spellcasting | undefined;
  multiattack_type?: string | undefined;
  actions?: readonly { action_name: string; count: number | string }[] | undefined;
  action_options?: unknown;
}

type Step = { action: string; count: number | string };

const num = (v: unknown, what: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`${what}: "${String(v)}" is not an integer`);
  return n;
};

/** Upstream now writes counts as strings ("2"); keep non-numeric rule text as is. */
const count = (v: unknown, what: string): number | string => {
  if (typeof v === 'string' && !/^\d+$/.test(v.trim())) return v;
  return num(v, what);
};

type RawOption = {
  option_type?: string;
  action_name?: string;
  count?: unknown;
  items?: RawOption[];
};

const optionSteps = (x: RawOption): Step[] => {
  if (x.option_type === 'multiple' && Array.isArray(x.items)) return x.items.flatMap(optionSteps);
  if (x.option_type === 'action' && typeof x.action_name === 'string') {
    return [{ action: x.action_name, count: count(x.count, 'action_options.count') }];
  }
  throw new Error(`action_options: unsupported option ${String(x.option_type)}`);
};

/** Reads upstream's `action_options`: `choose` N of a list of options (an action, or several together). */
function parseOptions(raw: unknown): { choose: number; choices: Step[][] } | null {
  if (raw === undefined) return null;
  const o = raw as { choose?: unknown; from?: { options?: unknown } };
  const options = o.from?.options;
  if (!Array.isArray(options)) throw new Error('action_options: unexpected shape');
  return {
    choose: num(o.choose, 'action_options.choose'),
    choices: (options as RawOption[]).map(optionSteps),
  };
}

function usage(u: Usage | undefined): MonsterAction['usage'] {
  if (!u) return null;
  if (u.type === 'recharge on roll')
    return { type: 'recharge', min: u.min_value ?? null, times: null };
  if (u.type === 'per day') return { type: 'perDay', min: null, times: u.times ?? null };
  if (u.type === 'recharge after rest') return { type: 'perRest', min: null, times: null };
  throw new Error(`unknown usage type "${u.type}"`);
}

export function normalizeSpellcasting(s: Spellcasting | undefined): MonsterAction['spellcasting'] {
  if (!s) return null;
  return {
    ability: toAbility(s.ability.index),
    dc: s.dc ?? null,
    attackBonus: s.modifier ?? null,
    spells: s.spells.map((sp) => ({
      id: sp.index,
      level: sp.level,
      usage: sp.usage ? { type: sp.usage.type, times: sp.usage.times ?? null } : null,
    })),
  };
}

export function normalizeAction(a: RawActionLike): MonsterAction {
  const head = a.desc.split('Hit:')[0] ?? '';
  const melee = /melee/i.test(head);
  const ranged = /ranged/i.test(head);
  const kind =
    a.attack_bonus !== undefined
      ? melee && ranged
        ? 'meleeOrRanged'
        : ranged
          ? 'ranged'
          : 'melee'
      : a.dc !== undefined
        ? 'save'
        : 'other';
  const reach = /reach (\d+)/i.exec(a.desc);
  const range = /range (\d+)\/(\d+)/i.exec(a.desc);
  const advantageRider = /if the attack roll had advantage/i.test(a.desc);
  const isMulti =
    a.multiattack_type !== undefined || a.actions !== undefined || a.action_options !== undefined;
  return {
    id: slug(a.name),
    name: a.name,
    kind,
    attackBonus: a.attack_bonus ?? null,
    reach: reach?.[1] ? Number(reach[1]) : null,
    range: range?.[1] && range[2] ? { normal: Number(range[1]), long: Number(range[2]) } : null,
    damage: (a.damage ?? []).map((d, i) => ({
      dice: compactDice(d.damage_dice),
      type: toDamageType(d.damage_type.index),
      // Upstream lists the rider as an ordinary extra damage entry.
      condition: advantageRider && i > 0 ? ('advantage' as const) : null,
    })),
    save: a.dc
      ? {
          ability: toAbility(a.dc.dc_type.index),
          dc: a.dc.dc_value ?? null,
          onSuccess: a.dc.success_type,
        }
      : null,
    usage: usage(a.usage),
    multiattack: isMulti
      ? {
          steps: (a.actions ?? []).map((s) => ({
            action: s.action_name,
            count: count(s.count, 'multiattack count'),
          })),
          options: parseOptions(a.action_options),
        }
      : null,
    spellcasting: normalizeSpellcasting(a.spellcasting),
    text: a.desc,
  };
}
