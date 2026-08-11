#!/usr/bin/env node
// guard.mjs — Layer 4 backpressure guards: the harness's over-try governor.
//
// Reads harness/guards.yml (declared guards) and decides whether a repeated,
// non-converging gate cycle should keep re-engaging the agent or stop and
// escalate to a human. Mode vocabulary is Kubernetes Pod Security Admission's —
// the only surveyed scheme with a silent-observation tier:
//
//   off      guard does not run                                        exit 0
//   audit    evaluates, records to state, prints nothing               exit 0
//   warn     evaluates, one loud stderr line + GUARD_JSON:, no block   exit 0
//   enforce  same output, blocks                                       exit 2
//
// Only proof-grade guards may reach `enforce` (ENFORCE_ELIGIBLE); a heuristic
// declared as `enforce` is clamped to `warn` rather than honored. Promotion runs
// `audit` -> `warn` -> `enforce` and is always a committed edit to
// harness/guards.yml, never an implicit runtime change.
//
// Two guards ship: `heal-loop-cap` (identical repair-directive set across N heal
// runs) and `no-progress` (identical failure-signature set across N gate runs
// *with an edit witness between each* — the witness is what stops merely
// re-reading the validator's output from counting as a stalled loop).
//
// Cross-run counters live in gitignored .copilot-tracking/guards/state.json and
// are never authoritative: an absent manifest, an unparseable manifest, or an
// unwritable state file all degrade to "no guard", which is the pre-guard
// behavior. Nothing here writes to a committed file — a trip *prints* a
// ready-to-append incident record for an agent to review and append itself.
// Node built-ins only.
//
//   node harness-scripts/harness.mjs guard   read-only status of recorded state
//
//   Exit 0  nothing declared, nothing tripped, or tripped below `enforce`
//   Exit 2  an `enforce` guard is tripped — agent re-engagement required

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signature, signatureSet } from './signature.mjs';

export const GUARD_MODES = ['off', 'audit', 'warn', 'enforce'];

/** New guards ship silent; promotion is a committed manifest edit, never implicit. */
export const DEFAULT_MODE = 'audit';

/** Consecutive gate runs considered when a guard declares no window (Google SRE: 3 attempts). */
export const DEFAULT_WINDOW = 3;

/** heal<->re-run cycles allowed to carry an unchanged directive set. */
export const MAX_HEAL_ATTEMPTS = 3;

/** Proof-grade guards only — everything else is clamped to `warn`. */
export const ENFORCE_ELIGIBLE = new Set(['heal-loop-cap']);

/** Declared ids without an evaluator here are skipped, not failed. */
export const KNOWN_GUARDS = new Set(['heal-loop-cap', 'no-progress']);

/** Tracked trees an edit could land in; gitignored scratch is deliberately excluded. */
export const WITNESS_ROOTS = [
  'AGENTS.md', 'PROGRESS.md', 'README.md', 'features.yml',
  '.github', 'harness', 'harness-scripts', 'knowledge-base', 'templates', 'tests',
];

/**
 * Locate the repo root by walking upward from `startDir` looking for a `.git`
 * entry (dir or file — handles worktrees/submodules) or an `AGENTS.md` file.
 * Falls back to the legacy one-level-up assumption if neither marker is found
 * anywhere above `startDir` (fail-open — this never throws).
 */
