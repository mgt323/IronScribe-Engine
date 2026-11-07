import { feet } from './normalize-util.js';
import { SPELL_MECHANICS, type SpellMechanics } from './overrides.js';
import { parseSpellMechanics } from './spell-parser.js';
import type { RawSpell } from './raw-types.js';
import type { Spell } from './schema-spell.js';

const TEXT_ONLY = {
  resolution: 'none',
  attack: null,
  save: null,
  damage: null,
  heal: null,
  projectiles: null,
  cantripDice: null,
  upcast: null,
} as const;

/** Mechanics: hand-checked override first, then the text parser, otherwise text only. */
function mechanicsFor(raw: RawSpell): SpellMechanics & Pick<Spell, 'mechanics'> {
  const override = SPELL_MECHANICS[raw.index];
  if (override) {
    // Drift guard: where upstream has damage, the override must agree with it.
    if (raw.damage && override.damage) {
      const base = Object.values(raw.damage.damage_at_slot_level ?? {})[0];
      if (raw.damage.damage_type?.index !== override.damage.type || base !== override.damage.dice) {
        throw new Error(`${raw.index}: override damage disagrees with upstream`);
      }
    }
    return { ...override, mechanics: 'override' };
  }
  const parsed = parseSpellMechanics(raw);
  return parsed ? { ...parsed, mechanics: 'parsed' } : { ...TEXT_ONLY, mechanics: 'text-only' };
}

export function normalizeSpell(raw: RawSpell): Spell {
  return {
    id: raw.index,
    name: raw.name,
    level: raw.level,
    school: raw.school.index,
    castingTime: raw.casting_time,
    range: raw.range,
    rangeFeet: /^\d+ feet$/.test(raw.range) ? feet(raw.range) : null,
    concentration: raw.concentration,
    verbal: raw.components.includes('V'),
    ...mechanicsFor(raw),
    text: raw.description,
    source: raw.url,
  };
}
