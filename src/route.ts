import { createHash } from 'crypto';
import type { Catalog } from './catalog.js';
import { FALLBACK, failureFromRecord, failureFromStatus, failureFromThrown, UpstreamError } from './errors.js';
import { accountOf, Health, profileTask, promptTokens, rank, Ranked, Ranking, RESERVED_OUTPUT, Sessions, sessionKey } from './rank.js';
import type { CatalogModel, ChatMessage, ChatRequest, Failure, RouterConfig } from './types.js';

type FetchFn = typeof fetch;

/** Names that ask the router to choose. */
export const AUTO_MODELS = new Set(['free-router/auto', 'free-router', 'auto', 'free']);
export const AUTO_MODEL = 'free-router/auto';

export interface RouteDeps {
  catalog: Catalog;
  health: Health;
  sessions: Sessions;
  config: RouterConfig;
  fetchImpl?: FetchFn;
}

export interface AttemptRecord {
  ref: string;
  ok: boolean;
  reason?: string;
}

/** One server-sent event's data, raw and parsed. */
export interface SSERecord {
  raw: string;
  json?: any;
  done?: boolean;
}

export type Routed = { model: CatalogModel; attempts: AttemptRecord[]; why: string[] } & (
  | { kind: 'stream'; records: AsyncGenerator<SSERecord>; close: () => void }
  | { kind: 'json'; body: any }
);

/** No model could answer. `status` is what the client receives. */
export class RouteError extends Error {
  constructor(readonly status: number, message: string, readonly attempts: AttemptRecord[] = [], readonly retryAfterMs?: number, readonly code = 'no_free_model') {
    super(message);
  }
}

/** Read server-sent events. A record is dispatched at each blank line; comments (": …") are skipped. */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SSERecord> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  const dispatch = function* (): Generator<SSERecord> {
    if (!data.length) return;
    const raw = data.join('\n');
    data = [];
    if (raw.trim() === '[DONE]') { yield { raw, done: true }; return; }
    let json: any;
    try { json = JSON.parse(raw); } catch { json = undefined; }
    yield { raw, json };
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line === '') yield* dispatch();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (buffer.startsWith('data:')) data.push(buffer.slice(5).replace(/^ /, ''));
    yield* dispatch();
  } finally {
    reader.releaseLock();
  }
}

/** Whether a stream record carries output: text, reasoning, a tool call, or the end of the answer. */
export function hasOutput(record: SSERecord): boolean {
  const choice = record.json?.choices?.[0];
  if (!choice) return false;
  const delta = choice.delta ?? {};
  return (typeof delta.content === 'string' && delta.content.length > 0)
    || (typeof delta.reasoning === 'string' && delta.reasoning.length > 0)
    || (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0)
    || (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0)
    || !!choice.finish_reason;
}

const MISTRAL_ID = /^[A-Za-z0-9]{9}$/;
/** Mistral accepts only 9-character alphanumeric tool call IDs; map others to a stable one. */
export const mistralId = (id: string) => MISTRAL_ID.test(id) ? id : createHash('sha256').update(id).digest('hex').replace(/[^a-z0-9]/g, '').slice(0, 9);

/** The request as this provider accepts it. */
export function upstreamBody(request: ChatRequest, model: CatalogModel): Record<string, unknown> {
  const body: Record<string, unknown> = { ...request, model: model.model };
  const kind = model.provider.kind;
  // Agents ask for large answers (Claude Code: 32,000 tokens). Cap the request at what this model
  // allows, and at what is left of its context after the prompt, so it is not rejected outright.
  const asked = Number(request.max_completion_tokens ?? request.max_tokens) || undefined;
  if (asked) {
    const limit = Math.min(asked, model.maxOutputTokens ?? Infinity);
    const room = model.contextLength ? model.contextLength - promptTokens(request.messages) - toolTokens(request) - 256 : Infinity;
    // Never below the output the ranking reserved, which it already checked fits.
    const capped = Math.min(limit, Math.max(room, Math.min(RESERVED_OUTPUT, limit)));
    if (capped < asked) {
      if (request.max_completion_tokens !== undefined) body.max_completion_tokens = capped;
      if (request.max_tokens !== undefined) body.max_tokens = capped;
    }
  }
  if (kind === 'groq' && body.max_tokens !== undefined && body.max_completion_tokens === undefined) {
    body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
  }
  if (kind === 'mistral') {
    delete body.stream_options;
    delete body.parallel_tool_calls;
    body.messages = request.messages.map((message: ChatMessage) => ({
      ...message,
      ...(message.tool_calls ? { tool_calls: message.tool_calls.map(call => ({ ...call, id: mistralId(call.id) })) } : {}),
      ...(message.tool_call_id ? { tool_call_id: mistralId(message.tool_call_id) } : {}),
    }));
  }
  if (!request.tools?.length) { delete body.tools; delete body.tool_choice; delete body.parallel_tool_calls; }
  return body;
}

