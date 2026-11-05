import { LlmError } from './errors.js';
import type {
  AdapterRequest,
  AdapterResponse,
  ChatMessage,
  LlmProviderAdapter,
  TokenUsage,
} from './types.js';

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com';
const DEFAULT_MODEL = 'gemini-2.5-flash';

export interface GeminiConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function toGemini(messages: readonly ChatMessage[]): {
  systemInstruction?: { parts: { text: string }[] };
  contents: { role: 'user' | 'model'; parts: { text: string }[] }[];
} {
  const systems = messages.filter((message) => message.role === 'system').map((m) => m.content);
  const contents = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: message.content }],
    }));
  if (systems.length === 0) return { contents };
  return { systemInstruction: { parts: [{ text: systems.join('\n\n') }] }, contents };
}

function generationConfig(request: AdapterRequest): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (request.temperature !== undefined) config['temperature'] = request.temperature;
  if (request.maxOutputTokens !== undefined) config['maxOutputTokens'] = request.maxOutputTokens;
  if (request.schema) {
    config['responseMimeType'] = 'application/json';
    config['responseJsonSchema'] = request.schema.jsonSchema;
  }
  return config;
}

function readUsage(body: Record<string, unknown>): TokenUsage | null {
  const usage = body['usageMetadata'];
  if (!isRecord(usage)) return null;
  const prompt = usage['promptTokenCount'];
  const completion = usage['candidatesTokenCount'];
  const total = usage['totalTokenCount'];
  if (typeof prompt !== 'number' || typeof completion !== 'number' || typeof total !== 'number') {
    return null;
  }
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total };
}

function partsText(candidate: unknown): string {
  if (!isRecord(candidate) || !isRecord(candidate['content'])) return '';
  const parts = candidate['content']['parts'];
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => (isRecord(part) && typeof part['text'] === 'string' ? part['text'] : ''))
    .join('');
}

function readCandidate(body: unknown): { text: string; usage: TokenUsage | null } {
  if (!isRecord(body) || !Array.isArray(body['candidates'])) {
    throw new LlmError('empty_response', 'Gemini response has no candidates');
  }
  const text = partsText(body['candidates'][0]);
  if (text.trim() === '') throw new LlmError('empty_response', 'Empty completion');
  return { text, usage: readUsage(body) };
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

/** Gemini REST adapter. The prefix is `systemInstruction`; the scene is the last user turn. */
export function createGeminiAdapter(config: GeminiConfig): LlmProviderAdapter {
  const fetchImpl = config.fetch ?? fetch;
  const model = config.model ?? DEFAULT_MODEL;
  const baseUrl = trimBase(config.baseUrl ?? DEFAULT_BASE);

  function endpoint(stream: boolean): string {
    const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    return `${baseUrl}/v1beta/models/${encodeURI(model)}:${method}`;
  }

  async function post(request: AdapterRequest, stream: boolean): Promise<Response> {
    const gemini = toGemini(request.messages);
    const body: Record<string, unknown> = {
      contents: gemini.contents,
      generationConfig: generationConfig(request),
    };
    if (gemini.systemInstruction) body['systemInstruction'] = gemini.systemInstruction;
    const init: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify(body),
    };
    if (request.signal) init.signal = request.signal;
    return fetchImpl(endpoint(stream), init);
  }

  return {
    id: 'gemini',
    async complete(request): Promise<AdapterResponse> {
      const response = await post(request, false);
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
        throw new LlmError('empty_response', 'Gemini response was not JSON');
      }
      return readCandidate(body);
    },
    async *stream(request) {
      const response = await post(request, true);
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
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        if (!isRecord(parsed) || !Array.isArray(parsed['candidates'])) continue;
        const text = partsText(parsed['candidates'][0]);
        if (text) yield text;
      }
    },
  };
}
