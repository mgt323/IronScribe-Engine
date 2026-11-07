import { EngineError } from './errors.js';
import type { ActionMenu, ActionRequest, ResolvedRequest } from './rule-system.js';

function aliasesOf(request: ActionRequest): readonly string[] {
  const listed = request.targetAliases ?? [];
  if (listed.length > 0) {
    if (request.targetAlias !== null && request.targetAlias !== listed[0]) {
      throw new EngineError('unknown_alias', 'targetAlias must equal the first of targetAliases');
    }
    return listed;
  }
  return request.targetAlias === null ? [] : [request.targetAlias];
}

export function validateRequest(menu: ActionMenu, request: ActionRequest): ResolvedRequest {
  const action = menu.actions.find((a) => a.alias === request.actionAlias);
  if (!action) {
    throw new EngineError('unknown_alias', `Unknown action alias: ${request.actionAlias}`);
  }
  const aliases = aliasesOf(request);
  if (aliases.length === 0) {
    if (action.needsTarget) {
      throw new EngineError('target_required', `${action.alias} requires a target`);
    }
    return { actorId: request.actorId, action, target: null, targets: [] };
  }
  const targets = aliases.map((alias) => {
    const found = menu.targets.find((t) => t.alias === alias);
    if (!found) throw new EngineError('unknown_alias', `Unknown target alias: ${alias}`);
    return found;
  });
  if (!action.needsTarget) {
    throw new EngineError('unexpected_target', `${action.alias} does not take a target`);
  }
  const max = action.maxTargets ?? 1;
  if (targets.length > max) {
    throw new EngineError(
      'unexpected_target',
      `${action.alias} takes at most ${String(max)} target(s)`,
    );
  }
  return { actorId: request.actorId, action, target: targets[0] ?? null, targets };
}
