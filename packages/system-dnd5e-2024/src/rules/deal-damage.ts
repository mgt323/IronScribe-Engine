import {
  EngineError,
  type CoreEvent,
  type Entity,
  type Fact,
  type GameState,
  type Resolution,
} from '@iron-scribe/engine-core';

import type { Catalog } from '../catalog/catalog.js';
import { readCreature } from './creature.js';
import { downedOutcome } from './death-saves.js';
import { applyDefenses, type DamagePart } from './damage.js';
import { hydraDamage } from './hydra.js';

export function entityOf(state: GameState, id: string): Entity {
  const found = state.entities[id];
  if (!found) throw new EngineError('unknown_entity', `Unknown entity: ${id}`);
  return found;
}

function damageFacts(parts: ReturnType<typeof applyDefenses>): Fact[] {
  return parts.map((part) => {
    const note = part.notes.length > 0 ? ` (${part.notes.join('; ')})` : '';
    return { key: 'damage', text: `${String(part.amount)} ${part.type}${note}` };
  });
}

/**
 * Rolled damage lands on one creature: defenses, hit points, and what follows
 * (a character at 0 HP is unconscious and dying or dead, a monster is defeated).
 * `parts` are already rolled; nothing here rolls dice.
 */
export function dealDamage(
  state: GameState,
  defenderId: string,
  parts: readonly DamagePart[],
  critical: boolean,
  catalog: Catalog,
): Resolution {
  const defender = entityOf(state, defenderId);
  const view = readCreature(defender, catalog);
  const applied = applyDefenses(parts, view);
  const facts: Fact[] = damageFacts(applied);
  const total = applied.reduce((sum, part) => sum + part.amount, 0);
  const hpAfter = Math.max(0, defender.hp.current - total);
  facts.push({ key: 'hp', text: `${defender.id} ${String(hpAfter)}/${String(defender.hp.max)}` });
  const events: CoreEvent[] = [];
  if (total > 0) events.push({ type: 'entity.damaged', entityId: defender.id, amount: total });
  if (total > 0 && view.kind === 'character') {
    const downed = downedOutcome(defender, view.conditionImmunities, { total, critical });
    events.push(...downed.events);
    facts.push(...downed.facts);
  } else if (total > 0 && hpAfter === 0) {
    facts.push({ key: 'defeated', text: defender.id });
  } else if (total > 0) {
    const hydra = hydraDamage(defender, applied, total, hpAfter);
    events.push(...hydra.events);
    facts.push(...hydra.facts);
  }
  return { events, facts };
}
