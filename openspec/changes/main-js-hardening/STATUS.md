# STATUS: main-js-hardening — IMPLEMENTED, NOT VERIFIED

**Do not treat this change as an approved or verified contract.** The delta specs in
`specs/` have **not** been synced into `openspec/specs/`, and they must not be, until the
gaps below are closed.

Last updated: 2026-09-26

## State

| | |
|---|---|
| Phase reached | `apply` (closed) |
| Tasks | **11 / 12 complete** — 4.2 is open |
| `verify-report.md` | **does not exist** — the verify phase has not run |
| Delta specs synced to `openspec/specs/` | **No** — and intentionally so |
| Archive | **Not run.** The OpenSpec store reports `archive: blocked` |

## Why this change was not archived

The OpenSpec dispatcher reports `verify: blocked` with the instruction *"Run final
verification only after every task is complete; apply-progress never makes final
verification ready."* Task 4.2 is open, and no verify report exists. Archiving would
merge unverified delta specs into `openspec/specs/`, promoting them to project-level
source of truth on the strength of nothing more than a passing build.

The maintainer elected to close out the work in this isolated form instead. That is a
delivery decision, not a verification result.

## What IS verified

- `npm run build` passes — 52 modules, ~2.7s, exit 0. Only the pre-existing >500 kB
  chunk-size warning. (This is task 4.1, and it is the **only** executable acceptance
  evidence this project has — see "No automated evidence" below.)
- 11 of 12 tasks implemented and independently diff-reviewed.
- **A4 correction (D-A4), verified at the artifact level:** the error surface styles
  resolve inside the CSS chunk that `dist/index.html` actually references. Confirmed
  `.login-error*` rules are present in `assets/index-*.css`, absent from the landing's
  lazy chunk, and that every `var()` token they reference is defined in that same chunk.
  This proves the *styles ship*; it does **not** prove they *look right in a browser*.

## What is NOT verified (the open gap)

**Task 4.2 — manual smoke. Requires a human in a browser. Never performed.**

The fragile part of this change is precisely the part nobody has watched run: the
`authGeneration` token and the login-error surface. Automated tests cannot cover it
here (see below), so it is unproven.

| # | Action | Expected |
|---|--------|----------|
| 1 | Log in normally | App boots; sidebar + chat render |
| 2 | DevTools → Network → **Offline**, hard reload with a persisted session | Inline error "No pudimos cargar tu perfil", **styled** (accent button, centred, readable) — this is what A4/D-A4 changed |
| 3 | Back Online, click **Reintentar** | Recovers and boots |
| 4 | Repeat the failure **3 times** | On the 3rd: signs out to the landing with a **live** CTA (not a dead "Cargando Elai...") |
| 5 | Offline → trigger the error → **authenticate in a second tab** before clicking Reintentar | **No** error surface appears; **no** dead session boots |

Step 5 is the one that exercises the generation token — the core of the change.

## No automated evidence exists

`strict_tdd: false`. There is **no test runner, no linter, and no type checker** in this
project; `verify.test_command` is empty. `npm run build` proves the code compiles. It
proves nothing about auth state transitions. Do not read a green build as a green change.

## Also outstanding

- **`JIRA-TBD`** is still a placeholder in all four task-group headers of `tasks.md`.
  `openspec/config.yaml` → `rules.tasks` requires the real ticket id per group.
- Nothing is committed, staged, or pushed. `openspec/changes/main-js-hardening/` is
  untracked.

## To close this change properly

1. Run the 5-step smoke above; record the outcome on task 4.2.
2. Replace `JIRA-TBD` with the real ticket id.
3. Run the `verify` phase — its report will cite your smoke results as human-provided evidence.
4. Then, and only then, run `archive` to sync the delta specs.
