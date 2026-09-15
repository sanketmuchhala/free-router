# TASKS.md — The Roadmap

> **Rule:** Complete one task fully (implement → test → verify) before starting the next.
> Update the status here and in `ACTIVE.md` as you go.

## Legend

- `[ ]` — Not started
- `[/]` — In progress
- `[x]` — Complete

---

## Phase 1: Stability & Developer Experience

- [ ] **1.1 Add ESLint + Prettier**
  - Add `eslint` and `prettier` with TypeScript support
  - Configure to match existing style (2-space, single quotes, semicolons)
  - Add `pnpm lint` and `pnpm format` scripts
  - Fix any existing violations

- [ ] **1.2 Persistent health state**
  - Save cooldowns and session→model mappings to disk
  - Restore on restart so a restart doesn't forget which models are down
  - Add a TTL so stale entries expire

- [ ] **1.3 Improve error messages**
  - Audit all error paths for clarity
  - Ensure rate-limit errors always include which models were tried and when the next one is available
  - Test error formatting for both OpenAI and Anthropic response shapes

---

## Phase 2: Feature Expansion

- [ ] **2.1 Reasoning/thinking output forwarding**
  - Forward `thinking` blocks from models that support it to Anthropic clients
  - Handle the case where upstream sends reasoning tokens and translate to Anthropic's thinking format
  - Add tests

- [ ] **2.2 Per-key usage limits**
  - Track request count and token usage per API key
  - Add configurable limits (requests/day, tokens/day)
  - Return 429 when a key exceeds its limit

- [ ] **2.3 Prompt caching support**
  - Detect and forward cache control headers from Anthropic requests
  - Track cache hits in health/stats

- [ ] **2.4 Multi-model mode (Free Agent)**
  - Port Nerdplexity's Free Agent pattern: multiple models draft, one checks
  - Make it opt-in via a model name like `free-router/agent`
  - Needs careful design doc first (update ARCH.md before implementing)

---

## Phase 3: Observability & Distribution

- [ ] **3.1 Web dashboard**
  - Serve a simple status page at `/dashboard`
  - Show: active models, recent requests, success/failure rates, cooldown status
  - Use vanilla HTML/JS (no build step; serve from the binary)

- [ ] **3.2 Structured logging**
  - Add optional JSON logging mode for production use
  - Include: timestamp, model, provider, status, latency, tokens (estimated)

- [ ] **3.3 Publish to npm**
  - Finalize `package.json` metadata
  - Add `npx free-router` support
  - Write install-from-npm docs
  - CI/CD pipeline for publishing

---

## Phase 4: Ecosystem

- [ ] **4.1 Docker image**
  - Multi-stage Dockerfile
  - Publish to GHCR
  - Document docker-compose setup with Ollama

- [ ] **4.2 Provider plugins**
  - Allow users to add custom provider adapters
  - Define a provider plugin interface
  - Load from `~/.free-router/plugins/`

- [ ] **4.3 Benchmarked model ranking**
  - Replace name-based size heuristics with measured performance
  - Run a small eval on first use to rank models
  - Cache results
