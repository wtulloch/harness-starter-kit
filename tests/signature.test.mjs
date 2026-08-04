#!/usr/bin/env node
// signature.test.mjs — unit tests for harness-scripts/signature.mjs.
//
// The signature module is the grouping key for every recurrence counter in the
// harness, so its invariances are a contract: the same failure recurring across
// sessions must group as one thing regardless of absolute paths, timestamps,
// ids, or line numbers, and two genuinely different failures must never merge.
//
//   node --test
//   node tests/signature.test.mjs   (also works standalone)
//
// Node built-ins only — no npm install. Pure in-memory; touches no files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGNATURE_VERSION,
  PROMOTE_THRESHOLD,
  DECAY_WINDOW_DAYS,
  canonicalize,
  signature,
  signatureSet,
  groupIncidents,
} from '../harness-scripts/signature.mjs';

// --- Shape and shared constants. ---------------------------------------------

test('signature returns v2:<kind>:<12-hex>', () => {
  const sig = signature('gate-fail', 'FAIL: link — README.md: broken');
  assert.match(sig, /^v2:gate-fail:[0-9a-f]{12}$/);
  assert.equal(SIGNATURE_VERSION, 'v2');
});

test('kind namespaces the signature', () => {
  assert.notEqual(signature('gate-fail', 'same text'), signature('incident', 'same text'));
});

test('tuning constants are the single source of truth', () => {
  assert.equal(PROMOTE_THRESHOLD, 3);
  assert.equal(DECAY_WINDOW_DAYS, 30);
});

// --- Invariances (the same failure must group as one thing). ------------------

test('absolute paths are invariant within a path flavor', () => {
  // Cross-flavor equality is deliberately not asserted: the Windows mask is
  // greedy over non-space characters and swallows the trailing `:` delimiter,
  // so a Windows and a POSIX rendering of the same failure canonicalize
  // differently. Grouping only has to hold across machines of the same shape.
  assert.equal(
    signature('gate-fail', 'FAIL: link — C:\\sandbox\\meta-harness\\README.md: broken'),
    signature('gate-fail', 'FAIL: link — D:\\clone\\elsewhere\\README.md: broken'),
  );
  assert.equal(
    signature('gate-fail', 'FAIL: link — /home/dev/meta-harness/README.md: broken'),
    signature('gate-fail', 'FAIL: link — /var/tmp/clone/README.md: broken'),
  );
});

test('timestamps, uuids, hexes, and shas are invariant', () => {
  const a = signature('gate-fail', 'run 2026-07-31T10:15:00Z id 4f8c2a1b-7d3e-4b9a-8c1d-2e3f4a5b6c7d at 0xdeadbeef sha a1b2c3d4e5f6');
  const b = signature('gate-fail', 'run 2026-08-01T23:59:59Z id 9e1d3c5b-2a4f-4e8b-9d7c-6b5a4f3e2d1c at 0xcafebabe sha f6e5d4c3b2a1');
  assert.equal(a, b);
});

test('line/column positions are invariant', () => {
  assert.equal(
    signature('gate-fail', 'parse error at foo.mjs:12:5 (line 12)'),
    signature('gate-fail', 'parse error at foo.mjs:840:97 (line 840)'),
  );
});

test('quoted literals and whitespace drift are invariant', () => {
  assert.equal(
    signature('incident', 'unexpected value "alpha"   in   config'),
    signature('incident', "unexpected value 'omega' in config"),
  );
});

// --- Separation (different failures must stay different). ---------------------

test('genuinely different failures produce different signatures', () => {
  assert.notEqual(
    signature('gate-fail', 'FAIL: link — README.md: broken link'),
    signature('gate-fail', 'FAIL: frontmatter — README.md: missing description'),
  );
});

test('the same check on different repo-relative paths stays separate', () => {
  // The validator normalizes every `FAIL:` detail to a repo-relative forward-slash
  // path, so this is the module's primary input shape, not an edge case. A path
  // mask wide enough to swallow it merges distinct failures into one counter.
  assert.notEqual(
    signature('gate-fail', 'FAIL: link — .github/instructions/alpha.instructions.md: broken link'),
    signature('gate-fail', 'FAIL: link — .github/instructions/beta.instructions.md: broken link'),
  );
  assert.notEqual(
    signature('gate-fail', 'FAIL: link — knowledge-base/index.md: broken link'),
    signature('gate-fail', 'FAIL: link — knowledge-base/glossary.md: broken link'),
  );
  assert.match(canonicalize('FAIL: link — .github/instructions/alpha.instructions.md: broken'), /alpha/);
});

