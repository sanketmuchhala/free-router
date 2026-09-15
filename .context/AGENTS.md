# AGENTS.md — The Rules

## Identity

- **Project:** free-router
- **Author:** Sanket Muchhala
- **License:** MIT
- **Version:** 0.1.0 (early / MVP)

## Tech Stack

| Layer | Technology | Version / Notes |
|-------|-----------|-----------------|
| Runtime | Node.js | ≥ 20 |
| Language | TypeScript | ^5.6 (`strict: true`) |
| Module system | ESM (`"type": "module"`) | `NodeNext` resolution; all local imports end in `.js` |
| Package manager | pnpm | Workspace via `pnpm-workspace.yaml` |
| Testing | Vitest | ^2.1 |
| CLI UI | Ink + React | `ink ^7.1`, `react ^19.3` (JSX via `react-jsx`) |
| HTTP | Node `http` built-in | No Express, Fastify, or similar |
| SDKs (dev only) | `openai ^5.0`, `@anthropic-ai/sdk ^0.60` | Used in tests to validate SDK compatibility |

## Coding Style

- **Strict TypeScript.** `strict: true`, no `any` unless unavoidable (e.g. JSON parsing). Prefer explicit types on function signatures.
- **ESM only.** Every local import must use the `.js` extension (`import { foo } from './bar.js'`).
- **No classes unless needed.** The codebase uses plain functions and interfaces. Only use classes when there is mutable state to encapsulate (e.g. `AnthropicStream`, `Catalog`, `KeyStore`).
- **Functional core, imperative shell.** Core logic (ranking, catalog filtering, request translation) is pure functions. Side effects (HTTP, filesystem) live in `server.ts`, `cli.ts`, and `config.ts`.
- **Concise logging.** One log line per request: method, path, status, model attempts, duration. No verbose debug logging.
- **Error handling.** Domain errors are typed (`RouteError`, `HttpError`, `ConfigError`, `TranslationError`). Never swallow errors silently; always surface a useful message.
- **No external HTTP framework.** The server uses raw `http.createServer`. Keep it that way.
- **Preserve all existing comments and docstrings** that are unrelated to your code changes.

## Commands

```bash
# Install dependencies
pnpm install

# Build (TypeScript → dist/)
pnpm build

# Run all tests (22 tests covering fallback, streaming, tool calls, SDK compat, prices, keys, config)
pnpm test

# Type-check without emitting
pnpm typecheck

# Dev: build + start server
pnpm dev

# Start production server
pnpm start             # → node dist/cli.js serve

# CLI commands (after npm link or pnpm build)
free-router serve      # Start the router
free-router models     # List available free models
free-router init       # Create config file
free-router key create <name>
free-router key list
free-router key revoke <id>
```

## Linting & Formatting

- No linter or formatter is currently configured. Follow the existing style (2-space indent, single quotes, semicolons, concise lines).
- Run `pnpm typecheck` before committing — it must pass clean.

## File Conventions

- Source files live in `src/`. Tests in `test/`.
- Build output goes to `dist/` (gitignored).
- Config files at root: `tsconfig.json` (dev + test), `tsconfig.build.json` (production build, `src/` only).
- User data directory: `~/.free-router/` (config, keys).

## Rules for AI Agents

1. **Never modify `dist/`.** Always edit `src/` and build.
2. **Run `pnpm typecheck` after every change** to catch type errors early.
3. **Run `pnpm test` before declaring a change complete.** All 22 tests must pass.
4. **One task at a time.** Refer to `TASKS.md` and `ACTIVE.md` for current focus.
5. **Don't add dependencies** without explicit approval. This project is intentionally minimal (zero runtime deps beyond ink/react for the CLI).
6. **Keep the API compatible.** Don't break the OpenAI or Anthropic SDK contracts.
7. **Provider keys never appear in logs or error messages.** Use `redact()` from `providers.ts`.
