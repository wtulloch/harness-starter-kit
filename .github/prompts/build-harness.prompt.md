---
description: "Interactively scaffold an AI-agent engineering harness (AGENTS.md, instructions, skills, knowledge base, prompts, session tracking) into this repo via a resumable, idempotent 6-phase flow."
agent: harness-builder
argument-hint: "project-slug=... [stack=...] [profile={doc-only|standard|full}] [overwrite=false]"
---

# Build Engineering Harness

Activate the **harness-builder** agent to scaffold an AI-agent engineering harness
for initiative `${input:project-slug}`.

## Inputs

- `${input:project-slug}`: (Required) kebab-case identifier for tracking (e.g. `my-service`).
- `${input:stack}`: (Optional) primary languages/frameworks to tailor instructions.
- `${input:profile}`: (Optional, default `standard`) fixed-artifact adoption
   profile from
   `.github/skills/scaffold-harness/references/adoption-profiles.json`:
   `doc-only`, `standard`, or `full`.
- `${input:overwrite}`: (Optional, default false) allow replacing existing harness files.

## Required steps

### Phase 0 — Detect & Resume

1. Look for `harness/state/${input:project-slug}/state.md` (the opt-in third tier;
   most initiatives run two-tier with `PROGRESS.md` + `features.yml` and have none).
2. If found: read it, summarize completed phases, and ask "resume where you left
   off, or restart?"
3. Inventory existing harness files (AGENTS.md, PROGRESS.md, features.yml,
   .github/instructions, .github/skills, .github/prompts, .github/agents,
   project-owned knowledge-base, harness/state). Present ✅ present / ❌ missing. Do NOT
   overwrite unless `${input:overwrite}` is true.
4. Record the **AGENTS.md reconciliation state** — neither / `AGENTS.md` only /
   `.github/copilot-instructions.md` only / both — since it selects the Phase 3
   `merge_agents` action.
5. Read `.github/skills/scaffold-harness/references/adoption-profiles.json`,
   resolve `${input:profile}` (default `standard`), and reject an unknown profile
   before planning any writes.

### Phase 1 — Gather (interview)

Present a one-sentence scope summary, then ask up to 8 focused questions (purpose,
stack, build/test commands, code style, conventions/gotchas, target agents,
desired skills, and any required command-line tools beyond git — e.g. a package
manager, cloud CLI, or language runtime — and whether each is required or
optional). Seed answers from any existing README / package manifest first. When
seeding from manifests, also map each detected manifest (package.json,
pyproject.toml/requirements.txt, go.mod, Cargo.toml, pom.xml/build.gradle,
*.csproj/*.sln) to the `doctor.yml` `tools:` entries it implies via
[scaffold-harness/references/toolchain-detection.md](../skills/scaffold-harness/references/toolchain-detection.md),
so the Phase 3 manifest seeding has its inputs ready.

### Phase 2 — Confirm

Show a compact spec, the selected profile, and its exact fixed-artifact file plan
resolved from the canonical profile catalog as a ✅/❓ checklist.
Wait for explicit user confirmation before writing anything.

### Phase 3 — Scaffold (only missing files unless overwrite)

Use the maintain-harness companion skill scaffold-harness to generate: AGENTS.md;
.github/instructions/*.instructions.md; .github/skills/<name>/SKILL.md (include a
harness-maintenance skill and the `review-session` self-healing skill);
project-owned knowledge-base/ with index.md; .github/prompts/*;
harness/incidents.jsonl (empty,
from `.github/skills/scaffold-harness/assets/templates/incidents.jsonl.template`
with its `{{! ... }}` header stripped).
Seed the two-tier tracking default (`PROGRESS.md` + `features.yml`). Emit
`harness/state/${input:project-slug}/state.md` (from
`.github/skills/scaffold-harness/assets/templates/state.md.template`)
**only when the user opts into** the phase-aware third tier — skip it otherwise.
Fill placeholders from `.github/skills/scaffold-harness/assets/templates/`. Wire
`.gitignore` and `.gitattributes` with
**create-then-append-if-line-missing**: when the target file is absent, create it
with the harness lines; when present, append only the missing harness lines and
preserve existing content. Exact lines — `.gitignore` → `.copilot-tracking/`,
`.env`, `.env.*`, `!.env.example`; `.gitattributes` → `* text=auto eol=lf` so
emitted files normalize to LF. Prefer /create-instruction, /create-skill,
/create-prompt, /create-agent for frontmatter where available.

**`merge_agents` branch (AGENTS.md reconciliation).** Branch on the four-state
result recorded in Phase 0 rather than plain create-missing-only:

- **Neither** → emit the full
   `.github/skills/scaffold-harness/assets/templates/AGENTS.md.template` (greenfield).
- **`AGENTS.md` only** → inject the harness managed block (between the
  `<!-- HARNESS:BEGIN (managed by scaffold-harness — edits inside are overwritten) -->`
  and `<!-- HARNESS:END -->` sentinels) via scaffold-harness Section 2a's
  replace-or-append idempotency; leave project-owned sections untouched.
- **`.github/copilot-instructions.md` only** → create `AGENTS.md` with the managed
  block, then run the migrate-and-delete protocol below.
- **Both** → inject the managed block into `AGENTS.md`, then run migrate-and-delete.

**migrate-and-delete protocol (default).** When `.github/copilot-instructions.md`
is present: (1) migrate its content into the project-owned sections of `AGENTS.md`
so nothing is lost; (2) announce the removal to the user; (3) delete
`copilot-instructions.md`. The migrated content must land in `AGENTS.md` **before**
removal — never a silent loss — which keeps the single-always-on standard and
validator Check 5 green (no co-shipped `copilot-instructions.md`).

#### Phase 3b — Emit the selected adoption profile

Resolve the selected `doc-only`, `standard`, or `full` profile from
`.github/skills/scaffold-harness/references/adoption-profiles.json`. Apply each
catalog operation exactly as declared. Source copies are verbatim; templates use
placeholder substitution and header stripping; append-lines entries preserve
existing shared-file content. The catalog's executable group is atomic, so never
emit only part of it.

`doc-only` emits Layer 0 fixed artifacts. `standard`, the default, adds the
dependency-free executable layer and its doctor/guard manifests. `full` adds the
validation workflow, inert local pre-commit hook, and GitHub Copilot agent-hooks
configuration. Never activate the emitted pre-commit hook automatically; document
the explicit `git config core.hooksPath .githooks` command.

When `harness/doctor.yml` is selected, populate it from the Gather-phase tooling
answer (git always seeded), then scan the target manifests and append implied
tools per
[scaffold-harness/references/toolchain-detection.md](../skills/scaffold-harness/references/toolchain-detection.md).
Use append-if-`name`-missing: existing entries win, with no reordering or rewrite.

Record the selected profile and emitted/skipped layers in committed tracking
(`PROGRESS.md` / `features.yml`, or `state.md` if the third tier was opted into).

For `full`, document the honest agent-hooks limitation: the scripts print
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
