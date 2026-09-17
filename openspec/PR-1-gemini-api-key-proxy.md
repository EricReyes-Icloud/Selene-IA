# PR — gemini-api-key-proxy

## Description

The Gemini API key was previously embedded in the browser bundle through `VITE_GEMINI_API_KEY`, so anyone who opened the app could extract the credential from the client code and use it directly. Chat requests also went straight from the browser to the Gemini API using the `gemini-2.5-*` models, which are now deprecated and return HTTP 404, breaking chat and title generation.

This change moves the API key out of the browser into a small Node.js + Express proxy (`server/index.js`) that owns the credential, reads it from `GEMINI_API_KEY` in `.env`, and exposes two internal routes: `POST /api/gemini/chat` and `POST /api/gemini/title`. The frontend now talks to this proxy instead of calling Gemini directly, and the server falls back across an updated model priority list on failure.

## Changes Made

**Security**

- `server/index.js` — new Express proxy; the key is read from `process.env.GEMINI_API_KEY` and the server exits with an error if it is not set
- `.env.example` — replaced `VITE_GEMINI_API_KEY` with `GEMINI_API_KEY` and `VITE_API_URL`
- `.gitignore` — ignore `server/data/` (usage logs)

**Features**

- `server/index.js` — `POST /api/gemini/chat` and `POST /api/gemini/title` routes with model fallback across `MODEL_PRIORITY`
- `server/index.js` — per-request token usage logging to `server/data/usage.log.jsonl`
- `server/index.js` — CORS restricted to `http://localhost:5173` and `http://127.0.0.1:5173`

**Client**

- `src/services/api.js` — new HTTP bridge helper: `API_BASE_URL` from `VITE_API_URL` (default `http://localhost:3001`) and `apiUrl(path)`
- `src/services/gemini.js` — rewritten from direct `GoogleGenerativeAI` usage into a `fetch`-based bridge to the proxy; the `SmartChatSession` API shape is preserved so `ChatArea.js` is unaffected

**Shared**

- `src/config/systemInstruction.js` — `buildSystemInstruction` extracted from the old client service into a shared module reused by the server

**Dev tooling / configuration**

- `package.json` — added `express` and `cors` dependencies and the `dev:server` script
- `src/config/seleneProjectKnowledge.js` — import updated with the `.js` extension for Node ESM compatibility
- `src/config/seleneProjectKnowledge.generated.js` — regenerated (prebuild): adds `src/services/api.js` and drops the direct "Google Gemini API integration" entry

**Change record**

- `openspec/changes/gemini-api-key-proxy/` — exploration, proposal, specs (`gemini-api-proxy`, `gemini-chat-service`), design, tasks, verify-report, and archive-report

## Impact

- The Gemini API key no longer ships in the browser bundle; it is only reachable from the Node server.
- End-user chat behavior is unchanged — the client `SmartChatSession` interface is preserved.
- Deployment now requires the Node proxy to run alongside Vite and `GEMINI_API_KEY` to be configured in the server environment.
- Direct browser-to-Gemini calls are rejected for origins outside `localhost:5173` / `127.0.0.1:5173` (see caveat in Notes).
- Every proxied request is logged with token counts to `server/data/usage.log.jsonl`.
- `VITE_GEMINI_API_KEY` is no longer used; anything relying on it must migrate.

## Notes

**How to test**

1. `npm install`
2. Create `.env` with `GEMINI_API_KEY=<your-key>` and `VITE_API_URL=http://localhost:3001`
3. `npm run dev:server` (starts the proxy on port 3001)
4. `npm run dev` (starts Vite on port 5173)
5. Open `http://localhost:5173` and send a chat message — chat, title generation, and model fallback all run through the proxy

**Known follow-up**

- CORS rejection for disallowed origins returns HTTP 500 instead of 403. Enforcement works (the request is blocked), but the status code should be 403.

**Models**

- `gemini-2.5-*` models are deprecated and return 404, so `MODEL_PRIORITY` in `server/index.js` is `["gemini-3.5-flash-lite", "gemini-3.6-flash"]`.