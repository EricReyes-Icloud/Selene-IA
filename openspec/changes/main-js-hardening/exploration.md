## Exploration: main-js-hardening

### Current State

`src/main.js` (142 lines) owns the full auth-to-app boot sequence. On `DOMContentLoaded` it builds a landing `Router`, then subscribes to Firebase auth via `AuthService.onUserChange` (a direct passthrough to `onAuthStateChanged`, `src/services/auth.js:29-31`). On login, `onLoginSuccess` (`main.js:106-122`) fetches the Firestore profile (`UserService.getUserProfile`, which rethrows on failure — `src/services/user.js:15-18`) and either routes to onboarding or calls `proceedToApp`, which writes the app shell via `innerHTML` and then boots all controllers inside a `setTimeout(..., 50)` (`main.js:67-103`). On logout, `cleanupActiveApp` (`main.js:44-49`) destroys chat/sidebar controllers and re-inits the landing router. There is no test suite: no test script in `package.json`, no test files in the repo. Verification for this change is `npm run build` plus manual smoke testing.

All three scoped findings were confirmed against the code. One additional observation strengthens #4 (see Risks). No evidence contradicts the adjudicated findings: repo-wide grep for `innerHTML` combined with `${` in `src/` returns nothing (#6 stays false), and `auth.js:30` does return the unsubscribe but Vite full-reloads `main.js` on edit so no HMR duplication occurs (#3 stays out of scope).

### Affected Areas

- `src/main.js` — all three findings live here (login path, boot timer, shell template)
- `src/services/auth.js` — possible error-boundary location for #7 (currently a bare passthrough)
- `src/services/user.js` — read-only context for #7 (rethrow behavior confirmed, no change needed)
- `index.html` — static shell removal candidate for #1
- `src/components/ChatArea.js`, `src/components/Sidebar.js`, `src/services/presence.js` — read-only verification for #4 (all init functions are synchronous DOM lookups safe to call immediately after `innerHTML` is set; `PresenceService.init` only attaches RTDB listeners and registers document/window listeners)

### Approaches

**#7 — Unhandled rejection in the login path**

1. **Try/catch inside `onLoginSuccess`** — wrap the `getUserProfile` / `createUserProfile` awaits, render an inline error with a retry action on failure.
   - Pros: boundary sits where the failure context lives (can distinguish profile-fetch failure from profile-create failure, which leave the UI in different states); smallest blast radius; `auth.js` untouched.
   - Cons: the `onUserChange` callback can still throw via other paths in the future; relies on discipline rather than a guarantee.
   - Effort: Low.
2. **Guard the `onUserChange` callback** — add try/catch (or `.catch()`) around `await onLoginSuccess(user)` at `main.js:124-141`.
   - Pros: single choke point; guarantees no rejection ever escapes to `onAuthStateChanged`, regardless of what `onLoginSuccess` grows into.
   - Cons: error handling sits far from the failure context; still needs to call into a UI routine owned by the login path.
   - Effort: Low.
3. **Wrap inside `AuthService.onUserChange`** — catch callback rejections centrally in the service.
   - Pros: every current and future subscriber is protected by default.
   - Cons: the service has no UI context, so it can only log and swallow (or re-route to a global handler that does not exist yet); hides per-call failure semantics behind a generic boundary; changes a currently transparent passthrough.
   - Effort: Low.

**#4 — Superstitious `setTimeout` boot delay**

1. **Run boot synchronously** — move the `setTimeout` body directly into `proceedToApp`.
   - Pros: removes the 50ms delay and the entire resurrection window in one deletion; every init callee was verified sync-safe (`getElementById` lookups post-`innerHTML`, `createElement`/`appendChild`, RTDB listener attachment — none require paint, layout, or async readiness).
   - Cons: none found; the 50ms bought nothing (shell DOM is written synchronously at `main.js:60-65` immediately before).
   - Effort: Low.
2. **`requestAnimationFrame` instead of `setTimeout`** — defer boot to the next paint.
   - Pros: principled (waits for one real signal instead of an arbitrary duration) if boot were heavy enough to block first paint.
   - Cons: boot is not heavy (listener attachment and DOM creation); still introduces an async gap that needs cancellation; solves a problem the code does not have.
   - Effort: Low.
3. **Cancellable boot token (generation counter)** — increment a counter on every `proceedToApp` / logout, capture it in the boot closure, abort if stale; also store and clear the timer handle in `cleanupActiveApp`.
   - Pros: closes the logout-inside-the-window resurrection hole and the overlapping-auth-callback hole (the `await`s in `onLoginSuccess` leave an async gap even with fully synchronous boot).
   - Cons: slightly more machinery than a plain deletion; must be kept correct as the sequence evolves.
   - Effort: Low.

**#1 — Duplicated app shell markup**

