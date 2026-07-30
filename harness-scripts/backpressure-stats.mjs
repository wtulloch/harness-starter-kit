#!/usr/bin/env node
// backpressure-stats.mjs — optional aggregation + recurrence gate (advisory).
//
// Parses harness/incidents.jsonl, groups OPEN incidents by
// detection_signal.type + a root_cause signature, counts occurrences, and flags
// any signature at/over the promotion threshold as "promote to deterministic",
// emitting a seeded (print-only) validator-check stub for the agent to review.
// Resolution lines ({"type":"resolution","resolves":"<id>"}) close their target.
//
// Advisory, not a gate: always exits 0. Fail-open — a missing/empty log or a
// malformed line degrades to a labeled note (malformed-line detection is the
// validator's job). Node built-ins only — no npm install.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locate the repo root by walking upward from `startDir` looking for a `.git`
 * entry (dir or file — handles worktrees/submodules) or an `AGENTS.md` file.
 * Falls back to the legacy one-level-up assumption if neither marker is found
 * anywhere above `startDir` (fail-open — this never throws).
 */
function findRepoRoot(startDir) {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, '.git')) || existsSync(join(dir, 'AGENTS.md'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(startDir, '..'); // no marker found — legacy fallback
    dir = parent;
  }
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const rel = (p) => relative(ROOT, p).split('\\').join('/');

// Compact identifier fragment from a free-text rule (seeds a stub fn name).
const slug = (s) =>
  s.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 4)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('') || 'RecurringSignature';

// --- Tuning constants (single source of truth). ---
const CORRECTION_STRUGGLE_THRESHOLD = 2; // >2 corrections on one issue = a struggle
const PROMOTE_THRESHOLD = 3;             // N open occurrences of a signature -> promote to deterministic

const logPath = join(ROOT, 'harness', 'incidents.jsonl');

if (!existsSync(logPath)) {
  process.stdout.write(`Backpressure: (${rel(logPath)} not found — nothing to aggregate)\n`);
  process.exit(0);
}

const lines = readFileSync(logPath, 'utf8').split(/\r?\n/).filter((l) => l.trim());

const incidents = [];
const resolved = new Set();
for (const line of lines) {
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    continue; // fail-open: skip malformed lines (validator flags them)
  }
  if (obj && obj.type === 'resolution') {
    if (obj.resolves) resolved.add(obj.resolves);
  } else if (obj && obj.id) {
    incidents.push(obj);
  }
}

// Open = status !== remediated/wont-fix AND no resolution line closed it.
const open = incidents.filter(
  (i) => i.status !== 'remediated' && i.status !== 'wont-fix' && !resolved.has(i.id),
);

if (incidents.length === 0) {
  process.stdout.write('Backpressure: (no incidents recorded)\n');
  process.exit(0);
}

// Group open incidents by detection_signal.type + root_cause signature.
// Keep one representative incident per group so a promoted signature can seed
// a validator-check stub from its prevention_rule / root_cause.
const groups = new Map();
for (const i of open) {
  const type = (i.detection_signal && i.detection_signal.type) || 'unknown';
  const cause = (i.root_cause || '').trim().toLowerCase().slice(0, 80);
  const key = `${type} :: ${cause}`;
  const g = groups.get(key);
  if (g) g.n += 1;
  else groups.set(key, { n: 1, sample: i });
}

const atThreshold = [...groups.entries()].filter(([, g]) => g.n >= PROMOTE_THRESHOLD);

process.stdout.write(
  `Backpressure: ${open.length} open / ${incidents.length} total incident(s); ` +
    `${atThreshold.length} signature(s) at promote threshold (>=${PROMOTE_THRESHOLD}).\n`,
);
if (atThreshold.length > 0) {
  for (const [key, { n, sample }] of atThreshold) {
    const rule = (sample.prevention_rule || sample.root_cause || key).trim();
    const fnName = `check${slug(rule)}`;
    process.stdout.write(`  PROMOTE: "${key}" x${n} — harden deterministically (add a validator check).\n`);
    // Print-only, consent-gated: emit a seeded stub the agent reviews before pasting.
    process.stdout.write('    Seeded stub for harness-scripts/validate-harness.mjs (review, then paste):\n\n');
    process.stdout.write(`    // ---- Check: ${rule} ----\n`);
    process.stdout.write(`    // Source: recurring incident signature "${key}" (x${n} open occurrence(s)).\n`);
    process.stdout.write(`    (function ${fnName}() {\n`);
    process.stdout.write('      // TODO: implement a deterministic check enforcing the rule above.\n');
    process.stdout.write(`      // On violation: fail('${fnName}', '<detail>');\n`);
    process.stdout.write('    })();\n\n');
    process.stdout.write(
      '    The executable layer has no template twin — the live validator is the\n' +
      '    single source the generator copies verbatim, so there is nothing to mirror.\n',
    );
  }
}

process.exit(0);
