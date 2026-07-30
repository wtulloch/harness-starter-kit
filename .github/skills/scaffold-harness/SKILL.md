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
`knowledge-base/`, `harness/state/`, and `harness/incidents.jsonl`. Present a ✅/❌
checklist. Never overwrite unless overwrite is approved.

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

### 2b. Emit the scripts by default (opt-out)

The doc harness above is complete on its own (Layer 0). Emit the scripts (Layers
1-4) **by default**; only skip them when the user opts out (a doc-only request).
The scripts are dependency-free (Node built-ins) and fail-open — if Node is absent
at runtime they simply do not run and the doc harness still stands, so emitting
them is safe even when no runtime is detected. They are **repo-agnostic** (they
discover the tree from their own location), so emit each as a **verbatim copy of
the live source file** — no placeholder substitution, no header stripping:

- `scripts/validate-harness.mjs` ← copy `scripts/validate-harness.mjs`
- `scripts/heal-harness.mjs` ← copy `scripts/heal-harness.mjs` (Layer 4 agent-reengage wrapper; exit 2 + structured repair directives)
- `scripts/session-start.mjs` ← copy `scripts/session-start.mjs`
- `scripts/session-end.mjs` ← copy `scripts/session-end.mjs` (Layer 3 read-only session-end checklist; triggers review-session at the promote threshold)
- `scripts/backpressure-stats.mjs` ← copy `scripts/backpressure-stats.mjs`
- `scripts/harness.mjs` ← copy `scripts/harness.mjs` (command-verb dispatcher fronting the scripts above)

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
`PROGRESS.md`, `features.yml`, and the state file conditionally. Add a `.gitignore`
entry so the ephemeral
`.copilot-tracking/` scratch tree stays out of version control. Add a
`.gitattributes` with `* text=auto eol=lf` so the emitted files normalize to LF
and `local == CI` regardless of the contributor's platform.

### 4. Report

List what was created vs skipped (already present), and how to invoke each piece.

## References

- Conventions: knowledge-base/conventions.md
- Architecture: knowledge-base/architecture.md
- Templates: templates/
