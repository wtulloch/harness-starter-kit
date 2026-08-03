---
name: review-session
description: "Detect backpressure in an agent coding session — while it is happening or at session end — capture each struggle to the committed incident log, and escalate to a deterministic-first remediation. USE FOR: mid-session when the same error or correction keeps repeating, the same fix is retried, edits thrash one file, tool calls keep failing, or you are going in circles; when a loop guard trips or heal keeps emitting the same repair directives; when the same validator check keeps failing across sessions; when context saturates and mistakes rise; after a rough session; capturing a runtime incident; deciding whether to harden the validator with a new check. DO NOT USE FOR: auditing harness file health/leanness (use maintain-harness) or scaffolding a new harness (use scaffold-harness)."
---

# Review Session (Backpressure → Capture → Escalate)

Close the self-healing loop: detect when an agent *struggled*, capture it durably,
and prevent recurrence — preferring **deterministic** guardrails over asking the
agent to re-derive the fix each time. This is the detection front-end for the
maintain-harness §7 rule "encode every mistake as a rule."

## When to use

- **Mid-session**, as it happens: the same error or correction keeps repeating, the
  same fix is retried, edits thrash one file, tool calls keep failing, or you are
  going in circles.
- A loop guard trips, or `heal` keeps re-emitting the same repair directives.
- The same validator check keeps failing across sessions, or context saturates and
  mistakes rise.
- **At session-end**, when any struggle signal fired during the session.

## Struggle signals (what "struggling" means)

Countable, thresholded — look for these when reviewing a session:

| Signal | `detection_signal.type` | Threshold |
|--------|-------------------------|-----------|
| Same correction repeated | `repeated-correction` | **>2 on one issue → struggle** |
| Same tool keeps failing | `tool-failure` | recurring `error.type` (e.g. ENOENT) |
| Re-editing the same file across turns | `edit-thrash` / `backtrack` | 3+ re-edits |
| Rising mistakes as context fills | `context-saturation` | large token use + late errors |
| Guardrail/tripwire halt | `tripwire` | any hard stop |
| Validator `FAIL:` recurrence | `validator-fail` | same check across sessions |
| Loop guard tripped | `guard-trip` | **3 non-converging gate runs → trip** |

## Procedure

### Step A — Review the session (read-only)

- When available, query the host session store read-only for coarse evidence:
  turn count, file-touch breadth, available tool distribution, and checkpoints.
- The current store does **not** expose tool-call status or per-edit history, so it
  cannot prove tool failures or repeated edits. Derive those signals from the
  transcript or explicit logs; do not infer them from `session_files`.
- **Fail-open**: if the session store is unavailable or lacks the needed evidence,
  review the current transcript directly instead. The loop still works without
  the store.

### Step B — Capture each distinct struggle

- Append **one JSON line per distinct struggle** to `harness/incidents.jsonl` using
  the schema below. Appending to the log is low-risk and may be done automatically.
- Do not fabricate incidents; capture only what actually happened.
- A tripped loop guard already prints a fully populated record on a
  `GUARD_INCIDENT:` line (from `harness-scripts/guard.mjs`, surfaced by
  `harness-scripts/session-end.mjs`). Review it, replace the placeholder
  `root_cause`, and append it — no script writes to the ledger.

Incident schema (JSON keys, one object per line):

```json
{
  "id": "sh-2026-07-10-01",
  "title": "Agent thrashed on relative filepaths after cd",
  "status": "open",
  "severity": "low",
  "symptom": "4 consecutive failed edits; file-not-found errors",
  "detection_signal": { "type": "tool-failure", "evidence": "ENOENT x4; >2 corrections same issue", "threshold_hit": ">2 corrections on one issue" },
  "trigger": "Agent changed working directory, then used relative paths",
  "root_cause": "Tool accepts relative paths; agent cannot reliably track cwd across turns",
  "remediation": { "layer": "deterministic", "kind": "validator-check", "action": "Reject relative-path tool args", "artifact": "harness-scripts/validate-harness.mjs" },
  "prevention_rule": "ALWAYS pass absolute file paths to file tools",
  "followups": [ { "action": "Add validator check for relative-path tool args", "type": "prevent", "done": false } ],
  "lessons": "Structural prevention (poka-yoke) beat restating the rule"
}
```

