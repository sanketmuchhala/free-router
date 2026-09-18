import { createHash } from 'crypto';
import type { CatalogModel, ChatMessage, Failure, FailureCategory, Provider, TaskKind, TaskProfile } from '../core/types.js';

// ---------------------------------------------------------------------------
// What a request needs

const CODE = /```|\b(function|class|def|const|compile[sd]?|stack ?trace|exception|bug|debug|refactor|regex|sql|typescript|javascript|python|rust|golang|java|c\+\+|html|css|endpoint|unit tests?|script|snippet|code)\b/i;
// A minus sign counts only with spaces ("12 - 7"), so dates and IDs ("2026-09-14") are not math.
const MATH = /\b(solve|equation|integral|derivative|probability|prove|proof|theorem|calculate|compute|percent(age)?|matrix|algebra|geometry|arithmetic)\b|\d\s*[+*/^×÷=]\s*\d|\d\s+-\s+\d|\d\s*%\s*of\b/i;
const EXTRACTION = /\b(json|yaml|csv|table|extract|parse|classify|categori[sz]e|schema|fill in|bullet list)\b/i;
const WRITING = /\b(write|draft|rewrite|rephrase|proofread|essay|e-?mail|letter|story|poem|blog|tweet|summar(y|i[sz]e)|translate|tone|cover letter)\b/i;
const REASONING = /\b(why|explain|reason(ing)?|compare|trade-?offs?|pros and cons|step by step|analy[sz]e|plan|design|puzzle|riddle|logic)\b/i;

export const textOf = (content: ChatMessage['content']): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part.type === 'text' ? String((part as { text?: unknown }).text ?? '') : '').join('\n') : '';

export function classify(text: string): TaskKind {
  return CODE.test(text) ? 'code' : MATH.test(text) ? 'math' : EXTRACTION.test(text) ? 'extraction' : WRITING.test(text) ? 'writing' : REASONING.test(text) ? 'reasoning' : 'general';
}

/** Output reserved when checking whether a request fits a model. Larger requests are capped per model before sending. */
export const RESERVED_OUTPUT = 4096;

/** The prompt's size in tokens, estimated at four characters per token plus 1,000 per image. */
export function promptTokens(messages: ChatMessage[]): number {
  let characters = 0;
  let images = 0;
  for (const message of messages) {
    characters += textOf(message.content).length;
    for (const call of message.tool_calls ?? []) characters += call.function.arguments.length;
    if (Array.isArray(message.content)) images += message.content.filter(part => part.type === 'image_url').length;
  }
  return Math.ceil(characters / 4) + images * 1000;
}

/**
 * What the request needs from a model. With tools, the request comes from an agent: it is treated
 * as code work, because agents' tool loops (reading files, editing, running commands) are code work
 * whatever the latest message says.
 */
export function profileTask(messages: ChatMessage[], tools: boolean, maxTokens = RESERVED_OUTPUT, toolTokens = 0): TaskProfile {
  const last = [...messages].reverse().find(m => m.role === 'user');
  return {
    kind: tools ? 'code' : classify(last ? textOf(last.content) : ''),
    vision: messages.some(m => Array.isArray(m.content) && m.content.some(part => part.type === 'image_url')),
    tools,
    estimatedTokens: promptTokens(messages) + toolTokens + Math.min(maxTokens, RESERVED_OUTPUT),
  };
}

/** Total parameters in billions from a model ID ("llama-3.3-70b", "mixtral-8x7b"). "a12b" is an active count and is ignored. */
export function parameterBillions(id: string): number | undefined {
  const name = id.toLowerCase();
  const experts = /(\d+)x(\d+(?:\.\d+)?)b\b/.exec(name);
  if (experts) return Number(experts[1]) * Number(experts[2]);
  const sizes = [...name.matchAll(/(?<![a-z0-9.])(\d+(?:\.\d+)?)b\b/g)].map(m => Number(m[1])).filter(n => n > 0 && n < 5000);
  return sizes.length ? Math.max(...sizes) : undefined;
}

/** Routers that pick a model themselves; kept last because their choice cannot be ranked. */
export const isMetaRouter = (model: string) => /^openrouter\/(free|auto)$/.test(model);

// ---------------------------------------------------------------------------
// Health: what recent requests showed about each model and account. In memory, per process.

interface ModelHealth {
  successes: number;
  failures: number;
  /** Exponentially weighted time to first output. */
  ttftMs?: number;
  cooldownUntil?: number;
  lastFailureAt?: number;
}

const MAX_TRACKED = 2000;
const COOLDOWN: Partial<Record<FailureCategory, number>> = { quota: 60_000, unavailable: 30_000, transport: 20_000, timeout: 30_000, auth: 10 * 60_000 };
const MAX_COOLDOWN_MS = 24 * 60 * 60_000;

/** An account is its provider, address, and key, so changing a key starts fresh. Keys are hashed, never kept. */
export function accountOf(provider: Provider): string {
  return createHash('sha256').update(`${provider.kind}\n${provider.chatURL}\n${provider.apiKey ?? ''}`).digest('hex').slice(0, 24);
}

export class Health {
  private models = new Map<string, ModelHealth>();
  private accounts = new Map<string, number>();

  constructor(readonly now: () => number = Date.now) {}

  private entry(account: string, model: string): ModelHealth {
    const key = `${account}\n${model}`;
    let entry = this.models.get(key);
    if (!entry) {
      if (this.models.size >= MAX_TRACKED) this.models.delete(this.models.keys().next().value!);
      entry = { successes: 0, failures: 0 };
      this.models.set(key, entry);
    }
    return entry;
  }

  peek(account: string, model: string): Readonly<ModelHealth> | undefined {
    return this.models.get(`${account}\n${model}`);
  }

  /** When this model can be tried again, or undefined when it can be tried now. */
  coolingUntil(account: string, model: string): number | undefined {
    const until = Math.max(this.accounts.get(account) ?? 0, this.peek(account, model)?.cooldownUntil ?? 0);
    return until > this.now() ? until : undefined;
  }

  success(account: string, model: string, ttftMs?: number) {
    const entry = this.entry(account, model);
    entry.successes++;
    entry.cooldownUntil = undefined;
    if (ttftMs !== undefined) entry.ttftMs = entry.ttftMs === undefined ? ttftMs : Math.round(entry.ttftMs * 0.7 + ttftMs * 0.3);
  }

  failure(account: string, model: string, failure: Failure) {
    const entry = this.entry(account, model);
    const now = this.now();
    entry.failures++;
    entry.lastFailureAt = now;
    const base = COOLDOWN[failure.category];
    if (base === undefined) return;
    const until = now + Math.min(Math.max(failure.retryAfterMs ?? base, 1000), MAX_COOLDOWN_MS);
    if (failure.scope === 'account') this.accounts.set(account, until);
    else entry.cooldownUntil = until;
  }
}

// ---------------------------------------------------------------------------
// Ranking

export interface Ranked {
  model: CatalogModel;
  score: number;
  /** Short phrases explaining the choice. */
  why: string[];
}

export interface Ranking {
  ranked: Ranked[];
  /** Why models were left out, by reason. */
  excluded: Record<string, number>;
  /** Soonest time a cooling-down model becomes available. */
  nextAvailableAt?: number;
}

const CODE_MODEL = /coder|codestral|devstral|\bcode/i;
const REASONING_MODEL = /(^|[-/_.])r1\b|reason|think|qwq|magistral|math/i;

export function rank(models: CatalogModel[], task: TaskProfile, health: Health): Ranking {
  const excluded: Record<string, number> = {};
  const exclude = (reason: string) => { excluded[reason] = (excluded[reason] ?? 0) + 1; };
  let nextAvailableAt: number | undefined;
  const ranked: Ranked[] = [];

  for (const entry of models) {
    const { model, capabilities, contextLength, provider } = entry;
    if (task.vision && capabilities.vision === false) { exclude('cannot read images'); continue; }
    if (task.tools && capabilities.tools === false) { exclude('cannot use tools'); continue; }
    if (contextLength && task.estimatedTokens > contextLength) { exclude('context too small'); continue; }
    const account = accountOf(provider);
    const cooling = health.coolingUntil(account, model);
    if (cooling) { exclude('cooling down after a failure'); nextAvailableAt = Math.min(nextAvailableAt ?? cooling, cooling); continue; }

    const why: string[] = [];
    const size = parameterBillions(model);
    // Log scale: 1B → 0, 10B → 0.33, 100B → 0.67, 1T → 1. Unknown size is neutral.
    let score = size ? Math.min(1, Math.max(0, Math.log10(size) / 3)) : 0.5;
    if (size) why.push(`${size >= 10 ? Math.round(size) : size}B parameters`);

    const coder = CODE_MODEL.test(model);
    const reasoner = REASONING_MODEL.test(model);
    if (task.kind === 'code' && coder) { score += 0.25; why.push('coding model'); }
    if ((task.kind === 'math' || task.kind === 'reasoning') && reasoner) { score += 0.2; why.push('reasoning model'); }
    if ((task.kind === 'writing' || task.kind === 'general') && coder) score -= 0.15;
    if ((task.kind === 'writing' || task.kind === 'general' || task.kind === 'extraction') && reasoner) score -= 0.05;

    if (task.tools) {
      if (capabilities.tools === true) { score += 0.05; why.push('supports tools'); }
      else score -= 0.25;
    }
    if (task.vision) {
      if (capabilities.vision === true) why.push('reads images');
      else score -= 0.3;
    }
    if (!contextLength) score -= 0.05;
    else if (task.estimatedTokens > 16_000 && contextLength >= task.estimatedTokens * 4) { score += 0.1; why.push('large context'); }
    if (provider.local) { score -= 0.1; why.push('on this machine'); }

    const seen = health.peek(account, model);
    if (seen) {
      const total = seen.successes + seen.failures;
      if (total >= 2) {
        score += 0.25 * (seen.successes / total - 0.75);
        why.push(`answered ${seen.successes} of ${total} recent requests`);
      }
      if (seen.ttftMs !== undefined && seen.ttftMs > 8000) score -= 0.1;
      if (seen.lastFailureAt !== undefined && health.now() - seen.lastFailureAt < 120_000) score -= 0.1;
    }
    if (isMetaRouter(model)) { score -= 10; why.splice(0, why.length, "OpenRouter's own free router, as a last resort"); }
    ranked.push({ model: entry, score, why });
  }
  ranked.sort((a, b) => b.score - a.score || a.model.ref.localeCompare(b.model.ref));
  return { ranked, excluded, ...(nextAvailableAt !== undefined ? { nextAvailableAt } : {}) };
}

// ---------------------------------------------------------------------------
// Sessions: an agent's requests stay on one model while it keeps working.

export class Sessions {
  private map = new Map<string, { ref: string; at: number }>();
  constructor(private max = 2000, private ttlMs = 60 * 60_000, private now: () => number = Date.now) {}

  get(key: string): string | undefined {
    const entry = this.map.get(key);
    if (!entry || this.now() - entry.at > this.ttlMs) { this.map.delete(key); return undefined; }
    return entry.ref;
  }

  set(key: string, ref: string) {
    this.map.delete(key);
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value!);
    this.map.set(key, { ref, at: this.now() });
  }
}

/** A stable key for one conversation: the caller's session ID, or the system prompt and first user message. */
export function sessionKey(messages: ChatMessage[], explicit?: string): string {
  if (explicit) return `id:${explicit.slice(0, 200)}`;
  const system = messages.filter(m => m.role === 'system' || m.role === 'developer').map(m => textOf(m.content)).join('\n').slice(0, 4000);
  const first = textOf(messages.find(m => m.role === 'user')?.content).slice(0, 4000);
  return `h:${createHash('sha256').update(`${system}\n ${first}`).digest('hex').slice(0, 32)}`;
}
