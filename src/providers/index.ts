import type { Provider, ProviderConfig, ProviderKind } from '../core/types.js';

export const PROVIDER_KINDS: readonly ProviderKind[] = [
  'openrouter', 'groq', 'cerebras', 'gemini', 'mistral', 'sambanova', 'huggingface', 'ollama', 'openai-compatible',
];

/** Hosted providers' OpenAI-compatible endpoints. */
const HOSTED: Partial<Record<ProviderKind, string>> = {
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  // Gemini serves chat through its OpenAI-compatible path; its model list comes from the native API.
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  mistral: 'https://api.mistral.ai/v1',
  sambanova: 'https://api.sambanova.ai/v1',
  huggingface: 'https://router.huggingface.co/v1',
};

export const LABEL: Record<ProviderKind, string> = {
  openrouter: 'OpenRouter', groq: 'Groq', cerebras: 'Cerebras', gemini: 'Gemini', mistral: 'Mistral', sambanova: 'SambaNova',
  huggingface: 'Hugging Face', ollama: 'Ollama', 'openai-compatible': 'The endpoint',
};

/** Environment variables read when there is no config file, and the provider each one enables. */
export const ENV_KEYS: [string, ProviderKind][] = [
  ['OPENROUTER_API_KEY', 'openrouter'], ['GROQ_API_KEY', 'groq'], ['CEREBRAS_API_KEY', 'cerebras'], ['GEMINI_API_KEY', 'gemini'],
  ['MISTRAL_API_KEY', 'mistral'], ['SAMBANOVA_API_KEY', 'sambanova'], ['HF_TOKEN', 'huggingface'],
];

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']);
const ID = /^[A-Za-z0-9_-]{1,40}$/;

export class ConfigError extends Error {}

/** Resolve a configured provider: its URLs, whether it runs on this machine, and its auth headers. */
export function resolveProvider(config: ProviderConfig): Provider {
  if (!ID.test(config.id)) throw new ConfigError(`Provider ID "${config.id}" must be 1–40 letters, digits, - or _.`);
  if (!PROVIDER_KINDS.includes(config.kind)) throw new ConfigError(`Provider ${config.id}: unknown kind "${config.kind}". Use one of: ${PROVIDER_KINDS.join(', ')}.`);
  const hosted = HOSTED[config.kind];
  const raw = config.baseURL?.trim() || hosted;
  if (!raw) throw new ConfigError(`Provider ${config.id}: set baseURL (for example http://127.0.0.1:11434).`);
  let url: URL;
  try { url = new URL(raw); } catch { throw new ConfigError(`Provider ${config.id}: baseURL "${raw}" is not a full URL.`); }
  const loopback = LOOPBACK.has(url.hostname);
  if (!loopback && url.protocol !== 'https:') throw new ConfigError(`Provider ${config.id}: remote providers must use https.`);
  // A hosted kind pointed at this machine (a test double, a proxy) is still priced as that provider.
  const local = loopback && (config.kind === 'ollama' || config.kind === 'openai-compatible');
  if (hosted && !config.apiKey) throw new ConfigError(`Provider ${config.id}: ${LABEL[config.kind]} needs an API key.`);
  const base = url.toString().replace(/\/+$/, '');
  const apiKey = config.apiKey?.trim() || undefined;
  if (config.kind === 'ollama') {
    // Ollama lists models on its native API and serves chat on its OpenAI-compatible /v1.
    const root = base.replace(/\/(api|v1)$/, '');
    return { id: config.id, kind: 'ollama', chatURL: `${root}/v1`, catalogURL: root, billing: 'none', local, headers: {}, ...(apiKey ? { apiKey } : {}) };
  }
  const chatURL = hosted && !config.baseURL ? hosted : (/\/v\d+(beta)?(\/openai)?$|\/openai\/v1$/.test(base) ? base : `${base}/v1`);
  return {
    id: config.id, kind: config.kind, chatURL,
    catalogURL: config.kind === 'gemini' ? chatURL.replace(/\/openai$/, '') : chatURL,
    billing: local ? 'none' : config.billing ?? 'unknown',
    local,
    headers: apiKey ? (config.kind === 'gemini' ? { 'x-goog-api-key': apiKey, Authorization: `Bearer ${apiKey}` } : { Authorization: `Bearer ${apiKey}` }) : {},
    ...(apiKey ? { apiKey } : {}),
  };
}

/** Remove a key from text that may be shown or logged. */
export function redact(text: string, apiKey?: string): string {
  return apiKey ? text.split(apiKey).join('[redacted]') : text;
}
