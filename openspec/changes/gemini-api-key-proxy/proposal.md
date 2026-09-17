# Proposal: Gemini API Key Proxy

## Intent

The Gemini API key is currently bundled in the browser via `import.meta.env.VITE_GEMINI_API_KEY` in `src/services/gemini.js`. Anyone who inspects the shipped JS can recover it. This change moves the key server-side and routes all Gemini calls through a local Express backend, eliminating client-side key exposure while preserving existing chat functionality. It also seeds a usage-logging foundation for future consumption limits.

## Scope

### In Scope
- Express backend (`server/index.js`, port 3001) with two endpoints: `POST /api/gemini/chat` and `POST /api/gemini/title`
- Backend owns the API key, system instruction, model fallback logic, and usage logging
- Client bridge rewrite (`src/services/gemini.js`): drop key/constants/fallback, delegate to backend, preserve `startChat`/`sendMessage`/`generateTitle` public API
- `src/services/api.js` — base URL helper (`VITE_API_URL`, default `http://localhost:3001`)
- `.env` with `GEMINI_API_KEY` (no `VITE_` prefix); `.env.example` documents the variable
- JSONL usage log (`server/data/usage.log.jsonl`) seeded from `response.usageMetadata`
- `package.json` updates: add `express`, `cors`; add `dev:server` script
- Strict CORS (origin allowlist) on the backend

### Out of Scope
- Firebase ID token validation (F1)
- Rate limiting (F1)
- Deploy to hosting (F1)
- Firestore security rules (separate ticket)
- Branding/identity changes (separate ticket)
- Automated tests (F2)
- Migration to `@google/genai` SDK (follow-up debt)

## Capabilities

### New Capabilities
- `gemini-api-proxy`: Backend proxy that owns the Gemini API key, routes chat and title requests, applies model fallback, and logs usage metadata per request

### Modified Capabilities
- `gemini-chat-service`: Client-side `GeminiService` public API preserved (`startChat`/`sendMessage`/`generateTitle`) but implementation rewritten to delegate to backend proxy instead of calling Gemini directly

## Approach

1. **Stateless Express proxy** — client sends `{ userId, chatId, message, history }` per request; backend rebuilds conversation via `@google/generative-ai` SDK (same classes, same `maxOutputTokens: 2000`), returns `{ text }`.
2. **Server owns system instruction** — `buildSystemInstruction()` extracted to shared module importable from Node (no `import.meta.env` deps). Backend constructs the full prompt.
3. **Model fallback server-side** — `gemini-2.5-flash-lite` → `gemini-2.5-flash` retry loop ported from current client code.
4. **Client bridge** — `gemini.js` rewritten as thin HTTP caller; history accumulation stays client-side; `ChatArea.js` untouched.
5. **Usage logging** — each Gemini call appends `{ ts, userId, chatId, endpoint, model, tokens }` to JSONL file. Foundation for consumption limits (no rate limiting in this ticket).

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Backend stateless, client sends history | Mirrors current semantics; survives restarts; multi-instance friendly (ADR "hosting interchangeable"); no session-map leak |
| D2 | Reuse `@google/generative-ai` SDK server-side | Zero learning curve, already installed, typed errors, built-in `usageMetadata`. Deprecation debt logged for follow-up |
| D3 | `GEMINI_API_KEY` in root `.env` without `VITE_` prefix | Vite ignores non-`VITE_` env vars; server reads via `--env-file-if-exists=.env` |
| D4 | `ChatArea.js` untouched | Public contract preserved; avoids scope creep; 352-line god-object refactored separately |
| D5 | CORS strict allowlist + userId logs only (no Firebase auth) | Appropriate for local-only F0; real auth deferred to F1 |
| D6 | JSONL usage logging, no rate limiting | Satisfies "prepared for limits" criterion without overbuilding |

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `server/index.js` | New | Express proxy: two endpoints, key ownership, fallback, CORS, usage logging |
| `src/services/gemini.js` | Modified | Client bridge rewrite: drop key, delegate to backend, preserve public API |
| `src/services/api.js` | New | Base URL helper for backend communication |
| `src/config/seleneProjectKnowledge.js` | Read-only | Imported by server for system instruction (no changes) |
| `package.json` | Modified | Add `express`, `cors` deps; add `dev:server` script |
| `.env` / `.env.example` | Modified | Add `GEMINI_API_KEY`; document without real value |
| `.gitignore` | Modified | Add `server/data/` for usage logs |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Unauthenticated endpoint burns API key if URL discovered | Med | CORS strict allowlist; document as internal; Firebase auth in F1 |
| `@google/generative-ai` SDK deprecated | Low | Accept for this ticket; log migration to `@google/genai` as follow-up debt |
| `VITE_API_URL` baked at build time | Low | Default to `http://localhost:3001`; document for future deployment |
| Payload grows with conversation length | Low | Acceptable at 2k-token scale; stateless approach chosen deliberately |

## Rollback Plan

1. Revert `src/services/gemini.js` to pre-change version (restores direct Gemini calls)
2. Remove `server/` directory, `src/services/api.js`
3. Revert `package.json` (remove `express`, `cors`, `dev:server`)
4. Remove `GEMINI_API_KEY` from `.env`
5. Run `npm install` to restore lockfile state
6. Verify chat functionality works with direct Gemini calls

## Dependencies

- `@google/generative-ai ^0.24.1` (already installed)
- `express` and `cors` (new, to be added)
- Team-shared `GEMINI_API_KEY` distributed via secret manager (outside repo)

## Success Criteria

- [ ] `GEMINI_API_KEY` not found in browser bundle (grep shipped JS)
- [ ] All Gemini requests routed through `http://localhost:3001/api/gemini/*`
- [ ] `ChatArea.js` unchanged and chat functionality preserved
- [ ] Backend logs JSONL entry per request with `{ ts, userId, chatId, endpoint, model, tokens }`
- [ ] Model fallback (flash-lite → flash) works server-side
- [ ] `generateTitle` works through backend endpoint
