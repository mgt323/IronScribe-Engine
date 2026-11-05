import { LlmError } from './errors.js';
import type {
  AdapterRequest,
  AdapterResponse,
  ChatMessage,
  FlatJsonSchema,
  LlmProviderAdapter,
  TokenUsage,
} from './types.js';

export type OpenAiSchemaMode = 'json_schema' | 'json_object';

export interface OpenAiCompatibleConfig {
  readonly baseUrl: string;
  readonly model?: string;
  readonly apiKey?: string;
  readonly schemaMode?: OpenAiSchemaMode;
  readonly fetch?: typeof fetch;
}

interface ParsedChoice {
  readonly text: string;
  readonly usage: TokenUsage | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `Array.isArray` narrows to `any[]`; this keeps the elements unknown. */
function unknownList(value: unknown): readonly unknown[] | null {
  if (!Array.isArray(value)) return null;
  return value as readonly unknown[];
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/**
 * The schema rides on the latest user message, not the system prefix. Turn-specific
 * enums (`A1`, `T1`) would otherwise bust the cached prefix.
 */
function messagesWithSchema(
  messages: readonly ChatMessage[],
  schema: FlatJsonSchema | null,
): ChatMessage[] {
  const copy = messages.map((message) => ({ role: message.role, content: message.content }));
  if (!schema) return copy;
  const hint = `\n\nReply with a single JSON object matching this schema (${schema.name}):\n${JSON.stringify(schema.jsonSchema)}`;
  for (let index = copy.length - 1; index >= 0; index -= 1) {
    const message = copy[index];
    if (message?.role === 'user') {
      copy[index] = { role: 'user', content: message.content + hint };
      return copy;
    }
  }
  return copy;
}

function responseFormat(schema: FlatJsonSchema, mode: OpenAiSchemaMode): Record<string, unknown> {
  if (mode === 'json_object') return { type: 'json_object' };
  return {
    type: 'json_schema',
    json_schema: { name: schema.name, strict: true, schema: schema.jsonSchema },
  };
}

function readUsage(body: Record<string, unknown>): TokenUsage | null {
  const usage = body['usage'];
  if (!isRecord(usage)) return null;
  const prompt = usage['prompt_tokens'];
  const completion = usage['completion_tokens'];
  const total = usage['total_tokens'];
  if (typeof prompt !== 'number' || typeof completion !== 'number' || typeof total !== 'number') {
    return null;
  }
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total };
}

function readContent(message: unknown): string {
  if (!isRecord(message)) throw new LlmError('empty_response', 'Completion has no message');
  const content = message['content'];
  if (typeof content === 'string') {
    if (content.trim() === '') throw new LlmError('empty_response', 'Empty completion');
    return content;
  }
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (isRecord(part) && typeof part['text'] === 'string' ? part['text'] : ''))
      .join('');
    if (text.trim() === '') throw new LlmError('empty_response', 'Empty completion');
    return text;
  }
  throw new LlmError('empty_response', 'Empty completion');
}

function readChoice(body: unknown): ParsedChoice {
  if (!isRecord(body)) throw new LlmError('empty_response', 'Completion has no choices');
  const choice = unknownList(body['choices'])?.[0];
  if (!isRecord(choice)) throw new LlmError('empty_response', 'Completion has no choices');
  return { text: readContent(choice['message']), usage: readUsage(body) };
}

function deltaText(data: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return '';
  }
  const choice = isRecord(parsed) ? unknownList(parsed['choices'])?.[0] : undefined;
  if (!isRecord(choice)) return '';
  const delta = isRecord(choice['delta']) ? choice['delta']['content'] : undefined;
  if (typeof delta === 'string') return delta;
  const message = isRecord(choice['message']) ? choice['message']['content'] : undefined;
  return typeof message === 'string' ? message : '';
}

async function* sseData(body: ReadableStream<Uint8Array> | null): AsyncIterable<string> {
  if (!body) throw new LlmError('empty_response', 'Empty stream');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return;
      yield data;
    }
  }
}

/** llama.cpp, LM Studio, Ollama, and KoboldCpp share this chat-completions shape. */
export function createOpenAiCompatibleAdapter(config: OpenAiCompatibleConfig): LlmProviderAdapter {
  const fetchImpl = config.fetch ?? fetch;
  const schemaMode = config.schemaMode ?? 'json_schema';
  const baseUrl = trimBase(config.baseUrl);

  function payload(
    request: AdapterRequest,
    mode: OpenAiSchemaMode | null,
    stream: boolean,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: config.model ?? 'local',
      messages: messagesWithSchema(request.messages, request.schema),
      cache_prompt: true,
    };
    if (request.temperature !== undefined) body['temperature'] = request.temperature;
    if (request.maxOutputTokens !== undefined) body['max_tokens'] = request.maxOutputTokens;
    if (stream) body['stream'] = true;
    if (request.schema && mode) body['response_format'] = responseFormat(request.schema, mode);
    return body;
  }

  async function post(
    request: AdapterRequest,
    mode: OpenAiSchemaMode | null,
    stream: boolean,
  ): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (config.apiKey) headers['authorization'] = `Bearer ${config.apiKey}`;
    const init: RequestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify(payload(request, mode, stream)),
    };
    if (request.signal) init.signal = request.signal;
    return fetchImpl(`${baseUrl}/v1/chat/completions`, init);
  }

  async function send(request: AdapterRequest, stream: boolean): Promise<Response> {
    const firstMode = request.schema ? schemaMode : null;
    const first = await post(request, firstMode, stream);
    if (
      request.schema &&
      schemaMode === 'json_schema' &&
      (first.status === 400 || first.status === 422)
    ) {
      await first.body?.cancel();
      return post(request, 'json_object', stream);
    }
    return first;
  }

  async function readOk(response: Response): Promise<ParsedChoice> {
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new LlmError(
        'http_error',
        `HTTP ${String(response.status)}: ${detail}`,
        [],
        response.status,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new LlmError('empty_response', 'Completion was not JSON');
    }
    return readChoice(body);
  }

  return {
    id: 'openai-compatible',
    async complete(request): Promise<AdapterResponse> {
      const choice = await readOk(await send(request, false));
      return { text: choice.text, usage: choice.usage };
    },
    async *stream(request) {
      const response = await send(request, true);
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new LlmError(
          'http_error',
          `HTTP ${String(response.status)}: ${detail}`,
          [],
          response.status,
        );
      }
      for await (const data of sseData(response.body)) {
        const text = deltaText(data);
        if (text) yield text;
      }
    },
  };
}

/** First model id from `GET /v1/models`, for the eval CLI. */
export async function detectOpenAiModel(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(`${trimBase(baseUrl)}/v1/models`);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new LlmError(
      'http_error',
      `HTTP ${String(response.status)}: ${detail}`,
      [],
      response.status,
    );
  }
  const body: unknown = await response.json();
  const data = unknownList(isRecord(body) ? body['data'] : null) ?? [];
  const model = data.find((entry) => isRecord(entry) && typeof entry['id'] === 'string');
  if (!isRecord(model) || typeof model['id'] !== 'string') {
    throw new LlmError('empty_response', 'No model id in /v1/models');
  }
  return model['id'];
}
