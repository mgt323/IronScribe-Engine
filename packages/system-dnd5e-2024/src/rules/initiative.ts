import { resolveRollMode, rollD20, type Rng } from '@iron-scribe/dice';
import { EngineError, type Fact, type GameState, type Resolution } from '@iron-scribe/engine-core';

import type { Catalog } from '../catalog/catalog.js';
import { readConditions, rollEffects } from './conditions.js';
import { readCreature } from './creature.js';

interface Roll {
  readonly entityId: string;
  readonly name: string;
  readonly total: number;
  readonly dex: number;
  readonly spawnIndex: number;
  readonly mode: string;
}

/**
 * SRD 5.2.1, "Initiative": a Dexterity check. Surprised creatures roll with
 * disadvantage. Ties break by Dexterity score, then by spawn order.
 */
export function rollInitiative(
  state: GameState,
  rng: Rng,
  surprised: readonly string[],
  catalog: Catalog,
): Resolution {
  for (const id of surprised) {
    if (!state.entities[id]) throw new EngineError('unknown_entity', `Unknown entity: ${id}`);
  }
  const surprisedIds = new Set(surprised);
  const rolls: Roll[] = [];
  for (const [spawnIndex, entityId] of state.spawnOrder.entries()) {
    const entity = state.entities[entityId];
    if (!entity?.present) continue;
    const view = readCreature(entity, catalog);
    const conditions = readConditions(entity);
    const effects = rollEffects({ kind: 'initiative', conditions });
    const mode = resolveRollMode({
      advantage: effects.advantage,
      disadvantage: effects.disadvantage || surprisedIds.has(entityId),
    });
    const rolled = rollD20(rng, { mode, modifier: view.initiativeBonus - effects.penalty });
    rolls.push({
      entityId,
      name: view.name,
      total: rolled.total,
      dex: view.dexScore,
      spawnIndex,
      mode,
    });
  }
  rolls.sort((a, b) => b.total - a.total || b.dex - a.dex || a.spawnIndex - b.spawnIndex);
  const order = rolls.map((entry) => ({ entityId: entry.entityId, total: entry.total }));
  const facts: Fact[] = rolls.map((entry) => ({
    key: 'initiative',
    text:
      entry.mode === 'normal'
        ? `${entry.name} ${entry.total}`
        : `${entry.name} ${entry.total} (${entry.mode})`,
  }));
  return {
    events: [
      {
        type: 'state.systemDataSet',
        key: 'encounter',
        value: { round: 1, turnIndex: 0, order },
      },
    ],
    facts,
  };
}
