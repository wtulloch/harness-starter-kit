---
name: maintain-harness
description: "Audit and maintain an AI-agent engineering harness. USE FOR: keeping AGENTS.md lean, pruning bloated instructions, verifying applyTo globs, checking frontmatter validity, refreshing knowledge-base links, archiving completed .copilot-tracking artifacts, checking that only one always-on file ships. DO NOT USE FOR: scaffolding a new harness (use scaffold-harness) or general coding tasks."
---

# Maintain Harness

Keep the harness healthy: lean, valid, and non-decaying. A bloated or stale
harness makes agents *ignore* real instructions, so maintenance is a discipline,
not a nicety.

## When to use

- AGENTS.md feels long or agents are missing instructions.
- After adding/removing customization files.
- Before a release, or on a periodic health check.
- When `applyTo` globs may be stale after tree changes.

## Procedure

### 1. Audit for bloat

- Read AGENTS.md. For each line ask: *"Would removing this cause the agent to make
  mistakes?"* If not, mark it for pruning.
- When Node is present, `node scripts/validate-harness.mjs` enforces a
  deterministic line budget on AGENTS.md (200 lines by default) so runaway growth
  fails loud instead of being a purely subjective call.
- Confirm exactly one always-on file exists (root `AGENTS.md`); flag any
  `.github/copilot-instructions.md` shipped alongside it as an anti-pattern.
- Check that "sometimes relevant" content lives in skills/instructions/KB, not in
  the always-on brief.

### 2. Prune

- Remove low-signal lines from AGENTS.md; move occasional context into the
  knowledge base, a skill, or an instruction and **link** to it.
- Keep emphasis (IMPORTANT / YOU MUST) only where adherence genuinely matters.

### 3. Verify frontmatter and globs

- Every `*.instructions.md`, `*.prompt.md`, `*.agent.md`, and `SKILL.md` has valid
  YAML frontmatter between `---` markers; descriptions with colons are quoted.
- Each skill folder name matches its `name` field.
- `applyTo` globs are specific — flag unintended `applyTo: "**"`.
- Every primitive has a keyword-rich `description`.
- Use the `get_errors` tool across changed files to surface Problems-tab issues.

### 4. Refresh knowledge-base links

- Confirm `knowledge-base/index.md` links resolve and cover the current docs.
- Retire stale gotchas; link out to canonical docs instead of copying frequently
  changing content.

### 5. Check tracking-path citations

- Files under `.copilot-tracking/` (ephemeral, gitignored) are cited as plain-text
  workspace-relative paths — never markdown links, never `#file:`. Committed
  tracking (`features.yml`, `harness/state/<slug>/state.md`) may use normal links.

### 6. Archive completed tracking artifacts

- Confirm each active `harness/state/<slug>/state.md` is accurate so resume works
  (only when an initiative opted into the phase-aware third tier — two-tier
  initiatives have none).
- Archive or close completed research + plans; remove dead context.
- Update `PROGRESS.md` and `features.yml` statuses.
- If the current agent/tool exposes host memory, confirm nothing *required*
  (onboarding steps, build/test commands) lives only there — it must also be in
  committed tracking or the knowledge base (see architecture.md's "Host agent
  memory" subsection).

### 7. Run the deterministic validator (done-gate)

The prose checks in §3–§5 map onto the optional Layer 1 validator, which makes them
tokenless and objective. When Node is present, a maintenance change is **not done
until the validator confirms it**:

- Run `node scripts/validate-harness.mjs` (or the verb form
  `node scripts/harness.mjs validate`). Silent + exit 0 = pass; any loud
  `FAIL:` line + non-zero exit = fix before considering the work complete.
- The same script runs in CI (`local == CI`), so a green local run predicts a green
  gate.
- **Encode every mistake as a rule.** When a new failure class slips past (a silent
  frontmatter corruption, a broken committed link, an "I read the state"
  hallucination), add a new deterministic check to the validator so that class can
  never recur unnoticed. Do not rely on LLM self-report as the enforcer. To *detect*
  runtime struggles (repeated errors, retries, thrash) and capture them before
  hardening, use the review-session skill as the front-end to this rule.

Layer self-audit (which layer each check defends):

| Maintenance check | Layer |
|-------------------|-------|
| Frontmatter / skill-name / `applyTo` / features schema / links / tracking-paths | L1 Constraint (validator) |
| AGENTS.md leanness (line budget), KB freshness, progressive disclosure | L1 Constraint (line budget) + L2 Context (freshness) |
| Secret-scan (committed credentials) | L1 Constraint (validator) |
| Agent `tools:` scope, subagent boundaries | L3 Execution |
| Validator as done-gate; silent-pass/loud-fail | L4 Verification |
| Session protocols, state accuracy, resume | L5 Lifecycle |

If Node is absent, fall back to the agent-driven §3–§5 checks (fail-open).

## Output

Report per category: what was audited, what was pruned/fixed, and any blocking
issues left for the user. Do not create Markdown files to document the changes
unless explicitly asked.

## References

- Conventions: knowledge-base/conventions.md
- Architecture: knowledge-base/architecture.md
- Runtime-incident detection + capture: .github/skills/review-session/SKILL.md
