import OpenAI from 'openai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Health } from '../src/routing/rank.js';
import { fakeProvider, startRouter, TEST_KEY } from './helpers.js';

let fake: Awaited<ReturnType<typeof fakeProvider>>;
const routers: Awaited<ReturnType<typeof startRouter>>[] = [];

beforeAll(async () => {
  fake = await fakeProvider({
    local: [{ id: 'limit-70b' }, { id: 'ok-8b' }, { id: 'down-400b' }, { id: 'silent-90b' }, { id: 'instream-80b' }, { id: 'break-50b' }, { id: 'ok-3b' }],
  });
});
afterAll(async () => {
  await Promise.all(routers.map(r => r.close()));
  await fake.close();
});

async function router(models: string[], options: Parameters<typeof startRouter>[1] = {}) {
  // Each router sees only the named models, through the fake's /local catalog.
  const r = await startRouter([{ id: 'local', kind: 'openai-compatible', baseURL: `${fake.base}/local/v1` }], options);
  const keep = new Set(models.map(m => `local/${m}`));
  const all = r.catalog.models();
  (r.catalog as any).models = () => all.filter(m => keep.has(m.ref));
  (r.catalog as any).find = (ref: string) => all.find(m => m.ref === ref && keep.has(ref));
  routers.push(r);
  return { ...r, client: new OpenAI({ baseURL: `${r.base}/v1`, apiKey: TEST_KEY, maxRetries: 0 }) };
}

const asked = (text: string) => fake.calls.filter(c => JSON.stringify(c.body.messages).includes(text)).map(c => c.model);

describe('OpenAI-compatible endpoint', () => {
  it('streams from the best model, falling back when one is rate limited, and names the model that answered', async () => {
    const { client } = await router(['limit-70b', 'ok-8b']);
    const prompt = 'stream fallback 1';
    const { data: stream, response } = await client.chat.completions.create({ model: 'onerouter/auto', stream: true, messages: [{ role: 'user', content: prompt }] }).withResponse();
    let text = '';
    for await (const part of stream) text += part.choices[0]?.delta?.content ?? '';
    expect(text).toBe('Hello from ok-8b.');
    expect(response.headers.get('x-onerouter-model')).toBe('local/ok-8b');
    expect(response.headers.get('x-onerouter-attempts')).toBe('2');
    expect(asked(prompt)).toEqual(['limit-70b', 'ok-8b']);

    // The rate-limited model is cooling down, so the next request goes straight to the one that works.
    const again = 'stream fallback 2';
    await client.chat.completions.create({ model: 'onerouter/auto', messages: [{ role: 'user', content: again }] });
    expect(asked(again)).toEqual(['ok-8b']);
  });

  it('answers without streaming, and passes tool calls through unchanged', async () => {
    const { client } = await router(['ok-8b']);
    const plain = await client.chat.completions.create({ model: 'onerouter/auto', messages: [{ role: 'user', content: 'non-stream please' }] });
    expect(plain.choices[0].message.content).toBe('Hello from ok-8b.');

    const tools = [{ type: 'function' as const, function: { name: 'read_file', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }];
    const stream = await client.chat.completions.create({ model: 'onerouter/auto', stream: true, tools, messages: [{ role: 'user', content: 'read a.txt' }] });
    let args = '';
    let name = '';
    let finish = '';
    for await (const part of stream) {
      const call = part.choices[0]?.delta?.tool_calls?.[0];
      if (call?.function?.name) name = call.function.name;
      args += call?.function?.arguments ?? '';
      finish = part.choices[0]?.finish_reason ?? finish;
    }
    expect({ name, args: JSON.parse(args), finish }).toEqual({ name: 'read_file', args: { path: 'a.txt' }, finish: 'tool_calls' });
    const sent = fake.calls.find(c => JSON.stringify(c.body.messages).includes('read a.txt'))!;
    expect(sent.body.tools).toEqual(tools);
  });

  it('moves on from a model that sends nothing, or an error before any output, but never after output', async () => {
    const { client } = await router(['silent-90b', 'instream-80b', 'ok-8b']);
    const prompt = 'quiet models';
    const stream = await client.chat.completions.create({ model: 'onerouter/auto', stream: true, messages: [{ role: 'user', content: prompt }] });
    let text = '';
    for await (const part of stream) text += part.choices[0]?.delta?.content ?? '';
    expect(text).toBe('Hello from ok-8b.');
    expect(asked(prompt)).toEqual(['silent-90b', 'instream-80b', 'ok-8b']);

    const broken = await router(['break-50b', 'ok-3b']);
    const cut = 'breaks mid answer';
    const response = await fetch(`${broken.base}/v1/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${TEST_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'onerouter/auto', stream: true, messages: [{ role: 'user', content: cut }] }),
    });
    const body = await response.text();
    expect(body).toContain('Partial ');
    expect(body).toContain('The model stream broke off');
    expect(body.trim().endsWith('data: [DONE]')).toBe(true);
    expect(asked(cut)).toEqual(['break-50b']);
  });

  it('says when no model can answer, with when to retry', async () => {
    const { client } = await router(['limit-70b', 'down-400b'], { health: new Health() });
    // The 400B model is down (503); the 70B one is rate limited (429), and was tried last.
    const error = await client.chat.completions.create({ model: 'onerouter/auto', messages: [{ role: 'user', content: 'nobody home' }] }).catch(e => e);
    expect(error.status).toBe(429);
    expect(error.message).toMatch(/2 free models failed \(last: The endpoint is rate limiting requests: Rate limit reached for limit-70b\.\)/);
    expect(Number(error.headers.get('retry-after'))).toBe(30);
    // Both are cooling down now, so nothing is sent, and the answer says when to retry.
    const next = await client.chat.completions.create({ model: 'onerouter/auto', messages: [{ role: 'user', content: 'still nobody' }] }).catch(e => e);
    expect(next.status).toBe(429);
    expect(next.message).toMatch(/No free model can take this request\. Left out: 2 cooling down after a failure\. The next one is available in \d+ s\./);
    expect(asked('still nobody')).toEqual([]);
  });

  it('keeps a conversation on the model it started with', async () => {
    let now = 1_000_000;
    const health = new Health(() => now);
    const { client } = await router(['limit-70b', 'ok-8b'], { health });
    const messages = [{ role: 'system' as const, content: 'You are an agent.' }, { role: 'user' as const, content: 'sticky task' }];
    await client.chat.completions.create({ model: 'onerouter/auto', messages });
    expect(asked('sticky task')).toEqual(['limit-70b', 'ok-8b']);
    now += 10 * 60_000; // the 70B model's cooldown is over and it ranks first again
    await client.chat.completions.create({ model: 'onerouter/auto', messages: [...messages, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'sticky next turn' }] });
    expect(asked('sticky next turn')).toEqual(['ok-8b']);
  });

  it('requires a key, lists models, takes a model by name, and routes unknown names', async () => {
    const { base, client } = await router(['ok-8b', 'ok-3b']);
    expect((await fetch(`${base}/v1/models`)).status).toBe(401);
    expect((await fetch(`${base}/health`)).status).toBe(200);
    const list = await client.models.list();
    expect(list.data.map(m => m.id)).toEqual(['onerouter/auto', 'local/ok-3b', 'local/ok-8b']);

    await client.chat.completions.create({ model: 'local/ok-3b', messages: [{ role: 'user', content: 'by name' }] });
    expect(asked('by name')).toEqual(['ok-3b']);
    await client.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: 'unknown name' }] });
    expect(asked('unknown name')).toEqual(['ok-8b']);
  });
});
