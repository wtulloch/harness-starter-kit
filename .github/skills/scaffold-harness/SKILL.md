---
name: scaffold-harness
description: "Emit an AI-agent engineering harness into a target repo. USE FOR: scaffolding AGENTS.md, .github/instructions, .github/skills, .github/prompts, .github/agents, a knowledge base, and .copilot-tracking state into a repository; generating harness files from templates idempotently and non-destructively. DO NOT USE FOR: maintaining an existing harness (use maintain-harness) or general project scaffolding."
---

# Scaffold Harness

Generate the harness file shape into a target repository. This is the reusable
emit procedure the `build-harness` generator prompt leans on during its Scaffold phase.

## When to use

- A repo needs an agent-readiness harness created.
- Re-running a scaffold to fill in missing pieces (idempotent top-up).

## Core rules

- **Discovery-before-generation.** Inventory what already exists before writing.
  Report ✅ present / ❌ missing.
- **Non-destructive create-missing-only.** Never overwrite an existing file unless
  the user explicitly opts in to overwrite.
- **Template-driven.** Fill placeholders from the `templates/` directory rather
  than authoring from scratch.
- **Per-phase state persistence.** Keep the committed tracking tiers current
  (`PROGRESS.md` + `features.yml`, plus `state.md` when the initiative opted into
  the third tier) so any interruption is resumable.

## Procedure

### 1. Inventory

Scan the target repo for: `AGENTS.md`, `PROGRESS.md`, `features.yml`,
`.github/instructions/`, `.github/prompts/`, `.github/skills/`, `.github/agents/`,
`knowledge-base/`, `harness/state/`, `harness/incidents.jsonl`, and
`harness/doctor.yml`. Present a ✅/❌ checklist. Never overwrite unless overwrite
is approved.

Also record the **AGENTS.md reconciliation state** — the presence of `AGENTS.md`
and `.github/copilot-instructions.md` selects one of four matrix actions (applied
in Section 2a):

- **Neither** → full greenfield emit from `templates/AGENTS.md.template`.
- **`AGENTS.md` only** → inject the managed block; leave project-owned sections intact.
- **`.github/copilot-instructions.md` only** → create `AGENTS.md` with the managed block, then migrate-and-delete `copilot-instructions.md`.
- **Both** → inject the managed block into `AGENTS.md` and migrate-and-delete `copilot-instructions.md`.

### 2. Generate missing files from templates

For each missing target, emit from the corresponding template and substitute
`{{placeholders}}` with the gathered project values:

- AGENTS.md ← templates/AGENTS.md.template
- PROGRESS.md ← templates/PROGRESS.md.template
- features.yml ← templates/features.yml.template
- harness/state/<project-slug>/state.md ← templates/state.md.template (opt-in third tier; emit **only** when the user opts into phase-aware state, otherwise skip — the two-tier default is PROGRESS.md + features.yml)
- harness/incidents.jsonl ← templates/incidents.jsonl.template (strip the `{{! ... }}` header; emit an empty log)
- Optional checkpoints ← templates/checkpoint.md.template

Also create: `knowledge-base/index.md` + body docs, path-scoped
`.github/instructions/*.instructions.md`, at least one maintenance skill (and the
`review-session` self-healing skill), and reusable `.github/prompts/*.prompt.md`.
Prefer the `/create-instruction`, `/create-skill`, `/create-prompt`,
`/create-agent` scaffolders where available for well-formed frontmatter.

### 2a. AGENTS.md managed-block injection (four-state reconciliation)

`AGENTS.md` is not a plain create-missing-only target: reconcile it per the
four-state matrix recorded in Section 1 so harness-owned content lands without
clobbering the target's project-owned sections and without creating a second
always-on file (which would trip validator Check 5).

