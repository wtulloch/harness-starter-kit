#!/usr/bin/env node
// guard.test.mjs — unit tests for harness-scripts/guard.mjs.
//
// The guard layer is the harness's only stop condition for its own re-engage
// loop, so three properties are contractual: it must stay silent and inert when
// nothing is declared, it must never block on a guard that is not proof-grade,
// and it must never write outside gitignored .copilot-tracking/.
//
//   node --test
//   node tests/guard.test.mjs   (also works standalone)
//
// Node built-ins only — no npm install. All writes happen inside an OS temp dir
// that is removed on exit.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, utimesSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GUARD_MODES,
  DEFAULT_MODE,
  MAX_HEAL_ATTEMPTS,
  ENFORCE_ELIGIBLE,
  parseGuards,
  loadGuards,
  resolveMode,
  maxAttemptsFor,
  readState,
  healDirectiveSignature,
  recordHealRun,
  recordNoProgress,
  editWitness,
  witnessChanged,
  incidentRecord,
  readGuardTrips,
  emit,
  status,
} from '../harness-scripts/guard.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD_SCRIPT = join(ROOT, 'harness-scripts', 'guard.mjs');
const STATE_REL = join('.copilot-tracking', 'guards', 'state.json');

const MANIFEST =
  'version: 1\n' +
  'defaults:\n' +
  '  window: 3          # inline comment must not leak into the value\n' +
  '  mode: audit\n' +
  'guards:\n' +
  '  - id: heal-loop-cap\n' +
  '    mode: enforce\n' +
  '    max_attempts: 3\n' +
  '  - id: no-progress\n' +
  '    mode: warn\n' +
  '    requires_edit_witness: true\n';

