import { createLlmClient } from '../client.js';
import type { LlmError } from '../errors.js';
import type {
  AdapterRequest,
  AdapterResponse,
  LlmClient,
  LlmProviderAdapter,
  TokenUsage,
} from '../types.js';

export interface ScriptedStep {
  readonly text?: string;
  readonly chunks?: readonly string[];
  readonly usage?: TokenUsage | null;
  readonly error?: LlmError;
}

export interface ScriptedLlmAdapter extends LlmProviderAdapter {
  readonly calls: AdapterRequest[];
}

/** Returns the next scripted completion. Throws if a test asks for more calls than it scripted. */
export function createScriptedLlmAdapter(steps: readonly ScriptedStep[]): ScriptedLlmAdapter {
  const calls: AdapterRequest[] = [];
  let index = 0;

  function next(request: AdapterRequest): ScriptedStep {
    calls.push(request);
    const step = steps[index];
    index += 1;
    if (!step) throw new Error('scripted adapter ran out of steps');
    return step;
  }

  return {
    id: 'scripted',
    calls,
    async complete(request): Promise<AdapterResponse> {
      const step = next(request);
      await Promise.resolve();
      if (step.error) throw step.error;
      return { text: step.text ?? '', usage: step.usage ?? null };
    },
    async *stream(request) {
      const step = next(request);
      if (step.error) throw step.error;
      await Promise.resolve();
      for (const chunk of step.chunks ?? [step.text ?? '']) yield chunk;
    },
  };
}

export function createScriptedLlmClient(steps: readonly ScriptedStep[]): LlmClient {
  return createLlmClient(createScriptedLlmAdapter(steps));
}
