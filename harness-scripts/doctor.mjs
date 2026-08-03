#!/usr/bin/env node
// doctor.mjs — Layer 1-sibling pre-flight tooling check.
//
// Reads harness/doctor.yml (declared tooling) and hard-gates on required tool
// presence. Fail-open on infrastructure: a missing manifest is never a failure.
// Node built-ins only — no npm install.
//
//   Exit 0  no manifest, no declared tools, or all required tools present
//   Exit 1  one or more required tools missing

import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

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
const MANIFEST_PATH = join(ROOT, 'harness', 'doctor.yml');

const argv = process.argv.slice(2);
const SCAN = argv.includes('--scan');
const WRITE = argv.includes('--write');

if (!SCAN && !existsSync(MANIFEST_PATH)) {
  console.log('Doctor: (harness/doctor.yml not found — no declared tooling; treating as pass)');
  process.exit(0);
}

/**
 * Hand-rolled narrow parser for the `tools:` top-level key (no YAML dependency).
 * Each `  - ` block underneath is one tool entry: `name` (bare scalar), `check`
 * (a JSON-array literal parsed via JSON.parse), `required` (true/false string),
 * and an optional `notes` string. Entries missing a name or a non-empty check
 * array are skipped.
 */
function parseTools(text) {
  const lines = text.split(/\r?\n/);
  const toolsIdx = lines.findIndex((l) => /^tools:\s*$/.test(l));
  if (toolsIdx === -1) return [];

  const tools = [];
  let current = null;
  for (let i = toolsIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // dedent back to top level — end of tools block

    const entryStart = line.match(/^\s*- name:\s*(.+)\s*$/);
    if (entryStart) {
      if (current) tools.push(current);
      current = { name: entryStart[1].trim(), check: null, required: false, notes: undefined };
      continue;
    }
    if (!current) continue;

    const checkMatch = line.match(/^\s*check:\s*(\[.*\])\s*$/);
    if (checkMatch) {
      try {
        current.check = JSON.parse(checkMatch[1]);
      } catch {
        current.check = null;
      }
      continue;
    }

    const requiredMatch = line.match(/^\s*required:\s*(true|false)\s*$/);
    if (requiredMatch) {
      current.required = requiredMatch[1] === 'true';
      continue;
    }

    const notesMatch = line.match(/^\s*notes:\s*(.+)\s*$/);
    if (notesMatch) {
      current.notes = notesMatch[1].trim();
      continue;
    }
  }
  if (current) tools.push(current);

  return tools.filter((t) => t.name && Array.isArray(t.check) && t.check.length > 0);
}

// --- opt-in manifest-scan writer (WI-02) ---------------------------------
// Single source of truth mirrors knowledge-base/toolchain-detection.md.
// Presence-only: each candidate is a spawn-presence `check` argv, never a
// file-exists probe and never a version constraint.
const DETECTORS = [
  { manifest: /^package\.json$/,            tools: [
      { name: 'node', check: ['node', '--version'], required: true },
      { name: 'npm',  check: ['npm', '--version'],  required: false } ] },
  { manifest: /^(pyproject\.toml|requirements\.txt)$/, tools: [
      { name: 'python', check: ['python', '--version'], required: true } ] },
  { manifest: /^go\.mod$/,                  tools: [
      { name: 'go', check: ['go', 'version'], required: true } ] },
  { manifest: /^Cargo\.toml$/,              tools: [
      { name: 'cargo', check: ['cargo', '--version'], required: true } ] },
  { manifest: /^(pom\.xml|build\.gradle)$/, tools: [
      { name: 'java', check: ['java', '-version'], required: true } ] },
  { manifest: /\.(csproj|sln)$/,            tools: [
      { name: 'dotnet', check: ['dotnet', '--version'], required: true } ] },
];

function scanRepoTools(root) {
  // Top-level, shallow, best-effort scan — fail-open on any fs error.
  let names;
  try { names = readdirSync(root); } catch { return []; }
  const found = new Map(); // name -> entry (first detector wins; dedup by name)
  for (const file of names) {
    for (const d of DETECTORS) {
      if (d.manifest.test(file)) {
        for (const t of d.tools) if (!found.has(t.name)) found.set(t.name, t);
      }
    }
  }
  return [...found.values()];
}

