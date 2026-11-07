import type { Entity } from '@iron-scribe/engine-core';

/** In the fight: a legal target, and on the initiative roll. Not melee reach. */
export function isEngaged(entity: Entity | undefined): entity is Entity {
  return entity?.proximity === 'engaged';
}

/** Still in the area (`engaged` or `nearby`). `gone` has left. */
export function isInScene(entity: Entity | undefined): entity is Entity {
  return entity?.proximity === 'engaged' || entity?.proximity === 'nearby';
}
