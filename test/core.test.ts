import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Catalog, priceOf } from '../src/providers/catalog.js';
import { loadConfig, providersFromEnv } from '../src/config/index.js';
import { KeyStore } from '../src/core/keys.js';
import { resolveProvider } from '../src/providers/index.js';
import { parameterBillions, profileTask, sessionKey } from '../src/routing/rank.js';
import { mistralId, upstreamBody } from '../src/routing/index.js';
import type { CatalogModel, ChatRequest } from '../src/core/types.js';
import { fakeProvider } from './helpers.js';

let fake: Awaited<ReturnType<typeof fakeProvider>>;
beforeAll(async () => {
  fake = await fakeProvider({
    or: [
      { id: 'meta/llama-3.3-70b:free', pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'], context_length: 131072 },
      { id: 'vendor/big', pricing: { prompt: '0.000003', completion: '0.000015' } },
      { id: 'vendor/mystery', pricing: { prompt: '-1', completion: '-1' } },
      { id: 'vendor/image-maker', pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['image'] } },
    ],
    paid: [{ id: 'llama-3.1-8b-instant' }, { id: 'whisper-large-v3' }],
  });
});
afterAll(async () => { await fake.close(); });

describe('free models only', () => {
  it('uses OpenRouter models listed at $0 and its free router, never paid or unpriced ones', async () => {
    const catalog = new Catalog([resolveProvider({ id: 'or', kind: 'openrouter', apiKey: 'k', baseURL: `${fake.base}/or/v1` })]);
    const [status] = await catalog.refresh();
    expect(catalog.models().map(m => m.ref)).toEqual(['or/meta/llama-3.3-70b:free', 'or/openrouter/free']);
    expect(status).toMatchObject({ ok: true, listed: 4, free: 2 });
    expect(catalog.find('or/meta/llama-3.3-70b:free')).toMatchObject({ contextLength: 131072, capabilities: { tools: true } });
  });

  it('uses a no-billing account only when the user says it has no billing', async () => {
    const unknown = new Catalog([resolveProvider({ id: 'groq', kind: 'groq', apiKey: 'k', baseURL: `${fake.base}/paid/v1` })]);
    await unknown.refresh();
    expect(unknown.models()).toEqual([]);
    const none = new Catalog([resolveProvider({ id: 'groq', kind: 'groq', apiKey: 'k', baseURL: `${fake.base}/paid/v1`, billing: 'none' })]);
    await none.refresh();
    // Speech models are left out.
    expect(none.models().map(m => m.ref)).toEqual(['groq/llama-3.1-8b-instant']);
  });

  it('reads prices', () => {
    expect(priceOf({ prompt: '0', completion: '0' })).toBe('zero-price');
    expect(priceOf({ prompt: '0', completion: '0', request: '0.01' })).toBe('paid');
    expect(priceOf({ prompt: '-1', completion: '0' })).toBe('unknown');
    expect(priceOf(undefined)).toBe('unknown');
  });

  it('keeps a provider’s last good list when listing fails', async () => {
    const provider = resolveProvider({ id: 'local', kind: 'openai-compatible', baseURL: `${fake.base}/paid/v1` });
    let fail = false;
    const catalog = new Catalog([provider], ((url: any, init: any) => fail ? Promise.reject(new TypeError('offline')) : fetch(url, init)) as typeof fetch);
    await catalog.refresh();
    fail = true;
    const [status] = await catalog.refresh();
    expect(status.ok).toBe(false);
    expect(catalog.models()).toHaveLength(1);
  });
});

describe('providers and config', () => {
  it('resolves addresses and refuses unsafe ones', () => {
    expect(resolveProvider({ id: 'g', kind: 'gemini', apiKey: 'k' })).toMatchObject({
      chatURL: 'https://generativelanguage.googleapis.com/v1beta/openai', catalogURL: 'https://generativelanguage.googleapis.com/v1beta',
    });
    expect(resolveProvider({ id: 'o', kind: 'ollama', baseURL: 'http://127.0.0.1:11434' })).toMatchObject({ chatURL: 'http://127.0.0.1:11434/v1', catalogURL: 'http://127.0.0.1:11434', local: true, billing: 'none' });
    expect(resolveProvider({ id: 'l', kind: 'openai-compatible', baseURL: 'http://localhost:1234' }).chatURL).toBe('http://localhost:1234/v1');
    expect(() => resolveProvider({ id: 'x', kind: 'openai-compatible', baseURL: 'http://example.com/v1' })).toThrow(/https/);
    expect(() => resolveProvider({ id: 'x', kind: 'groq' })).toThrow(/needs an API key/);
    expect(() => resolveProvider({ id: 'bad id', kind: 'groq', apiKey: 'k' })).toThrow(/Provider ID/);
  });

  it('builds providers from the environment, and reads keys by name from a config file', () => {
    const env = { OPENROUTER_API_KEY: 'or-key', GROQ_API_KEY: 'groq-key', FREE_ROUTER_NO_BILLING: 'groq', FREE_ROUTER_LOCAL: '0' };
    expect(providersFromEnv(env)).toEqual([
      { id: 'openrouter', kind: 'openrouter', apiKey: 'or-key', billing: 'unknown' },
      { id: 'groq', kind: 'groq', apiKey: 'groq-key', billing: 'none' },
    ]);
    const dir = mkdtempSync(join(tmpdir(), 'fr-'));
    const file = join(dir, 'config.json');
    writeFileSync(file, JSON.stringify({ port: 5000, providers: [{ id: 'or', kind: 'openrouter', apiKey: 'env:MY_KEY' }, { id: 'off', kind: 'groq', disabled: true }] }));
    const loaded = loadConfig({ path: file, env: { MY_KEY: 'secret', FREE_ROUTER_HOME: dir } });
    expect(loaded.providers.map(p => [p.id, p.apiKey])).toEqual([['or', 'secret']]);
    expect(loaded.config.port).toBe(5000);
    expect(() => loadConfig({ path: file, env: { FREE_ROUTER_HOME: dir } })).toThrow(/MY_KEY is not set/);
  });
});

