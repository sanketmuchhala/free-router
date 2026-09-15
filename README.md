# free-router

One endpoint for every free AI model you have. Point any OpenAI or Anthropic client at it (a coding agent, Claude Code, a script) and each request goes to the best free model that can take it. When a model is rate limited or down, the router tries the next one, before your client sees anything.

```text
your agent ──▶ free-router ──▶ OpenRouter (:free models) ─┐
  (OpenAI or        │       ──▶ Groq, Cerebras, Gemini,    ├─ best free model first,
   Anthropic API)   │           Mistral, SambaNova, HF     │  the next one if it fails
                    │       ──▶ Ollama, LM Studio (local) ─┘
                    └─ one key (fr_…); your provider keys never leave the router
```

Status: early (0.1). It works end to end with the OpenAI and Anthropic SDKs and with Claude Code (tested), but it is new. It grew out of the Free Router in [Nerdplexity](https://github.com/sanketmuchhala/Nerdplexity).

## Contents

- [Why](#why)
- [Quick start](#quick-start)
- [Use it from your tools](#use-it-from-your-tools)
- [Providers: what counts as free](#providers-what-counts-as-free)
- [Choosing a model](#choosing-a-model)
- [What happens to a request](#what-happens-to-a-request)
- [Configuration](#configuration)
- [API](#api)
- [Limits and caveats](#limits-and-caveats)
- [Security](#security)
- [Development](#development)

## Why

Free AI models are spread over many providers, each with small limits: OpenRouter's free models allow 20 requests a minute and 50 a day (1,000 a day once you have bought $10 of credits), Groq and Cerebras have per-minute and per-day caps, and so on. A coding agent sends dozens of requests per task and stops at the first rate limit.

free-router puts them behind one address and one key. It knows which of your models are free, ranks them for each request, keeps a conversation on the same model while it works, and moves on when one runs out.

## Quick start

Requires Node.js 20 or newer.

```bash
git clone https://github.com/sanketmuchhala/free-router.git
cd free-router
pnpm install && pnpm build        # or: npm install && npm run build
npm link                          # optional: puts `free-router` on your PATH

export OPENROUTER_API_KEY=sk-or-...   # a free OpenRouter key is enough to start
free-router serve
```

On first start it creates your router key and prints it once:

```text
Created your first API key (shown only once; save it):

  fr_Xy3...

Providers from environment variables: openrouter, ollama, lmstudio
  openrouter   28 free of 340 models
  ollama       unavailable: Nothing is answering at http://127.0.0.1:11434/v1.
  lmstudio     unavailable: ...

free-router listening on http://127.0.0.1:4141
```

Check what it found, best first:

```bash
free-router models
```

## Use it from your tools

### Claude Code, or any harness built on the Anthropic SDK

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:4141
export ANTHROPIC_AUTH_TOKEN=fr_...          # your router key
export CLAUDE_CODE_MAX_CONTEXT_TOKENS=100000 # free models' windows are smaller than Claude's
claude --model free-router/auto
```

- Any model name the router does not know (`claude-sonnet-4-5`, `sonnet`) is routed like `free-router/auto`, so the default model works too.
- Set `CLAUDE_CODE_MAX_CONTEXT_TOKENS` to about the smallest context you want to use (most large free models have 128k or more; 100000 leaves room). Claude Code assumes 200k for a model it does not know, and would otherwise let a conversation grow past what free models accept.
- In your own harness: `new Anthropic({ baseURL: 'http://127.0.0.1:4141', apiKey: 'fr_...' })`. Both `x-api-key` and `Authorization: Bearer` work.

### OpenAI SDKs and OpenAI-compatible tools

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:4141/v1", api_key="fr_...")
reply = client.chat.completions.create(model="free-router/auto", messages=[{"role": "user", "content": "Hello"}])
```

```ts
import OpenAI from 'openai';
const client = new OpenAI({ baseURL: 'http://127.0.0.1:4141/v1', apiKey: 'fr_...' });
```

Tools that take an "OpenAI-compatible" base URL and key (Aider, Cline, Continue, Open WebUI, and others) work the same way: base URL `http://127.0.0.1:4141/v1`, key `fr_...`, model `free-router/auto`.

### curl

```bash
curl http://127.0.0.1:4141/v1/chat/completions \
  -H "Authorization: Bearer fr_..." -H "Content-Type: application/json" \
  -d '{"model":"free-router/auto","messages":[{"role":"user","content":"Hi"}]}' -i
```

The response headers say which model answered: `x-free-router-model: openrouter/meta-llama/llama-3.3-70b-instruct:free`, and `x-free-router-attempts: 2` when the first choice failed.

## Providers: what counts as free

A model is used only when free-router can confirm it is free. Unknown prices are never treated as free.

| Provider | Environment variable | Free when |
| --- | --- | --- |
| OpenRouter | `OPENROUTER_API_KEY` | The catalog lists the model at $0 (the `:free` models), plus `openrouter/free`, OpenRouter's own free router (used last) |
| Groq | `GROQ_API_KEY` | The account has no payment method, and you say so (below) |
| Cerebras | `CEREBRAS_API_KEY` | Same |
| Gemini | `GEMINI_API_KEY` | Same |
| Mistral | `MISTRAL_API_KEY` | Same |
| SambaNova | `SAMBANOVA_API_KEY` | Same |
| Hugging Face | `HF_TOKEN` | A provider serving the model is marked free (listed as `model:provider`), or you say the account has no billing |
| Ollama, LM Studio, any server on this machine | none | Always: it runs on your hardware |

Groq, Cerebras, Gemini, Mistral, and SambaNova are free only while the account cannot be charged, and their APIs do not say whether it can. Tell the router with `FREE_ROUTER_NO_BILLING=groq,cerebras,gemini`, or `"billing": "none"` in the config file. Only do this for accounts without a payment method.

Ollama (`http://127.0.0.1:11434`) and LM Studio (`http://127.0.0.1:1234`) are used automatically when running; set `FREE_ROUTER_LOCAL=0` to turn that off.

## Choosing a model

| `model` in the request | What happens |
| --- | --- |
| `free-router/auto` (also `auto`, `free`, `free-router`) | The router ranks every free model for this request and falls back as needed |
| `provider/model`, e.g. `groq/llama-3.3-70b-versatile` | Exactly that model, no fallback. It must be one of your free models (see `GET /v1/models`) |
| A bare model ID that one provider has | That model |
| Anything else (`claude-sonnet-4-5`, `gpt-4o`) | Routed like `free-router/auto`. Set `"routeUnknownModels": false` to get a 404 instead |

## What happens to a request

1. **Needs.** The router reads what the request needs: images, tools, and its size (the prompt and tool definitions, at about four characters per token, plus 4,096 tokens reserved for the answer). A request with tools is treated as coding work.
2. **Leave out.** Models that report no image or tool support, whose context is too small, or that are cooling down after a failure.
3. **Rank.** By size read from the model name (larger first, on a log scale), fit for the task (`coder` models for code, reasoning models for math), tool support, larger context for long requests, and how the model did on recent requests on this router (success rate, speed). Models on your machine get a small penalty (usually slower); `openrouter/free` goes last.
4. **Same model for a conversation.** Once a model has answered, later requests in the same conversation go to it first while it keeps working, so an agent does not change model every turn. A conversation is identified by the `x-free-router-session` header, Anthropic's `metadata.user_id` (Claude Code sends one per session), or the system prompt plus the first user message.
5. **Send, and fall back before any output.** The request goes to the first model with rate-limit waits off. If it fails before sending any text, reasoning, or tool call (rate limit, error, bad key, rejected request, or silence for 2 minutes), the next model is tried, up to 4. Once a model has sent output, the answer is that model's: a partial answer is never continued by another model. A refusal is never retried elsewhere.
6. **Cooldowns.** A rate-limited model is skipped until the provider's reset (or a minute); an account-wide limit or a bad key skips every model on that account. This is kept in memory.
7. **Fit the provider.** Large answer requests are capped at the model's maximum output and at what fits in its context (Claude Code asks for 32,000 tokens; many free models allow 8,192). Groq gets `max_completion_tokens`; Mistral gets tool call IDs in the 9-character form it accepts.

When no model can answer, the error says how many were tried, the last failure, why others were left out, and when the next one is available (`Retry-After`). Status 429 when it is a rate limit, 503 otherwise (529 "overloaded" for Anthropic clients, which retry it).

## Configuration

Without a config file, providers come from environment variables (above). For more control, run `free-router init` and edit `~/.free-router/config.json`:

```json
{
  "port": 4141,
  "providers": [
    { "id": "openrouter", "kind": "openrouter", "apiKey": "env:OPENROUTER_API_KEY" },
    { "id": "groq", "kind": "groq", "apiKey": "env:GROQ_API_KEY", "billing": "none" },
    { "id": "ollama", "kind": "ollama", "baseURL": "http://127.0.0.1:11434" },
    { "id": "work-gpu", "kind": "openai-compatible", "baseURL": "https://gpu.example.com/v1", "apiKey": "env:WORK_GPU_KEY", "billing": "none" }
  ]
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `host` | `127.0.0.1` | Address to listen on. Keep it on this machine unless you know you need otherwise |
| `port` | `4141` | Also `FREE_ROUTER_PORT` |
| `providers[].id` | the kind | Name used in model IDs (`groq/...`) |
| `providers[].kind` | | `openrouter`, `groq`, `cerebras`, `gemini`, `mistral`, `sambanova`, `huggingface`, `ollama`, `openai-compatible` |
| `providers[].apiKey` | | The key, or `env:NAME` to read it from an environment variable (recommended) |
| `providers[].baseURL` | the provider's | Required for `ollama` and `openai-compatible`. Remote addresses must be https |
| `providers[].billing` | `unknown` | `none` means the account cannot be charged, so all its models count as free |
| `providers[].disabled` | `false` | Keep the entry but skip it |
| `routeUnknownModels` | `true` | Route unknown model names like `free-router/auto` |
| `maxAttempts` | `4` | Models tried per request |
| `firstOutputTimeoutMs` | `120000` | Silence before a model counts as failed (streaming requests) |
| `refreshMinutes` | `30` | How often provider catalogs are listed again |

Files live in `~/.free-router` (or `FREE_ROUTER_HOME`): `config.json` and `keys.json`. Use `--config FILE` or `FREE_ROUTER_CONFIG` for another config file.

### Router keys

```bash
free-router key create my-harness   # prints a new fr_ key once
free-router key list
free-router key revoke <id>
```

## API

| Method and path | Auth | For |
| --- | --- | --- |
| `POST /v1/chat/completions` | key | OpenAI chat completions, streaming or not, with tools. Passed to the chosen model as is, apart from `model` and the fixes in step 7 |
| `POST /v1/messages` | key | Anthropic Messages, streaming or not, with tools. Translated to and from OpenAI chat completions |
| `POST /v1/messages/count_tokens` | key | An estimate (four characters per token) |
| `GET /v1/models` | key | `free-router/auto` and every free model; Anthropic's list format when the request has an `anthropic-version` header |
| `GET /health` | none | Providers, whether each was reachable, and how many free models each has |

Anthropic translation, in short: `system` becomes a system message; text and images pass through; `tool_use` becomes `tool_calls`; `tool_result` becomes a `tool` message; `tool_choice` any/tool/none map to required/function/none; thinking blocks from earlier turns are dropped; Anthropic's server tools (such as web search) and PDF documents are not passed on (they cannot run on other providers). In the answer, text streams as it arrives, and tool calls are sent whole when the model finishes, because providers split tool arguments in different ways.

## Limits and caveats

- **Free quotas run out.** An agent task can take dozens of requests. OpenRouter alone gives about 50 a day. Add Groq, Cerebras, Gemini, and local models to spread the load, and check `free-router models`.
- **Tool calling varies by model.** Free models follow tool schemas less reliably than frontier models. Large models with tool support are ranked first for requests with tools, but expect more retries from your agent.
- **Privacy.** Some free models log or train on prompts, and your code goes to them. Check each provider's terms; local models keep everything on your machine.
- **Ranking uses names, not measurements.** Model size and task fit are read from model IDs, plus the router's own record of recent successes. There is no benchmark yet.
- **Health is in memory.** A restart forgets cooldowns and which model a conversation used.
- **Not supported yet:** a multi-model mode (several models drafting, one checking, as in Nerdplexity's Free Agent), per-key usage limits, prompt caching, and reasoning ("thinking") output for Anthropic clients (the model's reasoning is not forwarded).

## Security

- Listens on `127.0.0.1` only, unless you change `host`.
- Every API route needs a router key. Keys are stored as SHA-256 hashes in `~/.free-router/keys.json` (mode 600); a key is shown once, when created.
- Provider keys stay in the router: read from the environment or your config file, sent only to their own provider, and removed from any error text.
- Remote providers must use https. Requests use `redirect: 'error'`, so a provider cannot redirect a request, and its key, elsewhere.
- Prompts and answers are not logged. The log line for a request names the models tried, the status, and the time.

## Development

```bash
pnpm install
pnpm test        # 22 tests: fallback, streaming, tool calls, the OpenAI and Anthropic SDKs, prices, keys, config
pnpm typecheck
pnpm build
node dist/cli.js serve
```

The tests run the real server against a fake provider whose models misbehave on purpose (rate limits, silence, errors inside streams, connections that drop mid-answer), and drive it with the official OpenAI and Anthropic SDKs. How it is built: [docs/architecture.md](docs/architecture.md).

## License

MIT