/** Tool definitions count toward the prompt; agents send many (Claude Code sends about twenty). */
const toolTokens = (request: ChatRequest) => request.tools?.length ? Math.ceil(JSON.stringify(request.tools).length / 4) : 0;

/** Which models to try, in order, and why. */
export function candidates(request: ChatRequest, deps: RouteDeps, session?: string): { list: Ranked[]; ranking?: Ranking; sticky?: string; auto: boolean } {
  const name = String(request.model ?? '');
  const models = deps.catalog.models();
  const exact = deps.catalog.find(name) ?? (() => {
    // A bare model ID is accepted when exactly one provider has it.
    const matches = models.filter(m => m.model === name);
    return matches.length === 1 ? matches[0] : undefined;
  })();
  if (exact && !AUTO_MODELS.has(name)) return { list: [{ model: exact, score: 0, why: ['requested by name'] }], auto: false };
  if (!AUTO_MODELS.has(name) && !deps.config.routeUnknownModels) {
    throw new RouteError(404, `No free model named "${name}". Use ${AUTO_MODEL}, or a name from GET /v1/models.`, [], undefined, 'model_not_found');
  }
  const maxTokens = Number(request.max_completion_tokens ?? request.max_tokens) || undefined;
  const task = profileTask(request.messages, !!request.tools?.length, maxTokens, toolTokens(request));
  const ranking = rank(models, task, deps.health);
  const key = sessionKey(request.messages, session);
  const stuck = deps.sessions.get(key);
  const index = stuck ? ranking.ranked.findIndex(r => r.model.ref === stuck) : -1;
  const list = index > 0
    ? [{ ...ranking.ranked[index], why: ['same model as earlier in this conversation', ...ranking.ranked[index].why] }, ...ranking.ranked.filter((_, i) => i !== index)]
    : ranking.ranked;
  return { list, ranking, sticky: key, auto: true };
}

function seconds(ms: number) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
}

function exhausted(ranking: Ranking | undefined, attempts: AttemptRecord[], last: Failure | undefined, now: number): RouteError {
  const reasons = Object.entries(ranking?.excluded ?? {}).map(([reason, count]) => `${count} ${reason}`);
  const wait = ranking?.nextAvailableAt !== undefined ? ranking.nextAvailableAt - now : last?.retryAfterMs;
  const tried = attempts.length;
  const message = [
    tried ? `${tried} free model${tried === 1 ? '' : 's'} failed${last ? ` (last: ${last.message})` : ''}.` : 'No free model can take this request.',
    reasons.length ? `Left out: ${reasons.join(', ')}.` : '',
    wait !== undefined ? `The next one is available in ${seconds(wait)}.` : '',
  ].filter(Boolean).join(' ');
  const quota = last?.category === 'quota' || (!tried && wait !== undefined);
  return new RouteError(quota ? 429 : 503, message, attempts, wait !== undefined ? Math.max(0, wait) : undefined, quota ? 'rate_limited' : 'no_free_model');
}

const NON_STREAM_TIMEOUT_MS = 5 * 60_000;

/**
 * Send the request to the best model, and to the next when one fails before it starts answering.
 * Once a model has sent any output, the response is that model's: a partial answer is never
 * continued by a different model, and a refusal is never retried elsewhere.
 */
