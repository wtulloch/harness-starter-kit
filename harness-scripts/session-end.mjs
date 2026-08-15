#!/usr/bin/env node
// session-end.mjs — Layer 3 read-only session-end checklist + backpressure trigger.
//
// Executes the AGENTS.md Session-end protocol deterministically: prints the wrap-up
// checklist (PROGRESS.md, features.yml, state.md) and, crucially, decides whether
// to tell the agent to run the review-session skill before stopping. Two triggers,
// either of which fires it:
//
//   1. a guard trip recorded in .copilot-tracking/guards/state.json (deterministic —
//      one sensor firing outweighs any number of prose incidents), or
//   2. a recurring signature in harness/incidents.jsonl at the promote threshold.
//
// Trigger 1 exists because trigger 2 alone deadlocks: the only writer of incidents
// is an agent voluntarily running the skill, so the threshold depends on the very
// judgment it replaces. When guard state cannot be read the banner says so out
// loud and falls back to trigger 2 — a silent fallback would hide the deadlock's
// return. Read-only: never writes. Fail-open: a missing/empty input degrades to a
// labeled note and the script still exits 0. Node built-ins only — no npm install.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROMOTE_THRESHOLD, groupIncidents } from './signature.mjs';
import { emitMode, render } from './banner.mjs';

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

// Fail-open: a scaffold predating the guard layer keeps its threshold-only behavior.
let guard = null;
try {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), 'guard.mjs');
  if (existsSync(path)) guard = await import('./guard.mjs');
} catch {
  guard = null;
}

const out = [];
const line = (s = '') => out.push(s);

line('=== Harness session end ===');

// --- Wrap-up checklist (mirrors the AGENTS.md Session-end protocol). ---
line('Wrap-up:');
line('  1. Update PROGRESS.md (move done items to Done, refresh Next steps).');
line('  2. Update features.yml statuses + history entries.');
line('  3. If a milestone was reached, append to the active harness/state/<slug>/state.md.');
line('  4. Green-gate: run `node harness-scripts/harness.mjs heal` — apply any directives, re-run at most 3 times;');
line('     on a `GUARD: heal-loop-cap` line, stop and escalate to the human instead.');

// --- Trigger 1: guard trips from .copilot-tracking/guards/state.json (read-only). ---
const statePath = join(ROOT, '.copilot-tracking', 'guards', 'state.json');
let trips = { available: false, path: statePath, tripped: [] };
if (guard && guard.readGuardTrips) {
  try { trips = guard.readGuardTrips(ROOT); } catch { /* fail-open: keep the unavailable default */ }
}

if (!trips.available) {
  line(`Guards:   (${rel(trips.path)} unavailable — guard trips cannot be read this session;`);
  line('           falling back to the incident-threshold trigger below only.)');
} else if (trips.tripped.length > 0) {
  line(`Guards:   ${trips.tripped.length} guard trip(s) recorded.`);
  line('  ACTION: run the review-session skill before stopping — a deterministic guard');
  line('          tripped, which counts on its own regardless of the incident threshold:');
  for (const t of trips.tripped) {
    line(`    - ${t.id} (${t.mode}) at ${t.attempts}/${t.max} run(s), signature ${t.signature ?? 'n/a'}`);
  }
  line('  Review each record below, then append it to harness/incidents.jsonl yourself:');
  for (const t of trips.tripped) line('    GUARD_INCIDENT: ' + JSON.stringify(guard.incidentRecord(t)));
} else {
  line('Guards:   (no guard trips recorded)');
}

// --- Trigger 2: recurrence threshold in harness/incidents.jsonl (read-only, fail-open). ---
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
  const groups = groupIncidents(open, incidents);
  const atThreshold = [...groups.values()].filter((g) => g.n >= PROMOTE_THRESHOLD);
  if (atThreshold.length > 0) {
    line(`Health:   ${open.length} open incident(s); ${atThreshold.length} signature(s) at promote threshold.`);
    line('  ACTION: run the review-session skill before stopping — a recurring signature');
    line('          has reached the promote threshold and should be hardened deterministically:');
    for (const { label, n } of atThreshold) line(`    - "${label}" x${n}`);
  } else if (open.length > 0) {
    line(`Health:   ${open.length} open incident(s); none at promote threshold — no review-session needed.`);
  } else {
    line('Health:   (no open incidents — clean session)');
  }
}

line('=============================');
process.stdout.write(render(out, emitMode()));
process.exit(0);
