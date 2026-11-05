import { LlmError } from './errors.js';
import { DEFAULT_EVAL_CASES, type EvalCase } from './eval-cases.js';
import type { LlmClient } from './types.js';

export { DEFAULT_EVAL_CASES, type EvalCase } from './eval-cases.js';

export interface EvalCaseResult {
  readonly id: string;
  readonly kind: 'object' | 'text';
  readonly attempts: 0 | 1 | 2;
  readonly schemaOk: boolean;
  readonly semanticMatch: boolean;
  readonly latencyMs: number;
  readonly detail: string;
}

export interface EvalReport {
  readonly results: readonly EvalCaseResult[];
  readonly firstTryPasses: number;
  readonly repaired: number;
  readonly exhausted: number;
  readonly semanticMatches: number;
  readonly latencyMs: { readonly mean: number; readonly p50: number; readonly max: number };
}

function attemptCount(count: number): 0 | 1 | 2 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  return 2;
}

function failed(evalCase: EvalCase, started: number, error: unknown): EvalCaseResult {
  const attempts = error instanceof LlmError ? attemptCount(error.attempts.length) : 0;
  return {
    id: evalCase.id,
    kind: evalCase.mode,
    attempts,
    schemaOk: false,
    semanticMatch: false,
    latencyMs: Date.now() - started,
    detail: error instanceof Error ? error.message : 'failed',
  };
}

async function runCase(
  client: LlmClient,
  evalCase: EvalCase,
  timeoutMs: number | undefined,
): Promise<EvalCaseResult> {
  const started = Date.now();
  const signal = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs);
  try {
    if (evalCase.mode === 'text') {
      const result = await client.generateText(
        signal ? { prompt: evalCase.prompt, signal } : { prompt: evalCase.prompt },
      );
      return {
        id: evalCase.id,
        kind: 'text',
        attempts: 1,
        schemaOk: true,
        semanticMatch: evalCase.expect(result.text),
        latencyMs: Date.now() - started,
        detail: 'text',
      };
    }
    const result = await client.generateObject(
      signal
        ? { name: evalCase.schemaName, schema: evalCase.schema, prompt: evalCase.prompt, signal }
        : { name: evalCase.schemaName, schema: evalCase.schema, prompt: evalCase.prompt },
    );
    const attempts = attemptCount(result.attempts.length);
    return {
      id: evalCase.id,
      kind: 'object',
      attempts,
      schemaOk: true,
      semanticMatch: evalCase.expect(result.data),
      latencyMs: Date.now() - started,
      detail: attempts === 1 ? 'first-try' : 'repaired',
    };
  } catch (error) {
    return failed(evalCase, started, error);
  }
}

function latencyStats(results: readonly EvalCaseResult[]): EvalReport['latencyMs'] {
  if (results.length === 0) return { mean: 0, p50: 0, max: 0 };
  const values = results.map((result) => result.latencyMs);
  const sorted = [...values].sort((left, right) => left - right);
  const total = values.reduce((sum, value) => sum + value, 0);
  const mid = Math.floor((sorted.length - 1) / 2);
  return {
    mean: Math.round(total / values.length),
    p50: sorted[mid] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

export async function runEvalSuite(
  client: LlmClient,
  options?: { readonly cases?: readonly EvalCase[]; readonly timeoutMs?: number },
): Promise<EvalReport> {
  const cases = options?.cases ?? DEFAULT_EVAL_CASES;
  const results: EvalCaseResult[] = [];
  for (const evalCase of cases) results.push(await runCase(client, evalCase, options?.timeoutMs));
  const objects = results.filter((result) => result.kind === 'object');
  return {
    results,
    firstTryPasses: objects.filter((result) => result.schemaOk && result.attempts === 1).length,
    repaired: objects.filter((result) => result.schemaOk && result.attempts === 2).length,
    exhausted: results.filter((result) => !result.schemaOk).length,
    semanticMatches: results.filter((result) => result.semanticMatch).length,
    latencyMs: latencyStats(results),
  };
}