Wrap the harness-owned sections between these **exact** idempotency sentinels
(verbatim — Phase 4's Check 17 asserts these strings):

```markdown
<!-- HARNESS:BEGIN (managed by scaffold-harness — edits inside are overwritten) -->
## Repository conventions (always / never)
## Session start protocol (READ FIRST)
## Session end protocol (BEFORE STOPPING)
## Where deeper knowledge lives (pointers)
<!-- HARNESS:END -->
```

- **Harness-owned (inside the block):** session start/end protocols, repository
  conventions incl. the single-always-on rule, the prompt-injection security
  bullet, and the "where deeper knowledge lives" pointers. The harness directory
  descriptions and the "match patterns in neighboring files" code-style bullet are
  also harness-authored; they ship in the greenfield full emit inside their host
  sections and are left in place during a brownfield injection.
- **Project-owned (never touched):** project overview, setup commands,
  build/lint/test commands, language/formatting bullets, and project-specific
  security notes.
- **Idempotency (replace-or-append):** if the sentinel pair already exists in
  `AGENTS.md`, replace the block body between the markers; otherwise append the
  full block to the end of the file. Running adoption twice yields exactly one
  managed block, not two.
- **migrate-and-delete (default):** when `.github/copilot-instructions.md` is
  present, migrate its content into the project-owned sections of `AGENTS.md`
  first, announce the removal, then delete `copilot-instructions.md`. The migrated
  content lands in `AGENTS.md` **before** deletion — never a silent loss — and the
  single-always-on standard (Check 5) stays green.

### 2b. Emit the scripts by default (opt-out)

The doc harness above is complete on its own (Layer 0). Emit the scripts (Layers
1-4) **by default**; only skip them when the user opts out (a doc-only request).
The scripts are dependency-free (Node built-ins) and fail-open — if Node is absent
at runtime they simply do not run and the doc harness still stands, so emitting
them is safe even when no runtime is detected. They are **repo-agnostic** (they
discover the tree from their own location), so emit each as a **verbatim copy of
the live source file** — no placeholder substitution, no header stripping:

- `harness-scripts/signature.mjs` ← copy `harness-scripts/signature.mjs` (**not optional within this set**: an unconditional `import` of session-start, session-end, and backpressure-stats — omit it and all three die with `ERR_MODULE_NOT_FOUND` rather than failing open)
- `harness-scripts/validate-harness.mjs` ← copy `harness-scripts/validate-harness.mjs`
- `harness-scripts/heal-harness.mjs` ← copy `harness-scripts/heal-harness.mjs` (Layer 4 agent-reengage wrapper; exit 2 + structured repair directives)
- `harness-scripts/session-start.mjs` ← copy `harness-scripts/session-start.mjs`
- `harness-scripts/session-end.mjs` ← copy `harness-scripts/session-end.mjs` (Layer 3 read-only session-end checklist; triggers review-session at the promote threshold)
- `harness-scripts/backpressure-stats.mjs` ← copy `harness-scripts/backpressure-stats.mjs`
- `harness-scripts/guard.mjs` ← copy `harness-scripts/guard.mjs` (loop-guard engine reading `harness/guards.yml`; backs the `heal-loop-cap` the emitted AGENTS.md promises)
- `harness-scripts/harness.mjs` ← copy `harness-scripts/harness.mjs` (command-verb dispatcher fronting the scripts above)
- `harness-scripts/doctor.mjs` ← copy `harness-scripts/doctor.mjs` (hard-gated pre-flight tool/dependency check, reading `harness/doctor.yml`)

Emit the whole set or none of it. `harness.mjs` advertises every verb, and
`signature.mjs` is a hard dependency of three of the scripts — a partial emit
produces a target that crashes on invocation instead of degrading quietly.

### 2b2. Emit the default pre-flight manifest

Alongside the scripts above, emit `harness/doctor.yml` from
`templates/doctor.yml.template`, populated with `git` (always seeded) plus any
additional tooling named during the Gather-phase interview (Phase 1 of the
`build-harness` prompt). This has no separate opt-in gate — it is part of the
default scaffold, same as the two-tier tracking default in Section 3.

Then **scan the target's manifests** and append the tooling they imply, guided by
the single-source mapping table in
[references/toolchain-detection.md](references/toolchain-detection.md)
(manifest → `tools:` entries for JS/TS, Python, Go, Rust, Java, .NET — do not
inline that table here). Merge rule: **append-if-`name`-missing** — append only
entries whose `name` is not already in the `tools:` sequence; existing entries
always win (never drop, reorder, or rewrite a `tools:` entry the target already
declares), so re-running adoption is idempotent. Every appended entry reuses
`doctor.mjs`'s existing spawn-presence model (`name` + `check` argv + optional
`required`); this adds no new probe type and no `doctor.mjs` schema change.

