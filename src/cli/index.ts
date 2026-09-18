#!/usr/bin/env node
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Catalog } from '../providers/catalog.js';
import { homeDir, loadConfig } from '../config/index.js';
import { KeyStore } from '../core/keys.js';
import { ConfigError } from '../providers/index.js';
import { Health, profileTask, rank, Sessions } from '../routing/rank.js';
import { createServer } from '../gateway/server.js';

const HELP = `ONE ROUTER: Inference, intelligently routed.

Usage:
  onerouter serve [--port N] [--host H] [--config FILE]   Start the router
  onerouter models [--config FILE]                        List the free models it found, best first
  onerouter key create [NAME]                             Make an API key for a client (shown once)
  onerouter key list                                      List keys
  onerouter key revoke ID                                 Revoke a key
  onerouter init                                          Write an example config to ~/.onerouter/config.json

Without a config file, providers come from environment variables: OPENROUTER_API_KEY, GROQ_API_KEY,
CEREBRAS_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, SAMBANOVA_API_KEY, HF_TOKEN. Ollama and LM Studio on
this machine are used when running. Providers that are free only without billing (Groq, Cerebras,
Gemini, Mistral, SambaNova) are used only when listed in FREE_ROUTER_NO_BILLING, e.g. groq,cerebras.`;

const EXAMPLE = {
  port: 4141,
  providers: [
    { id: 'openrouter', kind: 'openrouter', apiKey: 'env:OPENROUTER_API_KEY' },
    { id: 'groq', kind: 'groq', apiKey: 'env:GROQ_API_KEY', billing: 'none' },
    { id: 'cerebras', kind: 'cerebras', apiKey: 'env:CEREBRAS_API_KEY', billing: 'none', disabled: true },
    { id: 'gemini', kind: 'gemini', apiKey: 'env:GEMINI_API_KEY', billing: 'none', disabled: true },
    { id: 'ollama', kind: 'ollama', baseURL: 'http://127.0.0.1:11434' },
  ],
};

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function serve(args: string[]) {
  const { config, providers, source } = loadConfig({ path: flag(args, 'config') });
  const port = flag(args, 'port') ? Number(flag(args, 'port')) : config.port;
  const host = flag(args, 'host') ?? config.host;
  const keys = new KeyStore(homeDir());
  if (!keys.list().length) {
    const { key } = keys.create('default');
    console.log(`Created your first API key (shown only once; save it):\n\n  ${key}\n`);
  }
  const catalog = new Catalog(providers);
  const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
  console.log(`Providers from ${source ?? 'environment variables'}: ${providers.map(p => p.id).join(', ') || 'none'}`);
  for (const status of await catalog.refresh()) {
    console.log(`  ${status.id.padEnd(12)} ${status.ok ? `${status.free} free of ${status.listed} models` : `unavailable: ${status.error}`}`);
  }
  if (!catalog.models().length) console.log('\nNo free models yet. Add a provider key (see onerouter --help); the router keeps checking.');
  const server = createServer({ catalog, health: new Health(), sessions: new Sessions(), config, authorize: key => !!keys.verify(key), log });
  setInterval(() => { void catalog.refresh(); }, config.refreshMinutes * 60_000).unref();
  server.listen(port, host, () => {
    const base = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
    console.log(`\nonerouter listening on ${base}
  OpenAI clients:    base URL ${base}/v1, model onerouter/auto
  Anthropic clients: ANTHROPIC_BASE_URL=${base}  ANTHROPIC_AUTH_TOKEN=<your fr_ key>`);
  });
}

async function models(args: string[]) {
  const { providers } = loadConfig({ path: flag(args, 'config') });
  const catalog = new Catalog(providers);
  const statuses = await catalog.refresh();
  const health = new Health();
  
  if (flag(args, 'json') || !process.stdout.isTTY) {
    for (const status of statuses) {
      console.log(`${status.id.padEnd(12)} ${status.ok ? `${status.free} free of ${status.listed}` : `unavailable: ${status.error}`}`);
    }
    for (const [label, task] of [['Chat', profileTask([{ role: 'user', content: 'Explain this' }], false)], ['Agents with tools (code)', profileTask([{ role: 'user', content: 'Fix it' }], true)]] as const) {
      console.log(`\n${label}, best first:`);
      for (const { model, why } of rank(catalog.models(), task, health).ranked.slice(0, 15)) console.log(`  ${model.ref.padEnd(60)} ${why.join(', ')}`);
    }
    return;
  }
  
  const { startTui } = await import('../tui/index.js');
  startTui(catalog, health, statuses);
}

function key(args: string[]) {
  const store = new KeyStore(homeDir());
  const [command, value] = args;
  if (command === 'create') {
    const { key, record } = store.create(value ?? 'default');
    console.log(`Key ${record.id} (${record.name}), shown only once:\n\n  ${key}\n`);
  } else if (command === 'list') {
    const records = store.list();
    if (!records.length) console.log('No keys. Create one with: onerouter key create');
    for (const r of records) console.log(`${r.id}  ${r.prefix}…  ${r.name.padEnd(20)} ${r.createdAt.slice(0, 10)}`);
  } else if (command === 'revoke' && value) {
    const removed = store.revoke(value);
    console.log(removed ? `Revoked ${removed.id} (${removed.name}).` : `No key matches "${value}".`);
    if (!removed) process.exitCode = 1;
  } else {
    console.log(HELP);
    process.exitCode = 1;
  }
}

function init() {
  const path = join(homeDir(), 'config.json');
  if (existsSync(path)) { console.log(`${path} already exists.`); return; }
  writeFileSync(path, `${JSON.stringify(EXAMPLE, null, 2)}\n`, { mode: 0o600 });
  console.log(`Wrote ${path}. Keys are read from the environment variables it names; enable the providers you have.`);
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'serve') await serve(args);
  else if (command === 'models') await models(args);
  else if (command === 'key' || command === 'keys') key(args);
  else if (command === 'init') init();
  else { console.log(HELP); if (command && command !== '--help' && command !== 'help') process.exitCode = 1; }
} catch (error) {
  if (error instanceof ConfigError) { console.error(`Config error: ${error.message}`); process.exitCode = 1; }
  else throw error;
}
