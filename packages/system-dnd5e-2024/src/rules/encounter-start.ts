import type { EntityId, GameState, Procedure } from '@iron-scribe/engine-core';

import type { Catalog } from '../catalog/catalog.js';
import { surprisedBy } from './hide.js';

/**
 * Combat opens with initiative before the first attack. No encounter yet and
 * an engaged hostile above 0 HP: roll the engaged creatures. A successful Hide
 * (and `unawareOf`) puts opponents in `surprised`, which is Disadvantage.
 */
export function dndEncounterStart(
  state: GameState,
  actorId: EntityId,
  catalog: Catalog,
): Procedure | null {
  if (state.system['encounter'] != null) return null;
  const hostile = state.spawnOrder.some((id) => {
    const entity = state.entities[id];
    return (
      id !== actorId &&
      entity?.proximity === 'engaged' &&
      entity.hp.current > 0 &&
      entity.system['attitude'] === 'hostile'
    );
  });
  return hostile ? { kind: 'initiative', surprised: surprisedBy(state, actorId, catalog) } : null;
}
