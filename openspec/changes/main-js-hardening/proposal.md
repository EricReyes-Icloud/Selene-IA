# Proposal: main-js-hardening

## Intent

Three verified defects in the auth-to-app boot sequence: an unhandled login-path rejection (#7) strands users on a dead landing CTA; a 50ms boot timer (#4) opens a stale-callback resurrection window; duplicated shell markup (#1) risks drift.

## Scope

### In Scope
- `src/main.js`: #7, #4, #1
- `index.html`: empty `<div id="app"></div>` (D4)
- `src/services/auth.js`: NOT touched (agreed approach)

### Out of Scope
- `PresenceService` listener idempotency guard (follow-up debt; sync boot + generation token removes the trigger)
- `Router.handleRoute`'s 200ms fade timer (`src/landing_comp/router.js:54-68`)
- `server/index.js` / backend entirely
- Automated tests (roadmap F2)

## Capabilities

### New Capabilities
- `app-boot-sequence`: JS-owned shell, synchronous boot, generation counter for stale callbacks
- `login-error-recovery`: inline error + retry on profile failure, bounded attempts, sign-out

### Modified Capabilities
None

## Approach

1. **#7** — try/catch in `onLoginSuccess` for the retry UI, PLUS `.catch()` on the `onUserChange` callback so no rejection reaches `onAuthStateChanged` (`AuthService` untouched).
2. **#4** — delete the `setTimeout`, boot synchronously; a generation counter aborts stale callbacks across `onLoginSuccess`'s `await` gaps. `requestAnimationFrame` rejected (nothing to defer).
3. **#1** — empty `#app` per D4; `main.js` is the single source of truth.

**Design constraint (easy to miss):** D3 signs out *from inside the error path*, so logout re-enters the auth callback. The generation counter MUST cover that path, or sign-out loops into the failure handler.

## Decisions (settled)

| # | Decision |
|---|----------|
| D1 | Fetch failure → inline `#app` message + Retry, not the landing Google button (disabled after popup). Spanish copy. |
| D2 | Fetch failure → re-invoke `onLoginSuccess`; create failure → re-attempt `createUserProfile` (idempotent `setDoc`, `merge: true`). |
| D3 | 3 failed attempts → sign out to landing with live CTA. |
| D4 | `index.html` ships empty `#app`; `main.js` owns the shell; blank first paint accepted. |

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/main.js` | Modified | All three findings |
| `index.html` | Modified | Static shell removed |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| No test suite; ACs manual | High | `npm run build` + throttled-Firestore smoke (limits below) |
| Error-path counter gap → sign-out loop | Med | Constraint above; smoke: 3 failures |
| Error surface is new UX, not refactor | Med | Minimal styling; pinned by D1–D3 |

## Rollback Plan

Single-commit revert of `src/main.js` + `index.html` — empty shell inert after revert; smoke-test a login.

## Dependencies

**None.** Vanilla ES modules only.

## Success Criteria

- [ ] `npm run build` passes
- [ ] Login failure → inline error + Retry in `#app`; 3 failures → sign-out to live CTA
- [ ] No boot resurrection on rapid logout (manual)
- [ ] App behavior otherwise unchanged

**Verification limits:** no test suite — error-path ACs manually provable only. **Size estimate:** tens of lines, under the 400-line budget (`ask-on-risk`; tasks forecast: Low).