describe('router keys', () => {
  it('stores only a hash, verifies, and revokes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fr-keys-'));
    const store = new KeyStore(dir);
    const { key, record } = store.create('harness');
    expect(key).toMatch(/^fr_/);
    expect(readFileSync(join(dir, 'keys.json'), 'utf8')).not.toContain(key);
    expect(statSync(join(dir, 'keys.json')).mode & 0o777).toBe(0o600);
    expect(store.verify(key)?.id).toBe(record.id);
    expect(store.verify('fr_wrong')).toBeUndefined();
    expect(store.revoke(record.id)?.name).toBe('harness');
    expect(store.verify(key)).toBeUndefined();
  });
});

describe('requests', () => {
  const model = (kind: 'groq' | 'mistral'): CatalogModel => ({
    provider: resolveProvider({ id: kind, kind, apiKey: 'k' }), model: 'm', ref: `${kind}/m`, capabilities: { tools: true, vision: false }, price: 'unknown',
  });
  const request: ChatRequest = {
    model: 'onerouter/auto', max_tokens: 100, stream: true, stream_options: { include_usage: true },
    messages: [
      { role: 'assistant', content: null, tool_calls: [{ id: 'toolu_01ABCdef', type: 'function', function: { name: 'f', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'toolu_01ABCdef', content: 'ok' },
    ],
    tools: [{ type: 'function', function: { name: 'f' } }],
  };

  it('adapts to provider quirks', () => {
    expect(upstreamBody(request, model('groq'))).toMatchObject({ model: 'm', max_completion_tokens: 100 });
    expect(upstreamBody(request, model('groq')).max_tokens).toBeUndefined();
    const mistral = upstreamBody(request, model('mistral')) as any;
    const id = mistralId('toolu_01ABCdef');
    expect(id).toMatch(/^[a-z0-9]{9}$/);
    expect(mistral.messages[0].tool_calls[0].id).toBe(id);
    expect(mistral.messages[1].tool_call_id).toBe(id);
    expect(mistral.stream_options).toBeUndefined();
    expect(mistralId('abcDEF123')).toBe('abcDEF123');
  });

  it('caps large answer requests at what each model allows', () => {
    const big: ChatRequest = { model: 'x', max_tokens: 32000, messages: [{ role: 'user', content: 'x'.repeat(80_000) }] };
    const withLimits = (contextLength?: number, maxOutputTokens?: number): CatalogModel => ({ ...model('groq'), contextLength, maxOutputTokens });
    expect(upstreamBody(big, withLimits(131072, 8192)).max_completion_tokens).toBe(8192);
    expect(upstreamBody(big, withLimits(32768)).max_completion_tokens).toBe(32768 - 20_000 - 256);
    expect(upstreamBody(big, withLimits(20_000 + 4096 + 100)).max_completion_tokens).toBe(4096);
    expect(upstreamBody(big, withLimits(131072, 2048)).max_completion_tokens).toBe(2048);
    expect(upstreamBody(big, withLimits()).max_completion_tokens).toBe(32000);
  });

  it('profiles requests and names conversations', () => {
    expect(profileTask([{ role: 'user', content: 'Write a poem' }], false).kind).toBe('writing');
    expect(profileTask([{ role: 'user', content: 'Write a poem' }], true).kind).toBe('code');
    expect(parameterBillions('mixtral-8x7b')).toBe(56);
    expect(parameterBillions('qwen3-235b-a22b')).toBe(235);
    const a = [{ role: 'system' as const, content: 's' }, { role: 'user' as const, content: 'first' }];
    expect(sessionKey([...a, { role: 'user', content: 'later' }])).toBe(sessionKey(a));
    expect(sessionKey(a, 'abc')).toBe('id:abc');
  });
});
