#!/usr/bin/env node
// doctor.mjs — Layer 1-sibling pre-flight tooling check.
//
// Reads harness/doctor.yml (declared tooling) and hard-gates on required tool
// presence. Fail-open on infrastructure: a missing manifest is never a failure.
// Node built-ins only — no npm install.
//
//   Exit 0  no manifest, no declared tools, or all required tools present
//   Exit 1  one or more required tools missing

import { readFileSync, existsSync } from 'node:fs';
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

if (!existsSync(MANIFEST_PATH)) {
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
