# Glossary

Terms used across the starter engineering harness.

**Engineering harness  (harness engineering)** — The collection of
committed, in-repo scaffolding (AGENTS.md, instructions, skills, knowledge base,
prompts, tracking) that makes a repository *agent-ready*: durable context,
conventions, capabilities, and guardrails so coding agents work reliably without a
human re-explaining the project each session.

**Harness vs hardware/test harness** — A *hardware* harness is a physical wiring
loom + fixtures connecting a device under test to instrumentation. A *software test*
harness is the test runner + drivers/stubs that automate a test suite. An *AI-agent
engineering* harness shares the "supporting apparatus" metaphor, but its device
under test is the **agent's plan → act → verify loop**, and it is documentation +
configuration that steers the agent — not test-execution machinery.

**AGENTS.md** — The open, schema-less Markdown "README for agents." An always-on,
project-wide brief loaded every session. Nested files: closest-file-wins; explicit
user chat prompts override everything.

**Instruction** (`*.instructions.md`) — A rules file loaded on-demand via its
`description` or auto-attached when a file matching its `applyTo` glob is in
context. Best for coding standards and path-scoped conventions.

**Prompt** (`*.prompt.md`) — A reusable, parameterized task template invoked as a
slash command. A thin entrypoint that often binds to an agent via `agent:` and
boots a workflow.

**Agent** (`*.agent.md`) — A custom persona with a scoped tool set, optional model,
allowed subagents, and handoffs. A mode you converse in over many turns, or a
subagent that returns a single output.

**Skill** (`SKILL.md`) — An on-demand workflow bundling instructions plus optional
`scripts/`, `references/`, and `assets/`, with progressive loading. The folder name
must match the `name` field.

**Generator prompt** — The `build-harness` prompt: a harness component that *generates*
the rest of the harness into a target repo (self-hosting scaffold).

**State file** (`state.md`) — The per-initiative YAML-in-markdown record
(project / current / transition_log / session_log / artifacts) under committed
`harness/state/{slug}/`. Enables precise cross-session resume.

**State-folder pattern** — Pairing a per-initiative working folder with
path-scoped instructions (`applyTo` bound to that tree) so the right guidance
self-activates whenever files in the folder are touched.

**PROGRESS.md** — The root read-first / write-last resume file: current focus,
next steps, blockers. The single source of truth for "where are we and what's next."

**features.yml** — The structured feature/status inventory (schema_version,
status_legend, features[]).

**Checkpoint** — A named restart point mirroring the session-store checkpoint
fields (overview / work_done / technical_details / important_files / next_steps).

**RPI (Research → Plan → Implement)** — The workflow split that separates
exploration from execution, mirrored by the `.copilot-tracking/` research, plans,
and details artifacts.

**Chronicle / session store** — A local, append-only SQLite history of past
sessions maintained by the agent host. Retrospective and read-only for the agent;
an optional recall accelerator, not the forward-looking source of truth.

**Idempotency** — Safe re-runs via discovery-before-generation, non-destructive
create-missing-only writes, per-phase state persistence, and confirm-before-advance.

## Five-layer harness lens

A *diagnostic lens* (not a mandated architecture) borrowed from the "Agent = Model
+ Harness" model. It names five responsibilities so you can invest in the layer
directly below your most frequent failure mode. Executables here are **optional**;
this repo's always-present harness is the doc layer (Layer 0).

**L1 Constraint ("skeleton")** — Deterministic, no LLM. Linters, schema/structure
checks, boundary rules. Cheap, tokenless, zero false positives; slow-changing;
owned by architecture. *This repo's `harness-scripts/validate-harness.mjs` fills L1 (also
reachable via `node harness-scripts/harness.mjs validate`).*

**L2 Context ("memory")** — What the model sees: AGENTS.md, skills, knowledge
base, the tracking scratchpad. Concise beats comprehensive. Changes per feature;
owned by the team. *Already strong here.*

**L3 Execution ("hands")** — Tools, MCP, sub-agent dispatch, sandboxing,
permission scoping. Fewer, sharper tools beat many. *Partial: agent `tools:` scope.*

**L4 Verification ("immune system")** — Accept/retry/escalate on output. Must be
context-efficient: *success is silent, failure is loud*, non-zero exit. Encode
every recurring mistake as a permanent deterministic check.

**L5 Lifecycle ("nervous system")** — Startup, health, resume/checkpoint, cost and
loop guards. *Present: session protocols + the `harness-scripts/session-start.mjs`
and `session-end.mjs` banners (also reachable via `node harness-scripts/harness.mjs
session-start` / `... session-end`), plus declared loop guards.*

**Loop guard** — A declared stop condition for the harness's own re-engage loop,
living in `harness/guards.yml` and evaluated by `harness-scripts/guard.mjs` at
gate-run boundaries against counters in gitignored
`.copilot-tracking/guards/state.json`. Two ship: `heal-loop-cap` (an identical
repair-directive set across the cap) and `no-progress` (an identical
failure-signature set across the window *with a witnessed edit between each run* —
without that witness, re-reading the gate's output would count as a stall).
Modes are `off | audit | warn | enforce`; promotion runs `audit` → `warn` →
`enforce` and is always a committed manifest edit, never implicit. Only
proof-grade signals are eligible for `enforce` (they must also appear in
`ENFORCE_ELIGIBLE`); heuristics are clamped to `warn`.

**meta-harness (disambiguation)** — In *this repo*, "meta-harness" means *a harness
that builds harnesses* (the self-hosting authoring/generator layer, mostly L2). In
the source article it means Anthropic's Claude Managed Agents *platform runtime*
(unopinionated L2/L3/L5 infrastructure). They are complementary: a repo scaffolded
by this meta-harness could run on that one.
