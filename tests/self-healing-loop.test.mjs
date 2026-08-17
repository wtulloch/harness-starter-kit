#!/usr/bin/env node
// self-healing-loop.test.mjs — automated Tier-1 slice of
// tests/self-healing-loop.test.md.
//
// Exercises the deterministic spine of the backpressure -> promote -> harden ->
// heal loop end to end, in a throwaway harness fixture:
//
//   1. Seed harness/incidents.jsonl with 3 same-signature OPEN incidents.
//   2. backpressure-stats detects the recurrence and PROMOTES it, emitting a
//      seeded validator-check stub (the hand-off to a deterministic guard).
//   3. Simulate the agent wiring that guard into validate-harness.mjs; confirm
//      the gate stays green when clean and fails loudly on a seeded violation.
//   4. heal surfaces the violation as a repair directive (exit 2), then reports
//      the harness healthy once the violation is removed (loop re-greened).
//   5. Recording resolutions clears the promote signal (the loop closes).
//   6. With a heal-loop-cap guard declared, an unfixable violation stops the
//      heal<->re-run cycle after 3 identical directive sets (the loop is bounded).
//
//   node --test
//   node tests/self-healing-loop.test.mjs   (also works standalone)
//
//   Exit 0  every check passed
//   Exit 1  one or more checks failed
//
// Node built-ins only — no npm install. Read-only w.r.t. this repo; all writes
// happen inside an OS temp dir that is removed on exit.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(ROOT, 'harness-scripts');

// Registers a node:test case. The boolean/detail are computed synchronously
// during the imperative loop simulation below (same sequencing the prior
// hand-rolled check()/results accumulator used) — the test body just asserts on
// the already-computed outcome, so registration order == execution order and
// node:test's own reporter/exit-code contract replaces the manual one.
const check = (name, ok, detail = '') => {
  test(name, () => { assert.ok(ok, detail || name); });
};

// --- Synthetic recurring incident signature (3 open occurrences). -------------
// Same detection_signal.type + root_cause so backpressure-stats groups them, and
// a stable prevention_rule so the emitted stub fn name is deterministic:
//   slug("Guard against forbidden marker ...") -> checkGuardAgainstForbiddenMarker
const PREVENTION_RULE = 'Guard against forbidden marker strings in committed docs';
const ROOT_CAUSE = 'forbidden marker strings slipped into committed docs repeatedly';
const STUB_FN = 'checkGuardAgainstForbiddenMarker';
const MARKER = 'LOOPTEST-VIOLATION';

function incident(id) {
  return JSON.stringify({
    id,
    title: 'Forbidden marker slipped into a committed doc',
    status: 'open',
    severity: 'low',
    symptom: `A committed doc shipped with a stray ${MARKER} marker`,
    detection_signal: {
      type: 'tool-failure',
      evidence: 'Reviewer caught a forbidden marker string in a committed doc',
      threshold_hit: 'Same marker leak seen three times',
    },
    trigger: 'A scratch marker was left in a doc before commit',
    root_cause: ROOT_CAUSE,
    remediation: { layer: 'probabilistic', kind: 'one-off-correction', action: 'Strip the marker by hand', artifact: null },
    prevention_rule: PREVENTION_RULE,
    followups: [],
    lessons: 'Recurring manual catches are a promote signal',
  });
}

// --- Build a minimal, validator-clean harness fixture in a temp dir. ----------
// Deliberately omits .github/** so customization checks no-op, and
// omits features.yml artifacts + state so Check 10 no-ops. What remains is a
// clean baseline the seeded guard and incidents drive.
function loopFixture() {
  const target = mkdtempSync(join(tmpdir(), 'harness-loop-'));

  writeFileSync(join(target, 'AGENTS.md'),
    '# AGENTS.md\n\nThrowaway fixture for the self-healing loop test.\n');
  writeFileSync(join(target, 'features.yml'),
    'schema_version: 1\n' +
    'status_legend:\n' +
    '  done: Completed\n' +
    'features:\n' +
    '  - id: F-001\n' +
    '    title: Loop fixture feature\n' +
    '    status: done\n');

  mkdirSync(join(target, 'harness'), { recursive: true });
  mkdirSync(join(target, 'harness-scripts'), { recursive: true });
  for (const name of ['signature.mjs', 'validate-harness.mjs', 'heal-harness.mjs', 'backpressure-stats.mjs', 'harness.mjs', 'guard.mjs']) {
    copyFileSync(join(SCRIPTS, name), join(target, 'harness-scripts', name));
  }

  // 3 same-signature OPEN incidents — the recurrence the loop must detect.
  writeFileSync(
    join(target, 'harness', 'incidents.jsonl'),
    [incident('loop-2026-07-23-01'), incident('loop-2026-07-23-02'), incident('loop-2026-07-23-03')].join('\n') + '\n',
  );

  return target;
}

