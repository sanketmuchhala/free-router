/** Providers the router can reach. Every one of them serves OpenAI-style chat completions. */
export type ProviderKind =
  | 'openrouter' | 'groq' | 'cerebras' | 'gemini' | 'mistral' | 'sambanova' | 'huggingface'
  | 'ollama' | 'openai-compatible';

/**
 * Whether the account behind a provider can be charged. Many providers are free only while no
 * payment method is on file, which their APIs do not report, so the user says so here.
 */
export type Billing = 'none' | 'paid' | 'unknown';

export interface ProviderConfig {
  /** Short name used in model IDs ("groq/llama-3.3-70b-versatile"). Letters, digits, - and _. */
  id: string;
  kind: ProviderKind;
  apiKey?: string;
  /** Required for ollama and openai-compatible; optional override for hosted kinds. */
  baseURL?: string;
  billing?: Billing;
  /** Skip this provider without removing it. */
  disabled?: boolean;
}

export interface RouterConfig {
  host: string;
  port: number;
  providers: ProviderConfig[];
  /** Model names the router does not know (such as "claude-sonnet-4") are routed like free-router/auto. */
  routeUnknownModels: boolean;
  /** Models tried per request before giving up. */
  maxAttempts: number;
  /** A model that sends nothing for this long is treated as failed and the next one is tried. */
  firstOutputTimeoutMs: number;
  /** How often provider catalogs are listed again. */
  refreshMinutes: number;
}

/** A provider after its address and credentials were resolved. */
export interface Provider {
  id: string;
  kind: ProviderKind;
  /** Base URL for chat completions (…/v1 or the provider's OpenAI-compatible path). */
  chatURL: string;
  /** Where the model list is read from, when it differs from chatURL. */
  catalogURL: string;
  apiKey?: string;
  billing: Billing;
  local: boolean;
  headers: Record<string, string>;
}

export type PriceClass = 'local' | 'zero-price' | 'no-billing' | 'paid' | 'unknown';

export interface CatalogModel {
  provider: Provider;
  /** The provider's own model ID. */
  model: string;
  /** "provider/model", the name clients use to ask for this model. */
  ref: string;
  contextLength?: number;
  /** The most output tokens the provider allows in one answer, when it says. */
  maxOutputTokens?: number;
  capabilities: { tools: boolean | null; vision: boolean | null };
  price: PriceClass;
}

export type TaskKind = 'code' | 'math' | 'reasoning' | 'writing' | 'extraction' | 'general';

export interface TaskProfile {
  kind: TaskKind;
  vision: boolean;
  tools: boolean;
  /** Prompt plus the reserved answer, estimated at four characters per token. */
  estimatedTokens: number;
}

export type FailureCategory = 'quota' | 'unavailable' | 'transport' | 'timeout' | 'invalid-request' | 'context' | 'auth' | 'refused' | 'unknown';

export interface Failure {
  category: FailureCategory;
  message: string;
  retryAfterMs?: number;
  /** The whole account is affected (a bad key, an account-wide limit), not just this model. */
  scope?: 'account';
  status?: number;
}

/** OpenAI chat completion request, as far as the router reads it. Everything else passes through. */
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  tools?: unknown[];
  max_tokens?: number;
  max_completion_tokens?: number;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  content?: string | ContentPart[] | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
  [key: string]: unknown;
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: string; [key: string]: unknown };
