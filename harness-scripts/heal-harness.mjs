#!/usr/bin/env node
// heal-harness.mjs — Layer 4 agent-reengage wrapper (the reserved exit 2).
//
// Wraps validate-harness.mjs AND doctor.mjs: runs both, and turns each opaque
// "FAIL: <check> — <detail>" line (validator) and "MISSING: <tool> — <detail>"
// line (doctor) into a structured, machine-readable repair directive (check,
// file, and the expected shape to restore) so an agent can act on it directly
// instead of re-deriving the fix. Emits nothing extra when both report clean.
// Node built-ins only — no npm install.
//
//   Exit 0  harness healthy (both scripts report clean, or fail-open/absent)
//   Exit 2  actionable repair directives emitted — agent re-engagement required
//
// The agent applies the directives, then re-runs `heal` to confirm green. This is
// the L4 code the validator header reserves; validate-harness.mjs itself still
// exits 1 so `local == CI` gating is unchanged; doctor.mjs itself still exits 1
// standalone so `node harness-scripts/harness.mjs doctor` keeps its own hard-gate contract.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const validator = resolve(HERE, 'validate-harness.mjs');
const doctorScript = resolve(HERE, 'doctor.mjs');

// Fail-open: with no validator to wrap there is nothing to heal.
if (!existsSync(validator)) {
  process.stdout.write('Heal: (validate-harness.mjs not found — nothing to check)\n');
  process.exit(0);
}

const r = spawnSync(process.execPath, [validator], { encoding: 'utf8' });

// Fail-open: a spawn error (e.g. runtime issue) degrades to a labeled note.
if (r.error) {
  process.stdout.write(`Heal: (could not run validator — ${r.error.message})\n`);
  process.exit(0);
}

// Map each validator check name to the expected shape to restore.
const REPAIR = {
  frontmatter: 'Begin the file with a `---` block containing a quoted `description:` (the discovery surface).',
  'skill-name': 'Rename the folder or the `name:` field so the SKILL.md `name` equals its folder.',
  applyTo: 'Replace the bare `applyTo: "**"` with a specific glob so it does not load on every request.',
  'features-schema': 'Restore features.yml schema: top-level schema_version/status_legend/features, and per-feature id/title/status with a declared status and unique id.',
  link: 'Fix or remove the broken markdown link so it resolves to an existing path.',
  'tracking-citation': 'Cite .copilot-tracking paths as plain text — no markdown link and no `#file:` reference.',
  'tracked-artifact': 'Create the referenced artifact at the given path, or correct the tracked path.',
  'incident-log': 'Fix the malformed line in harness/incidents.jsonl so every non-blank line is valid JSON.',
  'always-on': 'Keep exactly one always-on file: root AGENTS.md, with no co-shipped .github/copilot-instructions.md.',
  'doctor-yaml': 'Fix harness/doctor.yml so each tools[] entry has a `name` and a non-empty `check` array, and `required` (if present) is `true` or `false`.',
};

// Parse "FAIL: <check> — <detail>" lines from the validator's stderr.
const failLine = /^FAIL:\s+(\S+)\s+—\s+(.*)$/;
const directives = [];
if (r.status !== 0) {
  for (const line of (r.stderr || '').split(/\r?\n/)) {
    const m = failLine.exec(line.trim());
    if (!m) continue;
    const [, check, detail] = m;
    // Detail is conventionally "<file>: <message>"; pull the leading path token.
    const fileMatch = /^([^\s:]+):\s+(.*)$/.exec(detail);
    directives.push({
      check,
      file: fileMatch ? fileMatch[1] : null,
      problem: fileMatch ? fileMatch[2] : detail,
      expected: REPAIR[check] || 'Resolve the reported problem, then re-run heal.',
    });
  }
}
const validatorUnparsed = r.status !== 0 && directives.length === 0;

// Also run doctor.mjs (fail-open: skip its contribution if absent or unrunnable —
// e.g. an older scaffold that predates the doctor pattern).
let doctorClean = true;
if (existsSync(doctorScript)) {
  const d = spawnSync(process.execPath, [doctorScript], { encoding: 'utf8' });
  if (!d.error) {
    doctorClean = d.status === 0;
    if (!doctorClean) {
      const missingLine = /^MISSING:\s+(\S+)\s+—\s+(.*)$/;
      for (const line of (d.stderr || '').split(/\r?\n/)) {
        const m = missingLine.exec(line.trim());
        if (!m) continue;
        const [, name, detail] = m;
        directives.push({
          check: 'doctor-missing-tool',
          file: 'harness/doctor.yml',
          problem: `${name} — ${detail}`,
          expected: `Install \`${name}\` and ensure it resolves on PATH (or edit harness/doctor.yml to mark it optional or remove it if no longer required), then re-run doctor.`,
        });
      }
    }
  }
}

// Combined clean pass: validator silent+0 AND doctor clean (or absent/unrunnable).
if (r.status === 0 && doctorClean) {
  process.stdout.write('Heal: harness healthy — no repairs needed.\n');
  process.exit(0);
}

// Fail-open: nothing parseable from either script — surface raw output. In
// practice this only reaches here on an unparseable validator failure (doctor.mjs
// always prints a parseable MISSING: line whenever it exits non-zero, per its
// own contract), but the message stays generic rather than validator-specific.
if (directives.length === 0) {
  process.stdout.write('Heal: a wrapped script failed but emitted no parseable directives:\n');
  process.stdout.write((r.stderr || r.stdout || '(no output)').trim() + '\n');
  process.exit(2);
}

// Edge case: validator failed with unparseable output, but doctor still had
// parseable directives — surface the raw validator text first so nothing is
// silently dropped, then continue to the normal structured report below.
if (validatorUnparsed) {
  process.stdout.write('Heal: validator failed with unparseable output:\n');
  process.stdout.write((r.stderr || r.stdout || '(no output)').trim() + '\n\n');
}

process.stdout.write(`Heal: ${directives.length} repair directive(s) — apply, then re-run heal.\n\n`);
directives.forEach((d, i) => {
  process.stdout.write(`[${i + 1}] check: ${d.check}\n`);
  if (d.file) process.stdout.write(`    file:     ${d.file}\n`);
  process.stdout.write(`    problem:  ${d.problem}\n`);
  process.stdout.write(`    expected: ${d.expected}\n\n`);
});
process.stdout.write('REPAIR_JSON: ' + JSON.stringify(directives) + '\n');
process.exit(2);
