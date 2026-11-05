export type EngineErrorCode =
  | 'unknown_entity'
  | 'actor_not_present'
  | 'duplicate_entity'
  | 'invalid_entity'
  | 'invalid_amount'
  | 'unknown_alias'
  | 'target_required'
  | 'unexpected_target'
  | 'forbidden_event'
  | 'no_system_reducer'
  | 'no_procedure_handler'
  | 'nothing_to_undo'
  | 'nothing_to_redo';

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}
