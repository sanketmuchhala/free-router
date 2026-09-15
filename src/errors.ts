import { LABEL, redact } from './providers.js';
import type { Failure, FailureCategory, Provider } from './types.js';

/** A request to one model failed. `failure` is safe to show: keys are removed and text is capped. */
export class UpstreamError extends Error {
  constructor(readonly failure: Failure) { super(failure.message); }
}

/**
 * Failures that happen before a model answers and may not happen on another model, so the next
 * model is tried. A refusal is the model's decision and is never routed around.
 */
export const FALLBACK = new Set<FailureCategory>(['quota', 'unavailable', 'transport', 'timeout', 'invalid-request', 'context', 'auth']);

function retryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** Wait time from Retry-After, or from an epoch reset time (OpenRouter's X-RateLimit-Reset). */
export function retryAfterFrom(headers: Headers | undefined): number | undefined {
  const explicit = retryAfter(headers?.get('retry-after'));
  if (explicit !== undefined) return explicit;
  const reset = Number(headers?.get('x-ratelimit-reset'));
  if (!Number.isFinite(reset) || reset <= 0) return undefined;
  const resetMs = reset > 1e12 ? reset : reset > 1e9 ? reset * 1000 : undefined;
  return resetMs === undefined ? undefined : Math.max(0, resetMs - Date.now());
}

/** OpenRouter's free-model limit counts every free model on the account. */
const ACCOUNT_LIMIT = /free-models-per-(?:minute|day)|free[- ]models?.*(?:rate|request).*limit/i;

/** The provider's own error text from a JSON or plain body. */
export function providerMessage(body: string): string {
  try {
    const data = JSON.parse(body);
    const error = Array.isArray(data) ? data[0]?.error : data.error;
    if (typeof error === 'string') return error;
    const raw = error?.metadata?.raw;
    const upstream = error?.metadata?.provider_name;
    if (typeof raw === 'string') return typeof upstream === 'string' ? `${upstream}: ${raw}` : raw;
    if (typeof error?.message === 'string') return error.message;
  } catch { /* not JSON */ }
  return body;
}

/** Map an HTTP failure to a categorized, safe failure. */
export function failureFromStatus(status: number, body: string, provider: Provider, headers?: Headers): Failure {
  const label = LABEL[provider.kind];
  const text = redact(providerMessage(body), provider.apiKey).replace(/\s+/g, ' ').trim().slice(0, 300);
  const wait = status === 429 || status >= 500 ? retryAfterFrom(headers) : undefined;
  const make = (category: FailureCategory, message: string, account = false): Failure =>
    ({ category, message, status, ...(wait !== undefined ? { retryAfterMs: wait } : {}), ...(account ? { scope: 'account' as const } : {}) });
  const detail = text ? `: ${text}` : '.';
  if (status === 401 || status === 403) return make('auth', `${label} rejected the API key.`, true);
  if (status === 402) return make('quota', `${label} reports insufficient credits${detail}`, true);
  if (status === 429) return make('quota', `${label} is rate limiting requests${detail}`, ACCOUNT_LIMIT.test(text));
  if (status === 404) return make('invalid-request', `${label} could not find this model${detail}`);
  if (status === 400 || status === 413 || status === 422) {
    const context = /context|too long|too many tokens|maximum.*tokens|token limit|prompt is too long/i.test(text);
    return make(context ? 'context' : 'invalid-request', `${label} rejected the request${detail}`);
  }
  if (status >= 500) return make('unavailable', `${label} is unavailable (${status})${detail}`);
  return make('unknown', `${label} returned ${status}${detail}`);
}

/** An error object sent inside an otherwise successful stream (OpenRouter does this). */
export function failureFromRecord(record: any, provider: Provider): Failure {
  const code = Number(record?.error?.code);
  const message = providerMessage(JSON.stringify(record));
  return Number.isInteger(code) && code >= 400
    ? failureFromStatus(code, JSON.stringify(record), provider)
    : { category: 'unavailable', message: `${LABEL[provider.kind]} reported an error: ${redact(message, provider.apiKey).slice(0, 300)}` };
}

/** A network or timeout error from fetch. */
export function failureFromThrown(error: unknown, provider: Provider): Failure {
  const name = (error as Error)?.name;
  if (name === 'TimeoutError') return { category: 'timeout', message: `${LABEL[provider.kind]} did not respond in time.` };
  if (error instanceof TypeError) return { category: 'transport', message: provider.local ? `Nothing is answering at ${provider.chatURL}.` : `Unable to reach ${LABEL[provider.kind]}.` };
  return { category: 'unknown', message: redact((error as Error)?.message || 'The request failed.', provider.apiKey).slice(0, 300) };
}
