# ARCH.md — The Blueprint

## Folder Structure

```
free-router/
├── src/                     # All source code
│   ├── index.ts             # Public API: re-exports everything for library consumers
│   ├── cli.ts               # CLI entry point (Ink/React UI): serve, models, init, key commands
│   ├── server.ts            # HTTP server: routes requests to handlers, auth, error formatting
│   ├── route.ts             # Core routing: model selection, fallback loop, upstream dispatch
│   ├── rank.ts              # Model ranking: scoring, session stickiness, health tracking
│   ├── catalog.ts           # Provider catalog: discovers models, filters free ones, caches lists
│   ├── providers.ts         # Provider resolution: config → Provider objects with URLs and headers
│   ├── config.ts            # Config loading: file, env vars, defaults
│   ├── keys.ts              # API key store: create, verify, revoke (SHA-256 hashed, file-backed)
│   ├── anthropic.ts         # Anthropic ↔ OpenAI protocol translation (request + streaming response)
│   ├── errors.ts            # Error classification: HTTP status → FailureCategory mapping
│   └── types.ts             # Shared type definitions (interfaces, enums, type aliases)
├── test/                    # Test suite
│   ├── helpers.ts           # Fake provider server that simulates rate limits, errors, broken streams
│   ├── core.test.ts         # Core routing & fallback tests
│   ├── openai.test.ts       # End-to-end tests using the official OpenAI SDK
│   └── anthropic.test.ts    # End-to-end tests using the official Anthropic SDK
├── dist/                    # Build output (gitignored)
├── package.json
├── tsconfig.json            # Dev + test config
├── tsconfig.build.json      # Production build config (src/ only)
├── pnpm-workspace.yaml
└── .context/                # AI context files (this directory)
```

## Module Dependency Graph

```
cli.ts ──→ config.ts ──→ providers.ts ──→ types.ts
  │           │
  ▼           ▼
server.ts ──→ route.ts ──→ rank.ts ──→ catalog.ts ──→ providers.ts
  │             │
  ▼             ▼
anthropic.ts  errors.ts
  │
  ▼
keys.ts
```

## Key Data Types

### `Provider` (resolved, runtime)
```ts
{ id, kind, chatURL, catalogURL, apiKey?, billing, local, headers }
```

### `CatalogModel` (a model known to the router)
```ts
{ provider, model, ref, contextLength?, maxOutputTokens?, capabilities: { tools, vision }, price }
```

### `TaskProfile` (what a request needs)
```ts
{ kind: TaskKind, vision, tools, estimatedTokens }
```

### `ChatRequest` / `ChatMessage` (OpenAI format, the internal lingua franca)
All requests are normalized to OpenAI chat completion format internally. Anthropic requests are translated in `anthropic.ts`.

## Request Flow

```
Client Request
    │
    ▼
┌─────────────────┐
│   server.ts      │  Auth check, parse body, detect protocol (OpenAI vs Anthropic)
│                  │  Anthropic → toChatRequest() translation
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   route.ts       │  1. Resolve model name (auto / specific / unknown)
│                  │  2. Build candidate list via catalog
│                  │  3. Rank candidates (rank.ts)
│                  │  4. Fallback loop: try up to maxAttempts models
│                  │     - Build upstream body (cap tokens, fix provider quirks)
│                  │     - Send to provider, wait for first output
│                  │     - On failure: classify error, record cooldown, try next
│                  │     - On success: return Routed (json or stream)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   server.ts      │  Stream back to client (SSE for streaming, JSON for non-streaming)
│                  │  Anthropic responses: AnthropicStream translates OpenAI SSE → Anthropic events
└─────────────────┘
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/chat/completions` | `fr_...` key | OpenAI chat completions (streaming + non-streaming, with tools) |
| `POST` | `/v1/messages` | `fr_...` key | Anthropic Messages (streaming + non-streaming, with tools) |
| `POST` | `/v1/messages/count_tokens` | `fr_...` key | Token count estimate (4 chars/token heuristic) |
| `GET` | `/v1/models` | `fr_...` key | Model list (OpenAI or Anthropic format based on headers) |
| `GET` | `/health` or `/` | none | Provider status, model counts |

## Config & Data Storage

- **Config:** `~/.free-router/config.json` (or `FREE_ROUTER_CONFIG` / `--config`)
- **Keys:** `~/.free-router/keys.json` (mode 600, SHA-256 hashes)
- **Env vars:** `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `SAMBANOVA_API_KEY`, `HF_TOKEN`, `FREE_ROUTER_NO_BILLING`, `FREE_ROUTER_LOCAL`, `FREE_ROUTER_PORT`, `FREE_ROUTER_HOME`

## Ranking Algorithm (rank.ts)

Models are scored by:
1. **Parameter count** (extracted from model name, log-scale, larger = better)
2. **Task fit** (coder models for code, reasoning models for math)
3. **Tool support** (prefer models with confirmed tool calling)
4. **Context window** (prefer larger context for long requests)
5. **Runtime health** (success rate, speed from recent requests)
6. **Local penalty** (local models get a small score reduction — usually slower)
7. **`openrouter/free` last** (OpenRouter's own router is a last resort)

## Session Stickiness

Conversations are identified by:
1. `x-free-router-session` header (explicit)
2. `metadata.user_id` from Anthropic requests (Claude Code sends one per session)
3. Hash of system prompt + first user message (fallback)

Once a model answers in a session, it's preferred for subsequent requests until it fails.

## Error Handling Strategy

- Rate limits → 429 with `Retry-After` header
- No available model → 503 (or 529 for Anthropic clients, which retry it)
- Bad key → 401
- All errors include: attempts tried, last failure, why models were skipped, when next available
