import { SPELL_MECHANICS } from './overrides.js';
import type { RawSpell } from './raw-schema.js';
import { Spell } from './schema-spell.js';

export function normalizeSpell(raw: RawSpell): Spell {
  const mech = SPELL_MECHANICS[raw.index];
  if (!mech) throw new Error(`${raw.index}: no mechanics override`);
  // Drift guard: where upstream has damage, the override must agree with it.
  if (raw.damage && mech.damage) {
    const base = Object.values(raw.damage.damage_at_slot_level)[0];
    if (raw.damage.damage_type.index !== mech.damage.type || base !== mech.damage.dice) {
      throw new Error(`${raw.index}: override damage disagrees with upstream`);
    }
  }
  const feet = /^(\d+) feet$/.exec(raw.range);
  return Spell.parse({
    id: raw.index,
    name: raw.name,
    level: raw.level,
    school: raw.school.index,
    castingTime: raw.casting_time,
    range: raw.range,
    rangeFeet: feet?.[1] ? Number(feet[1]) : null,
    concentration: raw.concentration,
    ...mech,
    text: raw.description,
    source: raw.url,
  });
}