export function findRepoRoot(startDir) {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, '.git')) || existsSync(join(dir, 'AGENTS.md'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(startDir, '..'); // no marker found — legacy fallback
    dir = parent;
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = findRepoRoot(HERE);

const manifestPath = (root) => join(root, 'harness', 'guards.yml');
const statePath = (root) => join(root, '.copilot-tracking', 'guards', 'state.json');

// ---------------------------------------------------------------------------
// Manifest.
// ---------------------------------------------------------------------------

function coerce(raw) {
  const v = String(raw).replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

/**
 * Hand-rolled narrow parser for the `defaults:` and `guards:` keys (no YAML
 * dependency), mirroring the harness/doctor.yml reader in doctor.mjs. Each
 * `  - id: <id>` under `guards:` starts an entry; indented `key: value` lines
 * attach to it. Unknown keys are carried through untouched.
 */
export function parseGuards(text) {
  const defaults = { mode: DEFAULT_MODE, window: DEFAULT_WINDOW };
  const guards = [];
  let section = null;
  let current = null;

  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    if (/^\S/.test(line)) {
      if (current) { guards.push(current); current = null; }
      section = /^defaults:\s*$/.test(line) ? 'defaults' : /^guards:\s*$/.test(line) ? 'guards' : null;
      continue;
    }
    const kv = /^\s+([a-z_]+):\s*(.+?)\s*$/.exec(line);
    if (section === 'defaults') {
      if (kv) defaults[kv[1]] = coerce(kv[2]);
      continue;
    }
    if (section !== 'guards') continue;

    const entryStart = /^\s*- id:\s*(.+?)\s*$/.exec(line);
    if (entryStart) {
      if (current) guards.push(current);
      current = { id: coerce(entryStart[1]) };
      continue;
    }
    if (current && kv) current[kv[1]] = coerce(kv[2]);
  }
  if (current) guards.push(current);

  return { defaults, guards: guards.filter((g) => g.id) };
}

/** Absent, unreadable, or empty manifest -> null, i.e. "no guard" (fail-open). */
export function loadGuards(root = ROOT) {
  const path = manifestPath(root);
  if (!existsSync(path)) return null;
  try {
    const parsed = parseGuards(readFileSync(path, 'utf8'));
    return parsed.guards.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Manifest mode, then env overrides, then the ENFORCE_ELIGIBLE clamp. Returns
 * the honored mode plus the override that produced it (so the caller can record
 * and echo it — a silent override becomes a permanent one).
 */
export function resolveMode(cfg, defaults = {}, env = process.env) {
  let mode = GUARD_MODES.includes(cfg.mode) ? cfg.mode
    : GUARD_MODES.includes(defaults.mode) ? defaults.mode
      : DEFAULT_MODE;
  let override = null;

  if (GUARD_MODES.includes(env.HARNESS_GUARD_MODE)) {
    mode = env.HARNESS_GUARD_MODE;
    override = { source: 'HARNESS_GUARD_MODE', to: mode };
  }
  const disabled = String(env.HARNESS_GUARD_OFF || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (disabled.includes(cfg.id)) {
    mode = 'off';
    override = { source: 'HARNESS_GUARD_OFF', to: 'off' };
  }

  if (mode === 'enforce' && !ENFORCE_ELIGIBLE.has(cfg.id)) mode = 'warn';
  return { mode, override };
}

export function maxAttemptsFor(cfg, defaults = {}) {
  for (const n of [cfg.max_attempts, cfg.window, defaults.window, MAX_HEAL_ATTEMPTS]) {
    if (Number.isInteger(n) && n > 0) return n;
  }
  return MAX_HEAL_ATTEMPTS;
}

// ---------------------------------------------------------------------------
// Cross-run state (gitignored, never authoritative).
// ---------------------------------------------------------------------------

function normalizeState(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    version: 1,
    guards: o.guards && typeof o.guards === 'object' ? o.guards : {},
    overrides: Array.isArray(o.overrides) ? o.overrides : [],
  };
}

/** Absent or corrupt state reads as blank — losing it degrades to "no guard". */
export function readState(root = ROOT) {
  try {
    return normalizeState(JSON.parse(readFileSync(statePath(root), 'utf8')));
  } catch {
    return normalizeState(null);
  }
}

/** Best-effort: an unwritable .copilot-tracking/ degrades to no-guard, not an error. */
export function writeState(state, root = ROOT) {
  try {
    mkdirSync(dirname(statePath(root)), { recursive: true });
    writeFileSync(statePath(root), JSON.stringify(state, null, 2) + '\n');
    return true;
  } catch {
    return false;
  }
}

const overridesFor = (state, id) => state.overrides.filter((o) => o.guard === id);

function recordOverride(state, guard, override) {
  const hit = state.overrides.find((o) => o.guard === guard && o.source === override.source && o.to === override.to);
  if (hit) hit.count = (hit.count | 0) + 1;
  else state.overrides.push({ guard, source: override.source, to: override.to, at: new Date().toISOString(), count: 1 });
}

// ---------------------------------------------------------------------------
// Guard: heal-loop-cap.
// ---------------------------------------------------------------------------

/** Order- and prose-invariant fingerprint of one heal run's repair directives. */
export function healDirectiveSignature(directives) {
  return signatureSet((directives ?? []).map((d) =>
    signature('gate-fail', `${d.check} — ${d.file ?? ''}: ${d.problem ?? ''}`)));
}

/**
 * Record one heal run against the cap and report the verdict. An unchanged
 * directive set increments the counter; a changed set resets it to 1; a clean
 * run clears the entry (and reaps that guard's overrides). Returns null when no
 * manifest declares the guard, i.e. pre-guard behavior.
 */
export function recordHealRun(directives, root = ROOT, env = process.env) {
  const manifest = loadGuards(root);
  const cfg = manifest && manifest.guards.find((g) => g.id === 'heal-loop-cap');
  if (!cfg) return null;

  const { mode, override } = resolveMode(cfg, manifest.defaults, env);
  const max = maxAttemptsFor(cfg, manifest.defaults);
  const state = readState(root);
  if (override) recordOverride(state, cfg.id, override);

  const base = { id: cfg.id, mode, max, tripped: false, attempts: 0, directives: [] };

  if (mode === 'off') {
    writeState(state, root);
    return { ...base, overrides: overridesFor(state, cfg.id) };
  }

  if (!directives || directives.length === 0) {
    delete state.guards[cfg.id];
    state.overrides = state.overrides.filter((o) => o.guard !== cfg.id); // cleared counter reaps its overrides
    writeState(state, root);
    return { ...base, cleared: true, overrides: [] };
  }

  const sig = healDirectiveSignature(directives);
  const prev = state.guards[cfg.id];
  const attempts = prev && prev.signature === sig ? (prev.attempts | 0) + 1 : 1;
  const tripped = attempts > max;
  const detail = directives.map((d) => ({ check: d.check, file: d.file ?? null }));

  state.guards[cfg.id] = { signature: sig, attempts, tripped, directives: detail, updated: new Date().toISOString() };
  writeState(state, root);

  return {
    ...base,
    attempts,
    tripped,
    signature: sig,
    directives: detail,
    overrides: overridesFor(state, cfg.id),
  };
}

// ---------------------------------------------------------------------------
// Guard: no-progress.
// ---------------------------------------------------------------------------

/**
 * The cheapest proof-grade edit witness (research proof #1): the newest mtime and
 * the file count across the tracked harness trees. No git, no extra spawns. A
 * later mtime or a changed file count is evidence that something was actually
 * edited between two gate runs.
 *
 * Fail-open: an unreadable path contributes nothing rather than throwing. The
 * gitignored state file lives outside WITNESS_ROOTS, so recording a run can never
 * be mistaken for an edit.
 */
export function editWitness(root = ROOT) {
  let newest = 0;
  let files = 0;

  const visit = (path) => {
    let st;
    try { st = statSync(path); } catch { return; }
    if (st.isDirectory()) {
      let entries;
      try { entries = readdirSync(path); } catch { return; }
      for (const e of entries) visit(join(path, e));
      return;
    }
    files += 1;
    if (st.mtimeMs > newest) newest = st.mtimeMs;
  };

  for (const r of WITNESS_ROOTS) visit(join(root, r));
  return { newest, files };
}

/** An edit happened iff the tree got newer or gained/lost a file. */
export function witnessChanged(prev, next) {
  if (!prev || typeof prev !== 'object' || !next) return false;
  return next.newest > (prev.newest || 0) || next.files !== prev.files;
}

/**
 * Record one gate run against the no-progress window and report the verdict.
 * Trips only when the failure-signature set is identical across `window` runs
 * **and** the edit witness fired between each: without that clause, an agent
 * re-running the validator three times just to read its output would trip.
 *
 * A run with no witnessed edit is a no-op for the counter (not a reset) — it is
 * neither progress nor a stalled attempt. A changed signature set resets to 1; a
 * clean run clears the entry. `requires_edit_witness` in the manifest documents
 * this invariant; it is not a toggle, the witness is unconditional.
 */
export function recordNoProgress(failures, root = ROOT, env = process.env) {
  const manifest = loadGuards(root);
  const cfg = manifest && manifest.guards.find((g) => g.id === 'no-progress');
  if (!cfg) return null;

  const { mode, override } = resolveMode(cfg, manifest.defaults, env);
  const runs = maxAttemptsFor(cfg, manifest.defaults);
  const state = readState(root);
  if (override) recordOverride(state, cfg.id, override);

  const base = { id: cfg.id, mode, max: runs, tripped: false, attempts: 0, directives: [] };

  if (mode === 'off') {
    writeState(state, root);
    return { ...base, overrides: overridesFor(state, cfg.id) };
  }

  if (!failures || failures.length === 0) {
    delete state.guards[cfg.id];
    state.overrides = state.overrides.filter((o) => o.guard !== cfg.id); // cleared counter reaps its overrides
    writeState(state, root);
    return { ...base, cleared: true, overrides: [] };
  }

  const sig = healDirectiveSignature(failures);
  const witness = editWitness(root);
  const prev = state.guards[cfg.id];
  const same = Boolean(prev) && prev.signature === sig;
  const edited = same && witnessChanged(prev.witness, witness);
  const attempts = !same ? 1 : edited ? (prev.attempts | 0) + 1 : (prev.attempts | 0);
  const tripped = attempts >= runs;
  const detail = failures.map((d) => ({ check: d.check, file: d.file ?? null }));

  state.guards[cfg.id] = { signature: sig, attempts, tripped, witness, directives: detail, updated: new Date().toISOString() };
  writeState(state, root);

  return { ...base, attempts, tripped, edited, signature: sig, directives: detail, overrides: overridesFor(state, cfg.id) };
}

// ---------------------------------------------------------------------------
// Verdict rendering.
// ---------------------------------------------------------------------------

const APPEND_NOTE = 'A ready-to-append incident record is printed on the GUARD_INCIDENT: line — review it and '
  + 'append it to harness/incidents.jsonl yourself; nothing here writes to the committed ledger.';

/** One loud line plus the remedy that makes the trip actionable. */
export function describe(result) {
  const names = (result.directives ?? []).map((d) => (d.file ? `${d.check} (${d.file})` : d.check));
  const detail = names.join(', ') || '(no directive detail)';
  const bypass = `To bypass for one session set HARNESS_GUARD_OFF=${result.id} (recorded and echoed on every later run). `
    + APPEND_NOTE;

  if (result.id === 'no-progress') {
    return {
      line: `GUARD: ${result.id} — ${result.attempts} gate runs with edits in between produced an identical `
        + `failure-signature set (${result.signature}); the harness is not converging. Stop retrying the same `
        + `approach and escalate to a human. Unchanged: ${detail}`,
      expected: 'Change the approach, not the attempt count — a different failure set or a clean run resets the '
        + 'counter, and editing without moving the deterministic verdict is exactly what tripped this. ' + bypass,
    };
  }

  return {
    line: `GUARD: ${result.id} — ${result.attempts} heal runs produced an identical repair-directive set (${result.signature}); `
      + `the ${result.max}-attempt cap is spent. Stop re-running heal and escalate to a human. `
      + `Unsatisfiable: ${detail}`,
    expected: 'Resolve the named directive by hand, or decide it does not apply and remove what asks for it — '
      + 'a changed directive set or a clean run resets the counter. ' + bypass,
  };
}

/**
 * A ready-to-append incident record for a tripped guard, matching the schema
 * documented in .github/skills/review-session/SKILL.md and
 * .github/skills/scaffold-harness/assets/templates/incidents.jsonl.template.
 *
 * PRINT ONLY. This is what breaks the capture bootstrap deadlock: until now the
 * only writer of incidents was an agent voluntarily exercising the judgment the
 * ledger exists to replace, so the ledger starved and no signature ever reached
 * the promote threshold. A deterministic sensor now produces the record; a human
 * or agent still consents before it lands in the committed ledger.
 */
export function incidentRecord(result, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const names = (result.directives ?? []).map((d) => (d.file ? `${d.check} (${d.file})` : d.check));
  const detail = names.join(', ') || '(no directive detail)';

  return {
    id: `guard-${date}-01`,
    title: `Guard ${result.id} tripped after ${result.attempts} non-converging run(s)`,
    status: 'open',
    severity: result.mode === 'enforce' ? 'high' : 'medium',
    symptom: `${result.attempts} consecutive run(s) produced the identical failure set: ${detail}`,
    detection_signal: {
      type: 'guard-trip',
      evidence: `${result.id} at ${result.attempts}/${result.max} run(s); failure signature ${result.signature ?? 'n/a'}`,
      threshold_hit: `${result.attempts} run(s) reached the ${result.max}-run cap`,
    },
    trigger: `Repeated gate runs left ${detail} unresolved`,
    root_cause: `Not yet determined — ${result.id} proves the loop stalled on ${detail}, not why. `
      + 'Replace this with the underlying cause before appending.',
    remediation: {
      layer: 'deterministic',
      kind: 'loop-guard',
      action: `Resolve what ${result.id} named, or remove the requirement that asks for it`,
      artifact: 'harness-scripts/guard.mjs',
    },
    prevention_rule: 'ALWAYS change the approach after a guard trip — never re-run the same gate unchanged',
    followups: [
      { action: `Triage the ${result.id} trip and fill in root_cause`, type: 'prevent', done: false },
    ],
    lessons: 'A deterministic sensor firing once is stronger evidence than three prose incidents',
  };
}

/**
 * Emit a verdict. Silent unless an override is in play or the guard tripped at
 * `warn`/`enforce`. Returns the exit code the caller should honor.
 */
export function emit(result, write = (s) => process.stderr.write(s)) {
  if (!result) return 0;

  for (const o of result.overrides ?? []) {
    write(`GUARD: override active — ${o.guard} forced to ${o.to} via ${o.source} (first used ${o.at}, ${o.count}x)\n`);
  }
  if (!result.tripped || result.mode === 'off' || result.mode === 'audit') return 0;

  const { line, expected } = describe(result);
  write(line + '\n');
  write('GUARD_JSON: ' + JSON.stringify({
    guard: result.id,
    mode: result.mode,
    attempts: result.attempts,
    max: result.max,
    signature: result.signature ?? null,
    directives: result.directives ?? [],
    expected,
  }) + '\n');
  write('GUARD_INCIDENT: ' + JSON.stringify(incidentRecord(result)) + '\n');

  return result.mode === 'enforce' ? 2 : 0;
}

/** Read-only view of what the recorded counters currently say. */
export function status(root = ROOT, env = process.env) {
  const manifest = loadGuards(root);
  if (!manifest) return [];
  const state = readState(root);

  return manifest.guards.filter((cfg) => KNOWN_GUARDS.has(cfg.id)).map((cfg) => {
    const { mode } = resolveMode(cfg, manifest.defaults, env);
    const max = maxAttemptsFor(cfg, manifest.defaults);
    const rec = state.guards[cfg.id];
    return {
      id: cfg.id,
      mode,
      max,
      attempts: rec ? rec.attempts | 0 : 0,
      tripped: Boolean(rec && rec.tripped), // each guard records its own verdict; trip rules differ
      signature: rec ? rec.signature : null,
      directives: rec && Array.isArray(rec.directives) ? rec.directives : [],
      overrides: overridesFor(state, cfg.id),
    };
  });
}

/**
 * Trips recorded in the gitignored state file, for the session-end banner.
 * `available: false` means the manifest or the state file could not be read: the
 * caller must say so out loud rather than silently reporting "no trips", or the
 * capture deadlock returns unnoticed. Read-only — advances no counter.
 */
export function readGuardTrips(root = ROOT, env = process.env) {
  const path = statePath(root);
  if (!loadGuards(root) || !existsSync(path)) return { available: false, path, tripped: [] };
  return { available: true, path, tripped: status(root, env).filter((s) => s.tripped) };
}

// ---------------------------------------------------------------------------
// CLI — read-only; counters are only advanced by the gate that observes them.
// ---------------------------------------------------------------------------
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  let code = 0;
  for (const result of status()) code = Math.max(code, emit(result));
  process.exit(code);
}
