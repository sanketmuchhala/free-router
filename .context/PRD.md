# PRD.md — The Product

## Problem

Free AI models are scattered across many providers (OpenRouter, Groq, Cerebras, Gemini, Mistral, SambaNova, Hugging Face, Ollama, LM Studio), each with small rate limits. A coding agent sends dozens of requests per task and stalls at the first rate limit. Managing multiple keys, base URLs, and model names across tools is painful.

## Solution

**free-router** is a local proxy that presents one OpenAI- and Anthropic-compatible endpoint backed by every free AI model the user has access to. It picks the best free model for each request and transparently falls back when one is rate-limited or down.

## Target Users

- Developers using AI coding agents (Claude Code, Aider, Cline, Continue, Cursor)
- Hobbyists and students who rely on free-tier models
- Anyone who runs local models (Ollama, LM Studio) and wants them as a fallback pool alongside cloud free tiers

## User Goals

1. **One endpoint, one key.** Point any OpenAI or Anthropic client at `http://127.0.0.1:4141` with a single `fr_...` key.
2. **Maximize free usage.** Spread load across all available free models so quotas last longer.
3. **Invisible fallback.** When a model is rate-limited, the router tries the next one before the client sees an error.
4. **Conversation continuity.** Keep a conversation on the same model as long as it's working.
5. **Zero config to start.** Set one env var (`OPENROUTER_API_KEY`), run `free-router serve`, and it works.

## MVP Features (v0.1 — Current)

- [x] OpenAI-compatible `POST /v1/chat/completions` (streaming + non-streaming)
- [x] Anthropic-compatible `POST /v1/messages` (streaming + non-streaming, with full protocol translation)
- [x] `POST /v1/messages/count_tokens` (estimate)
- [x] `GET /v1/models` (OpenAI and Anthropic list formats)
- [x] `GET /health` (provider status)
- [x] Smart model ranking: size, task fit, tool support, context window, recent success rate
- [x] Automatic fallback across up to 4 models per request
- [x] Session stickiness (keeps a conversation on the same model)
- [x] Provider support: OpenRouter, Groq, Cerebras, Gemini, Mistral, SambaNova, Hugging Face, Ollama, LM Studio, any OpenAI-compatible server
- [x] Free-only model filtering: only uses models confirmed as free ($0 price, no-billing account, or local)
- [x] API key management (`fr_...` keys, SHA-256 hashed)
- [x] CLI: `serve`, `models`, `init`, `key create/list/revoke`
- [x] Security: localhost-only, HTTPS for remote providers, no redirects, keys never logged

## Not Yet Built (Post-MVP)

- [ ] Multi-model mode (several models draft, one checks — from Nerdplexity's Free Agent)
- [ ] Per-key usage limits
- [ ] Prompt caching
- [ ] Reasoning/thinking output forwarding for Anthropic clients
- [ ] Persistent health state across restarts
- [ ] Benchmarked model ranking (currently uses name heuristics + runtime stats)
- [ ] Web dashboard for monitoring
- [ ] npm package published to registry

## Success Metrics

- An agent (Claude Code, Aider) can complete a multi-step coding task using only free models without hitting a terminal rate-limit error.
- Setup takes under 2 minutes: clone, install, set one env var, run.
- All 22 tests pass with zero flakes.
