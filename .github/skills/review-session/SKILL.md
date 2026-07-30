---
name: review-session
description: "Review an agent coding session for backpressure (repeated errors, retries, thrash), capture each struggle to the committed incident log, and escalate to a deterministic-first remediation. USE FOR: after a rough session; when the same correction repeats; when tool calls keep failing or edits thrash; capturing a runtime incident; deciding whether to harden the validator. DO NOT USE FOR: auditing harness file health/leanness (use maintain-harness) or scaffolding a new harness (use scaffold-harness)."
---

# Review Session (Backpressure → Capture → Escalate)

Close the self-healing loop: detect when an agent *struggled*, capture it durably,
and prevent recurrence — preferring **deterministic** guardrails over asking the
agent to re-derive the fix each time. This is the detection front-end for the
maintain-harness §7 rule "encode every mistake as a rule."

## When to use

- A session hit repeated errors, retries, or backtracking.
- The same correction was applied more than twice on one issue.
- Tool calls kept failing (file-not-found, edit thrash) or context saturated.
- On session-end, when any struggle signal fired.

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
| Consecutive blocks / abort | — | **8 consecutive → circuit-breaker** |

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

### Step E — Remediate + close the loop

- Propose the **smallest** change that prevents recurrence.
- **Consent-gate committed-file edits**: ask before editing committed files
  (instructions, skills, scripts, AGENTS.md). Appending to the incident log itself
  is low-risk and may be automatic.
- When the remediation is **deterministic**, add a `// ---- Check N ----` block to
  `harness-scripts/validate-harness.mjs`. The executable layer has no template twins — the
  live script is the single source the generator copies verbatim, so there is
  nothing to mirror.
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
