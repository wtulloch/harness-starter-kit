---
description: "Interactively scaffold an AI-agent engineering harness (AGENTS.md, instructions, skills, knowledge base, prompts, session tracking) into this repo via a resumable, idempotent 6-phase flow."
agent: harness-builder
argument-hint: "project-slug=... [stack=...] [overwrite=false] [ci_hook=false] [agent_hooks=false]"
---

# Build Engineering Harness

Activate the **harness-builder** agent to scaffold an AI-agent engineering harness
for initiative `${input:project-slug}`.

## Inputs

- `${input:project-slug}`: (Required) kebab-case identifier for tracking (e.g. `my-service`).
- `${input:stack}`: (Optional) primary languages/frameworks to tailor instructions.
- `${input:overwrite}`: (Optional, default false) allow replacing existing harness files.
- `${input:doc_only}`: (Optional, default false) opt out of the executable layer and emit the doc harness (Layer 0) only.
- `${input:ci_hook}`: (Optional, default false) opt **in** to emitting the CI workflow (`.github/workflows/validate.yml`) and the local pre-commit hook (`.githooks/pre-commit`). These touch shared infrastructure (a CI runner, a contributor's git config surface) that the scripts (validator/heal/session-start/session-end/backpressure-stats/dispatcher) do not, so — unlike the rest of the executable layer — they are opt-in, not opt-out.
- `${input:agent_hooks}`: (Optional, default false) opt **in** to emitting `.github/hooks/hooks.json`, wiring GitHub Copilot's agent-hooks feature (`sessionStart` → `session-start.mjs`, `agentStop` → `session-end.mjs`). A separate opt-in from `ci_hook` — it runs inside the agent's own session rather than shared CI/git infrastructure, but still changes agent-session behavior.

## Required steps

### Phase 0 — Detect & Resume

1. Look for `harness/state/${input:project-slug}/state.md` (the opt-in third tier;
   most initiatives run two-tier with `PROGRESS.md` + `features.yml` and have none).
2. If found: read it, summarize completed phases, and ask "resume where you left
   off, or restart?"
3. Inventory existing harness files (AGENTS.md, PROGRESS.md, features.yml,
   .github/instructions, .github/skills, .github/prompts, .github/agents,
   knowledge-base, harness/state). Present ✅ present / ❌ missing. Do NOT
   overwrite unless `${input:overwrite}` is true.

### Phase 1 — Gather (interview)

Present a one-sentence scope summary, then ask up to 7 focused questions (purpose,
stack, build/test commands, code style, conventions/gotchas, target agents,
desired skills). Seed answers from any existing README / package manifest first.

### Phase 2 — Confirm

Show a compact spec and the exact file plan (paths + purpose) as a ✅/❓ checklist.
Wait for explicit user confirmation before writing anything.

### Phase 3 — Scaffold (only missing files unless overwrite)

Use the maintain-harness companion skill scaffold-harness to generate: AGENTS.md;
.github/instructions/*.instructions.md; .github/skills/<name>/SKILL.md (include a
harness-maintenance skill and the `review-session` self-healing skill);
knowledge-base/ with index.md; .github/prompts/*; harness/incidents.jsonl (empty,
from templates/incidents.jsonl.template with its `{{! ... }}` header stripped).
Seed the two-tier tracking default (`PROGRESS.md` + `features.yml`). Emit
`harness/state/${input:project-slug}/state.md` (from templates/state.md.template)
**only when the user opts into** the phase-aware third tier — skip it otherwise.
Fill placeholders from templates/. Also emit a `.gitignore` (ignoring
`.copilot-tracking/`) and a `.gitattributes` with `* text=auto eol=lf` so emitted
files normalize to LF. Prefer /create-instruction, /create-skill, /create-prompt,
/create-agent for frontmatter where available.

#### Phase 3b — Executable layer, emitted by default (opt-out)

Always emit the doc harness (Layer 0). Emit the scripts (Layers 1-4) **by
default**; skip them only when `${input:doc_only}` is true. The scripts are
dependency-free and fail-open, so emitting them is safe even when no runtime is
detected — if Node is absent they simply do not run. Emit each as a **verbatim
copy of the live source file** (repo-agnostic — they discover the tree from their
own location — so no placeholder substitution and no header stripping):

1. `scripts/validate-harness.mjs` ← copy `scripts/validate-harness.mjs`
2. `scripts/heal-harness.mjs` ← copy `scripts/heal-harness.mjs`
3. `scripts/session-start.mjs` ← copy `scripts/session-start.mjs`
4. `scripts/session-end.mjs` ← copy `scripts/session-end.mjs`
5. `scripts/backpressure-stats.mjs` ← copy `scripts/backpressure-stats.mjs`
6. `scripts/harness.mjs` ← copy `scripts/harness.mjs`

#### Phase 3c — CI workflow + local hook, emitted only on opt-in

Emit these two **only when `${input:ci_hook}` is true** — they are skipped by
default, independently of `${input:doc_only}`, because they touch shared
infrastructure (a CI runner, a contributor's git-config surface) rather than
staying inert inside the repo:

7. `.github/workflows/validate.yml` ← copy `.github/workflows/validate.yml`
8. `.githooks/pre-commit` ← copy `.githooks/pre-commit`

The scripts are dependency-free (Node built-ins only) and self-describing; the CI
workflow uses the runner's preinstalled Node with no install. Do not enable the
emitted local hook automatically even when `ci_hook=true` — document the opt-in
`git config core.hooksPath .githooks`.
Record the emit decision (which layers emitted vs skipped, and why) in the
committed tracking (`PROGRESS.md` / `features.yml`, or `state.md` if the third
tier was opted into).

#### Phase 3d — GitHub Copilot agent-hooks config, emitted only on opt-in

Emit `.github/hooks/hooks.json` **only when `${input:agent_hooks}` is true**,
independently of `${input:ci_hook}`:

9. `.github/hooks/hooks.json` ← copy `.github/hooks/hooks.json` (verbatim, same
   no-placeholder rule as the scripts)

Document the honest limitation alongside the emission: the scripts print
plain-text banners, not the single-line JSON (`{"additionalContext": "..."}`) the
hook runtime needs to inject output back into the agent's context — this
automates the *trigger* only (the scripts run without the agent remembering to),
never a substitute for the agent reading `PROGRESS.md` per the committed session
protocols. Detecting which backpressure is worth capturing remains agent/human
judgment (decisions-log D-15).

### Phase 4 — Validate

Confirm each file exists and parses (valid frontmatter, sane applyTo globs, lean
AGENTS.md, resolvable links, plain-text tracking-path citations). Report ✅/❌ per
file. Fix blocking issues.

### Phase 5 — Summarize & Next Steps

Update the committed tracking (`PROGRESS.md` + `features.yml`, plus `state.md`
transition_log / session_log / artifacts if the third tier was opted into). List
created files, how to invoke each, and recommended follow-ups (populate the KB,
add repo-specific skills, optionally wire hooks/MCP).

---

Begin at Phase 0 for project `${input:project-slug}`. Persist state at the end of
every phase and wait for confirmation at the Phase 2 gate before writing files.
