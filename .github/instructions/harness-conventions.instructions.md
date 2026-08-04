---
description: "Harness tracking conventions for the starter engineering harness: two-tier default (PROGRESS.md + features.yml) with opt-in per-slug harness/state/state.md, the state.md update protocol when one exists, plain-text .copilot-tracking scratch citations, and non-destructive create-missing-only default."
applyTo: '**/harness/state/**,**/.copilot-tracking/**'
---

# Harness Tracking Conventions

These rules auto-activate whenever any file under the committed tracking tree
(`harness/state/`) or the ephemeral scratch tree (`.copilot-tracking/`) is created
or modified.

## Two-tier default + routing rule

The baseline tracking model is **two committed tiers** — one home per concept, so
nothing has to be reconciled across files:

- **`features.yml`** (durable ledger): per-feature `status` + `history[]`
  (date + change) + `artifacts[]` + `depends_on`. The source of truth for *what is
  done*.
- **`PROGRESS.md`** (volatile pointer): current focus, next steps, blockers, phase
  snapshot. Read-first / write-last. Its "Done recently" list is a short **rolling
  window** (lossy — prune freely); it is *not* the durable done-record.
- **`harness/state/<slug>/state.md`** (opt-in third tier): add **only** when an
  initiative spans multiple sessions and needs phase-aware resume.
- **`.copilot-tracking/`** (ephemeral, gitignored): RPI scratch (research / plans /
  details / changes / reviews / logs). Never rely on it surviving a fresh clone;
  promote anything durable upward into the committed tiers.

Decision gate for the third tier: create `state.md` only if the initiative is
multi-session **and** needs phase-aware resumption. Otherwise `PROGRESS.md` +
`features.yml` are sufficient.

## Plain-text path citations

Cite every file under `.copilot-tracking/` as a **plain-text workspace-relative
path** — never a markdown link, never `#file:`. VS Code resolves links/`#file:`
and reports errors for missing targets, flooding the Problems tab. Committed
tracking (root `features.yml`, `harness/state/<slug>/state.md`) and external URLs
may use normal markdown links.

## Slug directory (opt-in)

When an initiative opts into the third tier, all of its per-initiative state lives
under committed `harness/state/<project-slug>/` — do not scatter initiative
artifacts outside a slug directory. Create the directory only when opting in; a
two-tier initiative needs no slug directory at all.

## state.md update protocol (when one exists)

When an initiative has a `state.md`, it is YAML-in-markdown with: `project`
(name/slug/created/initial_request), `current` (phase/step), `transition_log`,
`session_log`, and `artifacts`.

- Record every phase change as a `transition_log` entry (from_phase → to_phase +
  rationale + date).
- Append a `session_log` entry per working session.
- Keep `artifacts` current with produced files (path + type).
- Write state at the end of every phase so any interruption is resumable.

## Non-destructive default

Scaffolding and tracking writes are create-missing-only by default. Overwriting an
existing tracking file requires an explicit user opt-in.

## Resume before acting

On resume, re-read `PROGRESS.md` + `features.yml` (and the relevant `state.md` if
the initiative has one), summarize the recovered context, and confirm with the
user before advancing phases.
