import type { z } from 'zod';

import type { LlmAttempt } from './errors.js';

/** JSON Schema sent to a provider. `$schema` is stripped; every field is required. */
export interface FlatJsonSchema {
  readonly name: string;
  readonly jsonSchema: Readonly<Record<string, unknown>>;
}

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/**
 * Prefix is the stable instruction (and later the campaign summary). Scene is the
 * turn-specific menu and player text. Providers put prefix first so a prompt cache
 * can reuse it.
 */
export interface StructuredPrompt {
  readonly prefix: string;
  readonly scene: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface AdapterRequest {
  readonly messages: readonly ChatMessage[];
  readonly schema: FlatJsonSchema | null;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
}

export interface AdapterResponse {
  readonly text: string;
  readonly usage: TokenUsage | null;
}

/** Transport only. The client owns schema checks and the repair retry. */
export interface LlmProviderAdapter {
  readonly id: string;
  complete(request: AdapterRequest): Promise<AdapterResponse>;
  stream(request: AdapterRequest): AsyncIterable<string>;
}

export interface ObjectGenerationResult<T> {
  readonly data: T;
  readonly attempts: readonly LlmAttempt[];
  readonly usage: TokenUsage | null;
  readonly totalLatencyMs: number;
}

export interface TextGenerationResult {
  readonly text: string;
  readonly usage: TokenUsage | null;
  readonly latencyMs: number;
}

export interface LlmClient {
  generateObject<S extends z.ZodType>(request: {
    readonly name: string;
    readonly schema: S;
    readonly prompt: StructuredPrompt;
    readonly signal?: AbortSignal;
  }): Promise<ObjectGenerationResult<z.infer<S>>>;
  generateText(request: {
    readonly prompt: StructuredPrompt;
    readonly signal?: AbortSignal;
  }): Promise<TextGenerationResult>;
  streamText(request: {
    readonly prompt: StructuredPrompt;
    readonly signal?: AbortSignal;
  }): AsyncIterable<string>;
}
