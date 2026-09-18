import { LABEL, redact } from './index.js';
import type { CatalogModel, PriceClass, Provider } from '../core/types.js';

type FetchFn = typeof fetch;

const TIMEOUT_MS = 10_000;
// Groq also lists speech models.
const NON_CHAT = /(whisper|tts|orpheus|embed|guard|moderation|rerank|transcribe)/i;

export interface ProviderStatus {
  id: string;
  kind: Provider['kind'];
  ok: boolean;
  /** Models listed, and how many of them are free. */
  listed: number;
  free: number;
  error?: string;
  checkedAt: number;
}

async function getJSON(fetchImpl: FetchFn, url: string, provider: Provider): Promise<any> {
  const response = await fetchImpl(url, { headers: provider.headers, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(response.status === 401 || response.status === 403 ? `${LABEL[provider.kind]} rejected the API key.` : `${LABEL[provider.kind]} returned ${response.status}: ${redact(body, provider.apiKey).slice(0, 200)}`);
  }
  return response.json();
}

const perToken = (value: unknown) => {
  const n = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** USD per token as `prompt` / `completion` (OpenRouter, SambaNova). Missing or negative prices are unknown. */
export function priceOf(prices: any): 'zero-price' | 'paid' | 'unknown' {
  const input = perToken(prices?.prompt);
  const output = perToken(prices?.completion);
  const request = Number(prices?.request || 0);
  if (input === undefined || output === undefined || input < 0 || output < 0 || request < 0) return 'unknown';
  return input === 0 && output === 0 && request === 0 ? 'zero-price' : 'paid';
}

/** Whether a model can run without charges. Unknown is never treated as free. */
export function isFree(provider: Provider, price: PriceClass): boolean {
  if (price === 'paid') return false;
  return provider.local || price === 'zero-price' || price === 'local' || provider.billing === 'none';
}

const imageInput = (m: any): boolean | null => Array.isArray(m?.architecture?.input_modalities) ? m.architecture.input_modalities.includes('image') : null;

type Listed = Omit<CatalogModel, 'provider' | 'ref'>;

async function listOpenRouter(provider: Provider, fetchImpl: FetchFn): Promise<Listed[]> {
  const data = await getJSON(fetchImpl, `${provider.catalogURL}/models`, provider);
  const now = Date.now();
  const models: Listed[] = (Array.isArray(data?.data) ? data.data : [])
    .filter((m: any) => typeof m?.id === 'string'
      && (!Array.isArray(m.architecture?.output_modalities) || m.architecture.output_modalities.includes('text'))
      && !(m.expiration_date && Date.parse(m.expiration_date) <= now))
    .map((m: any): Listed => ({
      model: m.id,
      contextLength: Number(m.context_length) || undefined,
      maxOutputTokens: Number(m.top_provider?.max_completion_tokens) || undefined,
      capabilities: {
        tools: Array.isArray(m.supported_parameters) ? m.supported_parameters.includes('tools') : null,
        vision: imageInput(m),
      },
      // OpenRouter documents openrouter/free as an always-$0 router.
      price: m.id === 'openrouter/free' ? 'zero-price' : priceOf(m.pricing),
    }));
  if (!models.some(m => m.model === 'openrouter/free')) models.push({ model: 'openrouter/free', capabilities: { tools: null, vision: null }, price: 'zero-price' });
  return models;
}

async function listOpenAIStyle(provider: Provider, fetchImpl: FetchFn): Promise<Listed[]> {
  const data = await getJSON(fetchImpl, `${provider.catalogURL}/models`, provider);
  if (!Array.isArray(data?.data)) throw new Error(`${LABEL[provider.kind]} did not return a model list.`);
  return data.data
    .filter((m: any) => typeof m?.id === 'string' && m.active !== false && m.archived !== true && m.capabilities?.completion_chat !== false && !NON_CHAT.test(m.id))
    .map((m: any): Listed => ({
      model: m.id,
      contextLength: Number(m.context_length ?? m.context_window ?? m.max_context_length) || undefined,
      maxOutputTokens: Number(m.max_completion_tokens ?? m.max_output_tokens) || undefined,
      capabilities: {
        tools: typeof m.capabilities?.function_calling === 'boolean' ? m.capabilities.function_calling : null,
        vision: typeof m.capabilities?.vision === 'boolean' ? m.capabilities.vision : imageInput(m),
      },
      price: provider.local ? 'local' : m.pricing ? priceOf(m.pricing) : 'unknown',
    }));
}

/** Hugging Face lists models with their providers; a provider marked free is its own "model:provider" entry at $0. */
async function listHuggingFace(provider: Provider, fetchImpl: FetchFn): Promise<Listed[]> {
  const data = await getJSON(fetchImpl, `${provider.catalogURL}/models`, provider);
  return (Array.isArray(data?.data) ? data.data : []).flatMap((m: any): Listed[] => {
    if (typeof m?.id !== 'string') return [];
    const live = (Array.isArray(m.providers) ? m.providers : []).filter((p: any) => p?.status === 'live' && typeof p.provider === 'string');
    const entry = (model: string, providers: any[], price: PriceClass): Listed => ({
      model,
      contextLength: Math.max(0, ...providers.map(p => Number(p.context_length) || 0)) || undefined,
      capabilities: { tools: providers.some(p => p.supports_tools === true) ? true : providers.every(p => p.supports_tools === false) ? false : null, vision: imageInput(m) },
      price,
    });
    return [entry(m.id, live, 'unknown'), ...live.filter((p: any) => p.is_free === true).map((p: any) => entry(`${m.id}:${p.provider}`, [p], 'zero-price'))];
  });
}

async function listGemini(provider: Provider, fetchImpl: FetchFn): Promise<Listed[]> {
  const data = await getJSON(fetchImpl, `${provider.catalogURL}/models?pageSize=1000`, provider);
  return (Array.isArray(data?.models) ? data.models : [])
    .filter((m: any) => m?.supportedGenerationMethods?.includes('generateContent') && !NON_CHAT.test(m.name))
    .map((m: any): Listed => ({
      model: String(m.name).replace(/^models\//, ''),
      contextLength: Number(m.inputTokenLimit) || undefined,
      maxOutputTokens: Number(m.outputTokenLimit) || undefined,
      capabilities: { tools: null, vision: null },
      price: 'unknown',
    }));
}

async function listOllama(provider: Provider, fetchImpl: FetchFn): Promise<Listed[]> {
  const tags = await getJSON(fetchImpl, `${provider.catalogURL}/api/tags`, provider);
  const models = Array.isArray(tags?.models) ? tags.models : [];
  return Promise.all(models.map(async (m: any): Promise<Listed> => {
    const id: string = m.name || m.model;
    const show = await fetchImpl(`${provider.catalogURL}/api/show`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: id }), signal: AbortSignal.timeout(4000),
    }).then(r => r.ok ? r.json() : null).catch(() => null) as any;
    const caps: string[] | undefined = Array.isArray(show?.capabilities) ? show.capabilities : undefined;
    const contextKey = show?.model_info && Object.keys(show.model_info).find(k => k.endsWith('.context_length'));
    return {
      model: id,
      contextLength: contextKey ? Number(show.model_info[contextKey]) || undefined : undefined,
      capabilities: { tools: caps ? caps.includes('tools') : null, vision: caps ? caps.includes('vision') : null },
      price: 'local',
    };
  }));
}

