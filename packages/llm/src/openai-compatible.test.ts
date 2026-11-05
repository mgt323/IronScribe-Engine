import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createOpenAiCompatibleAdapter, detectOpenAiModel } from './openai-compatible.js';
import { toFlatJsonSchema } from './schema.js';
import type { ChatMessage } from './types.js';

const schema = toFlatJsonSchema('choice', z.strictObject({ ok: z.boolean() }));
const messages: ChatMessage[] = [
  { role: 'system', content: 'PREFIX' },
  { role: 'user', content: 'SCENE' },
];

function completion(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function mockFetch(responses: Response[]) {
  const calls: { url: string; body: Record<string, unknown> | null }[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    calls.push({
      url: requestUrl(input),
      body:
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    });
    const next = responses.shift();
    if (!next) return Promise.reject(new Error('no queued response'));
    return Promise.resolve(next);
  };
  return { fetchImpl, calls };
}

function messageContent(body: Record<string, unknown> | null, index: number): string {
  const messages = body?.['messages'];
  if (!Array.isArray(messages)) return '';
  const message = messages[index] as { content?: string } | undefined;
  return message?.content ?? '';
}

describe('openai-compatible adapter', () => {
  it('puts the schema on the user turn and asks for json_schema', async () => {
    const { fetchImpl, calls } = mockFetch([completion('{"ok":true}')]);
    const adapter = createOpenAiCompatibleAdapter({
      baseUrl: 'http://127.0.0.1:5001/',
      model: 'gpt-oss',
      apiKey: 'secret',
      fetch: fetchImpl,
    });
    const result = await adapter.complete({ messages, schema, temperature: 0 });
    expect(result.text).toBe('{"ok":true}');
    expect(result.usage).toEqual({ promptTokens: 3, completionTokens: 2, totalTokens: 5 });
    const body = calls[0]?.body;
    expect(calls[0]?.url).toBe('http://127.0.0.1:5001/v1/chat/completions');
    expect(body?.['cache_prompt']).toBe(true);
    expect(body?.['model']).toBe('gpt-oss');
    expect(messageContent(body ?? null, 0)).toBe('PREFIX');
    expect(messageContent(body ?? null, 1)).toContain('SCENE');
    expect(messageContent(body ?? null, 1)).toContain('"additionalProperties":false');
    expect(messageContent(body ?? null, 0)).not.toContain('additionalProperties');
    expect(body?.['response_format']).toEqual({
      type: 'json_schema',
      json_schema: { name: 'choice', strict: true, schema: schema.jsonSchema },
    });
  });

  it('falls back to json_object when json_schema is rejected', async () => {
    const { fetchImpl, calls } = mockFetch([
      new Response('unsupported', { status: 400 }),
      completion('{"ok":true}'),
    ]);
    const adapter = createOpenAiCompatibleAdapter({
      baseUrl: 'http://127.0.0.1:5001',
      fetch: fetchImpl,
    });
    const result = await adapter.complete({ messages, schema });
    expect(result.text).toBe('{"ok":true}');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body?.['response_format']).toEqual({ type: 'json_object' });
    expect(messageContent(calls[1]?.body ?? null, 1)).toContain('"additionalProperties":false');
  });

  it('sends json_object immediately when asked', async () => {
    const { fetchImpl, calls } = mockFetch([completion('{"ok":true}')]);
    const adapter = createOpenAiCompatibleAdapter({
      baseUrl: 'http://127.0.0.1:5001',
      schemaMode: 'json_object',
      fetch: fetchImpl,
    });
    await adapter.complete({ messages, schema });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body?.['response_format']).toEqual({ type: 'json_object' });
  });

  it('does not retry an HTTP 500', async () => {
    const { fetchImpl, calls } = mockFetch([new Response('down', { status: 500 })]);
    const adapter = createOpenAiCompatibleAdapter({
      baseUrl: 'http://127.0.0.1:5001',
      fetch: fetchImpl,
    });
    await expect(adapter.complete({ messages, schema })).rejects.toMatchObject({
      code: 'http_error',
      status: 500,
    });
    expect(calls).toHaveLength(1);
  });

  it('parses server-sent deltas', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const { fetchImpl, calls } = mockFetch([
      new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    ]);
    const adapter = createOpenAiCompatibleAdapter({
      baseUrl: 'http://127.0.0.1:5001',
      fetch: fetchImpl,
    });
    let text = '';
    for await (const chunk of adapter.stream({ messages, schema: null })) text += chunk;
    expect(text).toBe('Hello');
    expect(calls[0]?.body?.['stream']).toBe(true);
    expect(calls[0]?.body?.['response_format']).toBeUndefined();
  });

  it('reads the loaded model id', async () => {
    const { fetchImpl, calls } = mockFetch([
      new Response(JSON.stringify({ data: [{ id: 'gpt-oss' }] }), { status: 200 }),
    ]);
    await expect(detectOpenAiModel('http://127.0.0.1:5001/', fetchImpl)).resolves.toBe('gpt-oss');
    expect(calls[0]?.url).toBe('http://127.0.0.1:5001/v1/models');
  });
});
