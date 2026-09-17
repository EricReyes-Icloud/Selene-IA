## Exploration: gemini-api-key-proxy

### Current State

Selene-IA is a vanilla JS SPA (Vite 7.2.4, ES modules, Tailwind 3.4.17) with Firebase (Auth + Firestore) and Google Gemini. The Gemini API key lives in the browser bundle:

- `src/services/gemini.js` (119 lines) reads `import.meta.env.VITE_GEMINI_API_KEY` (line 5) and instantiates `GoogleGenerativeAI(API_KEY)` client-side. Vite statically bundles `VITE_`-prefixed env vars into the client, so the key is recoverable from the shipped JS. Confirmed: the key is referenced nowhere else in `src/` (grep across `*.js` — only `gemini.js:5`; `firebase-config.js` uses `VITE_FIREBASE_*`, which are public by design).
- `ChatArea.js` (352 lines, god-object) consumes ONLY the public contract `GeminiService.startChat()`, `chatSession.sendMessage(text)` (then `result.response.text()`, non-streaming), and `GeminiService.generateTitle(text)`. This contract MUST be preserved to avoid touching `ChatArea.js`.
- `SmartChatSession` (inside `gemini.js`): in-memory `history`, `startChat({ history, generationConfig: { maxOutputTokens: 2000 } })`, `getHistory()` after each send; model fallback `MODEL_PRIORITY = ["gemini-2.5-flash-lite", "gemini-2.5-flash"]` via `switchModel()` (retry on error). `generateTitle()` uses `gemini-2.5-flash-lite` with a Spanish short-title prompt and a client fallback `message.substring(0, 20) + "..."`.
- `buildSystemInstruction()` builds a Spanish Selene identity block (creator, company, Antigravity lineage) plus a project-knowledge block from `src/config/seleneProjectKnowledge.js` + `seleneProjectKnowledge.generated.js`. The generated file is COMMITTED (not gitignored) and pure data (no `import.meta.env`) — importable from Node.
- Repo facts: `package.json` has `"type": "module"`, deps `@google/generative-ai ^0.24.1` + `firebase ^12.6.0` (+ abandoned `git` package, pre-flagged debt). No `server/` dir, no `vite.config.js`, no `.env` (`.gitignore` line 26 already covers `.env`). `node_modules` is NOT installed in the working copy (lockfile exists). Runtime Node v22.22.3 available (supports `--env-file-if-exists`).
- ADR Decision 1 (docs/decisions/technical-decisions.md): own server, hosting interchangeable, hexagonal later.

**Behavioral quirks to preserve, not fix (out of scope):**
1. One `SmartChatSession` per app run — history mixes messages from all chats opened since the last `reset()`/`loadChat()`.
2. Reloading a chat restarts the session with EMPTY history — Firestore is never re-seeded into the session (context lost on reload today).

### Affected Areas

- `src/services/gemini.js` — rewritten as a thin client bridge: API key removed, same public API (`startChat` / `sendMessage` → `{ response.text() }` / `generateTitle`), history accumulation kept client-side, all Gemini calls delegated to the backend.
- `src/components/ChatArea.js` — NOT modified (contract preserved).
- NEW `server/index.js` — Express proxy: `POST /api/gemini/chat` and `POST /api/gemini/title`; owns key, system instruction, fallback, usage logging.
- NEW `src/services/api.js` — base URL helper (`VITE_API_URL`, default `http://localhost:3001`).
- `package.json` — add `express` + `cors` deps; add `dev:server` script (optionally `concurrently`).
- `.env` — add `GEMINI_API_KEY` (NO `VITE_` prefix → Vite never bundles it; server reads it via `--env-file-if-exists=.env`); retire `VITE_GEMINI_API_KEY`.
- `.gitignore` (design-time) — decide whether `server/data/` (usage logs) is ignored.

### Approaches

**Session/history handling**
1. **Stateless backend, client sends history** — bridge keeps the current in-memory history array; request body `{ userId, chatId, message, history }`; backend rebuilds conversation (`startChat({ history })` or `generateContent`) and returns `{ text }`.
   - Pros: mirrors current semantics exactly; survives restarts; multi-instance friendly (Cloudflare-Workers-style hosting, per ADR); no session-map leak.
   - Cons: payload grows with conversation length (acceptable at 2k-token scale).
   - Effort: Low.
2. **Stateful backend session map** keyed by `(userId, chatId)` — backend answers with `{ chatId }` and tracks history in memory.
   - Pros: smaller requests.
   - Cons: lost on restart; breaks on multi-instance hosting; diverges from the "hosting interchangeable" ADR posture; more failure modes for juniors.
   - Effort: Medium.

