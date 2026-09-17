# Design: Gemini API Key Proxy

## Technical Approach

Introduce a stateless Express proxy (`server/index.js`) that owns the Gemini API key, system instruction, and model fallback logic. The client-side `GeminiService` (`src/services/gemini.js`) is rewritten as a thin HTTP bridge that preserves the existing `startChat`/`sendMessage`/`generateTitle` contract while delegating all Gemini calls to the backend. This eliminates client-side key exposure per the proposal's security goal.

## Architecture Decisions

| # | Decision | Choice | Alternatives Considered | Rationale |
|---|----------|--------|------------------------|-----------|
| D1 | Statefulness | Stateless (client sends history) | Stateful session map keyed by `(userId, chatId)` | Mirrors current semantics; survives restarts; multi-instance friendly per ADR "hosting interchangeable"; no session-map leak risk. |
| D2 | SDK choice | `@google/generative-ai` server-side (already installed) | Raw `fetch` to REST API | Zero learning curve, typed errors, built-in `usageMetadata`. Deprecation debt logged for follow-up. |
| D3 | Env loading | `node --env-file-if-exists=.env server/index.js` | `dotenv` package | Node 22.22.3 supports `--env-file-if-exists` natively; zero-dependency approach. No extra package. |
| D4 | CORS | Strict origin allowlist via `cors` middleware | No CORS (rely on same-origin) | Dev runs on different ports (5173 + 3001); production may also differ. Allowlist is explicit safety boundary. |
| D5 | Auth | CORS + userId logs only (Firebase auth deferred) | Firebase ID token validation | Appropriate for local-only F0; real auth is F1 non-goal. |
| D6 | Usage logging | JSONL append to `server/data/usage.log.jsonl` | Structured stdout only | Persistent log file enables future analytics; `server/data/` added to `.gitignore`. |

## Data Flow

```
Browser (Vite :5173)                    Backend (Express :3001)              Gemini API
┌─────────────────┐                    ┌──────────────────────┐            ┌──────────────┐
│  ChatArea.js    │                    │  POST /api/gemini/*  │            │              │
│  (untouched)    │                    │                      │            │              │
└────────┬────────┘                    └──────────┬───────────┘            └──────┬───────┘
         │                                       │                               │
         │  session.sendMessage(text)            │                               │
         ▼                                       ▼                               │
┌─────────────────┐    HTTP POST (JSON)  ┌──────────────────────┐            │
│  gemini.js      │ ──────────────────→  │  Validate body       │            │
│  (bridge)       │  {userId,chatId,     │  Build system instr. │            │
│  history[]      │   message,history}   │  Start SDK chat      │            │
└─────────────────┘                      │  Execute fallback    │ ──────────→│
                                         │  Log usageMetadata   │  ◄─────────│
         ◄────────────────────────────── │  Return { text }     │  Response  │
         │  { response: { text() } }     └──────────────────────┘            │
         │                                       │                            │
         │                                       ▼                            │
         │                               ┌──────────────────┐                │
         │                               │  usage.log.jsonl  │                │
         │                               │  (append entry)   │                │
         │                               └──────────────────┘                │
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `server/index.js` | Create | Express proxy: two endpoints, CORS middleware, key ownership, SDK fallback, JSONL usage logging |
| `src/services/gemini.js` | Modify | Rewrite as HTTP bridge: drop API key, model constants, fallback logic; delegate to backend; preserve `startChat`/`sendMessage`/`generateTitle` contract |
| `src/services/api.js` | Create | Base URL helper: reads `VITE_API_URL` (default `http://localhost:3001`), provides `apiUrl(path)` function |
| `.env` | Modify | Add `GEMINI_API_KEY=...` (no `VITE_` prefix) |
| `.env.example` | Create | Document `GEMINI_API_KEY=` (empty) and `VITE_API_URL=http://localhost:3001` |
| `package.json` | Modify | Add `express`, `cors` deps; add `dev:server` script (`node --env-file-if-exists=.env server/index.js`) |
| `.gitignore` | Modify | Add `server/data/` (usage logs directory) |

### Unchanged Files (confirmed)

| File | Reason |
|------|--------|
| `src/components/ChatArea.js` | Contract preserved via `GeminiService` interface |
| `src/config/seleneProjectKnowledge.js` | Read-only import; no `import.meta.env` deps |
| `src/config/seleneProjectKnowledge.generated.js` | Pure data; Node-importable as-is |

## Interfaces / Contracts

### POST /api/gemini/chat

```json
// Request
{
  "userId": "firebase-uid",
  "chatId": "firestore-chat-id",
  "message": "user message text",
  "history": [{ "role": "user"|"model", "parts": [{ "text": "..." }] }]
}

// Response 200
{ "text": "model response text" }

// Response 400
{ "error": "Missing required field: message" }

// Response 403
{ "error": "Origin not allowed" }

// Response 500
{ "error": "Gemini API error" }
```

### POST /api/gemini/title

Same request/response shape. Server uses `gemini-2.5-flash-lite` with title-generation prompt. Fallback: `gemini-2.5-flash`.

### Client Bridge (`GeminiService` public API)

```js
// Preserved signatures — ChatArea.js untouched
GeminiService.startChat() → SmartChatSession
SmartChatSession.sendMessage(text) → Promise<{ response: { text: () => string } }>
GeminiService.generateTitle(message) → Promise<string>
```

