import type { Rng } from '@iron-scribe/dice';
import {
  EngineError,
  type Fact,
  type GameState,
  type Procedure,
  type Resolution,
} from '@iron-scribe/engine-core';
import { z } from 'zod';

import type { Catalog } from '../catalog/catalog.js';
import { ABILITIES, Ability, type Ability as AbilityName } from '../catalog/schema.js';
import { abilityCheck, savingThrow, skillCheck, type CheckResult } from './checks.js';
import { runCombatProcedure } from './combat.js';
import { readConditions } from './conditions.js';
import { readCreature } from './creature.js';
import { runDeathSave } from './death-save-roll.js';
import { HIDE_DC, hideAllowed, resolveHide, resolveSearch } from './hide.js';
import { rollInitiative } from './initiative.js';
import { engageNearbyHostiles, joinEncounter } from './join-encounter.js';
import { ABILITY_LABEL } from './modifiers.js';
import { runRecharge } from './usage.js';

const CheckProcedure = z.strictObject({
  kind: z.literal('check'),
  actorId: z.string(),
  ability: Ability,
  skill: z.string().nullable(),
  dc: z.number().int(),
});
const SaveProcedure = z.strictObject({
  kind: z.literal('save'),
  actorId: z.string(),
  ability: Ability,
  dc: z.number().int(),
});
const InitiativeProcedure = z.strictObject({
  kind: z.literal('initiative'),
  surprised: z.array(z.string()),
});
const DeathSaveProcedure = z.strictObject({
  kind: z.literal('deathSave'),
  actorId: z.string(),
});
const RechargeProcedure = z.strictObject({
  kind: z.literal('recharge'),
  actorId: z.string(),
});
const JoinProcedure = z.strictObject({
  kind: z.literal('joinEncounter'),
  entityIds: z.array(z.string()),
});
const EngageProcedure = z.strictObject({
  kind: z.literal('engageNearby'),
});
const CombatProcedure = z.strictObject({
  kind: z.enum(['advanceTurn', 'advanceRound', 'endEncounter']),
});
const ProcedureInput = z.discriminatedUnion('kind', [
  CombatProcedure.extend({ kind: z.literal('advanceTurn') }),
  CombatProcedure.extend({ kind: z.literal('advanceRound') }),
  CombatProcedure.extend({ kind: z.literal('endEncounter') }),
  CheckProcedure,
  SaveProcedure,
  InitiativeProcedure,
  DeathSaveProcedure,
  RechargeProcedure,
  JoinProcedure,
  EngageProcedure,
]);

function skillAbility(catalog: Catalog, skillId: string): AbilityName {
  const found = ABILITIES.find((ability) => ability === catalog.skills.get(skillId)?.ability);
  if (!found) throw new Error(`unknown skill: ${skillId}`);
  return found;
}

function testFact(key: string, label: string, result: CheckResult): Fact {
  if (result.autoFail) return { key, text: `${label} auto-fail vs DC ${String(result.dc)}` };
  const outcome = result.success ? 'success' : 'failure';
  return { key, text: `${label} ${String(result.total)} vs DC ${String(result.dc)}, ${outcome}` };
}

function actor(state: GameState, actorId: string) {
  const entity = state.entities[actorId];
  if (!entity) throw new EngineError('unknown_entity', `Unknown entity: ${actorId}`);
  return entity;
}

/** Engine-triggered check, save, death save, or initiative. Payloads are validated on entry. */
export function runDndProcedure(
  state: GameState,
  procedure: Procedure,
  rng: Rng,
  catalog: Catalog,
): Resolution {
  const parsed = ProcedureInput.safeParse(procedure);
  if (!parsed.success) throw new EngineError('unknown_alias', 'Invalid procedure');
  const input = parsed.data;
  if (
    input.kind === 'advanceTurn' ||
    input.kind === 'advanceRound' ||
    input.kind === 'endEncounter'
  ) {
    return runCombatProcedure(state, input.kind);
  }
  if (input.kind === 'initiative') return rollInitiative(state, rng, input.surprised, catalog);
  if (input.kind === 'joinEncounter') return joinEncounter(state, rng, input.entityIds, catalog);
  if (input.kind === 'engageNearby') return engageNearbyHostiles(state, rng, catalog);
  if (input.kind === 'recharge') return runRecharge(state, input.actorId, rng);
  if (input.kind === 'deathSave') return runDeathSave(state, input.actorId, rng);

  const entity = actor(state, input.actorId);
  const view = readCreature(entity, catalog);
  const conditions = readConditions(entity);
  if (input.kind === 'save') {
    const result = savingThrow(rng, {
      bonus: view.saveBonus(input.ability),
      dc: input.dc,
      conditions,
      ability: input.ability,
    });
    return { events: [], facts: [testFact('save', ABILITY_LABEL[input.ability], result)] };
  }
  if (input.skill === 'stealth' && input.dc === HIDE_DC && hideAllowed(state, input.actorId)) {
    return resolveHide(state, entity, rng, catalog);
  }
  if (input.skill === 'perception') {
    const search = resolveSearch(state, entity, rng, catalog);
    if (search) return search;
  }
  const ability = input.skill === null ? input.ability : skillAbility(catalog, input.skill);
  const result = (input.skill === null ? abilityCheck : skillCheck)(rng, {
    bonus: input.skill === null ? view.abilityMod(input.ability) : view.skillBonus(input.skill),
    dc: input.dc,
    conditions,
    ability,
  });
  const label =
    input.skill === null
      ? ABILITY_LABEL[input.ability]
      : (catalog.skills.get(input.skill)?.name ?? input.skill);
  return { events: [], facts: [testFact('check', label, result)] };
}
