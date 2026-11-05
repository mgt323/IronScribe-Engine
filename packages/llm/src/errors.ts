export type LlmErrorCode =
  | 'non_flat_schema'
  | 'http_error'
  | 'empty_response'
  | 'invalid_json'
  | 'schema_validation_failed'
  | 'repair_exhausted';

export interface LlmAttempt {
  readonly attempt: 1 | 2;
  readonly rawText: string;
  readonly error: string | null;
  readonly latencyMs: number;
}

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly attempts: readonly LlmAttempt[];
  readonly status?: number;

  constructor(
    code: LlmErrorCode,
    message: string,
    attempts: readonly LlmAttempt[] = [],
    status?: number,
  ) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.attempts = attempts;
    if (status !== undefined) this.status = status;
  }
}
