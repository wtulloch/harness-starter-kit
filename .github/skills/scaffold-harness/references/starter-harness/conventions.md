# Conventions

Authoring and file-path conventions for the starter engineering harness. This is
a starter-owned reference installed with the `scaffold-harness` skill. The
target repository's own conventions belong in its project-owned
`knowledge-base/`.

## Description is the discovery surface

Every instruction, skill, agent, and prompt is selected by its `description`. If
the trigger phrases are not present, the primitive is never loaded.

- Use the `USE FOR:` / `DO NOT USE FOR:` keyword pattern.
- Pack concrete trigger phrases (verbs + nouns a user would actually type).
- Keep it specific — a vague description ("A helpful skill") fails silently.

## `applyTo` specificity

`applyTo` is unique to instructions and drives path-scoped auto-activation.

- Prefer specific globs (e.g. `'**/harness/state/**'`).
- Avoid `applyTo: "**"` — it loads on every request and burns context. Reserve it
  only for genuinely global fallbacks.
- `applyTo` matching applies when creating/modifying matching files, not for
  read-only operations. The `description` still enables on-demand discovery when
  `applyTo` does not match.

## One scoped instruction file per stack area

In a multi-stack (polyglot) repo, keep the root `AGENTS.md` stack-agnostic and
emit one path-scoped instruction file per stack area (e.g. `react.instructions.md`
bound to `'frontend/**'`, `dotnet.instructions.md` bound to `'backend/**'`). This
keeps each stack's rules and build/test commands loaded only when the agent works
in that tree, and prevents the always-on brief from bloating. See
[architecture.md](architecture.md) (Multi-stack repos).

## Link, don't embed

Keep the always-on `AGENTS.md` lean. Push "sometimes relevant" content into the
knowledge base, skills, or instructions and **link** to it. A bloated brief causes
agents to *ignore* real instructions.

## Leanness discipline

Treat `AGENTS.md` like code: review when things go wrong, prune regularly. For each
line ask *"Would removing this cause the agent to make mistakes?"* If not, cut it.
Add emphasis (IMPORTANT / YOU MUST) only where adherence genuinely matters.

## Plain-text tracking-path citations

Files under `.copilot-tracking/` (ephemeral RPI scratch, gitignored) MUST be cited
as **plain-text workspace-relative paths** — never markdown links, never `#file:`.
VS Code resolves links/`#file:` and reports errors for missing targets, flooding
the Problems tab. Committed tracking (root `features.yml`,
`harness/state/<slug>/state.md`) and external URLs may use normal markdown links.

## Tracking routing rule (two-tier default)

The baseline is **two committed tiers**, one home per concept: `features.yml` is
the durable ledger (per-feature status + `history[]` = the source of truth for
*what is done*); `PROGRESS.md` is the volatile pointer (current focus / next /
blockers, with a lossy rolling "Done recently" window). A third tier,
`harness/state/<slug>/state.md`, is **opt-in** — add it only when an initiative is
multi-session **and** needs phase-aware resume. See
[architecture.md](architecture.md) and the harness-conventions instruction for the
full protocol.

This repo also keeps `project-notes/decisions-log.md` as an instance-specific
fourth home for **decisions and rationale only** — the "why," not the "what
changed" (that's `features.yml`'s `history[]`). It is not part of the generic
shape the generator emits into target repos; adopt the same decisions/rationale-
only discipline if you choose to keep an equivalent log in your own repo.

## Prevention rules migrate to scoped instruction files

A `prevention_rule` captured in `harness/incidents.jsonl` is a *trace*, not a
delivery mechanism. The session-start banner surfaces rules from **open**
incidents only, capped at 3, so a remediated rule stops being seen exactly when it
was judged important enough to fix.

When an incident is escalated to R2 (heuristic), move the rule into the
`applyTo`-scoped instruction file governing the paths it applies to — for example
[executable-layer.instructions.md](../../../instructions/executable-layer.instructions.md)
for `harness-scripts/` and `tests/`, or
[tracking-files.instructions.md](../../../instructions/tracking-files.instructions.md)
for the root tracking tiers — then close the incident. Create a new scoped file if
none governs those paths; never widen an existing `applyTo` to make a rule fit.

## Frontmatter validity

- YAML frontmatter between `---` markers.
- Quote `description` values that contain colons.
- Skill folder name **must** match the `name` field.
- One concern per instruction file; do not mix testing + API + styling.

## Single always-on file

Ship exactly one always-on file. This repo standardizes on root `AGENTS.md`; never
also ship `.github/copilot-instructions.md` as always-on. Tool-specific files
should reference `AGENTS.md`, not duplicate it.

## Non-destructive scaffolding

The scaffold is create-missing-only by default. Overwriting existing files
requires an explicit opt-in. Always run discovery-before-generation: inventory
what is present vs missing and report it before writing.