---
description: "Author and validate VS Code agent customization files. USE FOR: creating or fixing *.instructions.md, *.prompt.md, *.agent.md, or SKILL.md; writing frontmatter; choosing applyTo globs; making a description discoverable; deciding instruction vs skill vs prompt vs agent. DO NOT USE FOR: general coding tasks or non-customization Markdown."
applyTo: '**/.github/instructions/**,**/.github/skills/**,**/.github/prompts/**,**/.github/agents/**'
---

# Customization Authoring

Guidance for authoring well-formed VS Code / Copilot customization files.

## Choose the right primitive

- **Instruction** (`*.instructions.md`) — applies to *most* work in a scope, or a
  path-scoped standard. Discovered by `description` and/or auto-attached via
  `applyTo` glob.
- **Skill** (`SKILL.md`) — a *specific*, repeatable multi-step workflow with
  bundled assets (`scripts/`, `references/`). Slash `/` + model auto-load.
- **Prompt** (`*.prompt.md`) — a single focused task with `${input:...}` params.
  A thin entrypoint that often binds to an agent via `agent:`.
- **Agent** (`*.agent.md`) — a persona with scoped `tools`, optional `model`,
  `agents`, and `handoffs`. Use when steps need different tool restrictions or
  context isolation (subagent returns one output).

Disambiguation: Instructions vs Skill → broad vs specific. Skill vs Prompt →
multi-step + assets vs single parameterized task. Skill vs Agent → same tools for
all steps vs per-stage tool restriction / context isolation.

## Description is the discovery surface

The `description` decides whether the file is ever loaded. Use the
`USE FOR:` / `DO NOT USE FOR:` keyword pattern with concrete trigger phrases. A
vague description fails silently.

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
