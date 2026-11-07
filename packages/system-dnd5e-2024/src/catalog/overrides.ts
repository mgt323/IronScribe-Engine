import type { DamageType } from './schema.js';
import type { Monster } from './schema-monster.js';
import type { Spell } from './schema-spell.js';

/**
 * Rules data upstream (5e-bits 2024) does not carry. Each entry cites SRD 5.2.1
 * (CC-BY-4.0), chapter "Spells", the spell's own entry.
 */
export type SpellMechanics = Pick<
  Spell,
  'resolution' | 'attack' | 'save' | 'damage' | 'heal' | 'projectiles' | 'cantripDice' | 'upcast'
>;

const cantrip = (d: string) =>
  [1, 5, 11, 17].map((minLevel, i) => ({ minLevel, dice: `${i + 1}${d}` }));

const none = { attack: null, save: null, damage: null, heal: null, projectiles: null } as const;

export const SPELL_MECHANICS: Readonly<Record<string, SpellMechanics>> = {
  // SRD 5.2.1, Spells: Fire Bolt
  'fire-bolt': {
    ...none,
    resolution: 'attack',
    attack: 'ranged',
    damage: { dice: '1d10', type: 'fire', addSpellcastingMod: false },
    cantripDice: cantrip('d10'),
    upcast: null,
  },
  // SRD 5.2.1, Spells: Ray of Frost (the Speed reduction stays as text)
  'ray-of-frost': {
    ...none,
    resolution: 'attack',
    attack: 'ranged',
    damage: { dice: '1d8', type: 'cold', addSpellcastingMod: false },
    cantripDice: cantrip('d8'),
    upcast: null,
  },
  // SRD 5.2.1, Spells: Sacred Flame
  'sacred-flame': {
    ...none,
    resolution: 'save',
    save: { ability: 'dex', onSuccess: 'none' },
    damage: { dice: '1d8', type: 'radiant', addSpellcastingMod: false },
    cantripDice: cantrip('d8'),
    upcast: null,
  },
  // SRD 5.2.1, Spells: Magic Missile (no attack roll, no save)
  'magic-missile': {
    ...none,
    resolution: 'auto',
    damage: { dice: '1d4+1', type: 'force', addSpellcastingMod: false },
    projectiles: 3,
    cantripDice: null,
    upcast: { dicePerSlot: null, projectilesPerSlot: 1 },
  },
  // SRD 5.2.1, Spells: Cure Wounds
  'cure-wounds': {
    ...none,
    resolution: 'none',
    heal: { dice: '2d8', addSpellcastingMod: true },
    cantripDice: null,
    upcast: { dicePerSlot: '2d8', projectilesPerSlot: null },
  },
  // SRD 5.2.1, Spells: Burning Hands (15-foot cone stays as text)
  'burning-hands': {
    ...none,
    resolution: 'save',
    save: { ability: 'dex', onSuccess: 'half' },
    damage: { dice: '3d6', type: 'fire', addSpellcastingMod: false },
    cantripDice: null,
    upcast: { dicePerSlot: '1d6', projectilesPerSlot: null },
  },
};

/** Flat damage (no dice) that upstream's `damage` array leaves out. Each is printed in the stat block. */
type ExtraDamage = { action: string; dice: string; type: DamageType };
const flat = (action: string, type: DamageType): ExtraDamage => ({ action, dice: '1', type });

/**
 * SRD 5.2.1, Monsters: each listed attack prints this damage in its "Hit:" line, but the
 * upstream data omits it ("1 Piercing damage" with no dice, or the Cultist's "plus 1 Necrotic").
 */
export const EXTRA_MONSTER_DAMAGE: Readonly<Record<string, readonly ExtraDamage[]>> = {
  'awakened-shrub': [flat('rake', 'slashing')],
  badger: [flat('bite', 'piercing')],
  bat: [flat('bite', 'piercing')],
  cat: [flat('scratch', 'slashing')],
  crab: [flat('claw', 'bludgeoning')],
  cultist: [flat('ritual-sickle', 'necrotic')],
  'flying-snake': [flat('bite', 'piercing')],
  frog: [flat('bite', 'piercing')],
  'giant-fire-beetle': [flat('bite', 'fire')],
  hawk: [flat('talons', 'slashing')],
  homunculus: [flat('bite', 'piercing')],
  lizard: [flat('bite', 'piercing')],
  owl: [flat('talons', 'slashing')],
  piranha: [flat('bite', 'piercing')],
  rat: [flat('bite', 'piercing')],
  raven: [flat('beak', 'piercing')],
  scorpion: [flat('sting', 'piercing')],
  spider: [flat('bite', 'piercing')],
  sprite: [flat('enchanting-bow', 'piercing')],
  weasel: [flat('bite', 'piercing')],
};

/**
 * Attacks whose printed damage the data cannot express yet. Goat, Ram: "1 Bludgeoning damage, or
 * 2 (1d4) ... if the goat moved 20+ feet"; upstream lists only the 1d4 as ordinary damage.
 */
export const UNRESOLVED_MONSTER_DAMAGE: ReadonlySet<string> = new Set(['goat/ram']);

/**
 * Iron Scribe UX policy, not an SRD rule. A generic family name ("goblin", "goblins")
 * spawns this stat block instead of asking the player which variant. A named variant
 * ("goblin boss") still wins, and a broad family ("dragon") is still ambiguous.
 */
export const DEFAULT_MONSTER_VARIANTS: Readonly<Record<string, string>> = {
  goblin: 'goblin-warrior',
  bugbear: 'bugbear-warrior',
  hobgoblin: 'hobgoblin-warrior',
  vampire: 'vampire-vampire',
  werebear: 'werebear-hybrid',
  wereboar: 'wereboar-hybrid',
  wererat: 'wererat-hybrid',
  weretiger: 'weretiger-hybrid',
  werewolf: 'werewolf-hybrid',
};

export function withExtraDamage(m: Monster): Monster {
  const extras = EXTRA_MONSTER_DAMAGE[m.id];
  if (!extras) return m;
  return {
    ...m,
    actions: m.actions.map((a) => {
      const add = extras.filter((e) => e.action === a.id);
      return add.length === 0
        ? a
        : {
            ...a,
            damage: [
              ...a.damage,
              ...add.map((e) => ({ dice: e.dice, type: e.type, condition: null })),
            ],
          };
    }),
  };
}
