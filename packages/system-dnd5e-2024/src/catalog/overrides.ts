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

/** SRD 5.2.1, Monsters: Cultist, Ritual Sickle ("plus 1 Necrotic damage"); upstream omits it. */
export const EXTRA_MONSTER_DAMAGE: Readonly<
  Record<string, { action: string; dice: string; type: 'necrotic' }>
> = {
  cultist: { action: 'ritual-sickle', dice: '1', type: 'necrotic' },
};
