import type { CoreEvent, Entity, Fact, GameState } from '@iron-scribe/engine-core';
import { z } from 'zod';

import type { DamageType } from '../catalog/schema.js';

/**
 * Hydra, "Multiple Heads" (SRD 5.2.1, Monsters: Hydra). Runtime state in `entity.system.hydra`,
 * written only by events. A fresh Hydra has 5 heads; the state is read lazily from the template.
 * - 25 damage or more in one turn: one head dies. Losing every head kills the Hydra.
 * - At the end of its turn, a Hydra that lost heads regrows two per head lost and regains
 *   20 HP, unless it took fire damage since the end of its last turn.
 * Out of scope (needs reactions): Reactive Heads.
 */
export const HydraState = z.strictObject({
  heads: z.number().int().min(0),
  damageThisTurn: z.number().int().min(0),
  headsLostSinceLastTurn: z.number().int().min(0),
  fireDamageSinceLastTurn: z.boolean(),
});
export type HydraState = z.infer<typeof HydraState>;

export const HYDRA_TEMPLATE = 'srd-5.2.1:monster:hydra';
export const FRESH_HYDRA: HydraState = {
  heads: 5,
  damageThisTurn: 0,
  headsLostSinceLastTurn: 0,
  fireDamageSinceLastTurn: false,
};
const HEAD_LOSS_DAMAGE = 25;
const HEAL_ON_REGROWTH = 20;

/** The Hydra's state, or null for any other creature. */
export function readHydraState(entity: Entity): HydraState | null {
  const raw = entity.system['hydra'];
  if (raw !== undefined && raw !== null) return HydraState.parse(raw);
  return entity.templateRef === HYDRA_TEMPLATE ? FRESH_HYDRA : null;
}

function setHydra(entityId: string, value: HydraState): CoreEvent {
  return { type: 'entity.systemDataSet', entityId, key: 'hydra', value };
}

/**
 * Damage that left a Hydra standing (`total` > 0, hit points above 0 after it).
 * Tracks fire and the turn's damage, and kills a head at the 25-damage threshold.
 */
export function hydraDamage(
  hydra: Entity,
  applied: readonly { readonly type: DamageType; readonly amount: number }[],
  total: number,
  hpAfter: number,
): { events: CoreEvent[]; facts: Fact[] } {
  const prev = readHydraState(hydra);
  if (!prev) return { events: [], facts: [] };
  const damageThisTurn = prev.damageThisTurn + total;
  const fire = applied.some((part) => part.type === 'fire' && part.amount > 0);
  const losesHead = prev.damageThisTurn < HEAD_LOSS_DAMAGE && damageThisTurn >= HEAD_LOSS_DAMAGE;
  const heads = losesHead ? prev.heads - 1 : prev.heads;
  const next: HydraState = {
    heads,
    damageThisTurn,
    headsLostSinceLastTurn: prev.headsLostSinceLastTurn + (losesHead ? 1 : 0),
    fireDamageSinceLastTurn: prev.fireDamageSinceLastTurn || fire,
  };
  const events: CoreEvent[] = [setHydra(hydra.id, next)];
  const facts: Fact[] = [];
  if (losesHead) {
    facts.push({ key: 'hydra', text: `${hydra.id} loses a head (${String(heads)} remaining)` });
  }
  if (heads === 0) {
    events.push({ type: 'entity.damaged', entityId: hydra.id, amount: hpAfter });
    facts.push(
      { key: 'hp', text: `${hydra.id} 0/${String(hydra.hp.max)}` },
      { key: 'defeated', text: hydra.id },
    );
  }
  return { events, facts };
}

/**
 * The end of any combatant's turn: every present Hydra's turn damage resets. When the Hydra
 * itself ends its turn, lost heads regrow (two per head lost, 20 HP once) unless fire hurt it.
 */
export function hydraTurnEnd(
  state: GameState,
  endingId: string,
): { events: CoreEvent[]; facts: Fact[] } {
  const events: CoreEvent[] = [];
  const facts: Fact[] = [];
  for (const id of state.spawnOrder) {
    const hydra = state.entities[id];
    const prev = hydra?.present ? readHydraState(hydra) : null;
    if (!hydra || !prev) continue;
    let next: HydraState = { ...prev, damageThisTurn: 0 };
    if (id === endingId && hydra.hp.current > 0 && prev.heads > 0) {
      if (prev.headsLostSinceLastTurn > 0 && !prev.fireDamageSinceLastTurn) {
        const regrown = 2 * prev.headsLostSinceLastTurn;
        const healed = Math.min(HEAL_ON_REGROWTH, hydra.hp.max - hydra.hp.current);
        next = { ...next, heads: prev.heads + regrown };
        if (healed > 0) events.push({ type: 'entity.healed', entityId: id, amount: healed });
        facts.push({
          key: 'hydra',
          text: `${hydra.name} grows ${String(regrown)} heads and regains ${String(healed)} HP`,
        });
      }
      next = { ...next, headsLostSinceLastTurn: 0, fireDamageSinceLastTurn: false };
    }
    if (JSON.stringify(next) !== JSON.stringify(prev)) events.push(setHydra(id, next));
  }
  return { events, facts };
}
