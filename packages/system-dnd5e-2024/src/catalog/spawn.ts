import type { Entity, EntityId } from '@iron-scribe/engine-core';

import { Monster } from './schema-monster.js';

/** Spawn an entity from an SRD template. HP is copied, never rolled or invented. */
export function monsterToEntity(
  template: Monster,
  entityId: EntityId,
  options?: { name?: string },
): Entity {
  return {
    id: entityId,
    name: options?.name ?? template.name,
    templateRef: `srd-5.2.1:monster:${template.id}`,
    proximity: 'engaged',
    hp: { current: template.hp, max: template.hp },
    // Full snapshot: later data refreshes cannot change monsters already in a save.
    system: { monster: template },
  };
}

/** Read the stat block back from an entity. Throws if missing or invalid. */
export function readMonsterSnapshot(entity: Entity): Monster {
  return Monster.parse(entity.system['monster']);
}
