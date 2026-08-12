---
name: build-harness
description: "Build or upgrade an AI-agent engineering harness through a portable, confirmation-gated workflow. USE FOR: scaffolding agent readiness, adding AGENTS.md and harness tracking, or adopting doc-only, standard, or full harness profiles. DO NOT USE FOR: maintaining an existing harness without scaffolding (use maintain-harness) or general project setup."
argument-hint: "[project-slug] [profile={doc-only|standard|full}] [target=path] [overwrite=false]"
user-invocable: true
---

# Build Harness

Build or upgrade an engineering harness in the current repository. This skill
owns the complete workflow. Use the current host agent and its available file,
search, and execution capabilities; no particular persona or command surface is
required.

## Arguments

* `project-slug` is a kebab-case tracking identifier. Infer it from repository
  metadata when unambiguous; otherwise ask the user.
* `profile` selects `doc-only`, `standard`, or `full`. Default to `standard`.
* `target` identifies the repository root. Default to the current workspace.
* `overwrite` permits replacing harness-owned files only when explicitly true.
  Default to false.

Reject unknown profiles before planning writes. Resolve fixed artifacts from
[the adoption profile catalog](../scaffold-harness/references/adoption-profiles.json)
rather than maintaining another artifact list.

## Gate 1: Detect

1. Read `PROGRESS.md`, `features.yml`, and the initiative state file when one
   exists under `harness/state/<project-slug>/state.md`.
2. If resumable state exists, summarize completed work and ask whether to resume
   or restart.
3. Inventory existing harness files and report which are present or missing.
4. Record whether `AGENTS.md`, `.github/copilot-instructions.md`, both, or neither
   exists for later reconciliation.
5. Resolve the requested profile from the adoption profile catalog.

Do not write files during this gate.

## Gate 2: Gather

Read existing repository documentation and manifests before asking questions.
Gather only missing facts, with no more than eight focused questions covering:

* Project purpose and primary stack
* Build, lint, and test commands
* Code style, conventions, and known hazards
* Desired agent roles and repeatable skills
* Required or optional command-line tools beyond Git
* Whether phase-aware third-tier state is needed

Map detected manifests to tool requirements using
[toolchain detection](../scaffold-harness/references/toolchain-detection.md).

## Gate 3: Confirm

Present a compact specification containing the target, project slug, selected
profile, overwrite policy, tracking tiers, reconciliation action, and exact
fixed-artifact plan resolved from the catalog.

Wait for explicit user confirmation before writing, editing, moving, or deleting
any file. A request to inspect, plan, or preview is not write approval. If the
plan changes after confirmation, show the changed plan and confirm again.

## Gate 4: Scaffold

After confirmation, follow the emit and reconciliation procedure in the
[scaffold-harness skill](../scaffold-harness/SKILL.md).

1. Apply catalog operations exactly and keep atomic groups intact.
2. Create missing files by default. Replace existing harness-owned content only
   when overwrite was explicitly approved.
3. Preserve project-owned content and shared-file lines.
4. Seed `PROGRESS.md` and `features.yml`; create phase-aware state only when the
   user selected the third tier.
5. Never activate emitted hooks automatically.

## Gate 5: Validate

Check every selected artifact for existence and expected structure. Validate
frontmatter, instruction globs, links, tracking citations, profile completeness,
and the single always-on instruction rule. Run the repository's dependency-free
harness validator when available. Fix only blocking defects introduced by this
scaffold, then rerun the narrow check.

## Gate 6: Summarize

Report the selected profile, reconciliation result, files created, files skipped,
files changed with approval, validation outcomes, and unresolved follow-ups.
Update committed tracking with the completed outcome. Include phase-aware state
only when that tier exists.

If execution stops before completion, state the last completed gate and the next
required gate so a later session can resume without repeating approved work.