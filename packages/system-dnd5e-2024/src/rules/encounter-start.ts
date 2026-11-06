import type { EntityId, GameState, Procedure } from '@iron-scribe/engine-core';

/**
 * Combat opens with initiative before the first attack. No encounter yet and
 * a hostile creature above 0 HP is present: roll it. Surprise is not modelled.
 */
export function dndEncounterStart(state: GameState, actorId: EntityId): Procedure | null {
  if (state.system['encounter'] !== undefined) return null;
  const hostile = state.spawnOrder.some((id) => {
    const entity = state.entities[id];
    return (
      id !== actorId &&
      entity?.present === true &&
      entity.hp.current > 0 &&
      entity.system['attitude'] === 'hostile'
    );
  });
  return hostile ? { kind: 'initiative', surprised: [] } : null;
}
