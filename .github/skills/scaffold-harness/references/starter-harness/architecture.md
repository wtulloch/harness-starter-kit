# Architecture

How the starter engineering harness primitives fit together and why. This is a
starter-owned reference installed with the `scaffold-harness` skill; generated
project architecture belongs in the target repository's `knowledge-base/`.

## The primitives

| Primitive | File | Discovery surface | Role |
|-----------|------|-------------------|------|
| Root brief | `AGENTS.md` | Always-on | Project-wide baseline; loaded every session |
| Instructions | `.github/instructions/*.instructions.md` | Shared `applyTo` glob; VS Code semantic routing | Modular path-scoped rules |
| Skill | `.github/skills/<name>/SKILL.md` | Shared skill discovery and host invocation | Canonical shared multi-step workflow with bundled assets |
| Agent | `.github/agents/*.agent.md` | Shared agent file; host-specific picker refinements | Optional persona with scoped shared tool aliases |
| Prompt | `.github/prompts/*.prompt.md` | VS Code-specific prompt picker | Thin parameterized VS Code adapter |

Descriptions are required, keyword-rich metadata. VS Code uses descriptions for
semantic routing, but that behavior is not a shared host contract. Use `applyTo`
as the shared modular-instruction trigger and Agent Skills as the canonical
shared workflow surface.

## Composition patterns

1. **Skill → optional host adapters.** The `build-harness` Agent Skill owns the
  complete workflow. VS Code may add a thin prompt with `${input:...}` or a
  named-agent refinement, but those VS Code-specific adapters delegate to the
  skill and never duplicate its gates. Copilot CLI invokes the skill directly;
  it does not discover `.github/prompts` as a workflow surface.

2. **Agent → Instructions (path-scoped auto-activation).** The agent writes state
   under committed `harness/state/{slug}/`. Instruction files carry
   `applyTo: '**/harness/state/**'`, so the right guidance
   auto-attaches whenever files in that tree are touched. This **state-folder +
   path-scoped instructions** pairing is the core harness self-activation pattern.

3. **Agent → host refinements.** Shared agents use common tool aliases. Named
  subagents and handoffs are host-specific refinements and remain optional.

4. **Skill → references/ + assets/ (progressive disclosure).** A `SKILL.md` is a
   thin index; deep content and templates live in linked files loaded only when
   referenced. Discovery (~100 tokens) → body (<5000 tokens) → resources.

5. **Explicit shared invocation.** Skills are the portable named workflows.
  Slash menus, semantic description routing, and prompt pickers are host UX and
  must be verified separately.

6. **AGENTS.md as the always-on root.** Provides the project-wide baseline and
   points to (does not duplicate) the on-demand primitives.

## The tracking model (two-tier default + opt-in state folder)

The harness tracks work in **two committed tiers by default**, with an optional
third tier for long-running initiatives. Each concept has exactly one home, so
nothing has to be reconciled across files:

- **`features.yml`** (root, durable ledger): per-feature `status` + `history[]` +
  `artifacts[]` + `depends_on`. The source of truth for *what is done*.
- **`PROGRESS.md`** (root, volatile pointer): current focus, next steps, blockers.
  Read-first / write-last. Its "Done recently" list is a short **rolling window**
  (lossy) — not the durable done-record.

The optional **state-folder** third tier adds phase-aware recovery when (and only
when) an initiative is multi-session and needs it:

- One `{project-slug}/` directory per opted-in initiative under committed
  `harness/state/`, holding one `state.md` (project / current / transition_log /
  session_log / artifacts).
- Path-scoped instructions bound to `**/harness/state/**` auto-activate whenever
  any file in that tree is edited.
- Decision gate: create `state.md` only if the initiative is multi-session **and**
  needs phase-aware resume. Most initiatives run two-tier and never create one.

