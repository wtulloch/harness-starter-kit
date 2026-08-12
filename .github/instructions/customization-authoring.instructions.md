---
description: "Author and validate GitHub Copilot customization files for VS Code and Copilot CLI. USE FOR: creating or fixing *.instructions.md, *.prompt.md, *.agent.md, or SKILL.md; writing frontmatter; choosing applyTo globs; separating shared artifacts from VS Code adapters. DO NOT USE FOR: general coding tasks or non-customization Markdown."
applyTo: '**/.github/instructions/**,**/.github/skills/**,**/.github/prompts/**,**/.github/agents/**'
---

# Customization Authoring

Guidance for authoring well-formed GitHub Copilot customization files across VS
Code Chat and Copilot CLI.

## Host boundary

Agent Skills are the canonical shared workflow surface. Both hosts discover
`.github/skills/<name>/SKILL.md`; keep reusable workflow gates and bundled
references there. Instructions with `applyTo` are the shared
modular-instruction trigger, and agents intended for both hosts must use the
documented shared tool aliases.

Semantic `description` routing, `.github/prompts/*.prompt.md`, `${input:...}`
interpolation, and prompt-to-named-agent refinements are VS Code-specific. They
may provide a thin VS Code adapter, but they must not own workflow logic or be
presented as a Copilot CLI command surface.

## Choose the right primitive

- **Instruction** (`*.instructions.md`) — applies to *most* work in a scope, or a
  path-scoped standard. `applyTo` is the shared modular-instruction trigger;
  semantic `description` routing is a VS Code refinement.
- **Skill** (`SKILL.md`) — a *specific*, repeatable multi-step workflow with
  bundled assets (`scripts/`, `references/`). This is the canonical shared
  workflow primitive; each host controls its slash and model-loading UX.
- **Prompt** (`*.prompt.md`) — a single focused task with `${input:...}` params.
  A thin VS Code-specific entrypoint that can bind to an agent via `agent:`.
- **Agent** (`*.agent.md`) — a persona with scoped `tools`, optional `model`,
  and host refinements such as `agents` and `handoffs`. Keep portable agents on
  shared tool aliases; use host-only refinements only in explicit adapters.

Disambiguation: Instructions vs Skill → broad vs specific. Skill vs Prompt →
multi-step + assets vs single parameterized task. Skill vs Agent → same tools for
all steps vs per-stage tool restriction / context isolation.

## Description quality

Descriptions remain required metadata and should use the `USE FOR:` / `DO NOT
USE FOR:` keyword pattern with concrete trigger phrases. VS Code also uses them
for semantic routing. Do not assume that semantic routing behavior is portable
to Copilot CLI; use `applyTo` for shared instruction activation and explicit
skill invocation for shared workflows.

## Frontmatter rules per primitive

- Frontmatter sits between `---` markers as valid YAML. Quote any `description`
  containing a colon.
- **Instruction**: `description` (required for discovery), optional `applyTo`
  glob, optional `name`.
- **Skill**: `name` (required, 1-64 chars, lowercase alphanumeric + hyphens,
  **must match the folder name**), `description` (required). `SKILL.md` required.
  Optional `user-invocable`, `disable-model-invocation`, `argument-hint`.
- **Prompt**: optional `description`, `agent`, `model` (single or fallback array),
  `tools`, `argument-hint`. Body uses `${input:name}` interpolation. Current key
  is `agent:` (not legacy `mode:`).
- **Agent**: `description` (required), optional `tools` (aliases: `read`, `edit`,
  `search`, `execute`, `web`, `agent`, `todo`; sub-scopeable like
  `edit/createFile`), `model`, `agents`, `handoffs`, `hooks`, `user-invocable`,
  `disable-model-invocation`.

## applyTo specificity

Prefer specific globs over `applyTo: "**"` (which loads on every request and burns
context). `applyTo` matches when creating/modifying matching files, not for
read-only operations.

## Body discipline

- Keep `SKILL.md` bodies under ~500 lines; push detail into `references/` and link
  with relative `./` paths one level deep.
- One concern per instruction file.
- Agents: state the persona, explicit `DO NOT` boundaries, the approach, and the
  output format.

## Anti-patterns to avoid

- Vague descriptions ("A helpful skill").
- Monolithic SKILL.md (everything in one file).
- Folder name ≠ `name` field.
- Overly broad `applyTo: "**"` for narrowly-relevant content.
- Swiss-army agents with too many tools.