### 2b3. Emit the default guard manifest

Also emit `harness/guards.yml` from `templates/guards.yml.template` — same
default-on posture as `doctor.yml`, no separate opt-in. This is what backs the
"re-run heal at most 3 times, then escalate" rule the emitted `AGENTS.md` states:
without the manifest, `guard.mjs` degrades to "no guard" and that rule is a
promise nothing enforces. Emit the template as-is — `heal-loop-cap` at `enforce`,
`no-progress` silent at `audit` — and let the target promote `no-progress` later
once it has its own trip data.

### 2c. Emit the CI workflow + local hook only on opt-in

Unlike the scripts, the CI workflow and the local pre-commit hook touch shared
infrastructure (a CI runner, a contributor's git-config surface) rather than
staying inert inside the repo. Emit these two **only when the user opts in**
(`ci_hook=true`), independently of the doc-only toggle:

- `.github/workflows/validate.yml` ← copy `.github/workflows/validate.yml`
- `.githooks/pre-commit` ← copy `.githooks/pre-commit`

Emit the local hook file, but do not auto-enable it even on opt-in — document the
opt-in `git config core.hooksPath .githooks`. Record which layers were emitted or
skipped (and why) in the committed tracking (`PROGRESS.md` / `features.yml`, or
`state.md` if the third tier was opted into), so the target never silently
inherits — or silently misses — the deterministic gate.

### 2d. Emit the GitHub Copilot agent-hooks config only on opt-in

`.github/hooks/hooks.json` wires GitHub Copilot's agent-hooks feature
(`sessionStart` → `session-start.mjs`, `agentStop` → `session-end.mjs`) so the
scripts run automatically at session boundaries instead of relying on the agent
remembering to invoke them. Runs inside the agent's own session (not shared
CI/git infrastructure like 2c), but still gated behind a separate opt-in
(`agent_hooks=true`) since it changes agent-session behavior:

- `.github/hooks/hooks.json` ← copy `.github/hooks/hooks.json` (verbatim, same
  no-placeholder rule as the scripts)

Document the honest limitation alongside the emission: the scripts print
plain-text banners, not the single-line JSON (`{"additionalContext": "..."}`) the
hook runtime needs to inject output back into the agent's context — this
automates the *trigger* only, never a substitute for the agent reading
`PROGRESS.md` per the committed session protocols. Detecting which backpressure
is worth capturing remains agent/human judgment (decisions-log D-15).

### 3. Wire the tracking foundation

Seed the two-tier default: root `PROGRESS.md` + `features.yml`. Create the
committed `harness/state/<project-slug>/` slug directory and seed `state.md`
**only when the user opts into** the phase-aware third tier (multi-session
initiatives that need resume). Ensure AGENTS.md session protocols reference
`PROGRESS.md`, `features.yml`, and the state file conditionally.

Wire `.gitignore` and `.gitattributes` with **create-then-append-if-line-missing**
(not create-whole-file-if-missing): when the target file is absent, create it with
the harness lines; when it already exists, append only the specific harness lines
it is missing and preserve all existing content. This guarantees the mandatory
`.copilot-tracking/` ignore always lands (even into a repo that already has a
`.gitignore`) without clobbering the target's own rules. Exact lines:

- `.gitignore` → `.copilot-tracking/`, `.env`, `.env.*`, `!.env.example` (the
  `.copilot-tracking/` scratch tree and local secrets stay out of version control;
  `!.env.example` re-includes the committed example).
- `.gitattributes` → `* text=auto eol=lf` so emitted files normalize to LF and
  `local == CI` regardless of the contributor's platform.

### 4. Report

List what was created vs skipped (already present), and how to invoke each piece.

## References

- Conventions: knowledge-base/conventions.md
- Architecture: knowledge-base/architecture.md
- Templates: templates/
