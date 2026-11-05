import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createLlmClient } from './client.js';
import { LlmError } from './errors.js';
import { createScriptedLlmAdapter } from './testing/fake-client.js';

const Ok = z.strictObject({ ok: z.boolean() });
const prompt = { prefix: 'rules', scene: 'go' };

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
}

describe('createLlmClient', () => {
  it.each([
    ['plain JSON', '{"ok":true}'],
    ['a markdown fence', '```json\n{"ok":true}\n```'],
    ['a think block', '<think>maybe</think>\n{"ok":true}'],
    ['a stray closing think tag', 'reasoning</think>{"ok":true}'],
    [
      'a harmony channel',
      '<|channel|>analysis<|message|>hmm<|channel|>final<|message|>{"ok":true}',
    ],
    ['a preamble', 'Sure, here is the object: {"ok":true}'],
  ])('accepts %s on the first try', async (_label, text) => {
    const adapter = createScriptedLlmAdapter([{ text }]);
    const client = createLlmClient(adapter);
    const result = await client.generateObject({ name: 'choice', schema: Ok, prompt });
    expect(result.data).toEqual({ ok: true });
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.error).toBeNull();
    expect(adapter.calls).toHaveLength(1);
  });

  it('repairs malformed JSON once and keeps the prefix', async () => {
    const adapter = createScriptedLlmAdapter([{ text: 'not json' }, { text: '{"ok":true}' }]);
    const client = createLlmClient(adapter);
    const result = await client.generateObject({ name: 'choice', schema: Ok, prompt });
    expect(result.data).toEqual({ ok: true });
    expect(result.attempts.map((attempt) => attempt.attempt)).toEqual([1, 2]);
    expect(adapter.calls).toHaveLength(2);
    const repair = adapter.calls[1]?.messages;
    expect(repair?.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(repair?.[0]?.content).toBe('rules');
    expect(repair?.[1]?.content).toBe('go');
    expect(repair?.[2]?.content).toBe('not json');
    expect(repair?.[3]?.content).toMatch(/^Your previous reply was invalid: /);
  });

  it('repairs an unknown enum value once', async () => {
    const schema = z.strictObject({ kind: z.enum(['action', 'none']) });
    const adapter = createScriptedLlmAdapter([
      { text: '{"kind":"maybe"}' },
      { text: '{"kind":"action"}' },
    ]);
    const result = await createLlmClient(adapter).generateObject({
      name: 'choice',
      schema,
      prompt,
    });
    expect(result.data).toEqual({ kind: 'action' });
    expect(result.attempts).toHaveLength(2);
    expect(adapter.calls).toHaveLength(2);
  });

  it('stops after one repair retry', async () => {
    const adapter = createScriptedLlmAdapter([{ text: 'nope' }, { text: 'still nope' }]);
    const error = await createLlmClient(adapter)
      .generateObject({ name: 'choice', schema: Ok, prompt })
      .then(() => {
        throw new Error('expected repair_exhausted');
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).code).toBe('repair_exhausted');
    expect((error as LlmError).attempts).toHaveLength(2);
    expect(adapter.calls).toHaveLength(2);
  });

  it('does not retry an HTTP error', async () => {
    const adapter = createScriptedLlmAdapter([
      { error: new LlmError('http_error', 'down', [], 500) },
      { text: '{"ok":true}' },
    ]);
    await expect(
      createLlmClient(adapter).generateObject({ name: 'choice', schema: Ok, prompt }),
    ).rejects.toMatchObject({ code: 'http_error', status: 500 });
    expect(adapter.calls).toHaveLength(1);
  });

  it('rejects a nested schema before calling the provider', async () => {
    const adapter = createScriptedLlmAdapter([]);
    const schema = z.strictObject({ child: z.strictObject({ ok: z.boolean() }) });
    await expect(
      createLlmClient(adapter).generateObject({ name: 'bad', schema, prompt }),
    ).rejects.toMatchObject({ code: 'non_flat_schema' });
    expect(adapter.calls).toHaveLength(0);
  });

  it('strips a think block from narration', async () => {
    const adapter = createScriptedLlmAdapter([
      { text: '<think>secret</think> The goblin staggers.' },
    ]);
    const result = await createLlmClient(adapter).generateText({ prompt });
    expect(result.text).toBe('The goblin staggers.');
    expect(adapter.calls[0]?.schema).toBeNull();
    expect(adapter.calls[0]?.messages[0]?.content).toBe('rules');
  });

  it('streams prose that follows a think block', async () => {
    const adapter = createScriptedLlmAdapter([{ chunks: ['<think>x', '</think>Hello', ' there'] }]);
    const text = await collect(createLlmClient(adapter).streamText({ prompt }));
    expect(text).toBe('Hello there');
  });
});
