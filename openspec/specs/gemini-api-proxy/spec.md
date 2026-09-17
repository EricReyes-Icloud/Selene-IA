# gemini-api-proxy Specification

## Purpose

Backend proxy that owns the Gemini API key, routes chat and title requests to the Gemini API, applies model fallback, enforces CORS, and logs usage metadata. The key MUST NEVER be accessible from the browser.

## Requirements

### Requirement: API Key Server-Side Isolation

The `GEMINI_API_KEY` SHALL be stored in root `.env` without a `VITE_` prefix. The server MUST read it via `--env-file-if-exists=.env`. The key MUST NOT be referenced in any client-side code, environment variable with `VITE_` prefix, or bundled asset.

**Acceptance**: AC(1) API key not found from browser; AC(3) key available only on server.

#### Scenario: Key not bundled in client

- GIVEN the project builds with `vite build`
- WHEN the output bundle is searched for the Gemini API key value
- THEN no match is found
- AND `.env` is listed in `.gitignore`

#### Scenario: Key accessible on server

- GIVEN `.env` contains `GEMINI_API_KEY=...` without `VITE_` prefix
- WHEN the Express server starts via `node --env-file-if-exists=.env server/index.js`
- THEN `process.env.GEMINI_API_KEY` is defined and non-empty

### Requirement: Proxy Request Routing

The backend SHALL expose two POST endpoints: `/api/gemini/chat` and `/api/gemini/title`. Both MUST accept a JSON body containing `{ userId, chatId, message, history }`. The server MUST forward requests to the Gemini API using the `@google/generative-ai` SDK and return `{ text }`.

**Acceptance**: AC(2) all Gemini requests routed through backend.

#### Scenario: Chat request succeeds

- GIVEN the backend is running on port 3001
- WHEN a POST request is sent to `/api/gemini/chat` with `{ userId, chatId, message, history }`
- THEN the backend calls Gemini and returns `{ text: "<response>" }` with HTTP 200

#### Scenario: Title generation succeeds

- GIVEN the backend is running on port 3001
- WHEN a POST request is sent to `/api/gemini/title` with `{ userId, chatId, message, history }`
- THEN the backend returns `{ text: "<title>" }` with HTTP 200

#### Scenario: Missing required fields

- GIVEN a POST request to `/api/gemini/chat` with missing `message` field
- THEN the backend returns HTTP 400 with an error message

### Requirement: Model Fallback

The backend SHALL attempt `gemini-2.5-flash-lite` first. On failure, it MUST retry with `gemini-2.5-flash`. The system instruction (identity + project knowledge) MUST be constructed server-side.

#### Scenario: Fallback triggered on primary model failure

- GIVEN the primary model `gemini-2.5-flash-lite` is unavailable or errors
- WHEN the chat endpoint processes a request
- THEN the backend retries with `gemini-2.5-flash`
- AND the response text is returned successfully

#### Scenario: Primary model succeeds

- GIVEN `gemini-2.5-flash-lite` is available
- WHEN the chat endpoint processes a request
- THEN the response is returned without fallback

### Requirement: Usage Logging

The backend MUST append a JSONL entry per Gemini call to `server/data/usage.log.jsonl`. Each entry SHALL contain `{ ts, userId, chatId, endpoint, model, tokens }` sourced from `response.usageMetadata`.

**Acceptance**: AC(5) prepared for consumption limits.

#### Scenario: Usage logged per request

- GIVEN a request completes at the chat endpoint
- WHEN the response is processed
- THEN a JSONL line is appended with `ts`, `userId`, `chatId`, `endpoint`, `model`, and `tokens`

### Requirement: CORS Enforcement

The backend MUST enforce strict CORS with an origin allowlist. Requests from non-allowed origins SHALL be rejected.

#### Scenario: Allowed origin accepted

- GIVEN the request origin is in the CORS allowlist
- WHEN a request is sent to a proxy endpoint
- THEN the request is processed normally

#### Scenario: Disallowed origin rejected

- GIVEN the request origin is NOT in the CORS allowlist
- WHEN a request is sent to a proxy endpoint
- THEN the request is rejected with HTTP 403