1. **Reuse @google/generative-ai SDK server-side** — the SDK is isomorphic (official samples use `process.env.API_KEY`, global fetch, Node ≥ 18). Same classes (`GoogleGenerativeAI`, `getGenerativeModel`, `startChat`, `generateContent`, `generationConfig.maxOutputTokens`); the fallback loop and system-instruction code port nearly verbatim.
   - Pros: zero learning curve, already a dependency, typed errors, built-in `usageMetadata`.
   - Cons: Google is moving this package to `@google/genai` (deprecation debt — keep installed version for this ticket, flag follow-up).
   - Effort: Low.
2. Raw `fetch` to Gemini REST API (`generateContent` endpoint).
   - Pros: fewer abstractions.
   - Cons: hand-rolled auth header, error parsing, content schema, token-per-request risks of bugs; strictly more code and more ways for a junior to break it.
   - Effort: High.

**Local server shape**
1. **Express standalone (`server/index.js`, port 3001) + `VITE_API_URL`** — frontend calls `http://localhost:3001` in dev; CORS enabled for dev origins.
   - Pros: matches ADR Decision 1; dev/prod parity (same server code runs in prod on any host); clearest boundary; junior-legible single route file.
   - Cons: two processes in dev (document or add `concurrently`); CORS needed in dev.
   - Effort: Low-Medium.
2. Vite dev middleware/proxy (`vite.config.js` `server.proxy`).
   - Pros: single dev port.
   - Cons: dev-only sugar; prod still needs the standalone server; adds a config file where none exists today; hides the architecture boundary from juniors.
   - Effort: Medium.
3. Node built-in `http` (no Express).
   - Pros: zero deps.
   - Cons: hand-rolled routing, body parsing, CORS; Express is already the decided stack.
   - Effort: Medium.

**Usage logging (criterion 5 — "prepared for limits", NO rate limiting yet)**
- Frontend already holds `user.uid` and `chatId` (`targetChatId`) at send time → include `{ userId, chatId }` in request bodies.
- Backend reads `response.usageMetadata` (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`) and appends one JSONL line per Gemini call: `{ ts, userId, chatId, endpoint, model, tokens }` → `server/data/usage.log.jsonl` (or structured stdout). Title calls logged too. This creates the data foundation for consumption limits without implementing them.

### Recommendation

1. **Stateless Express proxy** (`server/index.js`, port 3001): endpoints `POST /api/gemini/chat` and `POST /api/gemini/title`; env `GEMINI_API_KEY` from root `.env` (no `VITE_` prefix) via `node --env-file-if-exists=.env`; CORS for the dev origin; JSONL usage log seeded from `usageMetadata`.
2. **Reuse the installed `@google/generative-ai` SDK server-side** with the same fallback loop (`gemini-2.5-flash-lite` → `gemini-2.5-flash`) and `maxOutputTokens: 2000`. Backend owns the full system instruction (identity + knowledge block) so the prompt and the key live together server-side.
3. **Client bridge** (`src/services/gemini.js` rewrite): preserve `startChat`/`sendMessage`/`generateTitle` exactly; keep history accumulation; drop the key, the model constants, and the fallback logic; call the proxy via `src/services/api.js`. `ChatArea.js` untouched.
4. **Non-streaming JSON responses only** (`{ text }`) — parity with `result.response.text()`; no SSE in this ticket.
5. **Single source of truth for the system instruction**: extract `buildSystemInstruction` into a module importable by both server and (for reference) client — design phase decides exact location (`src/config/` is importable from Node since it has no `import.meta.env`, but a shared folder is cleaner).

### Risks

- **Unauthenticated proxy endpoint**: anyone who discovers the backend URL can burn the key. Mitigations: tight CORS, treat as internal, document clearly; real auth (Firebase ID token verification) and rate limiting are F1+/follow-up — explicitly out of scope to avoid scope creep.
- Preserved quirks (mixed-context session, no context restore on chat reload) may surprise users; fixing them is a separate ticket.
- `@google/generative-ai` is deprecated in favor of `@google/genai` — accept for this ticket, log as follow-up debt.
- `VITE_API_URL` is baked at build time in static hosting — document the default and fallback.
- Legacy branding (Antigravity / Luis Mario C. in the prompt, `antigravity-google` package name) — separate ticket, do NOT touch here.
- `node_modules` absent in the working copy — apply phase needs `npm install` first; lockfile exists.
- Abandoned `git` npm dependency — pre-existing, unrelated to this change.

### Ready for Proposal

Yes — the orchestrator should tell the user: scope is confirmed small (approx. 250–350 changed lines, low 400-line budget risk), the decision (Express standalone + SDK server-side + stateless client-sent history) is validated against the code and the ADR, and the proposal can now define intent, scope, and rollback.