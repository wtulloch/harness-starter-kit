#!/usr/bin/env node
// session-start.mjs — Layer 3 read-only session-bootstrap banner.
//
// Executes the AGENTS.md Session-start protocol deterministically and prints only
// non-derivable *volatile* state — never re-printing AGENTS.md or the knowledge
// base (the agent loads those natively). This makes "I read the state" impossible
// to hallucinate. Read-only: never writes. Fail-open: missing sources degrade to a
// labeled note and the script still exits 0. Node built-ins only.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
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
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

const out = [];
const line = (s = '') => out.push(s);

line('=== Harness session start ===');

// --- Git branch + working-tree state (read-only; degrades if git is absent). ---
function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch === null) {
  line('Git:      (not available)');
} else {
  const status = git(['status', '--porcelain']);
  const changed = status ? status.split(/\r?\n/).filter(Boolean).length : 0;
  line(`Git:      ${branch} — ${changed} changed/untracked file(s)`);
}

// --- PROGRESS.md focus / next / blockers excerpts. ---
const progress = read(join(ROOT, 'PROGRESS.md'));
if (!progress) {
  line('PROGRESS: (PROGRESS.md not found)');
} else {
  const section = (heading) => {
    const lines = progress.split(/\r?\n/);
    const start = lines.findIndex((l) => new RegExp(`^##\\s+${heading}`).test(l));
    if (start === -1) return null;
    const body = [];
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) break;
      body.push(lines[i]);
    }
    const cleaned = body
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('>'));
    return cleaned.length ? cleaned.slice(0, 4) : null;
  };
  const focus = section('Current focus');
  const next = section('Next steps');
  const blockers = section('Blockers');
  line('PROGRESS:');
  line(`  Focus:    ${focus ? focus.join(' ') : '(none)'}`);
  line('  Next:');
  (next || ['(none)']).forEach((l) => line(`    - ${l.replace(/^[-*\d.]+\s*/, '')}`));
  line(`  Blockers: ${blockers ? blockers.join(' ') : '(none)'}`);
}

// --- features.yml status rollup. ---
const features = read(join(ROOT, 'features.yml'));
if (!features) {
  line('Features: (features.yml not found)');
} else {
  const counts = {};
  for (const m of features.matchAll(/^\s+status:\s*(\S+)/gm)) {
    counts[m[1]] = (counts[m[1]] || 0) + 1;
  }
  const rollup = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ');
  line(`Features: ${rollup || '(none)'}`);
}

// --- Active harness/state/<slug>/state.md current phase/step. ---
const stateRoot = join(ROOT, 'harness', 'state');
if (existsSync(stateRoot)) {
  for (const slug of readdirSync(stateRoot)) {
    const statePath = join(stateRoot, slug, 'state.md');
    const state = read(statePath);
    if (!state) continue;
    const phase = (/phase:\s*"?([^"\n]+)"?/.exec(state) || [])[1];
    const step = (/step:\s*"?([^"\n]+)"?/.exec(state) || [])[1];
    line(`State:    ${slug} — phase: ${phase || '?'} / step: ${step || '?'}`);
  }
} else {
  line('State:    (no harness/state directory)');
}

// --- Backpressure health from harness/incidents.jsonl (read-only, fail-open). ---
const incidentsRaw = read(join(ROOT, 'harness', 'incidents.jsonl'));
if (incidentsRaw === null) {
  line('Health:   (incidents.jsonl not found)');
} else {
  const incidents = [];
  const resolved = new Set();
  for (const l of incidentsRaw.split(/\r?\n/)) {
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
  const atThreshold = [...groups.values()].filter((g) => g.n >= PROMOTE_THRESHOLD).length;
  if (incidents.length === 0) {
    line('Health:   (no incidents)');
  } else {
    line(`Health:   ${open.length} open incident(s); ${atThreshold} at promote threshold` +
      (atThreshold ? ' — run review-session' : ''));
    // Surface the open prevention rules so the fix is top-of-mind this session.
    const rules = [...new Set(open.map((i) => (i.prevention_rule || '').trim()).filter(Boolean))].slice(0, 3);
    if (rules.length) {
      line(`  Prevention rules to keep in mind (${rules.length}):`);
      for (const r of rules) line(`    • ${r}`);
    }
  }
}

line('=============================');
process.stdout.write(render(out, emitMode()));