1. **Empty `<div id="app"></div>` in `index.html`; JS owns the shell** — single source of truth in `main.js:60-65`.
   - Pros: eliminates drift between the two copies permanently; verified safe (only consumers of `#sidebar`/`#chat-container` are `Sidebar.js` and `ChatArea.js`, both looked up at init time after the shell is written; nothing depends on the nodes at parse time).
   - Cons: first paint before Firebase auth resolves is blank instead of empty shell boxes — but the static shell is bare unstyled containers, not a skeleton, so nothing of value is lost; the landing overwrites `#app` via `Router.handleRoute` (`router.js:55`) within ~200ms of auth resolution either way.
   - Effort: Low.
2. **Keep the static shell as pre-paint markup** — change nothing, document the duplication as intentional.
   - Pros: zero risk, zero diff.
   - Cons: the two copies can drift (they already differ by the `.main-layout.app-active` wrapper); future editors must remember to update both.
   - Effort: None.
3. **Shared template constant imported by both** — e.g. a small module exporting the shell HTML string.
   - Pros: DRY without changing paint behavior.
   - Cons: `index.html` cannot import a JS module for its static markup without a build-time or runtime injection step — realistically this means runtime injection, which defeats the pre-paint purpose; machinery disproportionate to two lines of markup.
   - Effort: Low-Medium, unjustified.

### Recommendation

One change, not three. All three findings touch `src/main.js` and the same boot sequence; splitting them would produce three diffs that conflict textually and three verification passes over the same manual smoke test. Estimated total is well under the 400-line review budget (tens of lines changed).

- **#7**: Combine approach 1 + 2 — try/catch in `onLoginSuccess` (owns the per-failure UI and retry) plus a `.catch()` safety net on the `onUserChange` callback so no rejection can ever escape to Firebase. Do not touch `AuthService` (approach 3 hides semantics for no gain). Retry path: re-invoke `onLoginSuccess` for fetch failures; for create failures (which leave `#app` emptied and hidden) the handler must restore a visible state before retrying. Note the secondary dead end found during exploration: after a successful popup login the landing sign-in button stays disabled with loading text, so a post-auth profile failure strands the user on a landing page whose only CTA is dead — the error UI must live outside that button.
- **#4**: Approach 1 + 3 — delete the `setTimeout` (run boot synchronously) and add a generation counter guarding `proceedToApp` against stale auth callbacks across the `await` gaps in `onLoginSuccess`. Do not use `requestAnimationFrame` (no heavy work to defer).
- **#1**: Approach 1 — empty `#app` in `index.html`, JS-owned shell. This is a judgment call, not a bug: state that plainly in the proposal.

### Risks

- **No automated verification exists.** `npm run build` proves the bundle compiles; every acceptance criterion (error UI appears, retry works, no resurrection on rapid logout, landing still renders) requires manual smoke testing, including DevTools-throttled Firestore failure simulation for #7. Say so in the proposal; do not claim coverage the repo cannot provide.
- **#7 error UX is new surface, not a refactor.** The app currently has no error surface for login-path failures; whatever the change renders (inline message, retry button) is a product decision, however small. Keep it minimal and consistent with existing styling, but it needs developer sign-off on copy and placement.
- **Presence listener duplication (supporting evidence for #4, not new scope).** `PresenceService.init` registers document/window listeners (`startActivityTracker`, `setupVisibilityListener`, `setupBeforeUnloadListener`) with no idempotency guard, and `cleanup()` only runs on the logout path. A double `proceedToApp` without intervening logout (exactly what the timer resurrection causes) double-registers these listeners. Synchronous boot plus the generation token removes the trigger; hardening `PresenceService` itself is out of scope but should be logged as follow-up debt.
- **`Router.handleRoute` has its own 200ms `setTimeout` (`router.js:54-68`)** for a fade transition. It is out of scope (landing cosmetics, not the app boot sequence) but the proposal should name it so a reviewer does not confuse the two timers.
- **`server/index.js` is out of scope.** None of these approaches touch the backend; no new dependencies; vanilla ES modules only.

### Ready for Proposal

Yes — with four developer answers needed before or during the proposal phase:

1. **#7 error UI**: what should the user see on profile-fetch failure (inline message in `#app`, toast, other), in which language (UI copy is Spanish — match it?), and what is the retry affordance (button re-invoking `onLoginSuccess`, prompt to reload, auto-retry)?
2. **#7 create-failure state**: on `createUserProfile` failure the app has already emptied `#app` — should retry re-attempt creation, or fall back to read-then-create?
3. **#7 persistent failure**: after N failed retries (or if the user closes the error), should the app sign the user out to restore the landing CTA, or leave the session authenticated-but-unbooted (reload then retries silently via persisted auth)?
4. **#1 confirmation**: accept blank first paint (empty `#app`) in exchange for a single source of truth, or keep the static shell untouched and drop #1 from the change?