Minimal variant: `symptom` · `detection_signal` · `root_cause` · `remediation.layer`+`action` · `prevention_rule`.

### Step C — Classify severity + check recurrence

- Assign `severity` (low/medium/high) as a cost-of-failure proxy.
- When Node is present, run `node harness-scripts/backpressure-stats.mjs` to see whether this
  signature (`detection_signal.type` + `root_cause`) is at/over the promotion
  threshold (default **3** open occurrences → "promote to deterministic").
- High-severity incidents MAY also get a fuller Markdown postmortem at
  `harness/incidents/<id>.md`.

### Step D — Escalate (deterministic-first)

Choose the **lowest feasible rung** on the escalation ladder:

| Rung | Layer | When |
|------|-------|------|
| R3 | **Deterministic** — validator check / lint / pre-flight / tool-redesign | Machine-checkable **and** must always hold. **Prefer this.** |
| R2 | **Heuristic** — durable instruction / skill / ALWAYS-NEVER rule | Recurs across sessions but needs judgment. |
| R1 | **Probabilistic** — in-context reasoning / one-off correction | Genuinely one-off. |

Decision order: machine-checkable + must-always-hold → **R3**; recurs but needs
judgment → R2; one-off → R1. A heuristic that **keeps being violated** → promote to
R3 **and delete the now-redundant instruction**. Prefer the earliest/cheapest catch;
do not over-instrument a single incident.

**R2 — migrate the `prevention_rule` to a durable home.** The session-start banner
prints prevention rules from **open** incidents only, capped at 3, so a rule that
stays in the ledger goes silent the moment it is remediated. Choosing R2 therefore
means *moving* the rule, not just recording it: write it into the `applyTo`-scoped
instruction file that governs the files where it applies, then close the incident.

| Rule is about | Destination |
|---------------|-------------|
| Scripts under `harness-scripts/` or `tests/` | .github/instructions/executable-layer.instructions.md |
| `PROGRESS.md`, `features.yml`, `project-notes/` | .github/instructions/tracking-files.instructions.md |
| Instruction/skill/prompt/agent authoring | .github/instructions/customization-authoring.instructions.md |

If no scoped file governs those paths yet, create one rather than widening an
existing file's `applyTo`. Keep `prevention_rule` in the incident record as the
historical trace; the instruction file is what actually loads next session.

### Step E — Remediate + close the loop

- Propose the **smallest** change that prevents recurrence.
- **Consent-gate committed-file edits**: ask before editing committed files
  (instructions, skills, scripts, AGENTS.md). Appending to the incident log itself
  is low-risk and may be automatic.
- When the remediation is **deterministic**, add a `// ---- Check N ----` block to
  `harness-scripts/validate-harness.mjs`. The executable layer has no template twins — the
  live script is the single source the generator copies verbatim, so there is
  nothing to mirror. Step-by-step recipe (check contract, repair directive, test):
  [writing a validator check](references/writing-a-validator-check.md).
- Append a resolution line closing the incident:
  `{"type":"resolution","resolves":"<id>","files_modified":[...],"date":"YYYY-MM-DD"}`
  and set the incident `status` to `remediated`.

## Output

Report per incident: the captured entry, the chosen ladder rung + rationale, the
proposed remediation (awaiting consent for committed-file edits), and whether a
resolution line was appended. Do not create Markdown files beyond an optional
high-severity postmortem unless asked.

## References

- Done-gate + "encode every mistake as a rule": .github/skills/maintain-harness/SKILL.md (§7)
- Aggregation + recurrence gate: harness-scripts/backpressure-stats.mjs
- Deterministic guardrails: harness-scripts/validate-harness.mjs
- Incident log: harness/incidents.jsonl
- Conventions: knowledge-base/conventions.md
