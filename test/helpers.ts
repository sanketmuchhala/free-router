import http from 'http';
import type { AddressInfo } from 'net';
import { Catalog } from '../src/providers/catalog.js';
import { DEFAULTS } from '../src/config/index.js';
import { resolveProvider } from '../src/providers/index.js';
import { Health, Sessions } from '../src/routing/rank.js';
import { createServer } from '../src/gateway/server.js';
import type { ProviderConfig, RouterConfig } from '../src/core/types.js';

export interface LoggedCall { path: string; model: string; body: any; headers: http.IncomingHttpHeaders }

const chunk = (model: string, delta: object, finish: string | null = null, extra: object = {}) =>
  `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;

/**
 * A fake provider. Its behavior comes from the model name:
 *   ok-*       answers "Hello from <model>." (a tool call when the request has tools)
 *   limit-*    429 with Retry-After: 30
 *   down-*     503
 *   instream-* 200, then an error record before any output (as OpenRouter does)
 *   silent-*   200, then nothing
 *   break-*    one piece of text, then the connection drops
 * Catalogs: /local/v1 (no prices), /or/v1 (OpenRouter-style prices), /paid/v1 (no prices, for billing).
 */
export async function fakeProvider(catalogs: Record<string, any[]>) {
  const calls: LoggedCall[] = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const prefix = url.pathname.split('/')[1];
    if (req.method === 'GET' && url.pathname.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: catalogs[prefix] ?? [] }));
      return;
    }
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || '{}');
    const model: string = body.model;
    calls.push({ path: url.pathname, model, body, headers: req.headers });
    if (model.startsWith('limit-')) { res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '30' }).end(JSON.stringify({ error: { message: `Rate limit reached for ${model}.` } })); return; }
    if (model.startsWith('down-')) { res.writeHead(503).end('upstream down'); return; }
    if (!body.stream) {
      const message = body.tools?.length
        ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: body.tools[0].function.name, arguments: '{"path":"a.txt"}' } }] }
        : { role: 'assistant', content: `Hello from ${model}.` };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        id: 'x', object: 'chat.completion', model, choices: [{ index: 0, message, finish_reason: body.tools?.length ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
      }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(': keep-alive comment\n\n');
    res.write(chunk(model, { role: 'assistant', content: '' }));
    if (model.startsWith('silent-')) return;
    if (model.startsWith('instream-')) { res.end(`data: ${JSON.stringify({ error: { code: 502, message: 'Provider returned error' } })}\n\n`); return; }
    if (model.startsWith('break-')) { res.write(chunk(model, { content: 'Partial ' })); setTimeout(() => res.destroy(), 20); return; }
    if (body.tools?.length) {
      const name = body.tools[0].function.name;
      res.write(chunk(model, { tool_calls: [{ index: 0, id: 'call_abc', type: 'function', function: { name, arguments: '' } }] }));
      res.write(chunk(model, { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] }));
      res.write(chunk(model, { tool_calls: [{ index: 0, function: { arguments: '"a.txt"}' } }] }));
      res.write(chunk(model, {}, 'tool_calls'));
    } else {
      res.write(chunk(model, { content: 'Hello from ' }));
      res.write(chunk(model, { content: `${model}.` }));
      res.write(chunk(model, {}, 'stop'));
    }
    if (body.stream_options?.include_usage) res.write(`data: ${JSON.stringify({ id: 'c1', model, choices: [], usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, calls, close: () => new Promise(resolve => server.close(resolve)) };
}

export const TEST_KEY = 'fr_test_key_123456';

export async function startRouter(providers: ProviderConfig[], options: { config?: Partial<RouterConfig>; health?: Health } = {}) {
  const config: RouterConfig = { ...DEFAULTS, providers, firstOutputTimeoutMs: 500, ...options.config };
  const catalog = new Catalog(providers.map(resolveProvider));
  await catalog.refresh();
  const health = options.health ?? new Health();
  const lines: string[] = [];
  const server = createServer({ catalog, health, sessions: new Sessions(), config, authorize: key => key === TEST_KEY, log: line => lines.push(line) });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, catalog, health, lines, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
