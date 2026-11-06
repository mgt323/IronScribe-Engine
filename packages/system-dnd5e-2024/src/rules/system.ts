import type { RuleSystem } from '@iron-scribe/engine-core';

import type { Catalog } from '../catalog/catalog.js';
import { ABILITIES } from '../catalog/schema.js';
import { resolveDndCheckDc } from './check-dc.js';
import { dndNextCombatStep, dndTurnEnd } from './combat.js';
import { dndEncounterStart } from './encounter-start.js';
import { buildMenu } from './menu.js';
import { runDndProcedure } from './procedures.js';
import { resolveAttack } from './resolve-attack.js';
import { resolveDndSpawn } from './spawn-intent.js';

/** D&D 5e 2024 rules over a loaded SRD catalog. */
export function createDnd5eSystem(options: { catalog: Catalog }): RuleSystem {
  const { catalog } = options;
  return {
    id: 'dnd5e-2024',
    checkCatalog: {
      abilities: ABILITIES,
      skills: catalog.skills.list().map((skill) => skill.id),
    },
    availableActions: (state, actorId) => buildMenu(state, actorId, catalog),
    resolve: (state, request, rng) => resolveAttack(state, request, rng, catalog),
    runProcedure: (state, procedure, rng) => runDndProcedure(state, procedure, rng, catalog),
    resolveCheckDc: (state, context) => resolveDndCheckDc(state, context),
    resolveSpawn: (state, request) => resolveDndSpawn(state, request, catalog),
    encounterStart: (state, actorId) => dndEncounterStart(state, actorId),
    nextCombatStep: (state, playerId) => dndNextCombatStep(state, playerId, catalog),
    turnEnd: (state, actorId) => dndTurnEnd(state, actorId),
  };
}