export function listModels(provider: Provider, fetchImpl: FetchFn = fetch): Promise<Listed[]> {
  switch (provider.kind) {
    case 'openrouter': return listOpenRouter(provider, fetchImpl);
    case 'huggingface': return listHuggingFace(provider, fetchImpl);
    case 'gemini': return listGemini(provider, fetchImpl);
    case 'ollama': return listOllama(provider, fetchImpl);
    default: return listOpenAIStyle(provider, fetchImpl);
  }
}

/** The free models across every provider, refreshed on a timer. A provider that fails keeps its last good list. */
export class Catalog {
  private byProvider = new Map<string, CatalogModel[]>();
  private status = new Map<string, ProviderStatus>();

  constructor(readonly providers: Provider[], private fetchImpl: FetchFn = fetch) {}

  async refresh(): Promise<ProviderStatus[]> {
    await Promise.all(this.providers.map(async provider => {
      try {
        const listed = await listModels(provider, this.fetchImpl);
        const free = listed.filter(m => isFree(provider, m.price)).map(m => ({ ...m, provider, ref: `${provider.id}/${m.model}` }));
        this.byProvider.set(provider.id, free);
        this.status.set(provider.id, { id: provider.id, kind: provider.kind, ok: true, listed: listed.length, free: free.length, checkedAt: Date.now() });
      } catch (error) {
        const previous = this.status.get(provider.id);
        this.status.set(provider.id, {
          id: provider.id, kind: provider.kind, ok: false, listed: previous?.listed ?? 0, free: this.byProvider.get(provider.id)?.length ?? 0,
          error: redact((error as Error).message || 'Listing models failed.', provider.apiKey).slice(0, 300), checkedAt: Date.now(),
        });
      }
    }));
    return this.statuses();
  }

  models(): CatalogModel[] {
    return [...this.byProvider.values()].flat().sort((a, b) => a.ref.localeCompare(b.ref));
  }

  find(ref: string): CatalogModel | undefined {
    return this.models().find(m => m.ref === ref);
  }

  statuses(): ProviderStatus[] {
    return this.providers.map(p => this.status.get(p.id) ?? { id: p.id, kind: p.kind, ok: false, listed: 0, free: 0, error: 'Not listed yet.', checkedAt: 0 });
  }
}
