import type { ZodError } from 'zod';

import { LlmError, type LlmAttempt } from './errors.js';
import { toFlatJsonSchema } from './schema.js';
import type {
  AdapterRequest,
  ChatMessage,
  LlmClient,
  LlmProviderAdapter,
  StructuredPrompt,
  TextGenerationResult,
  TokenUsage,
} from './types.js';

const FINAL_MARKER = '<|channel|>final<|message|>';

/** Drop reasoning channels local models emit before the answer. */
function stripReasoning(rawText: string): string {
  let text = rawText;
  const finalAt = text.toLowerCase().indexOf(FINAL_MARKER);
  if (finalAt >= 0) text = text.slice(finalAt + FINAL_MARKER.length);
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const closeAt = text.toLowerCase().lastIndexOf('</think>');
  if (closeAt >= 0) text = text.slice(closeAt + '</think>'.length);
  return text.trim();
}

/** Reasoning, markdown fences, then the outermost `{...}` if the model added a preamble. */
function extractJsonText(rawText: string): string {
  let text = stripReasoning(rawText);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) text = fenced[1].trim();
  if (text.startsWith('{') && text.endsWith('}')) return text;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function formatIssues(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function baseMessages(prompt: StructuredPrompt): ChatMessage[] {
  return [
    { role: 'system', content: prompt.prefix },
    { role: 'user', content: prompt.scene },
  ];
}

function adapterRequest(
  messages: readonly ChatMessage[],
  schema: AdapterRequest['schema'],
  prompt: StructuredPrompt,
  signal: AbortSignal | undefined,
): AdapterRequest {
  const request: {
    messages: readonly ChatMessage[];
    schema: AdapterRequest['schema'];
    temperature?: number;
    maxOutputTokens?: number;
    signal?: AbortSignal;
  } = { messages, schema };
  if (prompt.temperature !== undefined) request.temperature = prompt.temperature;
  if (prompt.maxOutputTokens !== undefined) request.maxOutputTokens = prompt.maxOutputTokens;
  if (signal) request.signal = signal;
  return request;
}

function addUsage(left: TokenUsage | null, right: TokenUsage | null): TokenUsage | null {
  if (!left) return right;
  if (!right) return left;
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

/**
 * `undefined` while a reasoning prefix is still open. A string is prose ready to emit
 * (empty when the block closed exactly at the end of the buffer).
 */
function afterReasoning(buffer: string): string | undefined {
  const trimmed = buffer.trimStart();
  if (trimmed === '') return undefined;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('<think>')) {
    const end = lower.indexOf('</think>');
    if (end < 0) return undefined;
    return trimmed.slice(end + '</think>'.length).trimStart();
  }
  if (lower.startsWith('</think>')) return trimmed.slice('</think>'.length).trimStart();
  if (lower.startsWith('<|channel|>')) {
    const at = lower.indexOf(FINAL_MARKER);
    if (at < 0) return trimmed.length > 4000 ? stripReasoning(buffer) : undefined;
    return trimmed.slice(at + FINAL_MARKER.length).trimStart();
  }
  if (trimmed.startsWith('<') && trimmed.length < 12 && !trimmed.includes('>')) return undefined;
  return stripReasoning(buffer);
}

/** One client over any provider. Object calls get a single repair retry; text calls do not. */
export function createLlmClient(adapter: LlmProviderAdapter): LlmClient {
  return {
    async generateObject(request) {
      const schema = toFlatJsonSchema(request.name, request.schema);
      const started = Date.now();
      const attempts: LlmAttempt[] = [];
      let messages = baseMessages(request.prompt);
      let usage: TokenUsage | null = null;

      for (let number = 1; number <= 2; number += 1) {
        const attempt = number as 1 | 2;
        const attemptStarted = Date.now();
        let rawText = '';
        let failure: string | null = null;
        try {
          const response = await adapter.complete(
            adapterRequest(messages, schema, request.prompt, request.signal),
          );
          rawText = response.text;
          usage = addUsage(usage, response.usage);
          const parsed: unknown = JSON.parse(extractJsonText(rawText));
          const checked = request.schema.safeParse(parsed);
          if (!checked.success) failure = formatIssues(checked.error);
          else {
            attempts.push({
              attempt,
              rawText,
              error: null,
              latencyMs: Date.now() - attemptStarted,
            });
            return {
              data: checked.data,
              attempts,
              usage,
              totalLatencyMs: Date.now() - started,
            };
          }
        } catch (error) {
          if (error instanceof LlmError && error.code !== 'empty_response') throw error;
          if (error instanceof LlmError) failure = error.message;
          else if (error instanceof SyntaxError) failure = error.message;
          else throw error;
        }

        attempts.push({
          attempt,
          rawText,
          error: failure,
          latencyMs: Date.now() - attemptStarted,
        });
        if (attempt === 2) break;
        messages = [
          ...messages,
          { role: 'assistant', content: rawText },
          {
            role: 'user',
            content: `Your previous reply was invalid: ${failure ?? 'empty response'}. Reply with a single JSON object matching the schema.`,
          },
        ];
      }

      throw new LlmError(
        'repair_exhausted',
        'Structured output failed after one repair retry',
        attempts,
      );
    },

    async generateText(request): Promise<TextGenerationResult> {
      const started = Date.now();
      const response = await adapter.complete(
        adapterRequest(baseMessages(request.prompt), null, request.prompt, request.signal),
      );
      return {
        text: stripReasoning(response.text),
        usage: response.usage,
        latencyMs: Date.now() - started,
      };
    },

    async *streamText(request) {
      let pending = '';
      let emitting = false;
      const stream = adapter.stream(
        adapterRequest(baseMessages(request.prompt), null, request.prompt, request.signal),
      );
      for await (const chunk of stream) {
        if (emitting) {
          yield chunk;
          continue;
        }
        pending += chunk;
        const ready = afterReasoning(pending);
        if (ready === undefined) continue;
        emitting = true;
        pending = '';
        if (ready.length > 0) yield ready;
      }
      if (!emitting && pending.length > 0) {
        const rest = stripReasoning(pending);
        if (rest.length > 0) yield rest;
      }
    },
  };
}
