import type { Rng } from '@iron-scribe/dice';
import {
  EngineError,
  type Entity,
  type Fact,
  type GameState,
  type Resolution,
  type ResolvedRequest,
} from '@iron-scribe/engine-core';

import type { Catalog } from '../catalog/catalog.js';
import { readMonsterSnapshot } from '../catalog/spawn.js';
import type { MonsterAction } from '../catalog/schema-monster.js';
import { attackRoll, weaponAttackBonus } from './attack.js';
import { readCharacter } from './character.js';
import { readConditions } from './conditions.js';
import { readCreature } from './creature.js';
import { dealDamage, entityOf } from './deal-damage.js';
import { breakHideEvents } from './hide.js';
import { rollMonsterDamage, rollWeaponDamage, type DamagePart } from './damage.js';

export interface PendingAttack {
  readonly bonus: number;
  readonly attackKind: 'melee' | 'ranged';
  rollDamage(critical: boolean, hadAdvantage: boolean): DamagePart[];
}

function weaponAttack(
  state: GameState,
  actorId: string,
  weaponId: string,
  rng: Rng,
  catalog: Catalog,
): PendingAttack {
  const sheet = readCharacter(entityOf(state, actorId));
  const weapon = catalog.weapons.get(weaponId);
  if (!weapon) throw new Error(`unknown weapon: ${weaponId}`);
  const spec = weaponAttackBonus(sheet, weapon);
  return {
    bonus: spec.bonus,
    attackKind: weapon.kind,
    rollDamage: (critical) => [rollWeaponDamage(rng, weapon, spec.modifier, critical)],
  };
}

export function monsterAttack(attacker: Entity, actionId: string, rng: Rng): PendingAttack {
  const action: MonsterAction | undefined = readMonsterSnapshot(attacker).actions.find(
    (entry) => entry.id === actionId,
  );
  if (!action || action.attackBonus === null) throw new Error(`unknown attack: ${actionId}`);
  const bonus = action.attackBonus;
  return {
    bonus,
    attackKind: action.kind === 'ranged' ? 'ranged' : 'melee',
    rollDamage: (critical, hadAdvantage) =>
      rollMonsterDamage(rng, action.damage, critical, hadAdvantage),
  };
}

export function attackOnce(
  state: GameState,
  attacker: Entity,
  pending: PendingAttack,
  defenderId: string,
  rng: Rng,
  catalog: Catalog,
): Resolution {
  const defender = entityOf(state, defenderId);
  const defenderView = readCreature(defender, catalog);

  const result = attackRoll(rng, {
    bonus: pending.bonus,
    ac: defenderView.ac,
    attackKind: pending.attackKind,
    attacker: readConditions(attacker),
    target: readConditions(defender),
  });
  const outcome = !result.hit ? 'miss' : result.critical ? 'critical hit' : 'hit';
  const facts: Fact[] = [
    { key: 'attack', text: `${String(result.total)} vs AC ${String(result.ac)}, ${outcome}` },
  ];
  const revealed = breakHideEvents(attacker);
  if (!result.hit) return { events: revealed, facts };

  const dealt = dealDamage(
    state,
    defender.id,
    pending.rollDamage(result.critical, result.mode === 'advantage'),
    result.critical,
    catalog,
  );
  facts.push(...dealt.facts);
  return { events: [...dealt.events, ...revealed], facts };
}

/** One attack from the menu: roll to hit, then damage, then defenses. */
export function resolveAttack(
  state: GameState,
  request: ResolvedRequest,
  rng: Rng,
  catalog: Catalog,
): Resolution {
  const target = request.target;
  if (!target) throw new EngineError('target_required', 'an attack needs a target');
  const attacker = entityOf(state, request.actorId);
  const actionId = request.action.actionId;
  const pending = actionId.startsWith('weapon:')
    ? weaponAttack(state, request.actorId, actionId.slice('weapon:'.length), rng, catalog)
    : actionId.startsWith('monster:')
      ? monsterAttack(attacker, actionId.slice('monster:'.length), rng)
      : null;
  if (!pending) throw new EngineError('unknown_alias', `Unknown action: ${actionId}`);
  return attackOnce(state, attacker, pending, target.entityId, rng, catalog);
}