const temps = [];
function fixture(manifest = MANIFEST) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-guard-'));
  temps.push(dir);
  writeFileSync(join(dir, 'AGENTS.md'), '# AGENTS.md\n\nGuard fixture.\n'); // findRepoRoot anchor
  if (manifest !== null) {
    mkdirSync(join(dir, 'harness'), { recursive: true });
    writeFileSync(join(dir, 'harness', 'guards.yml'), manifest);
  }
  return dir;
}
process.on('exit', () => {
  for (const dir of temps) if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

const directive = (check, file) => ({ check, file, problem: `${file}: something is wrong`, expected: 'fix it' });
const capture = () => {
  const out = [];
  return { out, write: (s) => out.push(s), text: () => out.join('') };
};

// mtime resolution is coarse and platform-dependent, so the edit witness is moved
// explicitly rather than by racing the filesystem clock.
let clock = Date.now();
function edit(dir) {
  clock += 60_000;
  const at = new Date(clock);
  utimesSync(join(dir, 'AGENTS.md'), at, at);
}

// --- Manifest parsing. --------------------------------------------------------

test('parseGuards reads defaults and guard entries, stripping inline comments', () => {
  const { defaults, guards } = parseGuards(MANIFEST);
  assert.equal(defaults.window, 3);
  assert.equal(defaults.mode, 'audit');
  assert.deepEqual(guards.map((g) => g.id), ['heal-loop-cap', 'no-progress']);
  assert.equal(guards[0].max_attempts, 3);
  assert.equal(guards[1].requires_edit_witness, true);
});

test('loadGuards fails open on an absent manifest', () => {
  assert.equal(loadGuards(fixture(null)), null);
});

test('loadGuards fails open on an unparseable manifest', () => {
  assert.equal(loadGuards(fixture('not: yaml: at: all\n@@@\n')), null);
});

test('the repo ships a heal-loop-cap guard at enforce', () => {
  const manifest = loadGuards(ROOT);
  assert.ok(manifest, 'harness/guards.yml must load');
  const cap = manifest.guards.find((g) => g.id === 'heal-loop-cap');
  assert.ok(cap, 'heal-loop-cap must be declared');
  assert.equal(resolveMode(cap, manifest.defaults, {}).mode, 'enforce');
  assert.equal(maxAttemptsFor(cap, manifest.defaults), MAX_HEAL_ATTEMPTS);
});

// --- Mode resolution. ---------------------------------------------------------

test('mode vocabulary and default are the PSA scheme', () => {
  assert.deepEqual(GUARD_MODES, ['off', 'audit', 'warn', 'enforce']);
  assert.equal(DEFAULT_MODE, 'audit');
});

test('an undeclared mode falls back to the manifest default', () => {
  assert.equal(resolveMode({ id: 'heal-loop-cap' }, { mode: 'warn' }, {}).mode, 'warn');
  assert.equal(resolveMode({ id: 'heal-loop-cap' }, {}, {}).mode, DEFAULT_MODE);
});

test('enforce is clamped to warn for guards that are not proof-grade', () => {
  assert.ok(ENFORCE_ELIGIBLE.has('heal-loop-cap'));
  assert.equal(resolveMode({ id: 'no-progress', mode: 'enforce' }, {}, {}).mode, 'warn');
  assert.equal(resolveMode({ id: 'heal-loop-cap', mode: 'enforce' }, {}, {}).mode, 'enforce');
});

test('HARNESS_GUARD_MODE and HARNESS_GUARD_OFF override, and are reported', () => {
  const byMode = resolveMode({ id: 'heal-loop-cap', mode: 'enforce' }, {}, { HARNESS_GUARD_MODE: 'audit' });
  assert.equal(byMode.mode, 'audit');
  assert.equal(byMode.override.source, 'HARNESS_GUARD_MODE');

  const byId = resolveMode({ id: 'heal-loop-cap', mode: 'enforce' }, {}, { HARNESS_GUARD_OFF: 'other,heal-loop-cap' });
  assert.equal(byId.mode, 'off');
  assert.equal(byId.override.source, 'HARNESS_GUARD_OFF');

  assert.equal(resolveMode({ id: 'heal-loop-cap', mode: 'enforce' }, {}, { HARNESS_GUARD_OFF: 'no-progress' }).mode, 'enforce');
});

// --- State. -------------------------------------------------------------------

test('a corrupt state file reads as blank instead of throwing', () => {
  const dir = fixture();
  mkdirSync(join(dir, '.copilot-tracking', 'guards'), { recursive: true });
  writeFileSync(join(dir, STATE_REL), '{ not json');
  assert.deepEqual(readState(dir), { version: 1, guards: {}, overrides: [] });
});

test('state is written only under gitignored .copilot-tracking/', () => {
  const dir = fixture();
  recordHealRun([directive('link', 'README.md')], dir, {});
  assert.ok(existsSync(join(dir, STATE_REL)), 'state.json must exist');
  assert.deepEqual(readdirSync(dir).sort(), ['.copilot-tracking', 'AGENTS.md', 'harness']);
  assert.deepEqual(readdirSync(join(dir, 'harness')), ['guards.yml']);
  assert.equal(readFileSync(join(dir, 'harness', 'guards.yml'), 'utf8'), MANIFEST);
});

test('an absent manifest records nothing at all', () => {
  const dir = fixture(null);
  assert.equal(recordHealRun([directive('link', 'README.md')], dir, {}), null);
  assert.equal(existsSync(join(dir, '.copilot-tracking')), false);
});

// --- heal-loop-cap counting. --------------------------------------------------

test('an identical directive set increments; the 4th run trips the 3-attempt cap', () => {
  const dir = fixture();
  const set = [directive('link', 'README.md'), directive('frontmatter', '.github/instructions/x.instructions.md')];
  const runs = [1, 2, 3, 4].map(() => recordHealRun(set, dir, {}));
  assert.deepEqual(runs.map((r) => r.attempts), [1, 2, 3, 4]);
  assert.deepEqual(runs.map((r) => r.tripped), [false, false, false, true]);
  assert.equal(runs[3].mode, 'enforce');
  assert.equal(runs[3].max, 3);
});

test('directive-set order does not affect the signature', () => {
  const a = [directive('link', 'README.md'), directive('frontmatter', 'x.md')];
  assert.equal(healDirectiveSignature(a), healDirectiveSignature([...a].reverse()));
});

test('a changed directive set resets the counter to 1', () => {
  const dir = fixture();
  const set = [directive('link', 'README.md')];
  recordHealRun(set, dir, {});
  recordHealRun(set, dir, {});
  const changed = recordHealRun([directive('applyTo', '.github/instructions/y.instructions.md')], dir, {});
  assert.equal(changed.attempts, 1);
  assert.equal(changed.tripped, false);
});

test('a clean run clears the counter entirely', () => {
  const dir = fixture();
  const set = [directive('link', 'README.md')];
  recordHealRun(set, dir, {});
  recordHealRun(set, dir, {});
  const cleared = recordHealRun([], dir, {});
  assert.equal(cleared.cleared, true);
  assert.deepEqual(readState(dir).guards, {});
  assert.equal(recordHealRun(set, dir, {}).attempts, 1);
});

// --- Emission per mode. -------------------------------------------------------

test('audit evaluates, records, and stays silent at exit 0', () => {
  const dir = fixture(MANIFEST.replace('    mode: enforce\n', '    mode: audit\n'));
  const set = [directive('link', 'README.md')];
  let last;
  for (let i = 0; i < 4; i++) last = recordHealRun(set, dir, {});
  assert.equal(last.tripped, true);
  assert.equal(last.mode, 'audit');

  const sink = capture();
  assert.equal(emit(last, sink.write), 0);
  assert.equal(sink.text(), '');
  assert.equal(readState(dir).guards['heal-loop-cap'].attempts, 4); // recorded despite the silence
});

test('warn prints the verdict but does not block', () => {
  const cap = { id: 'heal-loop-cap', mode: 'warn', attempts: 4, max: 3, signature: 'v2:set:abc', directives: [{ check: 'link', file: 'README.md' }], tripped: true, overrides: [] };
  const sink = capture();
  assert.equal(emit(cap, sink.write), 0);
  assert.match(sink.text(), /^GUARD: heal-loop-cap — /m);
});

test('enforce emits one loud line plus a parseable GUARD_JSON block and exits 2', () => {
  const dir = fixture();
  const set = [directive('link', 'README.md')];
  let last;
  for (let i = 0; i < 4; i++) last = recordHealRun(set, dir, {});

  const sink = capture();
  assert.equal(emit(last, sink.write), 2);
  const lines = sink.text().trim().split('\n');
  assert.equal(lines.length, 3, sink.text()); // verdict + GUARD_JSON + GUARD_INCIDENT
  assert.match(lines[0], /^GUARD: heal-loop-cap — .*escalate to a human/);
  const payload = JSON.parse(lines[1].replace(/^GUARD_JSON: /, ''));
  assert.equal(payload.guard, 'heal-loop-cap');
  assert.equal(payload.mode, 'enforce');
  assert.equal(payload.attempts, 4);
  assert.match(payload.expected, /HARNESS_GUARD_OFF=heal-loop-cap/);
  assert.deepEqual(payload.directives, [{ check: 'link', file: 'README.md' }]);

  const record = JSON.parse(lines[2].replace(/^GUARD_INCIDENT: /, ''));
  assert.equal(record.detection_signal.type, 'guard-trip');
  assert.equal(record.remediation.layer, 'deterministic');
});

test('an honored override never blocks, is recorded, and is echoed on later runs', () => {
  const dir = fixture();
  const set = [directive('link', 'README.md')];
  for (let i = 0; i < 4; i++) recordHealRun(set, dir, { HARNESS_GUARD_OFF: 'heal-loop-cap' });

  const overrides = readState(dir).overrides;
  assert.equal(overrides.length, 1);
  assert.equal(overrides[0].source, 'HARNESS_GUARD_OFF');
  assert.equal(overrides[0].count, 4);

  const later = recordHealRun(set, dir, { HARNESS_GUARD_OFF: 'heal-loop-cap' });
  const sink = capture();
  assert.equal(emit(later, sink.write), 0);
  assert.match(sink.text(), /GUARD: override active — heal-loop-cap forced to off via HARNESS_GUARD_OFF/);

  recordHealRun([], dir, {}); // a clean run reaps the suppression it was hiding
  assert.deepEqual(readState(dir).overrides, []);
});

// --- no-progress counting. ----------------------------------------------------

test('the repo ships a no-progress guard at audit, and audit stays out of enforce', () => {
  const manifest = loadGuards(ROOT);
  const np = manifest.guards.find((g) => g.id === 'no-progress');
  assert.ok(np, 'no-progress must be declared');
  assert.equal(resolveMode(np, manifest.defaults, {}).mode, 'audit');
  assert.equal(ENFORCE_ELIGIBLE.has('no-progress'), false);
});

test('the edit witness moves only when the tracked tree actually changes', () => {
  const dir = fixture();
  const before = editWitness(dir);
  assert.ok(before.files > 0, 'the fixture tree must be visible to the witness');
  assert.equal(witnessChanged(before, editWitness(dir)), false);
  edit(dir);
  assert.equal(witnessChanged(before, editWitness(dir)), true);
});

test('three identical gate runs with no edits between them do NOT trip', () => {
  const dir = fixture();
  const set = [directive('link', 'README.md')];
  const runs = [1, 2, 3].map(() => recordNoProgress(set, dir, {}));
  assert.deepEqual(runs.map((r) => r.attempts), [1, 1, 1]); // no witness, no attempt
  assert.deepEqual(runs.map((r) => r.tripped), [false, false, false]);
});

test('three identical gate runs with an edit between each DO trip', () => {
  const dir = fixture();
  const set = [directive('link', 'README.md')];
  const runs = [];
  for (let i = 0; i < 3; i++) {
    if (i > 0) edit(dir);
    runs.push(recordNoProgress(set, dir, {}));
  }
  assert.deepEqual(runs.map((r) => r.attempts), [1, 2, 3]);
  assert.deepEqual(runs.map((r) => r.tripped), [false, false, true]);
  assert.equal(runs[2].max, 3);
});

test('a changed failure-signature set resets the no-progress counter', () => {
  const dir = fixture();
  const set = [directive('link', 'README.md')];
  recordNoProgress(set, dir, {});
  edit(dir);
  assert.equal(recordNoProgress(set, dir, {}).attempts, 2);
  edit(dir);
  const changed = recordNoProgress([directive('applyTo', '.github/instructions/y.instructions.md')], dir, {});
  assert.equal(changed.attempts, 1);
  assert.equal(changed.tripped, false);
});

test('a clean gate run clears the no-progress counter entirely', () => {
  const dir = fixture();
  const set = [directive('link', 'README.md')];
  recordNoProgress(set, dir, {});
  const cleared = recordNoProgress([], dir, {});
  assert.equal(cleared.cleared, true);
  assert.equal(readState(dir).guards['no-progress'], undefined);
});

test('at audit a no-progress trip is recorded but produces no output and exit 0', () => {
  const dir = fixture(MANIFEST.replace('    mode: warn\n', '    mode: audit\n'));
  const set = [directive('link', 'README.md')];
  let last;
  for (let i = 0; i < 3; i++) {
    if (i > 0) edit(dir);
    last = recordNoProgress(set, dir, {});
  }
  assert.equal(last.mode, 'audit');
  assert.equal(last.tripped, true);

  const sink = capture();
  assert.equal(emit(last, sink.write), 0);
  assert.equal(sink.text(), '');
  assert.equal(readState(dir).guards['no-progress'].tripped, true); // recorded despite the silence
});

test('an absent manifest means no no-progress evaluation at all', () => {
  const dir = fixture(null);
  assert.equal(recordNoProgress([directive('link', 'README.md')], dir, {}), null);
  assert.equal(existsSync(join(dir, '.copilot-tracking')), false);
});

// --- Seeded incident record (the capture bootstrap). --------------------------

const SKILL = join(ROOT, '.github', 'skills', 'review-session', 'SKILL.md');
const TEMPLATE = join(ROOT, '.github', 'skills', 'scaffold-harness', 'assets', 'templates', 'incidents.jsonl.template');

test('the guard-trip signal is documented in both schema sources', () => {
  assert.match(readFileSync(SKILL, 'utf8'), /`guard-trip`/);
  assert.match(readFileSync(TEMPLATE, 'utf8'), /guard-trip/);
});

test('a trip yields a record matching the documented incident schema', () => {
  const dir = fixture();
  const set = [directive('link', 'README.md')];
  let last;
  for (let i = 0; i < 3; i++) {
    if (i > 0) edit(dir);
    last = recordNoProgress(set, dir, {});
  }

  const record = incidentRecord(last, new Date('2026-08-02T10:00:00Z'));
  for (const key of ['id', 'title', 'status', 'severity', 'symptom', 'detection_signal', 'trigger',
    'root_cause', 'remediation', 'prevention_rule', 'followups', 'lessons']) {
    assert.ok(key in record, `record is missing the documented key ${key}`);
  }
  assert.equal(record.id, 'guard-2026-08-02-01');
  assert.equal(record.status, 'open');
  assert.equal(record.detection_signal.type, 'guard-trip');
  assert.equal(record.remediation.layer, 'deterministic');
  assert.match(record.detection_signal.evidence, /no-progress/);
  assert.equal(record.followups[0].done, false);
  assert.deepEqual(JSON.parse(JSON.stringify(record)), record); // must survive one JSONL line
});

test('nothing in the guard layer writes to the committed incident ledger', () => {
  const dir = fixture();
  const set = [directive('link', 'README.md')];
  for (let i = 0; i < 3; i++) { if (i > 0) edit(dir); recordNoProgress(set, dir, {}); }
  assert.equal(existsSync(join(dir, 'harness', 'incidents.jsonl')), false);
  assert.deepEqual(readdirSync(join(dir, 'harness')), ['guards.yml']);
});

// --- session-end trigger. -----------------------------------------------------

const SESSION_END_SCRIPTS = ['session-end.mjs', 'guard.mjs', 'signature.mjs', 'banner.mjs'];

/** A fixture that can run session-end.mjs against its own root (findRepoRoot anchors on AGENTS.md). */
function sessionEndFixture(manifest = MANIFEST) {
  const dir = fixture(manifest);
  mkdirSync(join(dir, 'harness-scripts'), { recursive: true });
  for (const f of SESSION_END_SCRIPTS) copyFileSync(join(ROOT, 'harness-scripts', f), join(dir, 'harness-scripts', f));
  return dir;
}

function runSessionEnd(dir) {
  return execFileSync('node', [join(dir, 'harness-scripts', 'session-end.mjs')], { cwd: dir, encoding: 'utf8' });
}

test('readGuardTrips reports unavailable rather than "no trips" when state is absent', () => {
  const dir = fixture();
  const absent = readGuardTrips(dir, {});
  assert.equal(absent.available, false);
  assert.deepEqual(absent.tripped, []);

  recordNoProgress([directive('link', 'README.md')], dir, {});
  assert.equal(readGuardTrips(dir, {}).available, true);
});

test('session-end announces the fallback out loud when guard state is unavailable', () => {
  const banner = runSessionEnd(sessionEndFixture());
  assert.match(banner, /Guards:\s+\(\.copilot-tracking\/guards\/state\.json unavailable/);
  assert.match(banner, /falling back to the incident-threshold trigger below only/);
  assert.doesNotMatch(banner, /GUARD_INCIDENT:/);
});

test('session-end prompts review-session on any guard trip, even with an empty ledger', () => {
  const dir = sessionEndFixture();
  mkdirSync(join(dir, 'harness'), { recursive: true });
  writeFileSync(join(dir, 'harness', 'incidents.jsonl'), '');

  const set = [directive('link', 'README.md')];
  for (let i = 0; i < 3; i++) { if (i > 0) edit(dir); recordNoProgress(set, dir, {}); }

  const banner = runSessionEnd(dir);
  assert.match(banner, /Guards:\s+1 guard trip\(s\) recorded\./);
  assert.match(banner, /ACTION: run the review-session skill before stopping/);
  assert.match(banner, /no-progress \(warn\) at 3\/3 run\(s\)/);
  const record = JSON.parse(/GUARD_INCIDENT: (\{.*\})/.exec(banner)[1]);
  assert.equal(record.detection_signal.type, 'guard-trip');
  assert.match(banner, /none at promote threshold|no open incidents/); // trigger 2 stayed quiet
});

test('session-end reports no trips when guard state exists but nothing tripped', () => {
  const dir = sessionEndFixture();
  recordNoProgress([directive('link', 'README.md')], dir, {});
  const banner = runSessionEnd(dir);
  assert.match(banner, /Guards:\s+\(no guard trips recorded\)/);
});

// --- CLI. ---------------------------------------------------------------------

function runGuard(cwd, env = {}) {
  try {
    const stdout = execFileSync('node', [GUARD_SCRIPT], { cwd, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

test('status reports declared guards and skips ones with no evaluator', () => {
  const dir = fixture();
  assert.deepEqual(status(dir, {}).map((s) => s.id), ['heal-loop-cap', 'no-progress']);
  // A declared id the code has no evaluator for is ignored rather than reported.
  const unknown = fixture(MANIFEST + '  - id: token-budget\n    mode: warn\n');
  assert.deepEqual(status(unknown, {}).map((s) => s.id), ['heal-loop-cap', 'no-progress']);
  assert.deepEqual(status(fixture(null), {}), []);
});

test('the guard verb is silent and exits 0 on a repo with nothing tripped', () => {
  const r = runGuard(ROOT);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout + r.stderr, '');
});

test('the guard CLI is read-only — it never advances a counter', () => {
  const dir = fixture();
  recordHealRun([directive('link', 'README.md')], dir, {});
  const before = readFileSync(join(dir, STATE_REL), 'utf8');
  assert.equal(runGuard(dir).code, 0);
  assert.equal(readFileSync(join(dir, STATE_REL), 'utf8'), before);
});
