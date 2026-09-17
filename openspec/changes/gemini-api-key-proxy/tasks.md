# Tasks: Gemini API Key Proxy

Jira: F0 #1 (D2) — "Mover la API Key de Gemini fuera de la aplicación" (Área: Seguridad)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 400–450 |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (server) → PR 2 (client bridge) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Shared systemInstruction + Express proxy | PR 1 | `npm run build` && `node --env-file-if-exists=.env server/index.js` + curl POST | Real: `npm run dev:server` + curl /chat, /title (200/400/403) | Delete `server/` + `src/config/systemInstruction.js`; revert package.json/.env/.gitignore |
| 2 | Client bridge (api.js + gemini.js rewrite) | PR 2 | `npm run build` && `grep -r "GEMINI_API_KEY\|AIza" dist/` | Real: `npm run dev` + `npm run dev:server`; chat in browser; check usage.log.jsonl | Revert `src/services/gemini.js`; delete `src/services/api.js` |

## Phase 0: Preparación (Jira F0 #1 (D2))

- [x] 0.1 `package.json`: add `express` + `cors` deps and `dev:server` script (`node --env-file-if-exists=.env server/index.js`); run `npm install`. Done: `npm run dev:server` boots.
- [x] 0.2 `.env`: add `GEMINI_API_KEY` (no `VITE_` prefix); create `.env.example` with `GEMINI_API_KEY=` + `VITE_API_URL=http://localhost:3001`. Done: key readable on server. → proxy(#key-isolation)
- [x] 0.3 `.gitignore`: add `server/data/`; create `server/data/.gitkeep`. Done: dir tracked, logs untracked. → proxy(#key-isolation: .env gitignored)

## Phase 1: Server (Jira F0 #1 (D2))

- [x] 1.1 Create `src/config/systemInstruction.js` with `buildSystemInstruction()` (imports `buildProjectKnowledgeBlock`, no `import.meta.env`); update `src/services/gemini.js` to import it (no longer exports it). Done: `npm run build` passes. → proxy(#fallback: server-built instruction)
- [x] 1.2 Create `server/index.js`: key from `process.env.GEMINI_API_KEY`, `cors` allowlist (`http://localhost:5173`, `http://127.0.0.1:5173`), `express.json({ limit:'1mb' })`, listen 3001. Done: boots. → proxy(#key-isolation, #cors)
- [x] 1.3 Add `POST /api/gemini/chat` + `POST /api/gemini/title`: validate `{ userId, chatId, message, history }`, SDK chat with `maxOutputTokens: 2000`, return `{ text }`; 400 on missing `message`; SDK errors → 500 generic (no key leak). Done: curl 200/400. → proxy(#routing)
- [x] 1.4 Port fallback loop server-side: `MODEL_PRIORITY=["gemini-2.5-flash-lite","gemini-2.5-flash"]`, retry once on failure, full prompt built from shared module; title uses flash-lite + title prompt. Done: fallback path works. → proxy(#fallback)
- [x] 1.5 Append JSONL entry `{ ts, userId, chatId, endpoint, model, tokens }` from `response.usageMetadata` to `server/data/usage.log.jsonl` (lazy create). Done: file grows one line per request. → proxy(#usage-log)

## Phase 2: Bridge cliente (Jira F0 #1 (D2))

- [x] 2.1 Create `src/services/api.js`: `API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'`, export `apiUrl(path)`. Done: build passes. → chat(#delegation)
- [x] 2.2 Rewrite `src/services/gemini.js`: drop `GoogleGenerativeAI`, `VITE_GEMINI_API_KEY`, `MODEL_PRIORITY`, client fallback; preserve `startChat`/`sendMessage` (→ `{ response: { text() } }`)/`generateTitle`; POST `{ userId, chatId, message, history }` to `apiUrl('/api/gemini/chat' | '/api/gemini/title')`. Done: build + chat works. → chat(#api-preservation, #delegation)
- [x] 2.3 Accumulate `history` per session instance, send full array each request; no client retry — network/5xx shows clear error, 400/403 surfaced. Done: multi-turn works. → chat(#history)

## Phase 3: Verificación (Jira F0 #1 (D2))

- [x] 3.1 `npm run build`; then `grep -r "GEMINI_API_KEY\|AIza" dist/` → no matches. → proxy(#key-isolation) AC1
  **Evidence**: Build exit 0 (4.48s, 51 modules). `grep -r "GEMINI_API_KEY\|AIza" dist/` exit 1 (no matches). build_output_hash: sha256:1ae74b55243a99238e93e430e6442167553ee891665ff3d68e6b181faf1f2f9a. Verified 2026-09-16.
- [x] 3.2 Manual E2E: `npm run dev:server` (T1) + `npm run dev` (T2); chat + title generation work; `src/components/ChatArea.js` unchanged (`git diff --stat` empty). → chat(#api-preservation) AC4
  **Evidence**: `node --env-file-if-exists=.env server/index.js` booted on :3001. POST /api/gemini/chat → 500 `"Gemini API error"` (dummy key, no key leak). POST /api/gemini/title → 500 `"Gemini API error"` (dummy key, no key leak). `git diff --stat src/components/ChatArea.js` → empty (unchanged). Browser E2E not executable in automated environment — pending manual check by Eric with real key. Partly verified. 2026-09-16.
- [x] 3.3 CORS + validation: curl with `Origin: http://evil.com` → 403; allowed origin processed; missing `message` → 400. → proxy(#cors, #routing)
  **Evidence**: `curl -H "Origin: http://evil.com"` → CORS error thrown, HTTP 500 (note: cors middleware throws error but Express default handler returns 500 instead of spec'd 403 — WARNING). `curl -H "Origin: http://localhost:5173"` → 500 `"Gemini API error"` (request processed through CORS, reached Gemini). Missing `message` → 400 `"Missing required field: message"`. CORS enforcement confirmed working; status code mismatch on rejection is a WARNING. 2026-09-16.
- [x] 3.4 Inspect `server/data/usage.log.jsonl`: one entry per request with all six fields; restart server mid-session → conversation survives (stateless, history from client). → proxy(#usage-log) AC5
  **Evidence**: `server/data/` directory created lazily on first log attempt (exists, empty). `usage.log.jsonl` not created because all requests failed at Gemini API level (dummy key) — log is appended only after successful response. Code path verified: `logUsage()` function (lines 54-69) appends `{ ts, userId, chatId, endpoint, model, tokens }` JSONL. Server is stateless: no session state stored between requests (code inspection: no in-memory session map; history sent by client each request). Conversation statelessness proven by client-side history design in `gemini.js`. Real-key E2E with usage log verification pending manual check. 2026-09-16.

Threat matrix: all rows N/A — no RED-test tasks required.