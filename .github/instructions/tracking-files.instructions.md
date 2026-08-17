---
description: "Root tracking-file conventions for PROGRESS.md, features.yml, and project-notes/. USE FOR: updating feature status or history[], writing current focus / next steps / blockers, pruning Done recently, deciding which tier a fact belongs in, logging a decision and its rationale. DO NOT USE FOR: harness/state/<slug>/state.md (see harness-conventions) or project-owned development workflow artifacts."
applyTo: 'PROGRESS.md,features.yml,**/project-notes/**'
---

# Root Tracking Files

One home per concept — never reconcile the same fact across files.

## Routing rule

| File | Role | Holds |
|------|------|-------|
| `features.yml` | Durable ledger | What is **done**: per-feature `status`, `history[]`, `artifacts[]` |
| `PROGRESS.md` | Volatile pointer | What is **next**: current focus, next steps, blockers |
| `project-notes/decisions-log.md` | Rationale | The **why** behind a choice, not what changed |

A fact belongs in exactly one of these. If it is a completed change, it goes in
`features.yml` `history[]` — not in `PROGRESS.md`.

## `features.yml` schema

Top level: `schema_version`, `project`, `updated`, `status_legend`, `features`.
Each feature: `id` (`F-NNN`), `title`, `status` (one of the `status_legend` keys),
`priority`, `owner`, `depends_on[]`, `acceptance[]`, `artifacts[]` (paths that must
exist), and `history[]` entries of `date` + `change`.

- Bump `updated` when you change any feature.
- Append to `history[]`; never rewrite past entries.
- Every `artifacts[]` path is validated — only list files that exist.

## `PROGRESS.md` is lossy

"Done recently" is a short **rolling window** — prune it freely. It is not the
done-record; `features.yml` is. Read `PROGRESS.md` first at session start, write it
last at session end.

## `project-notes/` is decisions-only

Instance-specific rationale (`D-NN` entries): the tradeoff considered and why one
option won. Not a changelog, not a status board, and not part of the generic shape
the generator emits into target repos.

## Non-destructive default

Tracking writes are create-missing-only. Overwriting an existing tracking file
requires an explicit user opt-in.
