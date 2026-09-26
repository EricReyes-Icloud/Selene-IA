# Harden the auth-to-app boot sequence in `src/main.js`

## Description

`src/main.js` owns the whole auth-to-app boot, and three verified defects made that path fragile. First, `UserService.getUserProfile` rethrows on failure (`src/services/user.js:15-18`), but `onLoginSuccess` had no `try/catch`, so the async callback handed to `onAuthStateChanged` rejected: an unhandled rejection, no app render, and the user left in front of a dead landing CTA. Second, the boot was deferred by a `setTimeout(..., 50)` even though the shell DOM had already been written synchronously one statement earlier — the delay bought nothing, and because nothing could cancel it, a logout inside that window could resurrect a dead session. Third, the app shell markup was duplicated in `index.html` and `src/main.js`, so the two copies could drift.

The fix is a single `authGeneration` token. The `onUserChange` subscription became a non-async wrapper that bumps the token on **both** branches — sign-out bumps too — so every auth continuation checks `isStale(generation)` after each `await` (`getUserProfile`, `createUserProfile`, `logout`) and after each deferred resume (the Retry click, the onboarding completion callback) before it is allowed to write the DOM. A stale continuation aborts instead of overwriting a newer auth state, which also covers the sign-out-on-third-failure path, where logout re-enters the auth callback from inside the failure handler. The boot timer is gone: `PresenceService.init` and all five initializers now run synchronously in the same task as the shell write. Login failures get a bounded recovery path — an inline error surface inside `#app` with a Retry button, capped at `MAX_ATTEMPTS = 3`, after which the app signs out and returns to the landing.

The error surface needed one non-obvious correction. The design originally specified Tailwind utilities, reasoning that `tailwind.config.js` scans `src/`. That is wrong for this component. `@tailwind base/components/utilities` exist only in `src/styles/style.css:1-3`, which is loaded by a dynamic `import()` inside `ensureLandingStyles()` (`src/landing_comp/router.js:18`); the statically imported `src/style.css` has no `@tailwind` directives and no button rules. The surface renders in the app-only boot path (persisted session + hard reload + Firestore failure), where `ensureLandingStyles()` never runs — so zero utilities would be available and the entire surface would have rendered as unstyled block text. The adopted solution is a new statically imported, scoped stylesheet, `src/styles/login-error.css`, that consumes only the `:root` tokens `src/style.css` always defines and resets browser button defaults by hand (`font-family: inherit`, `appearance: none`, `border: 0`), since no preflight loads in this path. Statically importing the landing stylesheet was evaluated and rejected: `src/style.css:37-45` and `src/styles/style.css:35-40` both style `body` at equal specificity over `font-family`, `background-color`, and `color`, from two different token sets plus two separate `*` resets, so Vite's CSS bundle order would decide whether the app shell or the landing broke.

## Changes Made

### Bug fixes — `src/main.js`

- `onLoginSuccess` now takes a `generation` and wraps `getUserProfile` and `createUserProfile` in `try/catch`. A profile-fetch failure delegates to `failLogin`; a profile-create failure re-attempts only `createUserProfile`, which is idempotent (`setDoc` with `merge: true`).
- `failLogin(user, generation, retry)` increments `loginAttempts`; at `MAX_ATTEMPTS = 3` it `await AuthService.logout()` and returns, otherwise it renders the retry surface. The sign-out branch is a no-op on the DOM because the signed-out callback owns painting the landing.
- `loginAttempts` resets to `0` when `getUserProfile` resolves, so a later unrelated failure does not inherit spent attempts.
- `AuthService.onUserChange` is now a non-async wrapper: `++authGeneration` for both branches, then `.catch((err) => console.error('Auth callback:', err))` on the returned promise, so no rejection reaches `onAuthStateChanged`. `src/services/auth.js` is unmodified.
- `isStale` guards are placed after every `await` and every deferred resume, before any DOM write: the `getUserProfile` result, the `createUserProfile` result, the onboarding-append closure, the onboarding completion callback, the Retry click, and the post-`logout` path.
- `renderLoginError(retry)` writes only `#app` — title `No pudimos cargar tu perfil`, message `Revisa tu conexión e inténtalo de nuevo.`, and a `Reintentar` button. It deliberately does not reuse the landing sign-in button, which is disabled as `Cargando Elai...` after the popup and is the dead CTA the user was previously stranded on.
- The signed-out branch was extracted into `onSignedOut()` with behavior unchanged: `cleanupActiveApp()`, remove `.onboarding-screen`, hide `#app`, add `body.landing-active`, `landingRouter.init()`, `PresenceService.cleanup()`.

### Refactors

- `proceedToApp` dropped the `setTimeout(..., 50)` wrapper. `PresenceService.init`, `initChatArea`, `initSettingsModal`, `ConfirmModal`, `initAFKMode`, and `initSidebar` now run in the same task as the shell write, inside the same `try/catch` that previously sat inside the timer callback. `proceedToApp` stays `await`-free so the stale-check-to-boot sequence remains atomic.
- `index.html` — the static app shell (`<aside id="sidebar">` + `<main id="chat-container">`) is replaced with an empty `<div id="app"></div>`, making `src/main.js` the single source of the shell. Consequence: the first paint before auth resolves is blank rather than two bare containers.

### Styles