test('fixing one of several failures changes the set fingerprint (progress is visible)', () => {
  // The no-progress proof a loop cap consumes: if a partially repaired run still
  // fingerprints equal, a progressing agent gets escalated as if it were stuck.
  const broken = (p) => signature('gate-fail', `link — ${p}: broken link`);
  assert.notEqual(
    signatureSet([broken('docs/one.md'), broken('docs/two.md')]),
    signatureSet([broken('docs/two.md')]),
  );
});

test('the bare-integer mask runs last, preserving earlier structure', () => {
  // `:12:5` must canonicalize to the positional form, not to two bare integers —
  // if the generic integer rule ran first it would shred the `:line:col` shape
  // and collapse structurally different messages together.
  assert.match(canonicalize('at foo.mjs:12:5'), /:<line>:<col>/);
  assert.notEqual(
    canonicalize('at foo.mjs:12:5'),
    canonicalize('at foo.mjs 12 5'),
  );
});

test('canonicalize lowercases, trims, and tolerates nullish input', () => {
  assert.equal(canonicalize('  MiXeD Case  '), 'mixed case');
  assert.equal(canonicalize(null), '');
  assert.equal(canonicalize(undefined), '');
});

// --- Set fingerprints (the no-progress proof). --------------------------------

test('signatureSet is order- and duplicate-invariant', () => {
  const a = signatureSet(['v2:gate-fail:aaa', 'v2:gate-fail:bbb']);
  const b = signatureSet(['v2:gate-fail:bbb', 'v2:gate-fail:aaa', 'v2:gate-fail:bbb']);
  assert.equal(a, b);
  assert.match(a, /^v2:set:[0-9a-f]{12}$/);
});

test('signatureSet separates different sets and tolerates empties', () => {
  assert.notEqual(
    signatureSet(['v2:gate-fail:aaa']),
    signatureSet(['v2:gate-fail:aaa', 'v2:gate-fail:bbb']),
  );
  assert.equal(signatureSet([]), signatureSet(undefined));
});

// --- Incident grouping (what the recurrence counters consume). ----------------

const incident = (id, type, cause) => ({
  id,
  status: 'open',
  detection_signal: { type },
  root_cause: cause,
});

test('grouping is path-invariant across the same root cause', () => {
  const groups = groupIncidents([
    incident('a-2026-07-25-01', 'tool-failure', 'validate failed on C:\\sandbox\\meta-harness\\README.md'),
    incident('a-2026-07-25-02', 'tool-failure', 'validate failed on D:\\clone\\other\\README.md'),
    incident('a-2026-07-25-03', 'tool-failure', 'validate failed on /home/dev/repo/README.md'),
  ]);
  assert.equal(groups.size, 1);
  assert.equal([...groups.values()][0].n, 3);
});

test('grouping keeps different repo-relative paths in different groups', () => {
  const groups = groupIncidents([
    incident('a-2026-07-25-04', 'tool-failure', 'validate failed on knowledge-base/index.md'),
    incident('a-2026-07-25-05', 'tool-failure', 'validate failed on knowledge-base/glossary.md'),
  ]);
  assert.equal(groups.size, 2);
});

test('different detection_signal types never merge', () => {
  const groups = groupIncidents([
    incident('b-2026-07-25-01', 'tool-failure', 'same cause text'),
    incident('b-2026-07-25-02', 'edit-thrash', 'same cause text'),
  ]);
  assert.equal(groups.size, 2);
});

test('groups keep a representative sample and a human label', () => {
  const groups = groupIncidents([incident('c-2026-07-25-01', 'tool-failure', 'Relative Path Confusion')]);
  const [{ sample, label }] = [...groups.values()];
  assert.equal(sample.id, 'c-2026-07-25-01');
  assert.equal(label, 'tool-failure :: relative path confusion');
});

test('occurrences outside the decay window stop counting', () => {
  const stale = incident('d-2026-01-01-01', 'tool-failure', 'recurring cause');
  const recent = [
    incident('d-2026-07-25-01', 'tool-failure', 'recurring cause'),
    incident('d-2026-07-26-01', 'tool-failure', 'recurring cause'),
  ];
  const groups = groupIncidents([stale, ...recent]);
  assert.equal([...groups.values()][0].n, 2, 'the >30d-old occurrence must decay out');
});

test('undated incidents are never decayed out (fail-open)', () => {
  const groups = groupIncidents([
    { status: 'open', detection_signal: { type: 'tool-failure' }, root_cause: 'recurring cause' },
    incident('e-2026-07-26-01', 'tool-failure', 'recurring cause'),
  ]);
  assert.equal([...groups.values()][0].n, 2);
});

test('grouping tolerates missing fields and empty input', () => {
  assert.equal(groupIncidents([]).size, 0);
  assert.equal(groupIncidents(undefined).size, 0);
  const groups = groupIncidents([{ id: 'f-2026-07-26-01', status: 'open' }]);
  assert.equal([...groups.keys()][0].startsWith('unknown :: '), true);
});
