import type { Rng } from '@iron-scribe/dice';
import type { CoreEvent, Entity, Fact, GameState, Resolution } from '@iron-scribe/engine-core';

import type { Catalog } from '../catalog/catalog.js';
import { skillCheck } from './checks.js';
import { conditionEvents, readConditions } from './conditions.js';
import { readCreature } from './creature.js';
import { isInScene } from './scene.js';

/** SRD 5.2.1 Hide: a Dexterity (Stealth) check against DC 15. Cover is Stage 8. */
export const HIDE_DC = 15;

/**
 * Hide is legal before combat, or when the scene says so.
 * `canHide` stands in for cover and heavy obscurement (Stage 8).
 * `unawareOf` lists creatures that have not noticed this one.
 */
export function hideAllowed(state: GameState, actorId: string): boolean {
  const actor = state.entities[actorId];
  if (state.system['encounter'] == null) return actor !== undefined;
  if (!actor) return false;
  if (actor.system['canHide'] === true) return true;
  return unawareOf(actor).length > 0;
}

export function hiddenStealthDc(entity: Entity): number | null {
  const value = entity.system['hiddenStealthDc'];
  return typeof value === 'number' ? value : null;
}

export function unawareOf(entity: Entity): string[] {
  const raw = entity.system['unawareOf'];
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === 'string');
}

/** 10 + Perception bonus. The DC a hidden creature's Stealth total is compared with. */
export function passivePerception(entity: Entity, catalog: Catalog): number {
  return 10 + readCreature(entity, catalog).skillBonus('perception');
}

function hostile(entity: Entity): boolean {
  return entity.system['attitude'] === 'hostile';
}

function opposes(actor: Entity, other: Entity): boolean {
  return hostile(actor) !== hostile(other);
}

function opponents(state: GameState, actor: Entity): Entity[] {
  return state.spawnOrder.flatMap((id) => {
    const other = state.entities[id];
    if (!other || other.id === actor.id || !isInScene(other) || other.hp.current <= 0) return [];
    return opposes(actor, other) ? [other] : [];
  });
}

/** Ends Invisible-from-Hide. An Invisible condition from anywhere else is left alone. */
export function breakHideEvents(entity: Entity): CoreEvent[] {
  if (hiddenStealthDc(entity) === null) return [];
  return [
    ...conditionEvents(entity, { op: 'remove', id: 'invisible' }, []),
    { type: 'entity.systemDataSet', entityId: entity.id, key: 'hiddenStealthDc', value: null },
  ];
}

/**
 * Creatures with Disadvantage on initiative when `actorId` opens the fight:
 * anyone listed in `unawareOf`, plus opponents whose Passive Perception
 * is below a successful Hide.
 */
export function surprisedBy(state: GameState, actorId: string, catalog: Catalog): string[] {
  const actor = state.entities[actorId];
  if (!actor) return [];
  const ids = new Set(unawareOf(actor));
  const dc = hiddenStealthDc(actor);
  if (dc === null) return [...ids];
  for (const other of opponents(state, actor)) {
    if (other.proximity !== 'engaged') continue;
    if (passivePerception(other, catalog) < dc) ids.add(other.id);
  }
  return [...ids];
}

function checkFact(result: { total: number | null; dc: number; success: boolean }): Fact {
  const outcome = result.success ? 'success' : 'failure';
  return {
    key: 'check',
    text: `Stealth ${String(result.total)} vs DC ${String(result.dc)}, ${outcome}`,
  };
}

/** Dexterity (Stealth) vs DC 15. Success grants Invisible and stores the total. */
export function resolveHide(
  state: GameState,
  actor: Entity,
  rng: Rng,
  catalog: Catalog,
): Resolution {
  const view = readCreature(actor, catalog);
  const result = skillCheck(rng, {
    bonus: view.skillBonus('stealth'),
    dc: HIDE_DC,
    conditions: readConditions(actor),
    ability: 'dex',
  });
  const facts: Fact[] = [checkFact(result)];
  const total = result.total;
  if (!result.success || total === null) return { events: [], facts };
  const spotted = opponents(state, actor).filter(
    (other) => passivePerception(other, catalog) >= total,
  );
  if (spotted.length > 0) {
    facts.push({
      key: 'hide',
      text: `Spotted by ${spotted.map((other) => other.name).join(', ')}`,
    });
    return { events: [], facts };
  }
  const immunities = view.conditionImmunities;
  facts.push({ key: 'hide', text: `${actor.name} hides (Stealth ${String(total)})` });
  return {
    events: [
      ...conditionEvents(actor, { op: 'add', id: 'invisible' }, immunities),
      {
        type: 'entity.systemDataSet',
        entityId: actor.id,
        key: 'hiddenStealthDc',
        value: total,
      },
    ],
    facts,
  };
}

/**
 * Search: one Wisdom (Perception) check against each hidden opponent.
 * A total at or above their Stealth DC ends that Hide. Null when nobody is hidden.
 */
export function resolveSearch(
  state: GameState,
  actor: Entity,
  rng: Rng,
  catalog: Catalog,
): Resolution | null {
  const hidden = opponents(state, actor).filter((other) => hiddenStealthDc(other) !== null);
  if (hidden.length === 0) return null;
  const view = readCreature(actor, catalog);
  const result = skillCheck(rng, {
    bonus: view.skillBonus('perception'),
    dc: HIDE_DC,
    conditions: readConditions(actor),
    ability: 'wis',
  });
  const events: CoreEvent[] = [];
  const found: string[] = [];
  for (const other of hidden) {
    const dc = hiddenStealthDc(other);
    if (dc === null || result.total === null || result.total < dc) continue;
    events.push(...breakHideEvents(other));
    found.push(other.name);
  }
  const text =
    found.length > 0
      ? `Perception ${String(result.total)} spots ${found.join(', ')}`
      : `Perception ${String(result.total)} spots nobody`;
  return { events, facts: [{ key: 'check', text }] };
}
