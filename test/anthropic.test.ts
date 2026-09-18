import Anthropic from '@anthropic-ai/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toChatRequest, AnthropicStream } from '../src/providers/anthropic.js';
import { fakeProvider, startRouter, TEST_KEY } from './helpers.js';

let fake: Awaited<ReturnType<typeof fakeProvider>>;
let router: Awaited<ReturnType<typeof startRouter>>;
let client: Anthropic;

beforeAll(async () => {
  fake = await fakeProvider({ local: [{ id: 'limit-70b' }, { id: 'ok-8b' }] });
  router = await startRouter([{ id: 'local', kind: 'openai-compatible', baseURL: `${fake.base}/local/v1` }]);
  // As Claude Code is configured: ANTHROPIC_BASE_URL and a key.
  client = new Anthropic({ baseURL: router.base, apiKey: TEST_KEY, maxRetries: 0 });
});
afterAll(async () => {
  await router.close();
  await fake.close();
});

const sentFor = (text: string) => fake.calls.filter(c => JSON.stringify(c.body.messages).includes(text));

const tools: Anthropic.Tool[] = [{ name: 'read_file', description: 'Read a file', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }];

describe('Anthropic-compatible endpoint', () => {
  it('answers a Claude-style request without streaming, with the model that answered', async () => {
    const message = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 256, system: 'Be brief.', messages: [{ role: 'user', content: 'anthropic plain' }] });
    expect(message.content).toEqual([{ type: 'text', text: 'Hello from ok-8b.' }]);
    expect(message).toMatchObject({ role: 'assistant', model: 'local/ok-8b', stop_reason: 'end_turn', usage: { input_tokens: 11, output_tokens: 5 } });
    // The rate-limited 70B model was tried first; the system prompt arrived as a system message.
    expect(sentFor('anthropic plain').map(c => c.model)).toEqual(['limit-70b', 'ok-8b']);
    expect(sentFor('anthropic plain')[1].body.messages[0]).toEqual({ role: 'system', content: 'Be brief.' });
    expect(sentFor('anthropic plain')[1].body.max_tokens).toBe(256);
  });

  it('streams text as Anthropic events', async () => {
    const stream = client.messages.stream({ model: 'claude-sonnet-4-5', max_tokens: 256, messages: [{ role: 'user', content: 'anthropic stream' }] });
    const deltas: string[] = [];
    stream.on('text', text => deltas.push(text));
    const final = await stream.finalMessage();
    expect(deltas).toEqual(['Hello from ', 'ok-8b.']);
    expect(final.content).toEqual([{ type: 'text', text: 'Hello from ok-8b.' }]);
    expect(final.stop_reason).toBe('end_turn');
  });

  it('runs a tool round trip: tool_use out, tool_result back', async () => {
    const stream = client.messages.stream({ model: 'claude-sonnet-4-5', max_tokens: 256, tools, messages: [{ role: 'user', content: 'use the tool please' }] });
    const first = await stream.finalMessage();
    expect(first.stop_reason).toBe('tool_use');
    const use = first.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock;
    expect(use).toMatchObject({ id: 'call_abc', name: 'read_file', input: { path: 'a.txt' } });
    const upstream = sentFor('use the tool please')[0].body;
    expect(upstream.tools).toEqual([{ type: 'function', function: { name: 'read_file', description: 'Read a file', parameters: tools[0].input_schema } }]);

    const second = await client.messages.create({
      model: 'claude-sonnet-4-5', max_tokens: 256, tools,
      messages: [
        { role: 'user', content: 'use the tool please' },
        { role: 'assistant', content: first.content },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: use.id, content: 'file says hi' }, { type: 'text', text: 'what did it say' }] },
      ],
    });
    expect(second.stop_reason).toBe('tool_use');
    const sent = sentFor('file says hi')[0].body.messages;
    expect(sent.slice(1)).toEqual([
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_abc', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }] },
      { role: 'tool', tool_call_id: 'call_abc', content: 'file says hi' },
      { role: 'user', content: 'what did it say' },
    ]);
  });

  it('counts tokens, lists models, and answers errors in Anthropic form', async () => {
    const count = await client.messages.countTokens({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'x'.repeat(400) }] });
    expect(count.input_tokens).toBeGreaterThan(90);
    const models = await client.models.list();
    expect(models.data.map(m => m.id)).toEqual(['onerouter/auto', 'local/limit-70b', 'local/ok-8b']);

    const unauthorized = new Anthropic({ baseURL: router.base, apiKey: 'wrong', maxRetries: 0 });
    await expect(unauthorized.messages.create({ model: 'x', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] })).rejects.toBeInstanceOf(Anthropic.AuthenticationError);
    const byName = await client.messages.create({ model: 'local/limit-70b', max_tokens: 5, messages: [{ role: 'user', content: 'only that one' }] }).catch(e => e);
    expect(byName).toBeInstanceOf(Anthropic.RateLimitError);
  });
});

describe('translation', () => {
  it('maps Anthropic content to OpenAI messages', () => {
    const chat = toChatRequest({
      model: 'm', max_tokens: 10, stop_sequences: ['END'], temperature: 0.2,
      system: [{ type: 'text', text: 'One.' }, { type: 'text', text: 'Two.' }],
      tool_choice: { type: 'any', disable_parallel_tool_use: true },
      tools: [...tools, { type: 'web_search_20250305', name: 'web_search' }],
      messages: [
        { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: 'what is this' }] },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm', signature: 's' }, { type: 'text', text: 'Let me look.' }, { type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'b' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'not found' }] }] },
      ],
    });
    expect(chat.messages).toEqual([
      { role: 'system', content: 'One.\nTwo.' },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }, { type: 'text', text: 'what is this' }] },
      { role: 'assistant', content: 'Let me look.', tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: '{"path":"b"}' } }] },
      { role: 'tool', tool_call_id: 't1', content: 'Error: not found' },
    ]);
    // Anthropic's server tools (web search) cannot run elsewhere, so only the client's tools are sent.
    expect((chat.tools as any[]).map(t => t.function.name)).toEqual(['read_file']);
    expect(chat).toMatchObject({ tool_choice: 'required', parallel_tool_calls: false, stop: ['END'], temperature: 0.2, max_tokens: 10, stream: true });
  });

  it('turns a length stop into max_tokens and bad tool arguments into a raw field', () => {
    const t = new AnthropicStream('m', 5);
    t.push({ raw: '', json: { choices: [{ delta: { tool_calls: [{ index: 0, id: 'x', function: { name: 'f', arguments: '{oops' } }] } }] } });
    t.push({ raw: '', json: { choices: [{ delta: {}, finish_reason: 'length' }] } });
    const message = t.message();
    expect(message.content).toEqual([{ type: 'tool_use', id: 'x', name: 'f', input: { _raw_arguments: '{oops' } }]);
    const s = new AnthropicStream('m', 5);
    s.push({ raw: '', json: { choices: [{ delta: { content: 'cut' }, finish_reason: 'length' }] } });
    expect(s.message().stop_reason).toBe('max_tokens');
  });
});
