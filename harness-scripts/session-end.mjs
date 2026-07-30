#!/usr/bin/env node
// session-end.mjs — Layer 3 read-only session-end checklist + backpressure trigger.
//
// Executes the AGENTS.md Session-end protocol deterministically: prints the wrap-up
// checklist (PROGRESS.md, features.yml, state.md) and, crucially, reads
// harness/incidents.jsonl to decide whether a recurring signature has reached the
// promote threshold — the deterministic trigger that tells the agent to run the
// review-session skill before stopping. Read-only: never writes. Fail-open: a
// missing/empty log degrades to a labeled note and the script still exits 0. Node
// built-ins only — no npm install.

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

const PROMOTE_THRESHOLD = 3; // N open occurrences of a signature -> promote to deterministic

const out = [];
const line = (s = '') => out.push(s);

line('=== Harness session end ===');

// --- Wrap-up checklist (mirrors the AGENTS.md Session-end protocol). ---
line('Wrap-up:');
line('  1. Update PROGRESS.md (move done items to Done, refresh Next steps).');
line('  2. Update features.yml statuses + history entries.');
line('  3. If a milestone was reached, append to the active harness/state/<slug>/state.md.');
line('  4. Green-gate: run `node harness-scripts/harness.mjs heal` — apply any directives, re-run until healthy.');

// --- Backpressure trigger from harness/incidents.jsonl (read-only, fail-open). ---
const logPath = join(ROOT, 'harness', 'incidents.jsonl');
const raw = existsSync(logPath) ? readFileSync(logPath, 'utf8') : null;
if (raw === null) {
  line(`Health:   (${rel(logPath)} not found — nothing to review)`);
} else {
  const incidents = [];
  const resolved = new Set();
  for (const l of raw.split(/\r?\n/)) {
    if (!l.trim()) continue;
    let obj;
    try { obj = JSON.parse(l); } catch { continue; } // fail-open: skip malformed lines
    if (obj && obj.type === 'resolution') { if (obj.resolves) resolved.add(obj.resolves); }
    else if (obj && obj.id) incidents.push(obj);
  }
  const open = incidents.filter(
    (i) => i.status !== 'remediated' && i.status !== 'wont-fix' && !resolved.has(i.id),
  );
  const groups = new Map();
  for (const i of open) {
    const type = (i.detection_signal && i.detection_signal.type) || 'unknown';
    const cause = (i.root_cause || '').trim().toLowerCase().slice(0, 80);
    const key = `${type} :: ${cause}`;
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  const atThreshold = [...groups.entries()].filter(([, n]) => n >= PROMOTE_THRESHOLD);
  if (atThreshold.length > 0) {
    line(`Health:   ${open.length} open incident(s); ${atThreshold.length} signature(s) at promote threshold.`);
    line('  ACTION: run the review-session skill before stopping — a recurring signature');
    line('          has reached the promote threshold and should be hardened deterministically:');
    for (const [key, n] of atThreshold) line(`    - "${key}" x${n}`);
  } else if (open.length > 0) {
    line(`Health:   ${open.length} open incident(s); none at promote threshold — no review-session needed.`);
  } else {
    line('Health:   (no open incidents — clean session)');
  }
}

line('=============================');
process.stdout.write(out.join('\n') + '\n');
process.exit(0);
