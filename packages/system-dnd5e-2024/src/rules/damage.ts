import { roll, type Rng } from '@iron-scribe/dice';

import type { DamageType, Weapon } from '../catalog/schema.js';
import type { MonsterAction } from '../catalog/schema-monster.js';

export interface DamagePart {
  readonly type: DamageType;
  readonly amount: number;
}

export interface DefenseProfile {
  readonly immunities: readonly DamageType[];
  readonly resistances: readonly DamageType[];
  readonly vulnerabilities: readonly DamageType[];
  readonly conditionalDefenses: readonly {
    readonly kind: 'resistance' | 'vulnerability' | 'immunity';
    readonly type: DamageType | null;
    readonly text: string;
  }[];
}

export interface AppliedDamage {
  readonly type: DamageType;
  readonly rolled: number;
  readonly amount: number;
  readonly notes: readonly string[];
}

type DamageEntry = MonsterAction['damage'][number];

/** Roll a dice formula once. A critical hit doubles the dice, not the modifier. */
export function rollDice(formula: string, rng: Rng, critical: boolean): number {
  const result = critical ? roll(formula, rng, { critical: true }) : roll(formula, rng);
  return result.total;
}

/** Weapon dice plus the attack's ability modifier. The total is never negative. */
export function rollWeaponDamage(
  rng: Rng,
  weapon: Weapon,
  modifier: number,
  critical: boolean,
): DamagePart {
  return {
    type: weapon.damage.type,
    amount: Math.max(0, rollDice(weapon.damage.dice, rng, critical) + modifier),
  };
}

/**
 * Monster dice already include the modifier. A part tagged `advantage` is the
 * "if the attack roll had Advantage" rider and is skipped otherwise.
 */
export function rollMonsterDamage(
  rng: Rng,
  damage: readonly DamageEntry[],
  critical: boolean,
  hadAdvantage: boolean,
): DamagePart[] {
  const parts: DamagePart[] = [];
  for (const part of damage) {
    if (part.condition === 'advantage' && !hadAdvantage) continue;
    parts.push({ type: part.type, amount: Math.max(0, rollDice(part.dice, rng, critical)) });
  }
  return parts;
}

function group(parts: readonly DamagePart[]): DamagePart[] {
  const order: DamageType[] = [];
  const sums = new Map<DamageType, number>();
  for (const part of parts) {
    if (!sums.has(part.type)) order.push(part.type);
    sums.set(part.type, (sums.get(part.type) ?? 0) + part.amount);
  }
  return order.map((type) => ({ type, amount: sums.get(type) ?? 0 }));
}

/**
 * SRD 5.2.1, "Resistance and Vulnerability": immunity first, then resistance
 * (round down), then vulnerability. The same defense does not stack. Resistance
 * and vulnerability to one type cancel, so the rolled amount is kept.
 * Conditional defenses are reported and not applied.
 */
export function applyDefenses(
  parts: readonly DamagePart[],
  defenses: DefenseProfile,
): AppliedDamage[] {
  return group(parts).map((part) => {
    const notes = defenses.conditionalDefenses
      .filter((entry) => entry.type === null || entry.type === part.type)
      .map((entry) => entry.text);
    const immune = defenses.immunities.includes(part.type);
    const resist = defenses.resistances.includes(part.type);
    const vulnerable = defenses.vulnerabilities.includes(part.type);
    let amount = part.amount;
    if (immune) {
      amount = 0;
      notes.push('immunity');
    } else if (resist && vulnerable) {
      notes.push('resistance and vulnerability cancel');
    } else if (resist) {
      amount = Math.floor(amount / 2);
      notes.push('resistance');
    } else if (vulnerable) {
      amount *= 2;
      notes.push('vulnerability');
    }
    return { type: part.type, rolled: part.amount, amount, notes };
  });
}
