# Writing a Validator Check (R3 recipe)

How to climb the R3 rung: turn a recurring incident into a deterministic check in
`harness-scripts/validate-harness.mjs`, register its repair directive in
`harness-scripts/heal-harness.mjs`, and prove it fires with a test.

Loaded on demand — read it when a `prevention_rule` is machine-checkable and must
always hold.

## Before you write anything

- Confirm the rule is **machine-checkable** and **must always hold**. If it needs
  judgment, it is R2 (a durable instruction), not R3.
- Run `node harness-scripts/backpressure-stats.mjs`. At/over the promote threshold
  it prints a **seeded stub** for the recurring signature — a `// ---- Check: … ----`
  block with the `fail('<name>', '<detail>')` call already shaped. Review it, then
  adapt it; do not paste it blind.
- Consent-gate the edit. `validate-harness.mjs` and `heal-harness.mjs` are
  committed files, so ask before modifying them.

## 1. Add the check

Checks are plain top-level code in `validate-harness.mjs`, each under a banner
comment, executed in file order. Append a new block at the end of the check
sequence.

```js
// ---------------------------------------------------------------------------
// Check <next-unused-number> — <one-line statement of the invariant>.
// <Why it exists, and its fail-open posture if it guards an optional artifact.>
// ---------------------------------------------------------------------------
const thingPath = join(ROOT, 'harness', 'thing.yml');
if (existsSync(thingPath)) {
  // ...inspect...
  fail('thing-shape', `harness/thing.yml: <what is wrong and what was expected>`);
}
```

**Check numbers are frozen (PD-06).** Take the next unused number; never renumber
existing blocks. Everything downstream — repair directives, tests, incident
records — refers to a check by its **`fail()` name**, never by its number.

### The `fail(check, detail)` contract

```js
const fail = (check, detail) => failures.push(`FAIL: ${check} — ${detail}`);
```

- `check` — a stable kebab-case name (`link`, `skill-name`, `tracking-citation`).
  It is the public identifier: the `FAIL:` line, the `heal` repair key, the test
  assertion, and the incident `detection_signal` all key off it.
- `detail` — conventionally `"<repo-relative path>: <message>"`. `heal` splits on
  the leading `path:` token to populate the directive's `file` field, so keeping
  that shape is what makes the failure machine-addressable. Use the `rel(p)`
  helper for the path.
- Never `throw`, never `process.exit()` inside a check. Push failures and let the
  single report block at the bottom print them to stderr and exit 1.

### Helpers already in scope

`ROOT` (anchor-searched repo root), `rel(p)`, `walk(dir)`,
`parseFrontmatter(text)`, `markdownProse(text)`, and the prebuilt
`customizationFiles` / `committedDocs` lists. Reuse them instead of re-globbing.

### House rules a new check must honor

- **Node built-ins only.** No dependency, no `package.json`, no lockfile.
- **Fail-open.** An absent optional artifact is a silent pass, never a failure.
- **Silent success, loud failure.** No output on pass; one line per problem.
- **Consistency-only.** Validate the *shape* of a manifest; do not reimplement the
  tool that consumes it.
- **`--fix` is for the safe subset only.** Auto-apply only unambiguous, reversible
  rewrites. Anything riskier prints a `SUGGEST:` hint under the `FAIL:` line and
  is left for a human.

## 2. Register the repair directive

`heal-harness.mjs` re-emits each `FAIL:` line as a structured directive. Its
`REPAIR` map is keyed by **check name**; each entry holds a `class` and the
`expected` shape to restore:

```js
const REPAIR = {
  // ...
  'thing-shape': {
    class: 'repairable',
    expected: 'Restore harness/thing.yml: <the shape an agent should re-establish>.',
  },
};
```

- `class: 'repairable'` — the agent can satisfy the check by editing the tree and
  re-running. This is the default; use it unless the next bullet applies.
- `class: 'terminal'` — no additional pass can satisfy it, because it needs a
  human decision or an upstream action (rotate a credential, install a tool).

An unregistered check still heals, but falls back to a generic
"resolve the reported problem" line — which defeats the point. Write the
`expected` value as a **restoration instruction**, not a restatement of the
failure.

`heal` exits **2** when directives are emitted (agent-reengage), while the
validator itself keeps exiting **1** so `local == CI` gating is unchanged.

## 3. Prove it fires

A check with no negative test is not done. `tests/scaffold-new-project.test.mjs`
scaffolds a target repo and uses an `expectFail` helper that mutates one file,
runs the validator, restores the file, and asserts the exit code and the
`FAIL: <name>` line:

```js
expectFail('validator-thing-shape-negative', 'thing-shape', thingFile,
  () => writeFileSync(thingFile, '<single-fault fixture>'));
```

Two assertions are required:

1. **Negative** — the single-fault fixture produces exit 1 and the expected
   `FAIL: <name>` line.
2. **Positive** — the clean scaffold still exits 0, so the new check does not
   fire on a healthy repo.

Run `node --test` (built-in runner, no install).

## 4. Close the loop

- Append a resolution line to `harness/incidents.jsonl`:
  `{"type":"resolution","resolves":"<id>","files_modified":["harness-scripts/validate-harness.mjs"],"date":"YYYY-MM-DD"}`
  and set the incident `status` to `remediated`.
- Delete any now-redundant instruction prose the check has superseded — a
  promoted heuristic should not survive in both layers.
- The executable layer has no template twin: the live script is the single source
  the generator copies verbatim, so there is nothing to mirror.
