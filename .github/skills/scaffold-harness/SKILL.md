---
name: scaffold-harness
description: "Emit an AI-agent engineering harness into a target repo. USE FOR: scaffolding AGENTS.md, .github/instructions, .github/skills, .github/prompts, .github/agents, a knowledge base, and .copilot-tracking state into a repository; generating harness files from templates idempotently and non-destructively. DO NOT USE FOR: maintaining an existing harness (use maintain-harness) or general project scaffolding."
---

# Scaffold Harness

Generate the harness file shape into a target repository. This is the reusable
emit-only capability used by the canonical `build-harness` skill after the user
confirms its file plan. It does not own discovery, interviewing, confirmation, or
workflow summarization.

## When to use

- A repo needs an agent-readiness harness created.
- Re-running a scaffold to fill in missing pieces (idempotent top-up).

## Core rules

- **Discovery-before-generation.** Inventory what already exists before writing.
  Report ✅ present / ❌ missing.
- **Non-destructive create-missing-only.** Never overwrite an existing file unless
  the user explicitly opts in to overwrite.
- **Template-driven.** Fill placeholders from the `assets/templates/` directory rather
  than authoring from scratch.
- **Profile-driven fixed artifacts.** Resolve `doc-only`, `standard`, or `full`
  from `.github/skills/scaffold-harness/references/adoption-profiles.json`; never
  maintain another fixed-artifact roster.
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

Also record the **AGENTS.md reconciliation state**. The presence of `AGENTS.md`
and `.github/copilot-instructions.md` selects one of four deterministic outcomes
(applied in Section 2a):

- **Neither** → full greenfield emit from `assets/templates/AGENTS.md.template`.
- **`AGENTS.md` only** → inject the managed block; leave project-owned sections intact.
- **`.github/copilot-instructions.md` only** → ask whether to migrate into the
  recommended `AGENTS.md`; migrate-and-delete only after explicit consent,
  otherwise preserve the existing file and make no reconciliation writes.
- **Both** → ask whether to consolidate into the recommended `AGENTS.md`;
  migrate-and-delete only after explicit consent, otherwise preserve both files
  and make no reconciliation writes.

### 2. Generate missing files from templates

For each missing target, emit from the corresponding template and substitute
`{{placeholders}}` with the gathered project values:

- AGENTS.md ← assets/templates/AGENTS.md.template
- PROGRESS.md ← assets/templates/PROGRESS.md.template
- features.yml ← assets/templates/features.yml.template
- harness/state/<project-slug>/state.md ← assets/templates/state.md.template (opt-in third tier; emit **only** when the user opts into phase-aware state, otherwise skip — the two-tier default is PROGRESS.md + features.yml)
- harness/incidents.jsonl ← assets/templates/incidents.jsonl.template (strip the `{{! ... }}` header; emit an empty log)
- Optional checkpoints ← assets/templates/checkpoint.md.template

Also create project-owned `knowledge-base/index.md` + body docs tailored to the
target repository, path-scoped
`.github/instructions/*.instructions.md`, at least one maintenance skill (and the
`review-session` self-healing skill), and reusable `.github/prompts/*.prompt.md`.
Use the current host's file-editing capabilities and follow the customization
authoring rules for well-formed frontmatter.

### 2a. AGENTS.md managed-block injection (four-state reconciliation)

`AGENTS.md` is not a plain create-missing-only target: reconcile it per the
four-state matrix recorded in Section 1 so harness-owned content lands without
clobbering the target's project-owned sections. Both target hosts support
`.github/copilot-instructions.md`; consolidating it is this harness's recommended
single-source policy, not a compatibility requirement.

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
- **Explicit migration consent:** when `.github/copilot-instructions.md` is
  present, ask for a dedicated migrate-or-keep choice before writing. General
  scaffold confirmation does not grant migration consent. On consent, migrate
  its content into the project-owned sections of `AGENTS.md` first, announce the
  removal, then delete `copilot-instructions.md`. Without consent or when the
  choice is unavailable noninteractively, preserve the file byte-for-byte, make
  no AGENTS reconciliation writes, and report that the CLI equivalent is
  `--migrate-instructions`. The migrated content lands in `AGENTS.md` **before**
  deletion, never a silent loss, and the single-always-on policy (Check 5) then
  stays green.

### 2b. Emit the selected adoption profile

Read `.github/skills/scaffold-harness/references/adoption-profiles.json` and
resolve the requested profile. Reject unknown names before writing. The profiles
are cumulative:

- `doc-only` emits the fixed Layer 0 foundation.
- `standard` is the default and adds the complete executable group plus its
  doctor and guard manifests.
- `full` adds the CI workflow, inert local pre-commit hook, and GitHub Copilot
  agent-hooks configuration.

Apply the catalog operation for every selected artifact: `copy` is a verbatim
source copy, `template` fills placeholders and strips generator headers,
`reconcile-template` follows Section 2a, and `append-lines` preserves existing
content while adding only missing lines. Never maintain a second path list in
this skill. The catalog's executable group is atomic; emit all of it or none.

When the selected profile includes `harness/doctor.yml`, populate it with `git`
(always seeded) plus tooling named during the Gather interview. Then scan the
target manifests and append implied tools using
[references/toolchain-detection.md](references/toolchain-detection.md) and the
append-if-`name`-missing rule. Existing entries win, with no removal, reordering,
or rewrite.

For `full`, emit the local hook file but never activate it automatically. Document
the explicit `git config core.hooksPath .githooks` command. The shared agent-hooks
file contains no lifecycle automation: VS Code and Copilot CLI use different
exact event names and output envelopes, and per-turn stop events are not session
termination. Keep `session-start` and `session-end` as read-only,
operator-invocable commands. Do not add a context adapter or CLI-only
`sessionEnd` hook until pinned live payload evidence justifies it. Detecting
backpressure remains agent/human judgment (D-15).

Record the selected profile and which layers it emitted or skipped in committed
tracking so the target never silently inherits or misses automation.

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

- Starter conventions: references/starter-harness/conventions.md
- Starter architecture: references/starter-harness/architecture.md
- Templates: assets/templates/
- Adoption profiles: references/adoption-profiles.json
