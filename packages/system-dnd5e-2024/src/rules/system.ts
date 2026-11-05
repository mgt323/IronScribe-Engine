import type { RuleSystem } from '@iron-scribe/engine-core';

import type { Catalog } from '../catalog/catalog.js';
import { buildMenu } from './menu.js';
import { runDndProcedure } from './procedures.js';
import { resolveAttack } from './resolve-attack.js';

/** D&D 5e 2024 rules over a loaded SRD catalog. */
export function createDnd5eSystem(options: { catalog: Catalog }): RuleSystem {
  const { catalog } = options;
  return {
    id: 'dnd5e-2024',
    availableActions: (state, actorId) => buildMenu(state, actorId, catalog),
    resolve: (state, request, rng) => resolveAttack(state, request, rng, catalog),
    runProcedure: (state, procedure, rng) => runDndProcedure(state, procedure, rng, catalog),
  };
}
