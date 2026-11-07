import {
  EngineError,
  type GameState,
  type SpawnRequest,
  type SpawnResolution,
} from '@iron-scribe/engine-core';
import { z } from 'zod';

import type { Catalog } from '../catalog/catalog.js';
import { DEFAULT_MONSTER_VARIANTS } from '../catalog/overrides.js';
import { normalizeText } from '../catalog/section.js';
import { monsterToEntity } from '../catalog/spawn.js';
import type { Monster } from '../catalog/schema-monster.js';

export const DndAttitude = z.enum(['hostile', 'neutral', 'friendly']);
export const DndSpawnCount = z.number().int().min(1).max(10);
/** Every slot in one turn, added together. */
export const MAX_TURN_SPAWN = 10;
export const MAX_AMBIGUOUS_CANDIDATES = 10;

const IRREGULAR_PLURAL: Readonly<Record<string, string>> = {
  wolves: 'wolf',
};

/** Last word only: wolves -> wolf, skeletons -> skeleton. Leaves "goblin" alone. */
function singularQuery(query: string): string | null {
  const words = query.trim().split(/\s+/);
  const last = words.at(-1)?.toLowerCase();
  if (!last) return null;
  const irregular = IRREGULAR_PLURAL[last];
  let singular = irregular;
  if (!singular && last.endsWith('s') && !last.endsWith('ss') && last.length > 3) {
    singular = last.slice(0, -1);
  }
  if (!singular || singular === last) return null;
  words[words.length - 1] = singular;
  return words.join(' ');
}

function nextEntityId(state: GameState, templateId: string, used: Set<string>): string {
  const base = templateId.replaceAll('-', '_');
  let n = 1;
  let id = `${base}_${String(n)}`;
  while (state.entities[id] || used.has(id)) {
    n += 1;
    id = `${base}_${String(n)}`;
  }
  used.add(id);
  return id;
}

function spawnOne(
  template: Monster,
  id: string,
  attitude: string,
  proximity: 'engaged' | 'nearby',
) {
  const entity = monsterToEntity(template, id);
  return {
    ...entity,
    proximity,
    system: { ...entity.system, attitude },
  };
}

function exactMatch(catalog: Catalog, query: string): Monster | undefined {
  const wanted = normalizeText(query);
  return catalog.monsters
    .list()
    .find((m) => normalizeText(m.id) === wanted || normalizeText(m.name) === wanted);
}

/** Priority: (1) exact id or name, (2) default family variant, (3) catalog search. */
function matchTemplates(catalog: Catalog, query: string): readonly Monster[] {
  const singular = singularQuery(query);
  const forms = singular ? [query, singular] : [query];
  for (const form of forms) {
    const exact = exactMatch(catalog, form);
    if (exact) return [exact];
  }
  for (const form of forms) {
    const id = DEFAULT_MONSTER_VARIANTS[normalizeText(form)];
    const template = id ? catalog.monsters.get(id) : undefined;
    if (template) return [template];
  }
  const found = catalog.monsters.find(query);
  if (found.length > 0 || !singular) return found;
  return catalog.monsters.find(singular);
}

/**
 * One catalog match spawns `count` copies. Zero or many matches do not.
 * A spawn during an encounter is a reinforcement. Engaged ones join the order
 * through `afterSpawn`; nearby ones wait until a fight pulls them in.
 */
export function resolveDndSpawn(
  state: GameState,
  request: SpawnRequest,
  catalog: Catalog,
): SpawnResolution {
  const count = DndSpawnCount.parse(request.count);
  const turnTotal = request.turnTotal ?? count;
  if (!Number.isInteger(turnTotal) || turnTotal < count || turnTotal > MAX_TURN_SPAWN) {
    throw new EngineError('invalid_amount', 'A turn can spawn at most 10 creatures');
  }
  const attitude = DndAttitude.parse(request.attitude ?? 'hostile');
  const proximity = request.proximity ?? 'engaged';
  if (proximity !== 'engaged' && proximity !== 'nearby') {
    throw new EngineError('invalid_entity', 'Spawn proximity must be engaged or nearby');
  }
  const matches = matchTemplates(catalog, request.query);
  if (matches.length === 0) return { status: 'not_found', query: request.query };
  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      query: request.query,
      candidates: matches.slice(0, MAX_AMBIGUOUS_CANDIDATES).map((monster) => ({
        id: monster.id,
        name: monster.name,
      })),
    };
  }
  const template = matches[0];
  if (!template) throw new EngineError('invalid_entity', 'missing monster template');
  const used = new Set<string>();
  const entities = Array.from({ length: count }, () =>
    spawnOne(template, nextEntityId(state, template.id, used), attitude, proximity),
  );
  return {
    status: 'matched',
    entities,
    facts: entities.map((entity) => ({
      key: 'spawn',
      text: `spawn: ${entity.id} (${entity.name}) ${String(entity.hp.current)}/${String(entity.hp.max)} HP, AC ${String(template.ac)}, ${attitude}`,
    })),
  };
}