export async function route(request: ChatRequest, deps: RouteDeps, options: { signal: AbortSignal; session?: string }): Promise<Routed> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const { list, ranking, sticky, auto } = candidates(request, deps, options.session);
  const attempts: AttemptRecord[] = [];
  const blocked = new Set<string>();
  let last: Failure | undefined;

  for (const entry of list) {
    if (attempts.length >= deps.config.maxAttempts) break;
    const { model } = entry;
    const account = accountOf(model.provider);
    if (blocked.has(account)) continue;

    const controller = new AbortController();
    const abort = () => controller.abort(options.signal.reason);
    options.signal.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(new DOMException('No output in time', 'TimeoutError')); },
      request.stream ? deps.config.firstOutputTimeoutMs : NON_STREAM_TIMEOUT_MS);
    const cleanup = () => { clearTimeout(timer); options.signal.removeEventListener('abort', abort); };
    const sentAt = Date.now();

    try {
      const response = await fetchImpl(`${model.provider.chatURL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...model.provider.headers, ...(model.provider.kind === 'openrouter' ? { 'X-Title': 'free-router' } : {}) },
        body: JSON.stringify(upstreamBody(request, model)),
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) throw new UpstreamError(failureFromStatus(response.status, await response.text().catch(() => ''), model.provider, response.headers));

      if (!request.stream) {
        const body = await response.json().catch(() => undefined) as any;
        if (body?.error) throw new UpstreamError(failureFromRecord(body, model.provider));
        if (!Array.isArray(body?.choices) || !body.choices.length) throw new UpstreamError({ category: 'transport', message: 'The model returned no answer.' });
        cleanup();
        deps.health.success(account, model.model, Date.now() - sentAt);
        if (auto && sticky) deps.sessions.set(sticky, model.ref);
        attempts.push({ ref: model.ref, ok: true });
        return { kind: 'json', model, attempts, why: entry.why, body };
      }

      if (!response.body) throw new UpstreamError({ category: 'transport', message: 'The model returned an empty stream.' });
      const records = readSSE(response.body);
      const buffered: SSERecord[] = [];
      // Hold records until the model shows output; until then another model can still take over.
      while (true) {
        const next = await records.next();
        if (next.done || next.value.done) throw new UpstreamError({ category: 'transport', message: 'The stream ended before the model answered.' });
        const record = next.value;
        if (record.json?.error) throw new UpstreamError(failureFromRecord(record.json, model.provider));
        buffered.push(record);
        if (hasOutput(record)) break;
      }
      clearTimeout(timer);
      deps.health.success(account, model.model, Date.now() - sentAt);
      if (auto && sticky) deps.sessions.set(sticky, model.ref);
      attempts.push({ ref: model.ref, ok: true });
      const stream = async function* (): AsyncGenerator<SSERecord> {
        try {
          yield* buffered;
          yield* records;
        } finally {
          cleanup();
        }
      };
      return { kind: 'stream', model, attempts, why: entry.why, records: stream(), close: () => { cleanup(); controller.abort(); } };
    } catch (error) {
      cleanup();
      if (options.signal.aborted) throw error;
      const failure = error instanceof UpstreamError ? error.failure
        : timedOut ? { category: 'timeout' as const, message: `${model.ref} sent nothing for ${Math.round(deps.config.firstOutputTimeoutMs / 1000)} s.` }
          : failureFromThrown(error, model.provider);
      deps.health.failure(account, model.model, failure);
      attempts.push({ ref: model.ref, ok: false, reason: failure.message });
      last = failure;
      if (failure.scope === 'account') blocked.add(account);
      if (!FALLBACK.has(failure.category) || !auto) {
        throw new RouteError(failure.status && failure.status < 500 ? failure.status : 502, failure.message, attempts, failure.retryAfterMs, failure.category === 'refused' ? 'refused' : 'upstream_error');
      }
    }
  }
  throw exhausted(ranking, attempts, last, deps.health.now());
}
