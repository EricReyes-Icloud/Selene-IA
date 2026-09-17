# gemini-chat-service Specification

## Purpose

Client-side GeminiService that preserves the existing public API (`startChat`, `sendMessage`, `generateTitle`) while delegating all Gemini calls to the backend proxy instead of calling the API directly. `ChatArea.js` MUST remain untouched.

## Requirements

### Requirement: Public API Preservation

The `GeminiService` MUST expose `startChat()`, `sendMessage()` (via `SmartChatSession`), and `generateTitle()` with the same signatures and return shapes as the current implementation. `ChatArea.js` SHALL NOT be modified.

**Acceptance**: AC(4) current Gemini functionality works correctly.

#### Scenario: startChat returns a session object

- GIVEN a user initiates a new chat
- WHEN `GeminiService.startChat()` is called with `{ history }`
- THEN a session object with `sendMessage(text)` is returned

#### Scenario: sendMessage returns response text

- GIVEN an active chat session
- WHEN `session.sendMessage("hello")` is called
- THEN a promise resolving to `{ response: { text: () => string } }` is returned
- AND the text matches the backend response

#### Scenario: generateTitle returns a title string

- GIVEN a user starts a new chat with a first message
- WHEN `GeminiService.generateTitle("message")` is called
- THEN a promise resolving to a title string is returned

#### Scenario: ChatArea.js contract unchanged

- GIVEN the GeminiService rewrite is complete
- WHEN `ChatArea.js` imports and calls GeminiService
- THEN all existing call sites work without modification

### Requirement: Backend Delegation

All Gemini API calls MUST be routed through the backend proxy at the base URL configured via `VITE_API_URL` (default `http://localhost:3001`). The client MUST NOT instantiate `GoogleGenerativeAI` or reference `VITE_GEMINI_API_KEY`.

**Acceptance**: AC(2) requests routed through backend; AC(1) no key in browser.

#### Scenario: Chat call delegated to backend

- GIVEN `VITE_API_URL` is configured
- WHEN `session.sendMessage("hello")` is called
- THEN an HTTP POST is sent to `{VITE_API_URL}/api/gemini/chat`
- AND the request body contains `{ userId, chatId, message, history }`

#### Scenario: Title call delegated to backend

- GIVEN `VITE_API_URL` is configured
- WHEN `GeminiService.generateTitle("text")` is called
- THEN an HTTP POST is sent to `{VITE_API_URL}/api/gemini/title`
- AND the request body contains `{ userId, chatId, message, history }`

#### Scenario: Default base URL used when VITE_API_URL unset

- GIVEN `VITE_API_URL` is not set
- WHEN a Gemini call is made
- THEN the request targets `http://localhost:3001`

### Requirement: Client-Side History Accumulation

History MUST be accumulated client-side in the `SmartChatSession` instance. The full history array is sent with each request to the backend. The backend is stateless.

#### Scenario: History grows with messages

- GIVEN a session with one prior message
- WHEN `sendMessage("second")` is called
- THEN the request body includes both prior and current messages in `history`

#### Scenario: History preserved across requests within session

- GIVEN three messages sent in sequence
- WHEN the third `sendMessage` fires
- THEN `history` contains the first, second, and third messages
