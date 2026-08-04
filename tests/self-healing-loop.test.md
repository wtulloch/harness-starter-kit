<!-- markdownlint-disable-file -->
# Test: Self-Healing Loop End-to-End (Backpressure → Promote → Harden → Heal)

Manual acceptance test that validates the harness's **self-healing loop**: a
recurring struggle recorded in the incident log is detected, promoted to a
deterministic guard, wired into the validator, and confirmed re-greened — the
loop the [review-session](../.github/skills/review-session/SKILL.md) skill and
the optional executable layer implement together.

- **Type**: end-to-end / smoke (manual, agent-driven with deterministic checks)
- **Under test**: [harness-scripts/backpressure-stats.mjs](../harness-scripts/backpressure-stats.mjs)
  (recurrence gate + seeded stub), [harness-scripts/validate-harness.mjs](../harness-scripts/validate-harness.mjs)
  (the deterministic gate), and [harness-scripts/heal-harness.mjs](../harness-scripts/heal-harness.mjs)
  (L4 repair directives) — the loop, not the scaffold.
- **Duration**: one session.
- **Pass condition**: every stage below reports **PASS**.

> **Automated slice**: [self-healing-loop.test.mjs](self-healing-loop.test.mjs)
> runs the deterministic spine of Stages 2–6 (detect → promote → wire → fail →
> heal → clear) in a throwaway temp fixture. Run it first; the manual stages
> below add the agent-in-the-loop judgement the automated slice cannot make.

---

## Preconditions

| # | Requirement | Check |
|---|-------------|-------|
| P1 | `node` on PATH (the loop is the optional executable layer) | `node --version` prints a version |
| P2 | This repo is open with its scripts + incident log present | `harness-scripts/backpressure-stats.mjs`, `harness-scripts/heal-harness.mjs`, and `harness/incidents.jsonl` exist |

> If Node is absent, the loop degrades to the doc-only workflow: the
> [review-session](../.github/skills/review-session/SKILL.md) skill still records
> incidents and reasons about recurrence by hand. Skip Stages 1–6 and assert the
> skill's prose steps stand on their own.

---

## Stage 0 — Run the automated slice (deterministic baseline)

**Action**:

```pwsh
node --test tests/self-healing-loop.test.mjs
```

**Expected**: `node:test`'s reporter shows `✔` for all 13 checks and a
`pass 13` / `fail 0` summary (exit 0). This proves the loop's deterministic
spine in isolation before you drive the manual stages. (`node --test`, with no
path, discovers and runs every `*.test.mjs` file under `tests/`.)

- **Result**: ☐ PASS ☐ FAIL

---

## Stage 1 — Record a recurring struggle (3 same-signature incidents)

**Action**: In a **throwaway** working copy (or accept that you will revert the
edit), append three OPEN incidents that share a `detection_signal.type` and
`root_cause` to `harness/incidents.jsonl` — for example three occurrences of the
same tool-failure signature. Use the schema the
[review-session](../.github/skills/review-session/SKILL.md) skill documents.

**Expected**: `harness/incidents.jsonl` has three new lines, each valid JSON,
each with a distinct `id`, matching `detection_signal.type` + `root_cause`, and
`status: "open"`.

- **Result**: ☐ PASS ☐ FAIL

> Do **not** commit these synthetic incidents. Revert the log after Stage 6.

---

## Stage 2 — Backpressure detects and promotes the recurrence

**Action**:

```pwsh
node harness-scripts/harness.mjs backpressure-stats
```

**Expected**:
1. The summary reports `... N open / M total incident(s); 1 signature(s) at promote threshold (>=3).`
2. A `PROMOTE:` line names the recurring signature.
3. A **seeded validator-check stub** is printed (a `check<Signature>()` function
   body) for you to review before pasting it into `harness-scripts/validate-harness.mjs`.

- **Result**: ☐ PASS ☐ FAIL

> Fail if a 3× signature does **not** cross the promote threshold, or if no stub
> is emitted.

---

## Stage 3 — Wire the promoted guard into the validator

**Action**: Review the seeded stub, then implement it as a real deterministic
check in `harness-scripts/validate-harness.mjs` (give it teeth — `fail(...)` on the
condition the incidents describe). The executable layer has no template twins, so
there is nothing to mirror — the live script is the single source that the
generator copies verbatim.

**Expected**:
1. `node harness-scripts/validate-harness.mjs` still exits **0** on the clean repo (the
   new guard does not false-positive).

- **Result**: ☐ PASS ☐ FAIL

---

## Stage 4 — The guard fails loudly on a real violation

**Action**: Introduce a file/edit that violates the newly promoted rule, then run
`node harness-scripts/validate-harness.mjs`.

**Expected**: exit **1** with a single `FAIL: <check> — <detail>` line naming the
new guard. Remove the violation afterward.

- **Result**: ☐ PASS ☐ FAIL

---

## Stage 5 — Heal surfaces the violation, then confirms re-green

**Action**: With the violation still present, run `node harness-scripts/harness.mjs heal`;
then remove the violation and run it again.

**Expected**:
1. With the violation present: exit **2**, one structured repair directive naming
   the guard, and a trailing `REPAIR_JSON:` line.
2. After removing the violation: exit **0** and `Heal: harness healthy — no repairs needed.`

- **Result**: ☐ PASS ☐ FAIL

---

## Stage 6 — Close the loop and tear down

**Action**: Record a `{"type":"resolution","resolves":"<id>"}` line for each of
the three synthetic incidents (or set their `status` to `remediated`), re-run
`node harness-scripts/harness.mjs backpressure-stats`, then **revert** the synthetic
incident + resolution lines from `harness/incidents.jsonl`.

**Expected**:
1. Backpressure now reports `0 signature(s) at promote threshold` — the loop has
   closed.
2. After revert, `git status` shows `harness/incidents.jsonl` unchanged from
   `main` (the synthetic data left no trace).

- **Result**: ☐ PASS ☐ FAIL

---

## Result summary

| Stage | Outcome |
|-------|---------|
| 0 — automated slice | ☐ PASS ☐ FAIL |
| 1 — record recurrence | ☐ PASS ☐ FAIL |
| 2 — detect + promote | ☐ PASS ☐ FAIL |
| 3 — wire the guard | ☐ PASS ☐ FAIL |
| 4 — guard fails on violation | ☐ PASS ☐ FAIL |
| 5 — heal + re-green | ☐ PASS ☐ FAIL |
| 6 — close loop + teardown | ☐ PASS ☐ FAIL |

**Overall**: ☐ PASS (every stage PASS) ☐ FAIL
