import { EngineError } from './errors.js';
import type { ActionMenu, ActionRequest, ResolvedRequest } from './rule-system.js';

export function validateRequest(menu: ActionMenu, request: ActionRequest): ResolvedRequest {
  const action = menu.actions.find((a) => a.alias === request.actionAlias);
  if (!action) {
    throw new EngineError('unknown_alias', `Unknown action alias: ${request.actionAlias}`);
  }
  if (request.targetAlias === null) {
    if (action.needsTarget) {
      throw new EngineError('target_required', `${action.alias} requires a target`);
    }
    return { actorId: request.actorId, action, target: null };
  }
  const target = menu.targets.find((t) => t.alias === request.targetAlias);
  if (!target) {
    throw new EngineError('unknown_alias', `Unknown target alias: ${request.targetAlias}`);
  }
  if (!action.needsTarget) {
    throw new EngineError('unexpected_target', `${action.alias} does not take a target`);
  }
  return { actorId: request.actorId, action, target };
}