// --- Run an emitted script and capture exit code + streams. -------------------
function runNode(target, scriptRel, args = []) {
  try {
    const stdout = execFileSync('node', [scriptRel, ...args], { cwd: target, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

// Simulate the agent wiring the promoted guard into the validator: inject a
// deterministic check (forbidden-marker guard) just before the report section.
// This mirrors pasting the reviewed stub body and giving it real teeth.
function wireGuardIntoValidator(target) {
  const path = join(target, 'harness-scripts', 'validate-harness.mjs');
  const src = readFileSync(path, 'utf8');
  const anchor =
    '// ---------------------------------------------------------------------------\n' +
    '// Report.\n' +
    '// ---------------------------------------------------------------------------\n';
  if (!src.includes(anchor)) throw new Error('validator report anchor not found — cannot wire guard');
  const guard =
    '// ---- Check: ' + PREVENTION_RULE + ' (promoted from a recurring incident) ----\n' +
    '(function ' + STUB_FN + '() {\n' +
    '  for (const file of committedDocs) {\n' +
    '    if (readFileSync(file, "utf8").includes("' + MARKER + '")) {\n' +
    '      fail("looptest-marker", `${rel(file)}: contains a forbidden ' + MARKER + ' marker`);\n' +
    '    }\n' +
    '  }\n' +
    '})();\n\n';
  writeFileSync(path, src.replace(anchor, guard + anchor));
}

// --- Run the checks. ----------------------------------------------------------
let target;
try {
  target = loopFixture();

  // Step 0 — baseline: the clean fixture passes the validator and heal reports healthy.
  const base = runNode(target, 'harness-scripts/validate-harness.mjs');
  check('baseline-validator-clean', base.code === 0, `exit ${base.code}${base.stderr ? ' — ' + base.stderr.trim() : ''}`);
  const baseHeal = runNode(target, 'harness-scripts/heal-harness.mjs');
  check('baseline-heal-healthy', baseHeal.code === 0 && /healthy/.test(baseHeal.stdout), `exit ${baseHeal.code}`);

  // Step 1/2 — backpressure detects the 3-occurrence signature and PROMOTES it,
  // emitting a seeded validator-check stub named for the prevention rule.
  const bp = runNode(target, 'harness-scripts/backpressure-stats.mjs');
  check('backpressure-exit', bp.code === 0, `exit ${bp.code}`);
  check('backpressure-detects-open', /3 open \/ 3 total incident/.test(bp.stdout), bp.stdout.trim());
  check('backpressure-at-threshold', /1 signature\(s\) at promote threshold \(>=3\)/.test(bp.stdout), bp.stdout.trim());
  check('backpressure-promote-line', /PROMOTE:/.test(bp.stdout));
  check('backpressure-seeds-stub', bp.stdout.includes(STUB_FN), `expected stub fn ${STUB_FN}`);

  // Step 3 — wire the promoted guard into the validator; the gate stays green
  // while the fixture is clean (wiring did not break the harness).
  wireGuardIntoValidator(target);
  const wired = runNode(target, 'harness-scripts/validate-harness.mjs');
  check('wired-validator-clean', wired.code === 0, `exit ${wired.code}${wired.stderr ? ' — ' + wired.stderr.trim() : ''}`);

  // Step 3b — the guard has teeth: a seeded violation fails the gate loudly.
  const badDoc = join(target, 'knowledge-base', '_looptest.md');
  mkdirSync(dirname(badDoc), { recursive: true });
  writeFileSync(badDoc, `# scratch\n\nleftover ${MARKER} marker\n`);
  const violated = runNode(target, 'harness-scripts/validate-harness.mjs');
  check('guard-fails-on-violation', violated.code === 1 && /FAIL: looptest-marker/.test(violated.stderr), `exit ${violated.code}`);

  // Step 4 — heal turns the violation into a structured repair directive (exit 2).
  const healBad = runNode(target, 'harness-scripts/heal-harness.mjs');
  check('heal-emits-directive', healBad.code === 2 && /looptest-marker/.test(healBad.stdout) && /REPAIR_JSON:/.test(healBad.stdout), `exit ${healBad.code}`);

  // Step 4b — apply the repair (remove the marker) and heal reports healthy: re-greened.
  rmSync(badDoc);
  const healed = runNode(target, 'harness-scripts/heal-harness.mjs');
  check('heal-regreened', healed.code === 0 && /healthy/.test(healed.stdout), `exit ${healed.code}`);

  // Step 5 — recording resolutions closes the incidents; the promote signal clears.
  const resolutions = ['loop-2026-07-23-01', 'loop-2026-07-23-02', 'loop-2026-07-23-03']
    .map((id) => JSON.stringify({ type: 'resolution', resolves: id, files_modified: ['harness-scripts/validate-harness.mjs'], date: '2026-07-23' }))
    .join('\n');
  const logPath = join(target, 'harness', 'incidents.jsonl');
  writeFileSync(logPath, readFileSync(logPath, 'utf8') + resolutions + '\n');
  const bpAfter = runNode(target, 'harness-scripts/backpressure-stats.mjs');
  check('promote-clears-after-resolution', /0 signature\(s\) at promote threshold/.test(bpAfter.stdout), bpAfter.stdout.trim());

  // Step 5b — the resolved log is still well-formed JSONL (Check 8 stays green).
  const finalValidate = runNode(target, 'harness-scripts/validate-harness.mjs');
  check('final-validator-clean', finalValidate.code === 0, `exit ${finalValidate.code}${finalValidate.stderr ? ' — ' + finalValidate.stderr.trim() : ''}`);

  // Step 6 — bound the loop. Declaring heal-loop-cap turns an unfixable violation
  // from an endless "apply, then re-run" cycle into an escalation after 3 tries.
  writeFileSync(
    join(target, 'harness', 'guards.yml'),
    'version: 1\ndefaults:\n  window: 3\n  mode: audit\nguards:\n  - id: heal-loop-cap\n    mode: enforce\n    max_attempts: 3\n',
  );
  writeFileSync(badDoc, `# scratch\n\nleftover ${MARKER} marker\n`);

  const cycles = [1, 2, 3, 4].map(() => runNode(target, 'harness-scripts/heal-harness.mjs'));
  check(
    'cap-allows-three-directive-cycles',
    cycles.slice(0, 3).every((c) => c.code === 2 && /REPAIR_JSON:/.test(c.stdout) && !/GUARD:/.test(c.stderr)),
    cycles.slice(0, 3).map((c) => `exit ${c.code}`).join(', '),
  );
  check(
    'cap-escalates-on-the-fourth',
    cycles[3].code === 2 && /GUARD: heal-loop-cap/.test(cycles[3].stderr) && /GUARD_JSON:/.test(cycles[3].stderr),
    `exit ${cycles[3].code} — ${(cycles[3].stderr || '(no stderr)').trim()}`,
  );
  check('cap-escalation-replaces-the-directive-block', !/REPAIR_JSON:/.test(cycles[3].stdout), cycles[3].stdout.trim());
  check(
    'cap-escalation-names-the-unsatisfiable-directive',
    /looptest-marker/.test(cycles[3].stderr) && /escalate to a human/.test(cycles[3].stderr),
    cycles[3].stderr.trim(),
  );

  // Step 6b — the counter is cross-run state, not a committed artifact.
  const guardState = join(target, '.harness-local', 'guards', 'state.json');
  check('cap-state-is-gitignored-scratch', existsSync(guardState), guardState);

  // Step 6c — applying the repair re-greens and clears the cap.
  rmSync(badDoc);
  const capHealed = runNode(target, 'harness-scripts/heal-harness.mjs');
  check('cap-clears-when-repaired', capHealed.code === 0 && /healthy/.test(capHealed.stdout), `exit ${capHealed.code}`);
  check('cap-counter-reset', JSON.parse(readFileSync(guardState, 'utf8')).guards['heal-loop-cap'] === undefined);
} finally {
  if (target && existsSync(target)) rmSync(target, { recursive: true, force: true });
}
