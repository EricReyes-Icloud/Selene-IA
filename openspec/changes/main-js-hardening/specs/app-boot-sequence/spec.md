# app-boot-sequence Specification

## Purpose

Auth-to-app boot sequence owned by `src/main.js`: single-source shell markup, synchronous controller initialization, and a generation token that aborts stale auth continuations. Behavior-preserving refactor (D4); vanilla ES modules only, no new runtime dependencies.

## Requirements

### Requirement: JS-Owned App Shell

`index.html` MUST ship an empty `<div id="app"></div>`. `src/main.js` SHALL be the sole source of the app shell markup. No second copy of the shell markup MUST exist anywhere in the repository. (Decision D4: blank first paint accepted for a single source of truth.)

#### Scenario: Repository has one shell source

- GIVEN the repository at rest
- WHEN HTML and JS sources are searched for app shell markup
- THEN `index.html` contains only an empty `#app` element
- AND every shell element is produced by `src/main.js`

#### Scenario: Landing renders with empty #app

- GIVEN the app loads with an empty `#app`
- WHEN Firebase auth resolves for a signed-out or logged-in user
- THEN the landing renders inside `#app` as the first visible content

### Requirement: Synchronous Controller Initialization

The boot sequence MUST NOT be deferred by an arbitrary timer. Once the shell is written, `PresenceService.init`, `initChatArea`, `initSettingsModal`, `ConfirmModal`, `initAFKMode`, and `initSidebar` SHALL initialize synchronously within the same task.

#### Scenario: Controllers initialize on shell write

- GIVEN a user completes login and the profile loads
- WHEN the app shell is written to `#app`
- THEN all listed controllers initialize before the current task yields
- AND no timer or animation frame defers their initialization

#### Scenario: No deferred boot window exists

- GIVEN the boot sequence has run
- WHEN the interval between shell write and controller initialization is inspected
- THEN no asynchronous gap exists in which a logout could be observed

### Requirement: Stale Auth Continuation Aborts

A generation token MUST guard every async continuation of the auth flow. If the auth state changes while an `await` inside `onLoginSuccess` is in flight, the stale continuation MUST abort rather than boot or re-boot a dead session.

#### Scenario: Auth changes during in-flight profile fetch

- GIVEN `onLoginSuccess` is awaiting `getUserProfile`
- WHEN the auth state changes before the await settles
- THEN the stale continuation aborts without writing the shell or initializing controllers

#### Scenario: Current continuation proceeds

- GIVEN the generation token is unchanged since the callback began
- WHEN the awaited profile fetch resolves
- THEN boot proceeds normally

### Requirement: No Controller Initialization After Rapid Logout

If logout occurs between the shell write and controller initialization, the controllers MUST NOT be initialized for the dead session.

#### Scenario: Logout before initialization completes

- GIVEN the shell has been written for a session
- WHEN logout fires before controllers initialize
- THEN controllers are not initialized for that session
- AND the landing router is the active view afterward

### Requirement: First Paint Preserved

With an empty `#app`, the landing SHALL render and remain the first thing the user sees. This is behavior-preserving, not a regression.

#### Scenario: First visible content is the landing

- GIVEN a cold load of the application
- WHEN auth state resolves
- THEN the landing is the first content rendered inside `#app`

## Verification

The repository has no test suite (no test script, no `*.test.js`/`*.spec.js`). `npm run build` proves compilation only; every scenario above MUST be verified by manual smoke testing.
