---
description: "Executable-layer contracts for harness-scripts/ and tests/. USE FOR: writing or changing validate-harness.mjs, heal-harness.mjs, doctor.mjs, session-start/session-end.mjs, backpressure-stats.mjs, harness.mjs verbs, or node:test suites; picking exit codes; keeping scripts dependency-free, read-only, and fail-open. DO NOT USE FOR: Markdown customization files (see customization-authoring) or product application code."
applyTo: '**/harness-scripts/**,**/tests/**'
---

# Executable Layer

Rules for the optional deterministic layer (`harness-scripts/`) and its self-tests
(`tests/`). The doc harness is the spec; these scripts only make already-documented
checks tokenless.

## Dependency-free

Node **built-ins only** — no `npm install`, no `package.json` dependency, no
lockfile. Tests use the built-in `node:test` runner and `node:assert/strict`, run
via `node --test`.

## Fail-open

An absent runtime, manifest, or optional artifact is never a failure. Missing
inputs degrade to a labeled note or a silent pass — never a throw. Losing
gitignored cross-run state degrades to today's behavior.

## Silent success / loud failure

Gates print **nothing** on a full pass and one loud line per problem
(`FAIL: <check> — <detail>`). Banners and checklists are read-only and always
print. Verification must burn no attention when everything is fine.

## Exit-code contract

| Code | Meaning |
|------|---------|
| 0 | Pass, or a read-only banner/advisory that never gates |
| 1 | One or more checks failed (validator, doctor, tests) |
| 2 | Agent-reengage — structured repair directives were emitted (`heal`) |

Anything that wants the agent to act on its output uses 2, not 1.

## `local == CI`

CI runs the same raw `node harness-scripts/<file>.mjs` call a contributor runs, so
a green local run predicts a green CI run. `harness.mjs` verbs are a convenience
wrapper over those raw calls — never a divergent code path. The `node --test`
suite is gated the same way, by a repo-local workflow kept out of the emit set so
the emitted `validate.yml` stays validator-only (a target has no `tests/`).

## Read-only by default

Scripts do not mutate the committed tree unless the caller passes an explicit
opt-in flag (`--fix`). Any cross-run state lives under gitignored
`.copilot-tracking/` and is never authoritative.

## Location-agnostic ROOT

Any script needing the repo root resolves it with the `findRepoRoot` anchor-search
(walk up for `.git` or `AGENTS.md`, legacy one-level-up fallback). Never hardcode a
relative depth.

## Encode every mistake as a rule

When a new failure class appears, add a deterministic check so it can never recur
unnoticed — and a `tests/` case that proves the check fires.

## Capture spawn stdout and stderr

`tests/` spawn helpers capture both stdout and stderr regardless of exit code — a
helper that drops stderr on exit 0 silently loses advisory diagnostics (e.g.
`--baseline` runs).
