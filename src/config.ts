import { existsSync, mkdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { ConfigError, ENV_KEYS, PROVIDER_KINDS, resolveProvider } from './providers.js';
import type { Provider, ProviderConfig, ProviderKind, RouterConfig } from './types.js';

export const DEFAULTS = {
  host: '127.0.0.1',
  port: 4141,
  routeUnknownModels: true,
  maxAttempts: 4,
  firstOutputTimeoutMs: 120_000,
  refreshMinutes: 30,
} as const;

/** Where keys and the config file live: FREE_ROUTER_HOME, or ~/.free-router. */
export function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.FREE_ROUTER_HOME || join(homedir(), '.free-router');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** "env:NAME" reads the key from the environment, so config files need not hold secrets. */
function secret(value: unknown, env: NodeJS.ProcessEnv, where: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ConfigError(`${where}: apiKey must be text.`);
  if (value.startsWith('env:')) {
    const name = value.slice(4);
    const found = env[name];
    if (!found) throw new ConfigError(`${where}: the environment variable ${name} is not set.`);
    return found;
  }
  return value;
}

/** Providers from environment variables, when there is no config file. */
export function providersFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderConfig[] {
  const noBilling = new Set((env.FREE_ROUTER_NO_BILLING ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
  const providers: ProviderConfig[] = ENV_KEYS.filter(([name]) => env[name]).map(([name, kind]) => ({
    id: kind, kind, apiKey: env[name], billing: noBilling.has(kind) ? 'none' : 'unknown',
  }));
  if (env.FREE_ROUTER_LOCAL !== '0') {
    providers.push({ id: 'ollama', kind: 'ollama', baseURL: env.OLLAMA_HOST?.startsWith('http') ? env.OLLAMA_HOST : 'http://127.0.0.1:11434' });
    providers.push({ id: 'lmstudio', kind: 'openai-compatible', baseURL: 'http://127.0.0.1:1234/v1' });
  }
  return providers;
}

export interface LoadedConfig {
  config: RouterConfig;
  providers: Provider[];
  /** The file read, or undefined when the environment was used. */
  source?: string;
}

const int = (value: unknown, fallback: number, min: number, max: number, name: string) => {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new ConfigError(`${name} must be a whole number from ${min} to ${max}.`);
  return value as number;
};

export function loadConfig(options: { path?: string; env?: NodeJS.ProcessEnv } = {}): LoadedConfig {
  const env = options.env ?? process.env;
  const path = options.path ?? (env.FREE_ROUTER_CONFIG || join(homeDir(env), 'config.json'));
  let raw: any = {};
  let source: string | undefined;
  if (existsSync(path)) {
    try { raw = JSON.parse(readFileSync(path, 'utf8')); }
    catch (error) { throw new ConfigError(`${path} is not valid JSON: ${(error as Error).message}`); }
    source = path;
  } else if (options.path) {
    throw new ConfigError(`No config file at ${path}.`);
  }
  const listed: ProviderConfig[] = source ? raw.providers ?? [] : providersFromEnv(env);
  if (!Array.isArray(listed)) throw new ConfigError('providers must be a list.');
  const seen = new Set<string>();
  const providers = listed.filter(p => !p?.disabled).map((p, i) => {
    const where = `providers[${i}]${p?.id ? ` (${p.id})` : ''}`;
    if (!p || typeof p !== 'object') throw new ConfigError(`${where} must be an object.`);
    const kind = p.kind as ProviderKind;
    if (!PROVIDER_KINDS.includes(kind)) throw new ConfigError(`${where}: kind must be one of ${PROVIDER_KINDS.join(', ')}.`);
    const id = p.id ?? kind;
    if (seen.has(id)) throw new ConfigError(`${where}: the ID "${id}" is used twice.`);
    seen.add(id);
    if (p.billing !== undefined && !['none', 'paid', 'unknown'].includes(p.billing)) throw new ConfigError(`${where}: billing must be none, paid, or unknown.`);
    return resolveProvider({ ...p, id, kind, apiKey: secret(p.apiKey, env, where) });
  });
  const config: RouterConfig = {
    host: typeof raw.host === 'string' ? raw.host : env.FREE_ROUTER_HOST || DEFAULTS.host,
    port: int(raw.port ?? (env.FREE_ROUTER_PORT ? Number(env.FREE_ROUTER_PORT) : undefined), DEFAULTS.port, 1, 65535, 'port'),
    providers: listed,
    routeUnknownModels: raw.routeUnknownModels ?? DEFAULTS.routeUnknownModels,
    maxAttempts: int(raw.maxAttempts, DEFAULTS.maxAttempts, 1, 10, 'maxAttempts'),
    firstOutputTimeoutMs: int(raw.firstOutputTimeoutMs, DEFAULTS.firstOutputTimeoutMs, 5_000, 600_000, 'firstOutputTimeoutMs'),
    refreshMinutes: int(raw.refreshMinutes, DEFAULTS.refreshMinutes, 1, 1440, 'refreshMinutes'),
  };
  return { config, providers, ...(source ? { source } : {}) };
}