- `src/styles/login-error.css` (new) — scoped `.login-error*` rules, statically imported from `src/main.js`. Consumes only `--bg-color`, `--text-main`, `--text-secondary`, `--accent-color`, and `--radius-md`. Adds `overflow-y: auto` because `body` is `overflow: hidden`, plus a `prefers-reduced-motion` guard.

### Change record

- `openspec/changes/main-js-hardening/` (new, untracked) — `exploration.md`, `proposal.md`, `design.md` (including a `Deviations` section documenting the A4 correction and the rejected alternatives), `tasks.md`, `STATUS.md`, and two delta specs under `specs/app-boot-sequence/` and `specs/login-error-recovery/`. `STATUS.md` records the unverified state in detail.

## Impact

**Behavior changes**

- The boot path no longer has a 50 ms asynchronous gap between the shell write and controller initialization, so the "logout inside the boot window" resurrection case has no window to occur in.
- A post-login Firestore failure now produces a visible, styled, retryable error inside `#app` instead of an unhandled rejection with no app render.
- After three failed attempts the app signs out and returns the landing with a live sign-in CTA.
- An auth-state change that lands while a profile fetch or profile create is in flight causes the in-flight continuation to abort silently, rather than writing the shell, rendering an error, or booting a dead session.
- `proceedToApp` has no `await`, so the check-then-boot sequence is not itself interruptible.

**Compatibility**

- No new runtime dependencies — vanilla ES modules only. No Firestore schema change, no change to `src/services/auth.js`, no change to any public interface.
- The only non-`src/main.js` behavior change is the empty-`#app` first paint, accepted as decision D4 in `proposal.md`.

**Risks**

- The generation token is the only defense against a stale continuation, and it is precisely the part that has never been executed. It is placed at each `await` and deferred resume by inspection, not by a passing test.
- The error surface is new user-facing UX, not a pure refactor; its visual correctness is unverified in a browser.
- Removing the timer also removes the accidental debounce between shell write and init. Every initializer was verified synchronous and paint-independent, but that verification is static.

## Notes

### Verification status — this change is implemented, not verified

**Verified**

- `npm run build` passes on the current worktree: 52 modules transformed, 2.70s, exit 0, with only the pre-existing `>500 kB` chunk-size warning on the main JS chunk.
- 11 of 12 SDD tasks implemented and independently diff-reviewed.
- The A4 styling correction was verified at the artifact level: in this build `dist/index.html` references only `assets/index-*.css`; all 8 `.login-error*` rules are present in that chunk and absent from the landing's lazy chunk `style-*.css`; and every `var()` token those rules use is defined in that same chunk. This proves the styles **ship**. It does not prove they look correct in a browser.

**Not verified — the open gap**

- **SDD task 4.2, the manual browser smoke, was never performed.** It requires a human in a browser, and it is the only acceptance evidence this project can produce for the auth state transitions. It covers: normal login and boot; a simulated Firestore failure via DevTools offline throttle showing the styled inline error plus a working Retry; three consecutive failures signing out to a landing with a live CTA; and a logout in the middle of an in-flight `await` aborting silently. That last scenario is the one that exercises the generation token — the core of this change.
- **This project has no test runner, no linter, and no type checker** (`strict_tdd: false`, empty `verify.test_command`). `npm run build` proves the code compiles. It proves nothing about auth state transitions. **A green build is not equivalent to a verified change, and nothing in this PR should be read as evidence that the fix works at runtime.** The fix is not proven.
- The SDD `verify` phase has not run and there is no verify report. The change was deliberately closed out **without archiving**, so its delta specs in `openspec/changes/main-js-hardening/specs/` were intentionally **not** synced into `openspec/specs/`. They must not be treated as a project-level contract.
- `JIRA-TBD` is still a placeholder in all four task-group headers of `tasks.md`, where `openspec/config.yaml` → `rules.tasks` requires the real ticket id.

**How to verify manually**

1. `npm run dev`, log in normally, and confirm the app boots with sidebar and chat.
2. DevTools → Network → **Offline**, hard reload with a persisted session. Expect the inline `No pudimos cargar tu perfil` error, styled (accent button, centered, readable) — this is the path the A4 correction exists for.
3. Go back Online, click **Reintentar**, and confirm the app boots.
4. Repeat the failure three times. Expect a sign-out to a **live** landing CTA, not a dead `Cargando Elai...`.
5. Offline → trigger the error → authenticate in a second tab before clicking **Reintentar**. Expect no error surface and no dead session booting.

### Out of scope — pre-existing worktree changes not part of this change

These are modified in the same worktree and are **not** part of this change; they should not be staged with it:

- `.atl/.skill-registry.cache.json` — fingerprint only.
- `.atl/skill-registry.md` — an auto-generated registry refresh that rewrites every skill path from `/home/eric_reyes/...` to `/home/yimmer/...`. Beyond being unrelated, it commits one machine's absolute home-directory paths and should stay out of the diff.
- `src/config/seleneProjectKnowledge.generated.js` — a `generatedAt` timestamp bump only.

### Follow-ups

- A `PresenceService` listener idempotency guard remains open debt; the synchronous boot and the generation token remove the trigger for it but do not add the guard.
- `src/landing_comp/router.js:54-68` (the 200 ms route fade) and the `styles/globlas.css` parallel-load rule are untouched and out of scope.
- The logout-mid-`await` race would be materially safer with an automated test; that is roadmap item F2 and is not started.
