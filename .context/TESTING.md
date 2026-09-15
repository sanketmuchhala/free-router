# TESTING.md — The Safety Net

## Test Framework

- **Vitest** ^2.1 — ESM-native, fast, compatible with the project's `"type": "module"` setup.

## Commands

```bash
# Run all tests (22 tests)
pnpm test

# Run tests in watch mode
pnpm vitest

# Run a specific test file
pnpm vitest run test/core.test.ts
pnpm vitest run test/openai.test.ts
pnpm vitest run test/anthropic.test.ts

# Type-check (must pass before committing)
pnpm typecheck
```

## Test Architecture

Tests run the **real server** against a **fake provider** (`test/helpers.ts`) that simulates real-world failure modes:

| Test File | Coverage |
|-----------|----------|
| `test/helpers.ts` | Fake provider server with configurable misbehavior (rate limits, silence, errors inside streams, dropped connections) |
| `test/core.test.ts` | Core routing, fallback logic, model selection, candidate filtering, session stickiness, error classification |
| `test/openai.test.ts` | End-to-end tests using the official **OpenAI SDK** (`openai ^5.0`): streaming, non-streaming, tool calls |
| `test/anthropic.test.ts` | End-to-end tests using the official **Anthropic SDK** (`@anthropic-ai/sdk ^0.60`): streaming, non-streaming, protocol translation, tool calls |

## What the Tests Validate

### Routing & Fallback
- [x] Auto-routing picks the best model
- [x] Falls back to the next model on rate limit (429)
- [x] Falls back on provider error (500)
- [x] Falls back on timeout (silence for 2+ minutes)
- [x] Falls back on broken stream (connection drops mid-response)
- [x] Respects `maxAttempts` limit
- [x] Returns proper error when all models fail

### Streaming
- [x] SSE streaming works end-to-end (OpenAI format)
- [x] SSE streaming works end-to-end (Anthropic format)
- [x] Partial stream followed by error → partial answer delivered, error appended
- [x] `[DONE]` sentinel is always sent

### Protocol Translation (Anthropic ↔ OpenAI)
- [x] System messages translated correctly
- [x] Text and image content parts map correctly
- [x] Tool use / tool result messages translate both directions
- [x] Tool choice modes map correctly (any/tool/none → required/function/none)

### Tool Calling
- [x] Tool definitions pass through correctly
- [x] Tool calls are sent whole (not split across chunks)
- [x] Tool results map correctly between formats

### Keys & Auth
- [x] Valid `fr_...` key → 200
- [x] Missing key → 401
- [x] Invalid key → 401
- [x] Both `Authorization: Bearer` and `x-api-key` headers work

### Pricing & Catalog
- [x] Only $0 / no-billing / local models are marked as free
- [x] Unknown prices are never treated as free

## Edge Cases to Always Check

When making changes, manually verify these edge cases:

1. **Token capping:** Request asks for `max_tokens: 32000` but model only supports 8192 → capped silently
2. **Groq quirk:** `max_completion_tokens` used instead of `max_tokens`
3. **Mistral quirk:** Tool call IDs trimmed to 9 characters
4. **Context overflow:** Prompt is larger than model's context window → model is skipped, not errored
5. **No free models available:** Returns 503 with details about when the next model will be available
6. **Anthropic server tools:** Web search and PDF tools are dropped (can't run on other providers)
7. **Thinking blocks:** From earlier turns are dropped (not forwarded yet)
8. **Provider redirect:** Remote providers cannot redirect requests (and leak keys) → `redirect: 'error'`
9. **20 MB body limit:** Requests larger than 20 MB are rejected with 413

## Before Submitting Code

- [ ] `pnpm typecheck` passes with zero errors
- [ ] `pnpm test` — all 22 tests pass
- [ ] No new `any` types introduced (unless absolutely necessary with justification)
- [ ] Error messages are clear and actionable
- [ ] Provider keys are never logged or included in error text (use `redact()`)
- [ ] API contracts are preserved (no breaking changes to request/response shapes)
