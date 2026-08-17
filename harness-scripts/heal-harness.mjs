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
// `--fix` is an explicit operator opt-in, forwarded to the validator's safe
// autofix subset. Bare `heal` stays read-only: it is the command AGENTS.md's
// session-end green-gate tells every agent to run, so it never rewrites a
// committed file without being asked.
//
// The agent applies the directives, then re-runs `heal` to confirm green — but at
// most `max_attempts` times: the `heal-loop-cap` guard in harness-scripts/guard.mjs
// counts runs carrying an identical directive set and, once the cap is spent,
// replaces the directive block with an escalation line instead of asking for yet
// another identical pass. This is the L4 code the validator header reserves;
// validate-harness.mjs itself still exits 1 so `local == CI` gating is unchanged;
// doctor.mjs itself still exits 1 standalone so `node harness-scripts/harness.mjs
// doctor` keeps its own hard-gate contract.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const validator = resolve(HERE, 'validate-harness.mjs');
const doctorScript = resolve(HERE, 'doctor.mjs');

// Fail-open: an older scaffold predating the guard layer heals exactly as before.
let guard = null;
try {
  if (existsSync(resolve(HERE, 'guard.mjs'))) guard = await import('./guard.mjs');
} catch {
  guard = null;
}

// Fail-open: with no validator to wrap there is nothing to heal.
if (!existsSync(validator)) {
  process.stdout.write('Heal: (validate-harness.mjs not found — nothing to check)\n');
  process.exit(0);
}

const FIX = process.argv.slice(2).includes('--fix');
const r = spawnSync(process.execPath, FIX ? [validator, '--fix'] : [validator], { encoding: 'utf8' });

// Fail-open: a spawn error (e.g. runtime issue) degrades to a labeled note.
if (r.error) {
  process.stdout.write(`Heal: (could not run validator — ${r.error.message})\n`);
  process.exit(0);
}

// Map each validator check name to the expected shape to restore, plus a class:
//   repairable  the agent can satisfy it by editing the tree, then re-running
//   terminal    no additional pass can satisfy it — it needs a human decision or
//               an upstream action (rotate a credential, install a tool), so
//               burning the remaining attempt budget on a re-run is waste
// This is Azure's "Cancel" retry strategy and Google SRE's "don't retry"
// response: a retry loop needs to know which failures retrying cannot fix.
const REPAIR = {
  frontmatter: {
    class: 'repairable',
    expected: 'Begin the file with a `---` block containing a quoted `description:` (the discovery surface).',
  },
  'skill-name': {
    class: 'repairable',
    expected: 'Rename the folder or the `name:` field so the SKILL.md `name` equals its folder.',
  },
  applyTo: {
    class: 'repairable',
    expected: 'Replace the bare `applyTo: "**"` with a specific glob so it does not load on every request.',
  },
  'features-schema': {
    class: 'repairable',
    expected: 'Restore features.yml schema: top-level schema_version/status_legend/features, and per-feature id/title/status with a declared status and unique id.',
  },
  link: {
    class: 'repairable',
    expected: 'Fix or remove the broken markdown link so it resolves to an existing path.',
  },
  'tracked-artifact': {
    class: 'repairable',
    expected: 'Create the referenced artifact at the given path, or correct the tracked path.',
  },
  'incident-log': {
    class: 'repairable',
    expected: 'Fix the named line in harness/incidents.jsonl: valid JSON, and — unless it is a `{"type":"resolution","resolves":...}` line — an `id`, a `detection_signal.type` and `remediation.layer` from the documented enums, and a non-empty `remediation.kind` (schema: .github/skills/review-session/SKILL.md).',
  },
  'always-on': {
    class: 'repairable',
    expected: 'Apply the repository single-source policy without data loss: obtain explicit migration consent, copy existing .github/copilot-instructions.md guidance into AGENTS.md, then remove the legacy file. Without consent, preserve it and escalate the policy conflict.',
  },
  'agents-budget': {
    class: 'repairable',
    expected: 'Prune AGENTS.md back to the 200-line budget (AGENTS_LINE_BUDGET in harness-scripts/validate-harness.mjs) — link to the knowledge base or a skill instead of embedding, and move path-specific prose into an `applyTo`-scoped .github/instructions file.',
  },
  'secret-scan': {
    class: 'terminal',
    expected: 'Stop and escalate to a human: the matched credential must be rotated upstream, which no editing pass can do. Once it is rotated, remove the literal from the file (or, if it is a false positive, rewrite it as an obvious placeholder so the narrow pattern no longer matches).',
  },
  'hooks-config': {
    class: 'repairable',
    expected: 'Fix .github/hooks/hooks.json: numeric `version`, a `hooks` object, every referenced `*.mjs` path present, and exact host event names only. Copilot CLI: sessionStart, userPromptSubmitted, preToolUse, postToolUse, preCompact, subagentStart, subagentStop, agentStop, sessionEnd. VS Code: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PreCompact, SubagentStart, SubagentStop, Stop. Never map Stop or agentStop to session-end.mjs; stop events are not session termination. Keep shared stop hooks neutral, and reserve session-end.mjs automation for CLI sessionEnd if explicitly adopted.',
  },
  'doctor-yaml': {
    class: 'repairable',
    expected: 'Fix harness/doctor.yml so each tools[] entry has a `name` and a non-empty `check` array, and `required` (if present) is `true` or `false`.',
  },
  'guards-yaml': {
    class: 'repairable',
    expected: 'Fix harness/guards.yml so it has a top-level `guards:` list, every entry declares an `id`, and every `mode` is one of off|audit|warn|enforce.',
  },
  'script-imports': {
    class: 'repairable',
    expected: 'Copy the missing module into harness-scripts/ from the source harness (the executable layer is emitted whole — a static import of an un-emitted file crashes the script instead of failing open), or drop the import if the dependency is genuinely gone.',
  },
  'emit-contract': {
    class: 'repairable',
    expected: 'Repair the canonical adoption-profiles.json catalog or make the reported generator surface reference it and its profile names. If the artifact is infrastructure for building this repo and is never emitted, add it to REPO_LOCAL in harness-scripts/validate-harness.mjs instead.',
  },
};
const UNKNOWN_REPAIR = { class: 'repairable', expected: 'Resolve the reported problem, then re-run heal.' };