Durable tracking (`PROGRESS.md`, `features.yml`, and any opted-in
`harness/state/<slug>/state.md`) is committed and versioned — portable and
human-reviewable. Specifications, research, plans, reviews, and other development
workflow artifacts remain project-owned. Ignored `.harness-local/` contains only
non-authoritative executable state. The host session store is an optional retrospective accelerator for
recall/standups — not a place to declare intended next steps.

## Host agent memory (optional, non-portable)

Some hosts expose a repo-scoped persistent-memory tool (distinct from the session
store above — this is agent-writable notes, not a transcript log). Treat it the
same way as the session store: a **personal accelerator**, never a tier.

- **Scope.** Memory is per-agent-tool, uncommitted, and does not travel with the
  repo across a clone, a different agent, or a teammate. It is invisible to
  reviewers and to CI.
- **Committed docs win on conflict.** If memory and committed tracking disagree,
  committed tracking (`features.yml`, `PROGRESS.md`, `state.md`, the knowledge
  base) is the record of truth — memory is corrected or discarded, never the
  tie-breaker.
- **Nothing required lives only in memory.** Onboarding steps, build/test
  commands, and any fact a new contributor or a different agent would need must
  also land in committed tracking or the knowledge base. Memory may *mirror* such
  facts as a convenience; it may never be their only home.
- See the session-start/session-end protocols in
  [AGENTS.md](../../../../../AGENTS.md) for the read/write points, and the
  `maintain-harness` skill for the audit check.

## Multi-stack (polyglot) repos

A repo with more than one tech stack (e.g. a React front end + a .NET back end)
keeps the root `AGENTS.md` **stack-agnostic** and pushes each stack's rules into a
separate path-scoped instruction file. This is composition pattern 2
(state-folder + path-scoped instructions) applied to source trees rather than the
tracking tree.

- `AGENTS.md` holds only cross-cutting concerns (repo layout, session protocols,
  commit conventions, security).
- One `*.instructions.md` per stack area, each bound to that area's glob so it
  auto-attaches **only** when the agent touches that code:

  | File | `applyTo` |
  |------|-----------|
  | `react.instructions.md` | `'frontend/**/*.{ts,tsx,jsx,css}'` |
  | `dotnet.instructions.md` | `'backend/**/*.cs'` |

- Editing a `.tsx` file loads only the React rules; editing a `.cs` file loads
  only the .NET rules. Neither bloats the always-on context, and the two never
  bleed into each other.
- Multiple stacks mean multiple build/test command sets — put each under its
  scoped instruction so the agent runs the right one for the code in scope.

For large, semi-independent sub-projects, an alternative is a **nested
`AGENTS.md`** per area (`frontend/AGENTS.md`, `backend/AGENTS.md`) merged with the
root via "closest file wins" precedence. Prefer the single-root + path-scoped
instructions approach unless the sub-projects are genuinely autonomous.

## The self-hosting generator model

This starter harness both **uses** this shape (self-hosting) and **emits** it. The
`build-harness` Agent Skill is the canonical shared workflow. It can use the
optional `harness-builder` persona and draws on the scaffold skill's
`assets/templates/` directory. Emission is idempotent:
discovery-before-generation, non-destructive create-missing-only, and per-phase
state persistence.

## Layered harness (progressive enhancement)

The harness is a **doc layer plus optional executable layers**, applied as
progressive enhancement and **fail-open**: if no runtime is present, everything
still works doc-only. The doc harness is the always-present source of truth; the
executables never replace it — they make its already-documented checks
deterministic.

