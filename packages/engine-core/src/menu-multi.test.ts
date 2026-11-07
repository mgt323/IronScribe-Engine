import { describe, expect, it } from 'vitest';

import { EngineError } from './errors.js';
import { validateRequest } from './menu.js';
import type { ActionMenu, ActionRequest } from './rule-system.js';

const menu: ActionMenu = {
  actions: [
    { alias: 'A1', actionId: 'stab', label: 'Stab', needsTarget: true },
    { alias: 'A2', actionId: 'burst', label: 'Burst', needsTarget: true, maxTargets: 3 },
    { alias: 'A3', actionId: 'wait', label: 'Wait', needsTarget: false },
  ],
  targets: [
    { alias: 'T1', entityId: 'a', label: 'A' },
    { alias: 'T2', entityId: 'b', label: 'B' },
    { alias: 'T3', entityId: 'c', label: 'C' },
    { alias: 'T4', entityId: 'd', label: 'D' },
  ],
};

const request = (over: Partial<ActionRequest>): ActionRequest => ({
  actorId: 'hero',
  actionAlias: 'A2',
  targetAlias: null,
  ...over,
});

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof EngineError) return error.code;
    throw error;
  }
  return undefined;
}

describe('validateRequest with several targets', () => {
  it('keeps the single-target shape: target is the one entry, targets has one', () => {
    const resolved = validateRequest(menu, request({ actionAlias: 'A1', targetAlias: 'T2' }));
    expect(resolved.target?.entityId).toBe('b');
    expect(resolved.targets.map((t) => t.entityId)).toEqual(['b']);
  });

  it('resolves every alias in order and puts the first in target', () => {
    const resolved = validateRequest(
      menu,
      request({ targetAlias: 'T3', targetAliases: ['T3', 'T1', 'T2'] }),
    );
    expect(resolved.target?.entityId).toBe('c');
    expect(resolved.targets.map((t) => t.entityId)).toEqual(['c', 'a', 'b']);
  });

  it('accepts targetAliases alone and drops duplicates', () => {
    const resolved = validateRequest(menu, request({ targetAliases: ['T2', 'T2', 'T4'] }));
    expect(resolved.targets.map((t) => t.entityId)).toEqual(['b', 'd']);
  });

  it('rejects an unknown alias anywhere in the list', () => {
    expect(code(() => validateRequest(menu, request({ targetAliases: ['T1', 'T9'] })))).toBe(
      'unknown_alias',
    );
  });

  it('rejects more targets than the action allows', () => {
    expect(
      code(() => validateRequest(menu, request({ targetAliases: ['T1', 'T2', 'T3', 'T4'] }))),
    ).toBe('unexpected_target');
    expect(
      code(() =>
        validateRequest(
          menu,
          request({ actionAlias: 'A1', targetAlias: 'T1', targetAliases: ['T1', 'T2'] }),
        ),
      ),
    ).toBe('unexpected_target');
  });

  it('rejects targets on a targetless action and a missing target list', () => {
    expect(
      code(() => validateRequest(menu, request({ actionAlias: 'A3', targetAliases: ['T1'] }))),
    ).toBe('unexpected_target');
    expect(code(() => validateRequest(menu, request({})))).toBe('target_required');
  });

  it('rejects a targetAlias that is not the first of targetAliases', () => {
    expect(
      code(() => validateRequest(menu, request({ targetAlias: 'T2', targetAliases: ['T1'] }))),
    ).toBe('unknown_alias');
  });
});
