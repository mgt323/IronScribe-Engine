import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createGeminiAdapter } from './gemini.js';
import { toFlatJsonSchema } from './schema.js';
import type { ChatMessage } from './types.js';

const schema = toFlatJsonSchema('choice', z.strictObject({ ok: z.boolean() }));

function geminiResponse(text: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1, totalTokenCount: 5 },
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
  const calls: { url: string; body: Record<string, unknown> | null; apiKey: string | null }[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: requestUrl(input),
      body:
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      apiKey: headers.get('x-goog-api-key'),
    });
    const next = responses.shift();
    if (!next) return Promise.reject(new Error('no queued response'));
    return Promise.resolve(next);
  };
  return { fetchImpl, calls };
}

describe('gemini adapter', () => {
  it('sends the prefix as systemInstruction and the schema as responseJsonSchema', async () => {
    const { fetchImpl, calls } = mockFetch([geminiResponse('{"ok":true}')]);
    const adapter = createGeminiAdapter({ apiKey: 'key', fetch: fetchImpl });
    const messages: ChatMessage[] = [
      { role: 'system', content: 'PREFIX' },
      { role: 'user', content: 'SCENE' },
    ];
    const result = await adapter.complete({ messages, schema });
    expect(result.text).toBe('{"ok":true}');
    expect(result.usage).toEqual({ promptTokens: 4, completionTokens: 1, totalTokens: 5 });
    expect(calls[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    expect(calls[0]?.apiKey).toBe('key');
    const body = calls[0]?.body;
    expect(body?.['systemInstruction']).toEqual({ parts: [{ text: 'PREFIX' }] });
    expect(body?.['contents']).toEqual([{ role: 'user', parts: [{ text: 'SCENE' }] }]);
    const generation = body?.['generationConfig'] as Record<string, unknown>;
    expect(generation['responseMimeType']).toBe('application/json');
    expect(generation['responseJsonSchema']).toEqual(schema.jsonSchema);
    expect(generation['responseJsonSchema']).not.toHaveProperty('$schema');
  });

  it('maps a repair turn onto model and user contents', async () => {
    const { fetchImpl, calls } = mockFetch([geminiResponse('{"ok":true}')]);
    const adapter = createGeminiAdapter({ apiKey: 'key', fetch: fetchImpl });
    const messages: ChatMessage[] = [
      { role: 'system', content: 'PREFIX' },
      { role: 'user', content: 'SCENE' },
      { role: 'assistant', content: 'nope' },
      { role: 'user', content: 'fix it' },
    ];
    await adapter.complete({ messages, schema: null });
    const contents = calls[0]?.body?.['contents'] as { role: string; parts: { text: string }[] }[];
    expect(contents.map((turn) => turn.role)).toEqual(['user', 'model', 'user']);
    expect(contents[1]?.parts[0]?.text).toBe('nope');
    expect(calls[0]?.body?.['systemInstruction']).toEqual({ parts: [{ text: 'PREFIX' }] });
    expect(calls[0]?.body?.['generationConfig']).toEqual({});
  });

  it('parses a generateContent stream', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\n\n'),
        );
        controller.enqueue(
          encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}]}\n\n'),
        );
        controller.close();
      },
    });
    const { fetchImpl, calls } = mockFetch([new Response(stream, { status: 200 })]);
    const adapter = createGeminiAdapter({ apiKey: 'key', fetch: fetchImpl });
    let text = '';
    for await (const chunk of adapter.stream({
      messages: [
        { role: 'system', content: 'PREFIX' },
        { role: 'user', content: 'SCENE' },
      ],
      schema: null,
    })) {
      text += chunk;
    }
    expect(text).toBe('Hello');
    expect(calls[0]?.url).toContain(':streamGenerateContent?alt=sse');
  });

  it('reports an HTTP error', async () => {
    const { fetchImpl } = mockFetch([new Response('denied', { status: 401 })]);
    const adapter = createGeminiAdapter({ apiKey: 'key', fetch: fetchImpl });
    await expect(
      adapter.complete({
        messages: [{ role: 'user', content: 'SCENE' }],
        schema: null,
      }),
    ).rejects.toMatchObject({ code: 'http_error', status: 401 });
  });
});
