#!/usr/bin/env node
// banner.test.mjs — unit tests for harness-scripts/banner.mjs.
//
// The banner adapter decides how the read-only session scripts serialize their
// output. Its contract: 'text' mode is byte-for-byte the legacy banner, and
// 'additional-context' mode is exactly one physical line of valid JSON the hooks
// runtime can inject — no accidental behavior change to the default path.
//
//   node --test
//   node tests/banner.test.mjs   (also works standalone)
//
// Node built-ins only — no npm install. Pure in-memory; touches no files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CONTEXT_BYTES, emitMode, render } from '../harness-scripts/banner.mjs';

// --- emitMode. ---------------------------------------------------------------

test('emitMode defaults to text when the flag is absent', () => {
  assert.equal(emitMode([]), 'text');
  assert.equal(emitMode(['--other=1']), 'text');
});

test('emitMode reads --emit=additional-context', () => {
  assert.equal(emitMode(['--emit=additional-context']), 'additional-context');
});

test('emitMode falls back to text on an unknown mode', () => {
  assert.equal(emitMode(['--emit=bogus']), 'text');
  assert.equal(emitMode(['--emit=']), 'text');
});

// --- text mode is the unchanged default. -------------------------------------

test('text mode joins with newlines and adds a single trailing newline', () => {
  assert.equal(render(['a', 'b', 'c'], 'text'), 'a\nb\nc\n');
  assert.equal(render(['solo']), 'solo\n'); // default arg is text
});

// --- additional-context mode. ------------------------------------------------

test('additional-context mode emits one physical line of valid JSON', () => {
  const out = render(['line 1', 'line 2'], 'additional-context');
  assert.equal(out.split('\n').filter(Boolean).length, 1); // exactly one non-empty line
  const parsed = JSON.parse(out);
  assert.deepEqual(Object.keys(parsed), ['additionalContext']);
  assert.equal(parsed.additionalContext, 'line 1\nline 2'); // newlines preserved in the value
});

test('additional-context escapes embedded newlines rather than splitting lines', () => {
  const out = render(['x', 'y'], 'additional-context');
  assert.ok(out.includes('\\n')); // the value carries an escaped newline
  assert.equal(out.trimEnd().indexOf('\n'), -1); // no raw newline in the JSON itself
});

test('empty input yields no output so the host applies "no context"', () => {
  assert.equal(render([], 'additional-context'), '');
  assert.equal(render(['', '  '], 'additional-context'), '');
});

test('oversized input is capped with a visible truncation marker', () => {
  const huge = 'x'.repeat(MAX_CONTEXT_BYTES + 500);
  const out = render([huge], 'additional-context');
  const parsed = JSON.parse(out);
  assert.ok(Buffer.byteLength(parsed.additionalContext, 'utf8') <= MAX_CONTEXT_BYTES);
  assert.match(parsed.additionalContext, /… \(truncated\)$/);
});