function serializeTool(t) {
  const lines = [`  - name: ${t.name}`,
                 `    check: ${JSON.stringify(t.check)}`];
  if (t.required !== undefined) lines.push(`    required: ${t.required}`);
  return lines.join('\n');
}

if (SCAN) {
  const existing = existsSync(MANIFEST_PATH)
    ? parseTools(readFileSync(MANIFEST_PATH, 'utf8')) : [];
  const have = new Set(existing.map((e) => e.name));
  const candidates = scanRepoTools(ROOT).filter((t) => !have.has(t.name)); // append-if-name-missing

  if (candidates.length === 0) {
    console.log('SCAN:     no new toolchain entries detected (nothing to append).');
    process.exit(0);
  }
  for (const t of candidates) console.log(`SCAN:     +${t.name} — ${JSON.stringify(t.check)}`);

  if (!WRITE) {
    console.log('SCAN:     preview only — re-run with --write to append to harness/doctor.yml.');
    process.exit(0); // read-only preview
  }

  try {
    const src = existsSync(MANIFEST_PATH) ? readFileSync(MANIFEST_PATH, 'utf8') : '';
    const lines = src.replace(/\n$/, '').split(/\r?\n/);
    if (lines.length === 1 && lines[0] === '') lines.pop(); // empty file -> no lines
    let headerIdx = lines.findIndex((l) => /^tools:\s*$/.test(l));
    if (headerIdx === -1) { lines.push('tools:'); headerIdx = lines.length - 1; }
    // Splice before the next top-level key so entries always land inside the
    // tools: block, never after a sibling key on a future multi-key doctor.yml.
    let insertAt = lines.length;
    for (let i = headerIdx + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) { insertAt = i; break; }
    }
    lines.splice(insertAt, 0, ...candidates.flatMap((t) => serializeTool(t).split('\n')));
    mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
    writeFileSync(MANIFEST_PATH, lines.join('\n') + '\n');
    for (const t of candidates) console.log(`WROTE:    +${t.name} — harness/doctor.yml`);
  } catch (err) {
    console.error(`SCAN:     could not write harness/doctor.yml (${err.code || err.message}) — no changes made.`);
  }
  process.exit(0); // deliberate mutation is not a failure
}
// --- fall through to the existing read-only presence gate -----------------

const manifestText = readFileSync(MANIFEST_PATH, 'utf8');
const tools = parseTools(manifestText);

if (tools.length === 0) {
  console.log('Doctor: harness/doctor.yml declares no tools — nothing to check.');
  process.exit(0);
}

const WINDOWS_SHIM_ALLOWLIST = new Set(['az', 'npm', 'npx', 'yarn', 'pnpm', 'func', 'ng', 'vue', 'tsc']);

function checkTool(args) {
  let r = spawnSync(args[0], args.slice(1), { shell: false });
  if (r.error && r.error.code === 'ENOENT' && process.platform === 'win32' &&
      WINDOWS_SHIM_ALLOWLIST.has(args[0])) {
    r = spawnSync(args[0], args.slice(1), { shell: true }); // narrow, hardcoded escape hatch — never manifest-controlled
  }
  return !r.error;
}

let hasMissingRequired = false;

for (const tool of tools) {
  const present = checkTool(tool.check);
  if (present) {
    console.log(`OK:       ${tool.name}`);
  } else if (tool.required) {
    console.error(`MISSING:  ${tool.name} — required tool not found on PATH (checked: ${tool.check.join(' ')})`);
    hasMissingRequired = true;
  } else {
    const notesSuffix = tool.notes ? ` ${tool.notes}` : '';
    console.log(`OPTIONAL: ${tool.name} — not found on PATH (checked: ${tool.check.join(' ')})${notesSuffix}`);
  }
}

process.exit(hasMissingRequired ? 1 : 0);
