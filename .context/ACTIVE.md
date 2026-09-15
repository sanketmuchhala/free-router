# ACTIVE.md — The Memory Anchor

> **Last updated:** 2026-09-15

## Currently Building

**Nothing in progress** — MVP (v0.1) is complete and working. The `.context/` directory was just created to prepare for structured AI-assisted development going forward.

## Current State

- ✅ MVP is functional end-to-end
- ✅ All 22 tests pass
- ✅ TypeScript compiles clean
- ✅ Works with Claude Code, OpenAI SDK, Anthropic SDK (tested)
- ✅ Supports 9 provider types (OpenRouter, Groq, Cerebras, Gemini, Mistral, SambaNova, HF, Ollama, LM Studio)

## Known Issues / Bugs

- **Health is in-memory only.** Restarting the server forgets all cooldowns and session→model mappings.
- **No reasoning output forwarding.** Models that emit thinking/reasoning tokens don't have them forwarded to Anthropic clients.
- **Ranking is heuristic-based.** Model size is guessed from the name, not measured.

## Current Errors

None. Clean build, all tests pass.

## Recent Changes

- Created `.context/` directory with 6 AI context files (AGENTS.md, PRD.md, ARCH.md, TASKS.md, TESTING.md, ACTIVE.md)

## Next Immediate Steps

Refer to `TASKS.md` for the full roadmap. The suggested next task is:

1. **Task 1.1: Add ESLint + Prettier** — Establish consistent code quality tooling before adding new features.

## Key Files to Know

When working on this codebase, these are the files you'll touch most:

| File | Purpose |
|------|---------|
| [`src/route.ts`](file:///Users/sanketmuchhala/Documents/GitHub/free-router/src/route.ts) | Core routing logic, fallback loop |
| [`src/rank.ts`](file:///Users/sanketmuchhala/Documents/GitHub/free-router/src/rank.ts) | Model scoring and ranking |
| [`src/catalog.ts`](file:///Users/sanketmuchhala/Documents/GitHub/free-router/src/catalog.ts) | Model discovery and free filtering |
| [`src/server.ts`](file:///Users/sanketmuchhala/Documents/GitHub/free-router/src/server.ts) | HTTP server, request handling |
| [`src/anthropic.ts`](file:///Users/sanketmuchhala/Documents/GitHub/free-router/src/anthropic.ts) | Anthropic ↔ OpenAI translation |
| [`src/types.ts`](file:///Users/sanketmuchhala/Documents/GitHub/free-router/src/types.ts) | All shared type definitions |
| [`test/helpers.ts`](file:///Users/sanketmuchhala/Documents/GitHub/free-router/test/helpers.ts) | Fake provider for tests |

## Open Questions

None at the moment. Ready to pick up the next task from `TASKS.md`.
