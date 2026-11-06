import type { MonsterAction } from '../catalog/schema-monster.js';

export const MULTIATTACK_ACTION_ID = 'multiattack';

function isAttack(action: MonsterAction): boolean {
  return action.attackBonus !== null;
}

function lookup(actions: readonly MonsterAction[], name: string): MonsterAction | undefined {
  const wanted = name.trim().toLowerCase();
  return actions.find((a) => a.id === wanted || a.name.toLowerCase() === wanted);
}

/**
 * Conservative Multiattack (SRD 5.2.1 monster stat blocks). Only a fixed list of
 * integer-count steps with no "choose" options, where every step names an attack
 * action, is automated. Anything else (Hydra heads, options, spell-like or save
 * steps) returns `[]` and the monster's Multiattack is not offered.
 */
export function expandMultiattack(actions: readonly MonsterAction[]): MonsterAction[] {
  const multi = actions.find((a) => a.id === MULTIATTACK_ACTION_ID)?.multiattack;
  if (!multi || multi.options !== null || multi.steps.length === 0) return [];
  const expanded: MonsterAction[] = [];
  for (const step of multi.steps) {
    if (typeof step.count !== 'number' || step.count < 1) return [];
    const action = lookup(actions, step.action);
    if (!action || !isAttack(action)) return [];
    for (let i = 0; i < step.count; i += 1) expanded.push(action);
  }
  return expanded;
}
