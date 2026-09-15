import http, { IncomingMessage, ServerResponse } from 'http';
import { AnthropicRequest, AnthropicStream, anthropicError, estimateTokens, toChatRequest, TranslationError } from './anthropic.js';
import type { Catalog } from './catalog.js';
import { AUTO_MODEL, route, RouteDeps, RouteError, Routed } from './route.js';
import type { ChatRequest } from './types.js';

export interface ServerDeps extends RouteDeps {
  catalog: Catalog;
  /** Whether a presented key is valid. */
  authorize: (key: string | undefined) => boolean;
  log?: (line: string) => void;
}

const MAX_BODY_BYTES = 20 * 1024 * 1024;

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function readJSON(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'The request is larger than 20 MB.');
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new HttpError(400, 'The request body is not valid JSON.'); }
}

const presentedKey = (req: IncomingMessage) => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const key = req.headers['x-api-key'];
  return typeof key === 'string' ? key.trim() : undefined;
};

/** Anthropic clients send anthropic-version; the shared /v1/models path answers in their format. */
const isAnthropicClient = (req: IncomingMessage) => typeof req.headers['anthropic-version'] === 'string';

function sendJSON(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function openAIError(res: ServerResponse, status: number, message: string, code = 'error', retryAfterMs?: number) {
  sendJSON(res, status, { error: { message, type: code, code } }, retryAfterMs !== undefined ? { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } : {});
}

const routedHeaders = (routed: Routed) => ({ 'x-free-router-model': routed.model.ref, 'x-free-router-attempts': String(routed.attempts.length) });

const describeAttempts = (attempts: { ref: string; ok: boolean; reason?: string }[]) =>
  attempts.map(a => a.ok ? a.ref : `${a.ref} failed (${(a.reason ?? '').slice(0, 80)})`).join(' → ');

export function createServer(deps: ServerDeps): http.Server {
  const log = deps.log ?? (() => undefined);

  const models = (req: IncomingMessage, res: ServerResponse) => {
    const list = deps.catalog.models();
    if (isAnthropicClient(req)) {
      const data = [{ type: 'model', id: AUTO_MODEL, display_name: 'Free Router (best free model)', created_at: '2026-01-01T00:00:00Z' },
        ...list.map(m => ({ type: 'model', id: m.ref, display_name: m.ref, created_at: '2026-01-01T00:00:00Z' }))];
      sendJSON(res, 200, { data, has_more: false, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null });
      return;
    }
    sendJSON(res, 200, {
      object: 'list',
      data: [{ id: AUTO_MODEL, object: 'model', created: 0, owned_by: 'free-router' },
        ...list.map(m => ({ id: m.ref, object: 'model', created: 0, owned_by: m.provider.id, ...(m.contextLength ? { context_length: m.contextLength } : {}) }))],
    });
  };

  const chatCompletions = async (req: IncomingMessage, res: ServerResponse, started: number) => {
    const body = await readJSON(req) as ChatRequest;
    if (!Array.isArray(body?.messages) || !body.messages.length) throw new HttpError(400, 'messages must be a non-empty list.');
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableFinished) controller.abort(); });
    const session = typeof req.headers['x-free-router-session'] === 'string' ? req.headers['x-free-router-session'] : undefined;
    let routed: Routed;
    try {
      routed = await route({ ...body, model: body.model ?? AUTO_MODEL }, deps, { signal: controller.signal, session });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!(error instanceof RouteError)) throw error;
      log(`POST /v1/chat/completions ${error.status} ${describeAttempts(error.attempts) || 'no model'} ${Date.now() - started}ms`);
      openAIError(res, error.status, error.message, error.code, error.retryAfterMs);
      return;
    }
    log(`POST /v1/chat/completions 200 ${describeAttempts(routed.attempts)}${body.stream ? ' stream' : ''} ${Date.now() - started}ms`);
    if (routed.kind === 'json') { sendJSON(res, 200, routed.body, routedHeaders(routed)); return; }
    res.on('close', routed.close);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...routedHeaders(routed) });
    let done = false;
    try {
      for await (const record of routed.records) {
        res.write(`data: ${record.raw}\n\n`);
        if (record.done) done = true;
      }
    } catch (error) {
      if (!controller.signal.aborted) res.write(`data: ${JSON.stringify({ error: { message: 'The model stream broke off. The partial answer above is all it sent.', type: 'upstream_error' } })}\n\n`);
    }
    if (!done && !res.writableEnded) res.write('data: [DONE]\n\n');
    res.end();
  };

  const messages = async (req: IncomingMessage, res: ServerResponse, started: number) => {
    const fail = (status: number, message: string, retryAfterMs?: number) => {
      const { status: code, body } = anthropicError(status, message);
      sendJSON(res, code, body, retryAfterMs !== undefined ? { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } : {});
    };
    const body = await readJSON(req) as AnthropicRequest;
    let chat: ChatRequest;
    try { chat = toChatRequest(body); }
    catch (error) { if (error instanceof TranslationError) { fail(400, error.message); return; } throw error; }
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableFinished) controller.abort(); });
    const header = req.headers['x-free-router-session'];
    const session = typeof header === 'string' ? header : body.metadata?.user_id;
    let routed: Routed;
    try {
      routed = await route({ ...chat, model: body.model ?? AUTO_MODEL }, deps, { signal: controller.signal, session });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!(error instanceof RouteError)) throw error;
      log(`POST /v1/messages ${error.status} ${describeAttempts(error.attempts) || 'no model'} ${Date.now() - started}ms`);
      fail(error.status, error.message, error.retryAfterMs);
      return;
    }
    log(`POST /v1/messages 200 ${describeAttempts(routed.attempts)}${body.stream ? ' stream' : ''}${chat.tools?.length ? ` tools=${chat.tools.length}` : ''} ${Date.now() - started}ms`);
    if (routed.kind !== 'stream') throw new Error('Anthropic requests are always streamed upstream.');
    res.on('close', routed.close);
    const translator = new AnthropicStream(routed.model.ref, estimateTokens(body));
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...routedHeaders(routed) });
      res.write(translator.start());
      try {
        for await (const record of routed.records) {
          const out = translator.push(record);
          if (out) res.write(out);
        }
        res.write(translator.end());
      } catch {
        if (!controller.signal.aborted) res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'The model stream broke off.' } })}\n\n`);
      }
      res.end();
      return;
    }
    try {
      for await (const record of routed.records) translator.push(record);
    } catch {
      if (!controller.signal.aborted) fail(502, 'The model stream broke off before the answer was complete.');
      return;
    }
    sendJSON(res, 200, translator.message(), routedHeaders(routed));
  };

  return http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const anthropic = path.startsWith('/v1/messages') || isAnthropicClient(req);
    try {
      if (req.method === 'GET' && (path === '/health' || path === '/')) {
        const statuses = deps.catalog.statuses();
        sendJSON(res, 200, { ok: true, models: deps.catalog.models().length, providers: statuses.map(({ id, kind, ok, free, error }) => ({ id, kind, ok, free, ...(error ? { error } : {}) })) });
        return;
      }
      if (!deps.authorize(presentedKey(req))) throw new HttpError(401, 'Missing or invalid API key. Create one with: free-router key create');
      if (req.method === 'GET' && path === '/v1/models') { models(req, res); return; }
      if (req.method === 'POST' && path === '/v1/chat/completions') { await chatCompletions(req, res, started); return; }
      if (req.method === 'POST' && path === '/v1/messages') { await messages(req, res, started); return; }
      if (req.method === 'POST' && path === '/v1/messages/count_tokens') {
        sendJSON(res, 200, { input_tokens: estimateTokens(await readJSON(req) as AnthropicRequest) });
        return;
      }
      throw new HttpError(404, `No route for ${req.method} ${path}.`);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : 'The router hit an unexpected error.';
      if (!(error instanceof HttpError)) log(`${req.method} ${path} 500 ${(error as Error)?.stack ?? error}`);
      if (res.headersSent) { res.end(); return; }
      if (anthropic) { const { status: code, body } = anthropicError(status, message); sendJSON(res, code, body); }
      else openAIError(res, status, message);
    }
  });
}
