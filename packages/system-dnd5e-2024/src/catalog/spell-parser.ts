import { compactDice, toAbility, toDamageType } from './normalize-util.js';
import type { RawSpell } from './raw-types.js';
import type { SpellMechanics } from './overrides.js';

const ABILITY_NAMES = 'Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma';
const DICE = String.raw`\d+d\d+(?:\s*\+\s*\d+)?`;

const NONE: SpellMechanics = {
  resolution: 'none',
  attack: null,
  save: null,
  damage: null,
  heal: null,
  projectiles: null,
  cantripDice: null,
  upcast: null,
};

const abilityShort = (name: string) => toAbility(name.slice(0, 3));

/**
 * Reads mechanics from upstream's structured fields and the spell text. Returns null
 * (text-only) whenever anything is ambiguous or unrecognised; it never guesses.
 */
export function parseSpellMechanics(raw: RawSpell): SpellMechanics | null {
  const text = `${raw.description} ${raw.higher_level ?? ''}`;

  // Attack or save, but not both.
  const saves = new Set(
    [...raw.description.matchAll(new RegExp(`(${ABILITY_NAMES}) saving throw`, 'g'))].map(
      (m) => m[1],
    ),
  );
  const attacks = new Set(
    [...raw.description.matchAll(/\b(melee|ranged) spell attack/gi)].map((m) =>
      m[1]?.toLowerCase(),
    ),
  );
  if (raw.attack_type) attacks.add(raw.attack_type);
  if (saves.size > 1 || attacks.size > 1 || (saves.size > 0 && attacks.size > 0)) return null;

  // Damage: structured data first.
  const dmgDice = raw.damage
    ? Object.entries(raw.damage.damage_at_slot_level ?? {}).sort(
        (a, b) => Number(a[0]) - Number(b[0]),
      )[0]?.[1]
    : undefined;
  const dmgType = raw.damage?.damage_type?.index;
  if (raw.damage && (!dmgDice || !dmgType)) return null;
  // Damage printed in the text that upstream does not carry: do not claim a mechanic.
  if (!raw.damage && new RegExp(`${DICE} [A-Z][a-z]+ damage`).test(raw.description)) return null;

  const heal = new RegExp(
    `regains? (?:a number of )?Hit Points equal to (${DICE})( plus your spellcasting ability modifier)?`,
  ).exec(raw.description);
  const heals = /\bregains?\b[^.]*\bHit Points\b/.test(raw.description);
  if (heals && !heal) return null;

  let cantripDice: SpellMechanics['cantripDice'] = null;
  let upcast: SpellMechanics['upcast'] = null;
  const damage =
    raw.damage && dmgDice && dmgType
      ? { dice: compactDice(dmgDice), type: toDamageType(dmgType), addSpellcastingMod: false }
      : null;

  if (raw.level === 0 && damage) {
    const m = new RegExp(
      String.raw`Cantrip Upgrade\.[^.]*?increases by (\d+d\d+) when you reach levels 5 \((\d+d\d+)\), 11 \((\d+d\d+)\), and 17 \((\d+d\d+)\)`,
    ).exec(raw.description);
    if (!m?.[1] || !m[2] || !m[3] || !m[4]) return null;
    const base = damage.dice;
    const sides = base.split('d')[1];
    if (
      m[1] !== `1d${sides}` ||
      m[2] !== `2d${sides}` ||
      m[3] !== `3d${sides}` ||
      m[4] !== `4d${sides}`
    ) {
      return null;
    }
    cantripDice = [1, 5, 11, 17].map((minLevel, i) => ({ minLevel, dice: `${i + 1}d${sides}` }));
  } else if (raw.level > 0 && (damage || heal)) {
    const up = new RegExp(
      `(?:damage|healing) increases by (${DICE}) for each spell slot level above \\d`,
    ).exec(text);
    if (up?.[1]) upcast = { dicePerSlot: compactDice(up[1]), projectilesPerSlot: null };
    else if (
      /for each spell slot level above/.test(text) &&
      /(damage|healing)/i.test(raw.higher_level ?? '')
    ) {
      return null;
    }
  }

  const healing = heal?.[1]
    ? { dice: compactDice(heal[1]), addSpellcastingMod: heal[2] !== undefined }
    : null;
  const saveAbility = [...saves][0];
  const attack = [...attacks][0];

  if (saveAbility) {
    return {
      ...NONE,
      resolution: 'save',
      save: {
        ability: abilityShort(saveAbility),
        onSuccess: damage && /half as much damage/i.test(raw.description) ? 'half' : 'none',
      },
      damage,
      heal: healing,
      cantripDice,
      upcast,
    };
  }
  if (attack === 'melee' || attack === 'ranged') {
    return { ...NONE, resolution: 'attack', attack, damage, heal: healing, cantripDice, upcast };
  }
  // Damage with neither an attack roll nor a save (darts, auras...) needs a hand-written override.
  if (damage) return null;
  if (healing) return { ...NONE, heal: healing, upcast };
  return null;
}
