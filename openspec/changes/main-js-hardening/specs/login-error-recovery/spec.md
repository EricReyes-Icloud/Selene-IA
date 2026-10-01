# login-error-recovery Specification

## Purpose

Recovery when the post-login profile load fails: inline error with bounded retry in `#app`, sign-out cap, and a boundary so no login-path error reaches Firebase. `AuthService` MUST NOT be modified.

## Requirements

### Requirement: Inline Error on Profile-Fetch Failure

When `UserService.getUserProfile` rejects during login, the app MUST show an inline error inside `#app` with a Retry action. Copy SHALL be Spanish. (D1)

#### Scenario: Fetch failure shows inline error

- GIVEN a successful popup login
- WHEN `getUserProfile` rejects
- THEN an inline error with a Retry control renders inside `#app`
- AND no DevTools interaction is required

#### Scenario: Landing sign-in button is not the error surface

- GIVEN the landing sign-in button is disabled showing "Cargando Elai..." after popup login
- WHEN a post-auth profile fetch fails
- THEN the failure is reported by the inline error, not the landing button or its dead CTA

### Requirement: Fetch-Failure Retry Semantics

Retrying after a profile-fetch failure MUST re-invoke `onLoginSuccess`. (D2)

#### Scenario: Retry re-runs the login flow

- GIVEN the inline error is displayed after a fetch failure
- WHEN the user activates Retry
- THEN `onLoginSuccess` runs again for the authenticated user
- AND success boots the app

### Requirement: Create-Failure Retry Semantics

On the onboarding path, retry after a `createUserProfile` failure MUST re-attempt it; idempotent via `setDoc` with `merge: true`. (D2)

#### Scenario: Create retry does not duplicate data

- GIVEN onboarding failed while creating the user profile
- WHEN the user activates Retry
- THEN `createUserProfile` re-invokes
- AND the existing document is merged

### Requirement: Bounded Attempts Then Sign-Out

After **3** failed attempts the app MUST sign the user out and return to the landing, restoring a live sign-in CTA. (D3)

#### Scenario: Third failure signs out

- GIVEN two failures, then a failing third
- WHEN the failure handler runs
- THEN the app signs the user out
- AND the landing shows an enabled sign-in CTA

#### Scenario: Attempts within the bound keep the error surface

- GIVEN fewer than 3 attempts have failed
- WHEN a retry fails again
- THEN the inline error with Retry remains
- AND no sign-out occurs

### Requirement: Sign-Out From Error Handling MUST NOT Loop

The generation token from `app-boot-sequence` MUST cover the error-handling path: signing out re-enters the auth callback, and the stale-guard MUST abort that re-entry instead of re-triggering the failure handler.

#### Scenario: Bounded sign-out does not re-trigger the handler

- GIVEN the third failure signs out from the error handler
- WHEN the resulting auth callback fires signed-out
- THEN the token marks the prior login generation stale
- AND the failure handler does not run again

#### Scenario: Logout during an in-flight retry aborts it

- GIVEN a retry is awaiting `getUserProfile`
- WHEN auth state changes to signed-out
- THEN the in-flight continuation aborts
- AND no error surface renders for the dead session

### Requirement: Attempt Counter Resets on Success

A profile load that succeeds MUST reset the attempt counter, so a later unrelated failure does not inherit attempts already spent.

#### Scenario: Success clears spent attempts

- GIVEN 2 accumulated failed attempts
- WHEN a later profile load succeeds
- THEN the counter resets to 0
- AND a later failure counts as 1, not 3

### Requirement: No Rejection Reaches Firebase

A `.catch()` on the `onUserChange` callback MUST ensure no rejection from the auth callback reaches `onAuthStateChanged`. `AuthService` is unmodified.

#### Scenario: Callback rejection is absorbed

- GIVEN a rejection escapes the login path's own handling
- WHEN it propagates through the `onUserChange` callback
- THEN the `.catch()` absorbs it
- AND `onAuthStateChanged` never receives a rejection

## Verification

No test suite exists (no test script, no `*.test.js`/`*.spec.js`). Every scenario is verified ONLY via `npm run build` and manual smoke testing; error paths additionally require a simulated Firestore failure (DevTools throttling/offline).