// Parse "FIXED: <fix> — <file>" lines from the validator's stdout (--fix only, so
// this stays empty and silent for a bare `heal`).
const fixedLine = /^FIXED:\s+(\S+)\s+—\s+(.*)$/;
const applied = [];
for (const line of (r.stdout || '').split(/\r?\n/)) {
  const m = fixedLine.exec(line.trim());
  if (m) applied.push({ fix: m[1], file: m[2] });
}

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
    const repair = REPAIR[check] || UNKNOWN_REPAIR;
    directives.push({
      check,
      file: fileMatch ? fileMatch[1] : null,
      problem: fileMatch ? fileMatch[2] : detail,
      expected: repair.expected,
      class: repair.class,
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
          // Terminal: installing a tool is an upstream action outside the tree.
          class: 'terminal',
        });
      }
    }
  }
}

// Combined clean pass: validator silent+0 AND doctor clean (or absent/unrunnable).
if (applied.length > 0) {
  process.stdout.write(`Heal: applied ${applied.length} autofix(es) via --fix:\n`);
  for (const a of applied) process.stdout.write(`  ${a.fix}: ${a.file}\n`);
  process.stdout.write('\n');
}

if (r.status === 0 && doctorClean) {
  if (guard) guard.emit(guard.recordHealRun([])); // a clean run clears the cap counter
  if (guard && guard.recordNoProgress) guard.emit(guard.recordNoProgress([]));
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

// Consult the heal-loop cap before re-engaging. Three runs carrying an identical
// directive set is proof that re-running is not converging, so escalate to the
// human instead of emitting the same block a fourth time. The no-progress guard
// watches the same gate boundary from the other side: identical failures *plus*
// witnessed edits in between. It ships at `audit`, so it records and stays silent.
if (guard && guard.recordNoProgress) guard.emit(guard.recordNoProgress(directives));
const capped = guard ? guard.recordHealRun(directives) : null;
if (capped && guard.emit(capped) === 2) process.exit(2);

const terminalCount = directives.filter((d) => d.class === 'terminal').length;
const terminalNote = terminalCount > 0
  ? ` (${terminalCount} terminal — re-running will not clear those)`
  : '';
process.stdout.write(`Heal: ${directives.length} repair directive(s)${terminalNote} — apply, then re-run heal.\n\n`);
directives.forEach((d, i) => {
  process.stdout.write(`[${i + 1}] check: ${d.check}\n`);
  process.stdout.write(`    class:    ${d.class}\n`);
  if (d.file) process.stdout.write(`    file:     ${d.file}\n`);
  process.stdout.write(`    problem:  ${d.problem}\n`);
  process.stdout.write(`    expected: ${d.expected}\n\n`);
});
process.stdout.write('REPAIR_JSON: ' + JSON.stringify(directives) + '\n');
process.exit(2);
