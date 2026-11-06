import { roll, rollD20, type Rng } from '@iron-scribe/dice';
import {
  EngineError,
  type CoreEvent,
  type Entity,
  type Fact,
  type GameState,
  type Resolution,
} from '@iron-scribe/engine-core';

import { conditionEvents, readConditions, rollEffects } from './conditions.js';
import { readDeathSaves, setDeathSaves, isDying, type DeathSaveState } from './death-saves.js';

/** SRD 5.2.1, "Death Saving Throws": a roll of 10 or higher succeeds. */
export const DEATH_SAVE_DC = 10;

function hasFriendlyAlly(state: GameState, actorId: string): boolean {
  return state.spawnOrder.some((id) => {
    const other = state.entities[id];
    return (
      id !== actorId &&
      other?.present === true &&
      other.hp.current > 0 &&
      other.system['attitude'] === 'friendly'
    );
  });
}

/** Wakes the character at 1 HP and clears the tally. */
function wake(entity: Entity): CoreEvent[] {
  return [
    { type: 'entity.healed', entityId: entity.id, amount: 1 },
    ...conditionEvents(entity, { op: 'remove', id: 'unconscious' }, []),
    setDeathSaves(entity.id, null),
  ];
}

/**
 * One Death Saving Throw. It is a saving throw, so it is a D20 Test and Exhaustion
 * lowers the total (2 per level). A natural 1 and a natural 20 are read from the
 * unmodified die. Natural 20: regain 1 HP and wake. Natural 1: two failures.
 * Three successes: stable. Three failures: dead.
 *
 * Iron Scribe rule (not SRD): a solo hero (no conscious friendly ally) who becomes
 * stable rests 1d4 hours, regains 1 HP, and the encounter ends, so play cannot
 * soft-lock on a stable, unconscious hero. No world clock is kept.
 */
export function runDeathSave(state: GameState, actorId: string, rng: Rng): Resolution {
  const entity = state.entities[actorId];
  if (!entity) throw new EngineError('unknown_entity', `Unknown entity: ${actorId}`);
  const tally = readDeathSaves(entity);
  if (!tally || !isDying(entity)) {
    throw new EngineError('invalid_combat_state', `${actorId} is not dying`);
  }
  const penalty = rollEffects({
    kind: 'save',
    ability: 'con',
    conditions: readConditions(entity),
  }).penalty;
  const rolled = rollD20(rng, { mode: 'normal', modifier: -penalty });
  const max = entity.hp.max;

  if (rolled.natural === 20) {
    return {
      events: wake(entity),
      facts: [
        { key: 'death_save', text: 'Death save: natural 20, regains 1 HP and consciousness' },
        { key: 'hp', text: `${actorId} 1/${String(max)}` },
      ],
    };
  }

  let { successes, failures } = tally;
  let label: string;
  if (rolled.natural === 1) {
    failures += 2;
    label = 'Death save: natural 1, two failures';
  } else if (rolled.total >= DEATH_SAVE_DC) {
    successes += 1;
    label = `Death save ${String(rolled.total)} vs DC ${String(DEATH_SAVE_DC)}, success`;
  } else {
    failures += 1;
    label = `Death save ${String(rolled.total)} vs DC ${String(DEATH_SAVE_DC)}, failure`;
  }
  const facts: Fact[] = [{ key: 'death_save', text: label }];

  if (failures >= 3) {
    const dead: DeathSaveState = { successes, failures: 3, stable: false, dead: true };
    facts.push({ key: 'dead', text: `${actorId} dies` });
    return { events: [setDeathSaves(actorId, dead)], facts };
  }
  if (successes >= 3) {
    facts.push({ key: 'death_save', text: `${actorId} is stable` });
    if (hasFriendlyAlly(state, actorId)) {
      const stable: DeathSaveState = { successes: 0, failures: 0, stable: true, dead: false };
      return { events: [setDeathSaves(actorId, stable)], facts };
    }
    const hours = roll('1d4', rng).total;
    const events = wake(entity);
    if (state.system['encounter'] != null) {
      events.push({ type: 'state.systemDataSet', key: 'encounter', value: null });
    }
    facts.push(
      {
        key: 'recovery',
        text: `${actorId} regains 1 HP after ${String(hours)} hour${hours === 1 ? '' : 's'}`,
      },
      { key: 'hp', text: `${actorId} 1/${String(max)}` },
    );
    return { events, facts };
  }
  const next: DeathSaveState = { successes, failures, stable: false, dead: false };
  return { events: [setDeathSaves(actorId, next)], facts };
}