### Base URL Helper (`src/services/api.js`)

```js
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
export function apiUrl(path) { return `${API_BASE_URL}${path}`; }
```

## Server Design

### Express Setup (`server/index.js`)

1. **Imports**: `express`, `cors`, `@google/generative-ai` (same package, isomorphic).
2. **Key**: `process.env.GEMINI_API_KEY` (loaded by `--env-file-if-exists=.env`).
3. **System instruction**: imports `buildSystemInstruction()` from `../src/services/gemini.js` — extracted as a pure function (no `import.meta.env` dependency). Server constructs full prompt per request.
4. **CORS**: `cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] })` — configurable via env if needed.
5. **JSON body parser**: `express.json({ limit: '1mb' })`.
6. **Routes**: `POST /api/gemini/chat`, `POST /api/gemini/title`.
7. **Error handling**: try/catch per route; Gemini SDK errors caught and mapped to HTTP 500 with generic message (no key leakage in error responses).
8. **Usage logging**: `appendFileSync('server/data/usage.log.jsonl', JSON.stringify(entry) + '\n')` — synchronous append per request; simple, correct for single-process dev.

### Model Fallback (server-side)

Same `MODEL_PRIORITY` array: `["gemini-2.5-flash-lite", "gemini-2.5-flash"]`. Port the retry loop from current `SmartChatSession.switchModel()` to a server-side helper. On failure of primary model, retry once with secondary. If both fail, return 500.

### Startup

```
node --env-file-if-exists=.env server/index.js
```

Port 3001. `package.json` script: `"dev:server": "node --env-file-if-exists=.env server/index.js"`. Concurrent dev: user runs `npm run dev:server` (terminal 1) + `npm run dev` (terminal 2). No `concurrently` dependency added — YAGNI for F0.

## Bridge Client Design (`src/services/gemini.js`)

### What stays in memory (client-side)

- `history` array — accumulated per `SmartChatSession` instance, sent with every request.
- `modelIndex` — tracked client-side for logging/debugging only; actual fallback lives server-side.

### Request/Response Shapes

- Client sends `{ userId, chatId, message, history }` to backend.
- Backend returns `{ text }`.
- Client wraps in `{ response: { text: () => string } }` to match `ChatArea.js` contract.

### Error Handling

- **Network error / 5xx**: Client shows a user-friendly error message. No retry on client side — the server handles model fallback.
- **400 validation error**: Client surfaces the error message.
- **403 CORS**: Client surfaces "Connection refused" or similar generic message.

### Fallback Behavior

The client does NOT implement model fallback. The server handles `gemini-2.5-flash-lite` → `gemini-2.5-flash` retry. If the server returns 500, the client shows an error. This keeps the client thin.

## CORS Configuration

### Allowlist (dev origins)

| Origin | Purpose |
|--------|---------|
| `http://localhost:5173` | Vite dev server (default) |
| `http://127.0.0.1:5173` | Vite dev server (localhost alias) |

### Configuration via env (optional)

The CORS origin list is hardcoded in `server/index.js` for F0 simplicity. Future: read from `CORS_ORIGINS` env var (comma-separated). No runtime complexity added now.

## Usage Logging

### Format (JSONL)

```json
{
  "ts": "2026-09-16T14:30:00.000Z",
  "userId": "firebase-uid",
  "chatId": "firestore-chat-id",
  "endpoint": "chat",
  "model": "gemini-2.5-flash-lite",
  "tokens": { "prompt": 150, "candidates": 80, "total": 230 }
}
```

### Storage

- Path: `server/data/usage.log.jsonl`
- Added to `.gitignore`: `server/data/`
- Created lazily on first log entry (no startup directory creation needed).

### What gets logged

- Every Gemini API call (both `/chat` and `/title`).
- Source: `response.usageMetadata` from the SDK response.
- Model used (may differ from requested if fallback triggered).

## Key Management

### .env Layout

```
GEMINI_API_KEY=actual-key-value-here
# VITE_API_URL=http://localhost:3001  # optional, defaults to localhost:3001
```

### Why NOT `VITE_` prefix

Vite statically injects `import.meta.env.VITE_*` values into the client bundle at build time. A `VITE_GEMINI_API_KEY` would be recoverable from the shipped JS. `GEMINI_API_KEY` (no prefix) is invisible to Vite and only accessible via `process.env` on the server.

### Bundle proof

After implementation, verify: `grep -r "GEMINI_API_KEY\|AIza" dist/` returns no matches.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. This change introduces an HTTP server with two POST endpoints and CORS middleware — standard web server patterns, no shell/process/VCS integration.

## Migration / Rollout

No migration required. This is a dev-only change (F0 scope). The `VITE_GEMINI_API_KEY` env var is deprecated but harmless — Vite ignores non-`VITE_` vars, and the old var can be removed from the developer's `.env` at their discretion.

Rollback: revert `gemini.js` to pre-change version (restores direct Gemini calls), remove `server/` directory, remove `src/services/api.js`, revert `package.json`.

## Open Questions

- [ ] Should `buildSystemInstruction()` be extracted to a shared module (`src/config/systemInstruction.js`) or remain importable from `gemini.js`? The server can import from `gemini.js` directly since it has no `import.meta.env` dependency in that function.
- [ ] Should `server/data/` directory be pre-created in the repo (with `.gitkeep`) or created lazily on first log? Lazy is simpler but may confuse first-time contributors.
