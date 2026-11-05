import { toDamageType } from './normalize-util.js';
import type { RawEquipment, RawMagicItem } from './raw-types.js';
import { MASTERIES, WEAPON_PROPERTIES, type Armor, type Weapon } from './schema.js';
import type { Gear, MagicItem } from './schema-items.js';

const has = (raw: RawEquipment, cat: string) =>
  raw.equipment_categories.some((c) => c.index === cat);

const range = (r: { normal: number; long?: number | undefined } | undefined) =>
  r ? { normal: r.normal, long: r.long ?? null } : null;

export const isWeapon = (raw: RawEquipment): boolean => has(raw, 'weapons');
/** The `armor` category includes the shield. */
export const isArmor = (raw: RawEquipment): boolean => has(raw, 'armor');

function pick<T extends string>(all: readonly T[], value: string, what: string): T {
  const found = all.find((x) => x === value);
  if (!found) throw new Error(`unknown ${what} "${value}"`);
  return found;
}

export function normalizeWeapon(raw: RawEquipment): Weapon {
  const dmg = (d: RawEquipment['damage']) =>
    d ? { dice: d.damage_dice, type: toDamageType(d.damage_type.index) } : null;
  const damage = dmg(raw.damage);
  if (!damage) throw new Error(`${raw.index}: weapon without damage`);
  if (!raw.mastery) throw new Error(`${raw.index}: weapon without mastery`);
  const properties = (raw.properties ?? []).map((p) =>
    pick(WEAPON_PROPERTIES, p.index, 'property'),
  );
  const kind = has(raw, 'ranged-weapons') ? 'ranged' : 'melee';
  // Upstream omits `range` on the Morningstar; a melee weapon reaches 5 feet (10 with Reach).
  const reach = { normal: properties.includes('reach') ? 10 : 5, long: null };
  const weaponRange = range(raw.range) ?? (kind === 'melee' ? reach : null);
  if (!weaponRange) throw new Error(`${raw.index}: ranged weapon without range`);
  return {
    id: raw.index,
    name: raw.name,
    category: has(raw, 'martial-weapons') ? 'martial' : 'simple',
    kind,
    damage,
    versatileDamage: dmg(raw.two_handed_damage),
    properties,
    mastery: pick(MASTERIES, raw.mastery.index, 'mastery'),
    range: weaponRange,
    throwRange: range(raw.throw_range),
    source: raw.url,
  };
}

export function normalizeArmor(raw: RawEquipment): Armor {
  const ac = raw.armor_class;
  if (!ac) throw new Error(`${raw.index}: no armor_class`);
  if (has(raw, 'shields')) {
    return { kind: 'shield', id: raw.index, name: raw.name, acBonus: ac.base, source: raw.url };
  }
  const category = (['light', 'medium', 'heavy'] as const).find((c) => has(raw, `${c}-armor`));
  if (!category) throw new Error(`${raw.index}: unknown armor category`);
  return {
    kind: 'body',
    id: raw.index,
    name: raw.name,
    category,
    baseAc: ac.base,
    dexCap: ac.dex_bonus ? (ac.max_bonus ?? null) : 0,
    strMin: raw.str_minimum ? raw.str_minimum : null,
    stealthDisadvantage: raw.stealth_disadvantage ?? false,
    source: raw.url,
  };
}

/** Order matters: gaming sets and instruments are also in `tools`. */
const GEAR_KIND_BY_CATEGORY: readonly (readonly [string, Gear['kind']])[] = [
  ['ammunition', 'ammunition'],
  ['gaming-sets', 'gaming-set'],
  ['musical-instruments', 'instrument'],
  ['arcane-foci', 'focus'],
  ['druidic-foci', 'focus'],
  ['holy-symbols', 'focus'],
  ['equipment-packs', 'pack'],
  ['tools', 'tool'],
];

export function normalizeGear(raw: RawEquipment): Gear {
  const kind = GEAR_KIND_BY_CATEGORY.find(([cat]) => has(raw, cat))?.[1] ?? 'gear';
  return {
    id: raw.index,
    name: raw.name,
    kind,
    cost: { quantity: raw.cost.quantity, unit: raw.cost.unit },
    weight: raw.weight ?? null,
    text: raw.description ?? '',
    source: raw.url,
  };
}

/** Variants point at their parent only from the parent's side, so invert that link. */
export function normalizeMagicItems(raws: readonly RawMagicItem[]): MagicItem[] {
  const parentOf = new Map<string, string>();
  for (const r of raws) for (const v of r.variants) parentOf.set(v.index, r.index);
  return raws.map((r) => ({
    id: r.index,
    name: r.name,
    category: r.equipment_category.index,
    rarity: r.rarity.name,
    attunement: r.attunement,
    variantOf: parentOf.get(r.index) ?? null,
    variants: r.variants.map((v) => v.index),
    text: r.desc.join('\n\n'),
    source: r.url,
  }));
}