| Layer | Artifact | Deterministic? | Fails open? |
|-------|----------|----------------|-------------|
| **L0 Doc harness** (always present) | AGENTS.md + instructions/skills/prompts/agents + knowledge-base | Agent-interpreted | n/a — this is the spec |
| **L1 Constraint** (optional) | `harness-scripts/validate-harness.mjs` (frontmatter, skill-name, `applyTo`, features schema, links, incident-log integrity, AGENTS.md line budget, secret-scan, agent-hooks config consistency, script-import resolution, generator emit-contract coverage), plus `harness-scripts/doctor.mjs` (hard-gated tool/dependency pre-flight, reading `harness/doctor.yml`; consistency-checked by validator Check 14); a missing required tool is also surfaced as a `doctor-missing-tool` repair directive by `harness-scripts/heal-harness.mjs` | Yes (no LLM) | Yes — absent runtime → agent-driven checks only |
| **L2 CI + local hook** (`full`) | `.github/workflows/validate.yml`, `.githooks/pre-commit` | Yes | Yes; `full` emits both, and the local hook still requires explicit activation through `core.hooksPath` |
| **L2.5 Agent hooks** (`full`) | `.github/hooks/hooks.json` | No (runtime-dependent on each host's agent-hooks feature) | Yes; the shared file is inert until pinned host payload bytes justify event-specific adapters |
| **L3 Session bootstrap** (optional) | `harness-scripts/session-start.mjs` | Yes (read-only) | Yes — missing sources degrade to a labeled note |
| **L4 Re-engage + loop guards** (optional) | `harness-scripts/heal-harness.mjs` (structured repair directives, exit 2), plus `harness-scripts/guard.mjs` reading `harness/guards.yml` — declared loop guards (`heal-loop-cap`, `no-progress`) evaluated at gate-run boundaries, with cross-run counters in gitignored `.harness-local/guards/state.json` | Yes (no LLM) | Yes — an absent/unparseable manifest or unwritable state degrades to "no guard", i.e. pre-guard behavior |

The L1/L3 scripts are also reachable through the command-verb dispatcher
`harness-scripts/harness.mjs` (`node harness-scripts/harness.mjs validate` / `... session-start` /
`... backpressure-stats`); the raw `node harness-scripts/<file>.mjs` calls stay the
fail-open / `local == CI` baseline.

Principles:

- **Silent success / loud failure.** The validator prints nothing on a full pass
  and one loud line per failing check, exiting non-zero. Verification is
  context-efficient — it burns no tokens and no attention when everything is fine.
- **`local == CI`.** Local validation and the CI gate run the *same*
  dependency-free Node script (built-ins only, no npm install), so a green local
  run predicts a green CI run. Concretely: `validate.yml` runs the validator (and
  is emitted to targets verbatim), while this repo additionally runs its own
  `node --test` suite through the repo-local `self-test.yml`. `doctor`, `guard`,
  and `heal` are session-loop tools rather than CI gates — the claim covers the
  validator and the suite, not every verb.
- **Encode every mistake as a rule.** When a new failure class appears (e.g. a
  silent frontmatter corruption or an "I read the state" hallucination), add a new
  deterministic check to the validator so the class can never recur unnoticed.
- **Never required to run.** The doc harness is complete on its own; the
  executable layers are enhancements. Fixed artifacts come from the canonical
  adoption-profile catalog. `doc-only` emits Layer 0, `standard` is the default
  and adds the atomic L1/L3/L4 executable group plus manifests, and `full` adds
  L2/L2.5 automation. Scripts remain inert until a runtime is present. The local
  hook is never activated automatically, and the shared agent-hooks file has no
  event wiring. Run session scripts manually until adapters are validated for
  exact VS Code `SessionStart`/`Stop` and Copilot CLI
  `sessionStart`/`agentStop`/`sessionEnd` events.
- **Location-agnostic ROOT discovery.** The four scripts that need the repo root
  (`validate-harness.mjs`, `session-start.mjs`, `session-end.mjs`,
  `backpressure-stats.mjs`) resolve it with an anchor-search (`findRepoRoot`):
  walk upward from the script's own on-disk location looking for a `.git` entry
  or `AGENTS.md`, falling back to the legacy one-level-up assumption if neither
  is found. This means `harness-scripts/` can be relocated to any depth (e.g.
  `.github/harness-scripts/`, `tools/harness-scripts/`) without breaking `ROOT` resolution — the
  default emission location is unchanged, this only makes relocation safe (see
  decisions-log D-22).