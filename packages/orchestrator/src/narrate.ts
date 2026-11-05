import type { LlmClient, StructuredPrompt } from '@iron-scribe/llm';

import type { RunTurnOptions } from './types.js';

export interface NarrationOutcome {
  readonly narration: string | null;
  readonly narrationError: string | null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Narration never rolls back mechanics. A stream that dies mid-sentence keeps
 * the text already received.
 */
export async function narrateFacts(
  llm: LlmClient,
  prompt: StructuredPrompt,
  options: RunTurnOptions | undefined,
): Promise<NarrationOutcome> {
  const signal = options?.signal;
  if (!options?.onNarrationChunk) {
    try {
      const result = await llm.generateText(signal ? { prompt, signal } : { prompt });
      return { narration: result.text, narrationError: null };
    } catch (error) {
      return { narration: null, narrationError: messageOf(error) };
    }
  }
  let partial = '';
  try {
    for await (const chunk of llm.streamText(signal ? { prompt, signal } : { prompt })) {
      partial += chunk;
      options.onNarrationChunk(chunk);
    }
    return { narration: partial, narrationError: null };
  } catch (error) {
    return { narration: partial.length > 0 ? partial : null, narrationError: messageOf(error) };
  }
}
