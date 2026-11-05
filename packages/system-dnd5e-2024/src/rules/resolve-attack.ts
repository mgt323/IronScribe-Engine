import type { Rng } from '@iron-scribe/dice';
import {
  EngineError,
  type CoreEvent,
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
import { conditionEvents, readConditions } from './conditions.js';
import { readCreature } from './creature.js';
import { applyDefenses, rollMonsterDamage, rollWeaponDamage, type DamagePart } from './damage.js';

interface PendingAttack {
  readonly bonus: number;
  readonly attackKind: 'melee' | 'ranged';
  rollDamage(critical: boolean, hadAdvantage: boolean): DamagePart[];
}

function entityOf(state: GameState, id: string): Entity {
  const found = state.entities[id];
  if (!found) throw new EngineError('unknown_entity', `Unknown entity: ${id}`);
  return found;
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

function monsterAttack(attacker: Entity, actionId: string, rng: Rng): PendingAttack {
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

function damageFacts(parts: ReturnType<typeof applyDefenses>): Fact[] {
  return parts.map((part) => {
    const note = part.notes.length > 0 ? ` (${part.notes.join('; ')})` : '';
    return { key: 'damage', text: `${String(part.amount)} ${part.type}${note}` };
  });
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
  const defender = entityOf(state, target.entityId);
  const defenderView = readCreature(defender, catalog);
  const actionId = request.action.actionId;
  const pending = actionId.startsWith('weapon:')
    ? weaponAttack(state, request.actorId, actionId.slice('weapon:'.length), rng, catalog)
    : actionId.startsWith('monster:')
      ? monsterAttack(attacker, actionId.slice('monster:'.length), rng)
      : null;
  if (!pending) throw new EngineError('unknown_alias', `Unknown action: ${actionId}`);

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
  if (!result.hit) return { events: [], facts };

  const applied = applyDefenses(
    pending.rollDamage(result.critical, result.mode === 'advantage'),
    defenderView,
  );
  facts.push(...damageFacts(applied));
  const total = applied.reduce((sum, part) => sum + part.amount, 0);
  const hpAfter = Math.max(0, defender.hp.current - total);
  facts.push({ key: 'hp', text: `${defender.id} ${String(hpAfter)}/${String(defender.hp.max)}` });
  const events: CoreEvent[] = [];
  if (total > 0) {
    events.push({ type: 'entity.damaged', entityId: defender.id, amount: total });
  }
  if (total > 0 && hpAfter === 0 && defenderView.kind === 'character') {
    events.push(
      ...conditionEvents(
        defender,
        { op: 'add', id: 'unconscious' },
        defenderView.conditionImmunities,
      ),
    );
    facts.push({ key: 'condition', text: `${defender.id} unconscious` });
  } else if (total > 0 && hpAfter === 0) {
    facts.push({ key: 'defeated', text: defender.id });
  }
  return { events, facts };
}
