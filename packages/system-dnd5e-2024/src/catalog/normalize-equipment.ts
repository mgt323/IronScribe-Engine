import type { RawEquipment } from './raw-schema.js';
import { Armor, Weapon } from './schema.js';

const has = (raw: RawEquipment, cat: string) =>
  raw.equipment_categories.some((c) => c.index === cat);

const range = (r: { normal: number; long?: number | undefined } | undefined) =>
  r ? { normal: r.normal, long: r.long ?? null } : null;

export function isWeapon(raw: RawEquipment): boolean {
  return has(raw, 'weapons');
}

export function normalizeWeapon(raw: RawEquipment): Weapon {
  const dmg = (d: NonNullable<RawEquipment['damage']> | undefined) =>
    d ? { dice: d.damage_dice, type: d.damage_type.index } : null;
  return Weapon.parse({
    id: raw.index,
    name: raw.name,
    category: has(raw, 'martial-weapons') ? 'martial' : 'simple',
    kind: has(raw, 'ranged-weapons') ? 'ranged' : 'melee',
    damage: dmg(raw.damage),
    versatileDamage: dmg(raw.two_handed_damage),
    properties: (raw.properties ?? []).map((p) => p.index),
    mastery: raw.mastery?.index,
    range: range(raw.range),
    throwRange: range(raw.throw_range),
    source: raw.url,
  });
}

export function normalizeArmor(raw: RawEquipment): Armor {
  const ac = raw.armor_class;
  if (!ac) throw new Error(`${raw.index}: no armor_class`);
  if (has(raw, 'shields')) {
    return Armor.parse({
      kind: 'shield',
      id: raw.index,
      name: raw.name,
      acBonus: ac.base,
      source: raw.url,
    });
  }
  const category = (['light', 'medium', 'heavy'] as const).find((c) => has(raw, `${c}-armor`));
  return Armor.parse({
    kind: 'body',
    id: raw.index,
    name: raw.name,
    category,
    baseAc: ac.base,
    dexCap: ac.dex_bonus ? (ac.max_bonus ?? null) : 0,
    strMin: raw.str_minimum ? raw.str_minimum : null,
    stealthDisadvantage: raw.stealth_disadvantage ?? false,
    source: raw.url,
  });
}
