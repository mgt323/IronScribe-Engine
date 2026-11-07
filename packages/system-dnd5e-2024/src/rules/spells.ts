import { roll, type Rng } from '@iron-scribe/dice';
import {
  applyEvents,
  EngineError,
  type CoreEvent,
  type Entity,
  type Fact,
  type GameState,
  type Resolution,
  type ResolvedRequest,
} from '@iron-scribe/engine-core';

import type { Catalog } from '../catalog/catalog.js';
import type { Spell } from '../catalog/schema-spell.js';
import { readCharacter, type Character } from './character.js';
import { dealDamage, entityOf } from './deal-damage.js';
import { rollDice, type DamagePart } from './damage.js';
import { healEvents } from './death-saves.js';
import { attackOnce } from './resolve-attack.js';
import { resolveSaveEffect } from './resolve-save.js';
import {
  SPELL_PREFIX,
  castingMod,
  readSlotsUsed,
  slotsLeft,
  spellAttackBonus,
  spellDamageDice,
  spellSaveDc,
} from './spell-data.js';

function rollSpellDamage(spell: Spell, sheet: Character, rng: Rng, critical: boolean): DamagePart {
  if (spell.damage === null) throw new Error(`${spell.id} has no damage`);
  const mod = spell.damage.addSpellcastingMod ? castingMod(sheet) : 0;
  const dice = spellDamageDice(spell, sheet.level);
  return { type: spell.damage.type, amount: Math.max(0, rollDice(dice, rng, critical) + mod) };
}

/**
 * Magic Missile style darts, one slot per dart in the order given (a target may repeat:
 * [T1, T1, T2] is two darts on T1). One slot takes every dart, two slots take
 * [first, second, first], three or more take one each. A dart whose target is already
 * at 0 HP is not redirected: no spillover onto unchosen creatures.
 */
export function dartAllocation(targetIds: readonly string[], darts: number): string[] {
  if (targetIds.length === 0) return [];
  if (targetIds.length === 2)
    return Array.from({ length: darts }, (_, i) => targetIds[i % 2] ?? '');
  return Array.from({ length: darts }, (_, i) => targetIds[targetIds.length === 1 ? 0 : i] ?? '');
}

/** Rolls and applies each dart in turn on a running state. */
function resolveDarts(
  state: GameState,
  spell: Spell,
  sheet: Character,
  targetIds: readonly string[],
  rng: Rng,
  catalog: Catalog,
): Resolution {
  const events: CoreEvent[] = [];
  const facts: Fact[] = [];
  let running = state;
  const ids = dartAllocation(targetIds, spell.projectiles ?? 1);
  for (const [dart, id] of ids.entries()) {
    if (entityOf(running, id).hp.current <= 0) continue;
    facts.push({ key: 'spell', text: `dart ${String(dart + 1)} strikes ${id}` });
    const dealt = dealDamage(
      running,
      id,
      [rollSpellDamage(spell, sheet, rng, false)],
      false,
      catalog,
    );
    events.push(...dealt.events);
    facts.push(...dealt.facts);
    running = applyEvents(running, dealt.events);
  }
  return { events, facts };
}

function resolveHeal(
  state: GameState,
  spell: Spell,
  sheet: Character,
  target: Entity,
  rng: Rng,
): Resolution {
  if (spell.heal === null) throw new Error(`${spell.id} does not heal`);
  const mod = spell.heal.addSpellcastingMod ? castingMod(sheet) : 0;
  const amount = Math.max(0, roll(spell.heal.dice, rng).total + mod);
  const healed = healEvents(entityOf(state, target.id), amount);
  if (healed.events.length === 0) {
    return { events: [], facts: [{ key: 'heal', text: `${target.id} cannot be healed` }] };
  }
  return { events: healed.events, facts: healed.facts };
}

/**
 * A character spell from the menu. Spends one slot of the spell's level (cantrips cost
 * nothing, and there is no upcasting in this stage). The slot is recorded as an event.
 */
export function resolveSpell(
  state: GameState,
  request: ResolvedRequest,
  rng: Rng,
  catalog: Catalog,
): Resolution {
  const caster = entityOf(state, request.actorId);
  const sheet = readCharacter(caster);
  const [id, flag] = request.action.actionId.slice(SPELL_PREFIX.length).split(':');
  const spell = id === undefined ? undefined : catalog.spells.get(id);
  const known = [...sheet.cantrips, ...sheet.preparedSpells];
  if (!spell || !known.includes(spell.id) || sheet.spellcastingAbility === null) {
    throw new EngineError('unknown_alias', `Unknown spell: ${request.action.actionId}`);
  }
  const events: CoreEvent[] = [];
  if (spell.level > 0) {
    const used = readSlotsUsed(caster);
    if (slotsLeft(sheet, used, spell.level) <= 0) {
      throw new EngineError('invalid_combat_state', `No level ${String(spell.level)} slot left`);
    }
    const key = String(spell.level);
    events.push({
      type: 'entity.systemDataSet',
      entityId: caster.id,
      key: 'spellSlotsUsed',
      value: { ...used, [key]: (used[key] ?? 0) + 1 },
    });
  }
  const facts: Fact[] = [{ key: 'use', text: `${caster.id} casts ${spell.name}` }];
  const targetIds = flag === 'self' ? [caster.id] : request.targets.map((t) => t.entityId);
  const first = targetIds[0];
  if (first === undefined) throw new EngineError('target_required', `${spell.name} needs a target`);

  let part: Resolution;
  if (spell.heal !== null) {
    part = resolveHeal(state, spell, sheet, entityOf(state, first), rng);
  } else if (spell.resolution === 'attack' && spell.attack !== null) {
    part = attackOnce(
      state,
      caster,
      {
        bonus: spellAttackBonus(sheet),
        attackKind: spell.attack,
        rollDamage: (critical) => [rollSpellDamage(spell, sheet, rng, critical)],
      },
      first,
      rng,
      catalog,
    );
  } else if (spell.resolution === 'save' && spell.save !== null) {
    part = resolveSaveEffect(
      state,
      targetIds,
      {
        ability: spell.save.ability,
        dc: spellSaveDc(sheet),
        onSuccess: spell.save.onSuccess,
        parts: [rollSpellDamage(spell, sheet, rng, false)],
      },
      rng,
      catalog,
    );
  } else if (spell.resolution === 'auto' && spell.damage !== null) {
    part = resolveDarts(state, spell, sheet, targetIds, rng, catalog);
  } else {
    throw new EngineError('unknown_alias', `${spell.name} cannot be resolved`);
  }
  return { events: [...events, ...part.events], facts: [...facts, ...part.facts] };
}
