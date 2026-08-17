#!/usr/bin/env node
// validate-harness.mjs — Layer 1 deterministic harness gate.
//
// Makes the maintain-harness prose checks deterministic (no LLM, no tokens).
// Silent on a full pass; on failure prints one "FAIL: <check> — <detail>" line
// per problem, a summary, and exits 1. Node built-ins only — no npm install.
//
//   Exit 0  all checks pass (no output)
//   Exit 1  one or more checks failed
//
// Pass `--fix` to apply the safe subset of repairs (currently: quote a
// frontmatter `description:` value containing a colon). Riskier findings are
// surfaced as SUGGEST: hints, never auto-applied. Default (no flag) is unchanged.
//
// Pass `--baseline` for a brownfield-adoption advisory run: the checks that
// false-positive on a freshly-scaffolded pre-existing repo (frontmatter,
// skill-name, applyTo, always-on, link, agents-budget, secret-scan) are
// downgraded to non-gating WARN: notes so first-run noise does not block
// adoption. Every other check still hard-fails. Default (no flag) is unchanged.
//
// (Exit 2 is used by the L4 agent-reengage wrapper harness-scripts/heal-harness.mjs, which
//  wraps this validator and re-emits failures as structured repair directives.)

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
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

const failures = [];
const warnings = [];

// `--baseline` advisory mode: on a freshly-scaffolded pre-existing (brownfield)
// repo, these whole-tree / pre-existing-file checks legitimately false-positive
// on project-owned content the harness did not author. Under `--baseline` they
// are downgraded to non-gating WARN: notes; every other check still hard-fails.
// Without the flag the routing is a no-op, so normal runs are byte-identical.
const BASELINE = process.argv.slice(2).includes('--baseline');
const BASELINE_ADVISORY = new Set([
  'frontmatter', 'skill-name', 'applyTo', 'always-on', 'link', 'agents-budget', 'secret-scan',
]);
const fail = (check, detail) => {
  if (BASELINE && BASELINE_ADVISORY.has(check)) {
    warnings.push(`WARN: ${check} — ${detail} (brownfield baseline — advisory, not gating)`);
    return;
  }
  failures.push(`FAIL: ${check} — ${detail}`);
};

// `--fix` applies the safe subset of repairs; without it behavior is unchanged.
const FIX = process.argv.slice(2).includes('--fix');
const fixes = [];

/** Path relative to repo root, forward slashes. */
const rel = (p) => relative(ROOT, p).split('\\').join('/');

/** Recursively list files under a directory, skipping node_modules/.git. */
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Parse a top-level `---`-delimited frontmatter block into a flat key→value map.
 * Returns { ok, keys, raw } where keys is null when no valid block is present.
 * Hand-rolled — no YAML dependency. Handles simple `key: value` scalars and
 * single-level `key:\n  - item` lists (values become string[]). Nested maps and
 * multi-line block scalars remain unsupported — a documented limit, not a silent
 * gap: anything beyond a flat scalar or a flat list of scalars is out of scope.
 */
function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { ok: false, keys: null };
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') return { ok: false, keys: null };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) return { ok: false, keys: null };
  const keys = {};
  let i = 1;
  while (i < end) {
    const line = lines[i];
    if (!line.trim() || line.startsWith('#')) { i++; continue; }
    // Only capture top-level keys (no leading indentation).
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (/^\s/.test(line) || !m) { i++; continue; }
    let value = m[2].trim();
    if (!value) {
      // Empty inline value — look for a following flat `  - item` list.
      const items = [];
      let j = i + 1;
      while (j < end && /^\s+-\s*(.+?)\s*$/.test(lines[j])) {
        items.push(/^\s+-\s*(.+?)\s*$/.exec(lines[j])[1].trim());
        j++;
      }
      if (items.length > 0) {
        keys[m[1]] = items;
        i = j;
        continue;
      }
      keys[m[1]] = '';
      i++;
      continue;
    }
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    keys[m[1]] = value;
    i++;
  }
  return { ok: true, keys };
}

// ---------------------------------------------------------------------------
// Check 1 — frontmatter parses + description present for every customization file.
// ---------------------------------------------------------------------------
const customizationFiles = walk(join(ROOT, '.github')).filter((p) =>
  /\.instructions\.md$/.test(p) ||
  /\.prompt\.md$/.test(p) ||
  /\.agent\.md$/.test(p) ||
  /[/\\]SKILL\.md$/.test(p)
);

// ---------------------------------------------------------------------------
// Optional `--fix` pass — safe, mechanical normalizations only. Currently:
// quote a frontmatter `description:` value that contains a colon but is not yet
// quoted (the one unambiguous, reversible repair). Riskier findings (skill
// folder/name mismatch, bare applyTo) are surfaced as SUGGEST: hints below,
// never auto-applied.
// ---------------------------------------------------------------------------
if (FIX) {
  for (const file of customizationFiles) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    if (lines[0] === undefined || lines[0].trim() !== '---') continue;
    let end = -1;
    for (let i = 1; i < lines.length; i++) { if (lines[i].trim() === '---') { end = i; break; } }
    if (end === -1) continue;
    let changed = false;
    for (let i = 1; i < end; i++) {
      const m = /^description:\s*(.*)$/.exec(lines[i]);
      if (!m) continue;
      const value = m[1].trim();
      if (!value || !value.includes(':')) continue; // no colon -> quoting optional
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) continue; // already quoted
      lines[i] = `description: "${value.replace(/"/g, '\\"')}"`;
      changed = true;
    }
    if (changed) {
      writeFileSync(file, lines.join('\n'));
      fixes.push(rel(file));
    }
  }
}

for (const file of customizationFiles) {
  const text = readFileSync(file, 'utf8');
  const { ok, keys } = parseFrontmatter(text);
  if (!ok) {
    fail('frontmatter', `${rel(file)}: missing or unterminated \`---\` frontmatter block`);
    continue;
  }
  if (!keys.description || !keys.description.trim()) {
    fail('frontmatter', `${rel(file)}: missing or empty \`description\` (the discovery surface)`);
  }
  // List-valued keys (agent frontmatter): if declared, must parse as a non-empty
  // list — catches a `tools:`/`agents:` header with no items under it.
  for (const listKey of ['tools', 'agents']) {
    if (keys[listKey] !== undefined && (!Array.isArray(keys[listKey]) || keys[listKey].length === 0)) {
      fail('frontmatter', `${rel(file)}: \`${listKey}:\` is present but not a non-empty list`);
    }
  }
}

// ---------------------------------------------------------------------------
// Check 2 — each skill folder name equals its `name:` field.
// ---------------------------------------------------------------------------
const skillFiles = customizationFiles.filter((p) => /[/\\]SKILL\.md$/.test(p));
for (const file of skillFiles) {
  const { keys } = parseFrontmatter(readFileSync(file, 'utf8'));
  const folder = dirname(file).split(/[/\\]/).pop();
  if (!keys || !keys.name) {
    fail('skill-name', `${rel(file)}: SKILL.md has no \`name\` field`);
  } else if (keys.name !== folder) {
    fail('skill-name', `${rel(file)}: name "${keys.name}" ≠ folder "${folder}"`);
  }
}

// ---------------------------------------------------------------------------
// Check 3 — flag a catch-all `applyTo` (loads on every request; likely a mistake).
// applyTo is optional (description-triggered files omit it); only the catch-all
// glob in either spelling — `**` or `**/*` — is flagged.
// ---------------------------------------------------------------------------
for (const file of customizationFiles.filter((p) => /\.instructions\.md$/.test(p))) {
  const { keys } = parseFrontmatter(readFileSync(file, 'utf8'));
  if (keys && keys.applyTo && /^\*\*(?:\/\*)?$/.test(keys.applyTo.trim())) {
    fail('applyTo', `${rel(file)}: bare \`applyTo: "${keys.applyTo.trim()}"\` loads on every request — scope it`);
  }
}

// ---------------------------------------------------------------------------
// Check 4 — features.yml parses and conforms to the minimal schema.
// ---------------------------------------------------------------------------
const featuresPath = join(ROOT, 'features.yml');
if (!existsSync(featuresPath)) {
  fail('features-schema', 'features.yml is missing');
} else {
  const lines = readFileSync(featuresPath, 'utf8').split(/\r?\n/);
  for (const key of ['schema_version', 'status_legend', 'features']) {
    if (!lines.some((l) => new RegExp(`^${key}:`).test(l))) {
      fail('features-schema', `features.yml: missing top-level \`${key}\``);
    }
  }
  const legendStart = lines.findIndex((l) => /^status_legend:/.test(l));
  const allowedStatuses = new Set();
  if (legendStart !== -1) {
    for (const line of lines.slice(legendStart + 1)) {
      if (/^\S/.test(line)) break;
      const match = /^  ([A-Za-z0-9_-]+):/.exec(line);
      if (match) allowedStatuses.add(match[1]);
    }
  }
  const featIdx = lines.findIndex((l) => /^features:/.test(l));
  if (featIdx !== -1) {
    const blocks = [];
    let cur = null;
    for (const line of lines.slice(featIdx + 1)) {
      if (/^  - /.test(line)) { if (cur) blocks.push(cur); cur = [line]; }
      else if (cur) cur.push(line);
    }
    if (cur) blocks.push(cur);
    if (blocks.length === 0) {
      fail('features-schema', 'features.yml: `features` list is empty');
    }
    const seenIds = new Set();
    for (const block of blocks) {
      const body = block.join('\n');
      const id = (/(?:^|\n)\s*-?\s*id:\s*(\S+)/.exec(body) || [])[1] || '(unknown)';
      for (const field of ['id', 'title', 'status']) {
        if (!new RegExp(`(?:^|\\n)\\s*(?:-\\s*)?${field}:\\s*\\S`).test(body)) {
          fail('features-schema', `features.yml: feature ${id} missing \`${field}\``);
        }
      }
      if (id !== '(unknown)') {
        if (seenIds.has(id)) fail('features-schema', `features.yml: duplicate feature id \`${id}\``);
        seenIds.add(id);
      }
      const status = (/(?:^|\n)\s*status:\s*(\S+)/.exec(body) || [])[1];
      if (status && !allowedStatuses.has(status)) {
        fail('features-schema', `features.yml: feature ${id} has undeclared status \`${status}\``);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Check 5 — this harness's recommended single-source policy is root AGENTS.md.
// Both supported hosts can read .github/copilot-instructions.md, so this is a
// repository policy check, not a host-compatibility restriction.
// ---------------------------------------------------------------------------
if (!existsSync(join(ROOT, 'AGENTS.md'))) {
  fail('always-on', 'root AGENTS.md is missing (the single always-on file)');
}
if (existsSync(join(ROOT, '.github', 'copilot-instructions.md'))) {
  fail('always-on', '.github/copilot-instructions.md co-ships with AGENTS.md; repository policy recommends one AGENTS.md, but migrate and remove existing instructions only with explicit consent');
}

// ---------------------------------------------------------------------------
// Committed markdown docs to scan for links + tracking-path citations.
// ---------------------------------------------------------------------------
const committedDocs = [...new Set([
  ...readdirSync(ROOT).filter((name) => name.endsWith('.md')).map((name) => join(ROOT, name)),
  ...['knowledge-base', 'project-notes', 'tests', join('harness', 'state')]
    .flatMap((dir) => walk(join(ROOT, dir)).filter((p) => p.endsWith('.md'))),
  ...customizationFiles,
])].filter(existsSync);

const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
const markdownProse = (text) => {
  let inFence = false;
  return text.split(/\r?\n/).filter((line) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return false; }
    return !inFence;
  }).join('\n');
};

// ---------------------------------------------------------------------------
// Check 6 — markdown links in committed docs resolve to existing paths.
// ---------------------------------------------------------------------------
for (const file of committedDocs) {
  const text = markdownProse(readFileSync(file, 'utf8'));
  for (const m of text.matchAll(linkRe)) {
    let target = m[1].trim();
    if (/^(https?:|mailto:|#)/.test(target)) continue; // external / anchor
    target = target.split('#')[0]; // strip line/section fragment
    if (!target) continue;
    const decoded = decodeURIComponent(target);
    const resolved = resolve(dirname(file), decoded);
    if (!existsSync(resolved)) {
      fail('link', `${rel(file)}: broken link → ${target}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Check 10 — concrete artifact paths in feature/state tracking resolve.
// Placeholder-bearing template values and URLs are intentionally skipped.
// ---------------------------------------------------------------------------
const RETIRED_ARTIFACT_REPLACEMENTS = new Map([
  ['.github/prompts/build-harness.prompt.md', '.github/skills/build-harness/SKILL.md'],
]);

function checkArtifact(owner, rawPath) {
  const artifact = rawPath.trim().replace(/^['"]|['"]$/g, '');
  if (!artifact || artifact.includes('{{') || /^(https?:|mailto:)/.test(artifact)) return;
  const replacement = RETIRED_ARTIFACT_REPLACEMENTS.get(artifact);
  if (replacement && existsSync(resolve(ROOT, replacement))) return;
  if (!existsSync(resolve(ROOT, artifact))) {
    fail('tracked-artifact', `${owner}: artifact does not exist → ${artifact}`);
  }
}

if (existsSync(featuresPath)) {
  const lines = readFileSync(featuresPath, 'utf8').split(/\r?\n/);
  let inArtifacts = false;
  for (const line of lines) {
    if (/^    artifacts:\s*$/.test(line)) { inArtifacts = true; continue; }
    if (inArtifacts && /^    \S/.test(line)) inArtifacts = false;
    const match = inArtifacts ? /^      -\s+(.+?)\s*$/.exec(line) : null;
    if (match) checkArtifact('features.yml', match[1]);
  }
}

for (const stateFile of walk(join(ROOT, 'harness', 'state')).filter((p) => p.endsWith('state.md'))) {
  const text = readFileSync(stateFile, 'utf8');
  for (const match of text.matchAll(/^\s+- path:\s*["']?([^"'\r\n]+?)["']?\s*$/gm)) {
    checkArtifact(rel(stateFile), match[1]);
  }
}

// ---------------------------------------------------------------------------
// Check 8 — incident log (harness/incidents.jsonl) is well-formed JSONL AND
// every record conforms to the schema documented in
// .github/skills/review-session/SKILL.md and
// .github/skills/scaffold-harness/assets/templates/incidents.jsonl.template.
// Optional artifact: absent or empty passes silently (fail-open). Field-level
// validation exists so a malformed incident cannot silently poison aggregation
// (backpressure-stats.mjs groups on detection_signal.type + root_cause and
// escalates on remediation.layer — a record missing those is invisible, not
// loud). Only the keys the aggregators actually consume are required; the
// documented minimal variant's optional keys are enum-checked when present.
// Per PD-01 signatures are computed on the fly, so no signature field exists.
// ---------------------------------------------------------------------------
const DETECTION_TYPES = new Set([
  'repeated-correction', 'tool-failure', 'edit-thrash', 'context-saturation',
  'tripwire', 'validator-fail', 'backtrack', 'guard-trip',
]);
const REMEDIATION_LAYERS = new Set(['probabilistic', 'heuristic', 'deterministic']);
const INCIDENT_STATUSES = new Set(['open', 'remediated', 'wont-fix']);
const INCIDENT_SEVERITIES = new Set(['low', 'medium', 'high']);
const nonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

const incidentsPath = join(ROOT, 'harness', 'incidents.jsonl');
if (existsSync(incidentsPath)) {
  const incidentLines = readFileSync(incidentsPath, 'utf8').split(/\r?\n/);
  incidentLines.forEach((line, i) => {
    if (!line.trim()) return;
    const where = `harness/incidents.jsonl: line ${i + 1}`;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      fail('incident-log', `${where} is not valid JSON`);
      return;
    }
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      fail('incident-log', `${where} is not a JSON object`);
      return;
    }
    if (record.type === 'resolution') {
      if (!nonEmptyString(record.resolves)) {
        fail('incident-log', `${where}: resolution line is missing a \`resolves\` id`);
      }
      return;
    }
    if (!nonEmptyString(record.id)) {
      fail('incident-log', `${where} is missing \`id\``);
    }
    const detection = record.detection_signal;
    if (!detection || typeof detection !== 'object' || !nonEmptyString(detection.type)) {
      fail('incident-log', `${where} is missing \`detection_signal.type\``);
    } else if (!DETECTION_TYPES.has(detection.type)) {
      fail('incident-log', `${where} has undeclared \`detection_signal.type\` \`${detection.type}\``);
    }
    const remediation = record.remediation;
    if (!remediation || typeof remediation !== 'object') {
      fail('incident-log', `${where} is missing \`remediation\``);
    } else {
      if (!nonEmptyString(remediation.layer)) {
        fail('incident-log', `${where} is missing \`remediation.layer\``);
      } else if (!REMEDIATION_LAYERS.has(remediation.layer)) {
        fail('incident-log', `${where} has undeclared \`remediation.layer\` \`${remediation.layer}\``);
      }
      if (!nonEmptyString(remediation.kind)) {
        fail('incident-log', `${where} is missing \`remediation.kind\``);
      }
    }
    if (record.status !== undefined && !INCIDENT_STATUSES.has(record.status)) {
      fail('incident-log', `${where} has undeclared \`status\` \`${record.status}\``);
    }
    if (record.severity !== undefined && !INCIDENT_SEVERITIES.has(record.severity)) {
      fail('incident-log', `${where} has undeclared \`severity\` \`${record.severity}\``);
    }
  });
}

// ---------------------------------------------------------------------------
// Check 11 — AGENTS.md stays within a deterministic leanness budget. A generous
// line cap, not a stylistic nitpick — it exists to catch runaway growth (the
// always-on file bloating until agents start ignoring it), makes the
// maintain-harness "keep it lean" discipline tokenless, and is intentionally a
// single constant so a project can tune it for its own repo.
// ---------------------------------------------------------------------------
const AGENTS_LINE_BUDGET = 200;
const agentsPath = join(ROOT, 'AGENTS.md');
if (existsSync(agentsPath)) {
  const lineCount = readFileSync(agentsPath, 'utf8').split(/\r?\n/).length;
  if (lineCount > AGENTS_LINE_BUDGET) {
    fail('agents-budget', `AGENTS.md is ${lineCount} lines (budget: ${AGENTS_LINE_BUDGET}) — prune per the maintain-harness leanness discipline (link, don't embed)`);
  }
}

// ---------------------------------------------------------------------------
// Check 12 — deterministic secret-scan over every committed file. Regex-based,
// no dependency; patterns are intentionally narrow (high-entropy / well-known
// prefixes) to keep false positives low — this is a safety net, not a full
// secret-detection tool. Skips binary files (a NUL byte anywhere in the read).
// ---------------------------------------------------------------------------
const SECRET_PATTERNS = [
  { name: 'aws-access-key-id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'slack-token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'pem-private-key', re: /-----BEGIN (RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/ },
  { name: 'generic-secret-assignment', re: /\b(api[_-]?key|secret|password)\b\s*[:=]\s*['"][A-Za-z0-9_-]{16,}['"]/i },
];
for (const file of walk(ROOT)) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  if (text.includes('\u0000')) continue; // binary — skip
  for (const { name, re } of SECRET_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const lineNo = text.slice(0, m.index).split(/\r?\n/).length;
      fail('secret-scan', `${rel(file)}:${lineNo}: possible ${name} — verify and remove before committing`);
    }
  }
}

// ---------------------------------------------------------------------------
// Check 13 — .github/hooks/hooks.json (optional, opt-in agent-hooks layer), if
// present, is well-formed JSON with a numeric `version` and a `hooks` object,
// every `*.mjs` path referenced in a command/bash/powershell/
// command string actually exists, and every event key names a real hook event.
// Consistency-only (D-14 style): the file is optional and its absence is never a
// failure — this is not a hooks-schema validator.
//
// Event names are exact host contracts, not case aliases. Keep the tables
// separate so a spelling documented by one host is never generalized into a
// fabricated spelling for the other. Shared hook files may use only the
// intersection; host-specific adapters may use their host's complete table.
// ---------------------------------------------------------------------------
const HOOK_EVENTS_BY_HOST = {
  'copilot-cli': new Set([
    'sessionStart', 'userPromptSubmitted', 'preToolUse', 'postToolUse',
    'preCompact', 'subagentStart', 'subagentStop', 'agentStop', 'sessionEnd',
  ]),
  vscode: new Set([
    'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
    'PreCompact', 'SubagentStart', 'SubagentStop', 'Stop',
  ]),
};
const HOOK_EVENTS = new Set(Object.values(HOOK_EVENTS_BY_HOST).flatMap((events) => [...events]));
const hooksConfigPath = join(ROOT, '.github', 'hooks', 'hooks.json');
if (existsSync(hooksConfigPath)) {
  const raw = readFileSync(hooksConfigPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    fail('hooks-config', `.github/hooks/hooks.json is not valid JSON — ${e.message}`);
  }
  if (parsed) {
    if (typeof parsed.version !== 'number') {
      fail('hooks-config', '.github/hooks/hooks.json is missing a numeric "version" field');
    }
    if (!parsed.hooks || typeof parsed.hooks !== 'object') {
      fail('hooks-config', '.github/hooks/hooks.json is missing a "hooks" object');
    } else {
      for (const event of Object.keys(parsed.hooks)) {
        if (!HOOK_EVENTS.has(event)) {
          fail('hooks-config', `.github/hooks/hooks.json declares unknown hook event "${event}"; use an exact VS Code or Copilot CLI event name`);
        }
        if (event === 'Stop' || event === 'agentStop') {
          const entries = Array.isArray(parsed.hooks[event]) ? parsed.hooks[event] : [];
          if (entries.some((entry) => typeof entry?.command === 'string'
            && /(?:^|[\\/])session-end\.mjs(?:\s|$)/.test(entry.command))) {
            fail('hooks-config', `.github/hooks/hooks.json maps ${event} to session-end.mjs; stop events are not session termination`);
          }
        }
      }
      const scriptRefs = new Set();
      for (const m of raw.matchAll(/[\w.-]+(?:\/[\w.-]+)*\.mjs/g)) scriptRefs.add(m[0]);
      for (const ref of scriptRefs) {
        if (!existsSync(join(ROOT, ref))) {
          fail('hooks-config', `.github/hooks/hooks.json references "${ref}", which does not exist in the repo`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Check 14 — harness/doctor.yml (optional, default-emitted pre-flight
// manifest), if present, has a `tools:` list where every entry has a non-empty
// `name` and a non-empty `check` array, and `required` (if present) is `true`
// or `false`. Consistency-only (D-14 style): absence is never a failure — this
// is not a tool-presence check (that's harness-scripts/doctor.mjs's job).
// ---------------------------------------------------------------------------
const doctorYamlPath = join(ROOT, 'harness', 'doctor.yml');
if (existsSync(doctorYamlPath)) {
  const dLines = readFileSync(doctorYamlPath, 'utf8').split(/\r?\n/);
  const toolsIdx = dLines.findIndex((l) => /^tools:\s*$/.test(l));
  if (toolsIdx === -1) {
    fail('doctor-yaml', 'harness/doctor.yml: missing top-level `tools:` key');
  } else {
    const blocks = [];
    let cur = null;
    for (const line of dLines.slice(toolsIdx + 1)) {
      if (/^  - /.test(line)) { if (cur) blocks.push(cur); cur = [line]; }
      else if (cur && /^\s/.test(line)) cur.push(line);
      else break;
    }
    if (cur) blocks.push(cur);
    for (const block of blocks) {
      const body = block.join('\n');
      const name = (/name:\s*(\S+)/.exec(body) || [])[1];
      const checkMatch = /check:\s*(\[.*\])/.exec(body);
      let checkArr = null;
      if (checkMatch) { try { checkArr = JSON.parse(checkMatch[1]); } catch { checkArr = null; } }
      const requiredMatch = /required:\s*(\S+)/.exec(body);
      if (!name) fail('doctor-yaml', 'harness/doctor.yml: a tools entry is missing `name`');
      if (!Array.isArray(checkArr) || checkArr.length === 0) {
        fail('doctor-yaml', `harness/doctor.yml: tool ${name || '(unnamed)'} has an invalid or empty \`check\` array`);
      }
      if (requiredMatch && !['true', 'false'].includes(requiredMatch[1])) {
        fail('doctor-yaml', `harness/doctor.yml: tool ${name || '(unnamed)'} has a non-boolean \`required\` value`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Check 15 — harness/guards.yml (optional backpressure-guard manifest), if
// present, has a `guards:` list where every entry declares a non-empty `id`,
// every `mode` value (per-guard or under `defaults:`) is one of the four
// Kubernetes-PSA-style modes, and every `window` is >= 2 (a window of 1 trips on
// the first run before the edit witness can accrue). Mirrors Check 14:
// consistency-only, absence is never a failure. A typo'd mode silently disables a
// guard at runtime, so the gate has to see it — harness-scripts/guard.mjs is what
// actually enforces the mode ceiling.
// ---------------------------------------------------------------------------
const GUARD_MODES = new Set(['off', 'audit', 'warn', 'enforce']);
const guardsYamlPath = join(ROOT, 'harness', 'guards.yml');
if (existsSync(guardsYamlPath)) {
  const gLines = readFileSync(guardsYamlPath, 'utf8').split(/\r?\n/);
  for (const line of gLines) {
    const m = /^\s*(?:-\s*)?mode:\s*(\S+)\s*$/.exec(line);
    if (m && !GUARD_MODES.has(m[1])) {
      fail('guards-yaml', `harness/guards.yml: unknown \`mode\` value \`${m[1]}\` (expected off|audit|warn|enforce)`);
    }
    const w = /^\s*(?:-\s*)?window:\s*(\d+)\s*$/.exec(line);
    if (w && Number(w[1]) < 2) {
      fail('guards-yaml', `harness/guards.yml: \`window: ${w[1]}\` is too small (need >= 2 so the edit witness can accrue)`);
    }
  }
  const guardsIdx = gLines.findIndex((l) => /^guards:\s*$/.test(l));
  if (guardsIdx === -1) {
    fail('guards-yaml', 'harness/guards.yml: missing top-level `guards:` key');
  } else {
    const blocks = [];
    let cur = null;
    for (const line of gLines.slice(guardsIdx + 1)) {
      if (/^  - /.test(line)) { if (cur) blocks.push(cur); cur = [line]; }
      else if (cur && /^\s/.test(line)) cur.push(line);
      else if (/^\S/.test(line)) break;
    }
    if (cur) blocks.push(cur);
    for (const block of blocks) {
      if (!/(?:^|\n)\s*(?:-\s*)?id:\s*\S/.test(block.join('\n'))) {
        fail('guards-yaml', 'harness/guards.yml: a guards entry is missing `id`');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Check 16 — harness/state/**/state.md artifact registries are internally
// consistent, and no committed executable-layer script silently escapes the
// registry. Both parts are fail-open — no state.md, or a placeholder-only
// registry, is never a failure:
//   (a) structural: within one registry no `- path:` repeats and every entry
//       carries a `type:`, so a half-written row can't masquerade as registered.
//   (b) reverse coverage (opt-in by precedent): once ANY registry lists a real
//       harness-scripts/*.mjs path, every committed harness-scripts/*.mjs must
//       appear in some registry. This is the one direction Check 10 does not
//       cover — it proves listed→exists; this proves shipped→listed, the class
//       that let F-029's doctor.mjs/doctor.yml go unregistered across two
//       initiatives. A repo that never registers scripts stays dormant. See D-33.
// ---------------------------------------------------------------------------
const registeredScripts = new Set();
for (const stateFile of walk(join(ROOT, 'harness', 'state')).filter((p) => p.endsWith('state.md'))) {
  const owner = rel(stateFile);
  const sLines = readFileSync(stateFile, 'utf8').split(/\r?\n/);
  const seenPaths = new Set();
  for (let i = 0; i < sLines.length; i++) {
    const pm = /^\s*-\s*path:\s*["']?([^"'\r\n]+?)["']?\s*$/.exec(sLines[i]);
    if (!pm) continue;
    const p = pm[1].trim();
    if (p.includes('{{')) continue; // placeholder registry — skip
    if (seenPaths.has(p)) fail('state-artifact-registry', `${owner}: artifact "${p}" is registered more than once`);
    seenPaths.add(p);
    let hasType = false;
    for (let j = i + 1; j < sLines.length; j++) {
      if (/^\s*-\s*path:/.test(sLines[j]) || /^\S/.test(sLines[j])) break;
      if (/^\s*type:\s*\S/.test(sLines[j])) { hasType = true; break; }
    }
    if (!hasType) fail('state-artifact-registry', `${owner}: artifact "${p}" has no \`type:\``);
    if (/^harness-scripts\/[\w.-]+\.mjs$/.test(p)) registeredScripts.add(p);
  }
}
if (registeredScripts.size > 0) {
  for (const shipped of walk(join(ROOT, 'harness-scripts')).map(rel).filter((p) => /^harness-scripts\/[\w.-]+\.mjs$/.test(p))) {
    if (!registeredScripts.has(shipped)) {
      fail('state-artifact-registry', `${shipped} ships in harness-scripts/ but is registered in no state.md artifact registry`);
    }
  }
}

// ---------------------------------------------------------------------------
// Check 17 — AGENTS.md managed-block content presence. Check 5 proves AGENTS.md
// exists; this proves a *reconciled* brownfield merge actually landed its
// harness-owned sections. Fail-open and dormant by default: a hand-authored
// AGENTS.md with NO sentinels (like this repo's own) is fully allowed — the
// check only activates once the scaffold-harness managed block is present.
// When both sentinels are present, the four harness-owned section headings must
// appear between them; an unbalanced/out-of-order sentinel pair is a malformed
// (truncated) managed block and fails on its own. `local == CI` then proves the
// merge is complete, closing the gap that Check 5's existence-only test leaves.
// (Number is 17, not the vacant 9 slot — the source is numbered 1-8, 10-16.)
// ---------------------------------------------------------------------------
const BEGIN_SENTINEL = '<!-- HARNESS:BEGIN (managed by scaffold-harness — edits inside are overwritten) -->';
const END_SENTINEL = '<!-- HARNESS:END -->';
const HARNESS_SECTION_HEADINGS = [
  'Session start protocol',
  'Session end protocol',
  'Repository conventions',
  'Where deeper knowledge lives',
];
if (existsSync(agentsPath)) {
  const agentsText = readFileSync(agentsPath, 'utf8');
  const beginIdx = agentsText.indexOf(BEGIN_SENTINEL);
  const endIdx = agentsText.indexOf(END_SENTINEL);
  if (beginIdx === -1 && endIdx === -1) {
    // No managed block — dormant (fail-open). A hand-authored AGENTS.md is fine.
  } else if (beginIdx === -1 || endIdx === -1) {
    const missing = beginIdx === -1 ? 'HARNESS:BEGIN' : 'HARNESS:END';
    fail('managed-block', `AGENTS.md has one HARNESS sentinel but not the other (missing ${missing}) — the managed block is truncated`);
  } else if (endIdx < beginIdx) {
    fail('managed-block', 'AGENTS.md HARNESS:END appears before HARNESS:BEGIN — the managed block is malformed');
  } else {
    const block = agentsText.slice(beginIdx, endIdx);
    for (const heading of HARNESS_SECTION_HEADINGS) {
      if (!block.includes(heading)) {
        fail('managed-block', `AGENTS.md managed block is missing the harness-owned "${heading}" section`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Check 18 — every relative import inside harness-scripts/ resolves on disk.
// Universal and always on, which is the point: this is the one check that fires
// inside a *scaffolded target*, where a partial emit actually lands. A static
// relative import of a file the generator never copied is not a fail-open
// degradation — the script dies with ERR_MODULE_NOT_FOUND before its first line
// runs. Dormant when harness-scripts/ is absent (a doc-only harness). See D-34.
// ---------------------------------------------------------------------------
const relativeSpecifier = /\b(?:from|import)\s*\(?\s*['"](\.\.?\/[^'"]+)['"]/g;
// Comment lines are dropped first: prose about an import is not an import, and
// this check tripped on its own banner before the filter existed.
const codeLines = (text) => text.split(/\r?\n/)
  .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
  .join('\n');
const harnessScripts = walk(join(ROOT, 'harness-scripts')).filter((p) => p.endsWith('.mjs'));
for (const script of harnessScripts) {
  const text = codeLines(readFileSync(script, 'utf8'));
  for (const m of text.matchAll(relativeSpecifier)) {
    if (!existsSync(resolve(dirname(script), m[1]))) {
      fail('script-imports', `${rel(script)}: imports "${m[1]}", which does not exist`);
    }
  }
}

// ---------------------------------------------------------------------------
// Check 19 — the canonical adoption-profile catalog covers every shipped emit
// artifact and every generator contract surface points to that catalog. The
// mirror image of Check 18: that one catches a partial executable emit from the
// victim's side, this one catches catalog drift at the source, before a target
// is generated. Dormant when the catalog is absent, as it is in emitted targets.
//
// The artifact set is *derived from the tree*, not hand-listed, because a static
// list drifts exactly like the prose it replaced. Scripts alone were the original
// scope, which left every manifest, workflow, and hook artifact under prose-only
// control — and that is how the starter-kit mirror came to ship guard.mjs and
// doctor.mjs with no manifests to read (F-051/F-052). Repo-local files are the
// one thing a derivation cannot infer, so they get an explicit exemption.
// See D-34, D-39, D-40.
// ---------------------------------------------------------------------------
const PROFILE_CATALOG = '.github/skills/scaffold-harness/references/adoption-profiles.json';
const PROFILE_NAMES = ['doc-only', 'standard', 'full'];
const CONTRACT_FILES = new Map([
  ['.github/skills/build-harness/SKILL.md', '../scaffold-harness/references/adoption-profiles.json'],
  ['.github/skills/scaffold-harness/SKILL.md', PROFILE_CATALOG],
  ['ADOPTING.md', PROFILE_CATALOG],
  ['tests/scaffold-new-project.test.md', PROFILE_CATALOG],
]);
// Infrastructure for building/publishing *this* repo, never emitted to a target.
const REPO_LOCAL = new Set([
  '.github/workflows/self-test.yml',
  '.github/workflows/sync-starter-kit.yml',
  'harness/installation.yml',
]);
/** Files directly inside `dir` (no recursion — subtrees are per-repo content). */
const topLevelFiles = (dir) => {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => `${dir}/${e.name}`);
};
const profileCatalogPath = join(ROOT, PROFILE_CATALOG);
if (existsSync(profileCatalogPath)) {
  const shipped = [
    ...harnessScripts.map(rel),
    ...topLevelFiles('harness'),          // doctor.yml, guards.yml, incidents.jsonl
    ...topLevelFiles('.github/workflows'), // validate.yml (repo-local ones exempted)
    ...topLevelFiles('.githooks'),
    ...topLevelFiles('.github/hooks'),
  ].filter((p) => !REPO_LOCAL.has(p)).sort();

  let catalog;
  try {
    catalog = JSON.parse(readFileSync(profileCatalogPath, 'utf8'));
  } catch (error) {
    fail('emit-contract', `${PROFILE_CATALOG}: invalid JSON (${error.message})`);
  }

  if (catalog) {
    const artifacts = catalog.artifacts && typeof catalog.artifacts === 'object' ? catalog.artifacts : {};
    const profiles = catalog.profiles && typeof catalog.profiles === 'object' ? catalog.profiles : {};
    const artifactIds = new Set(Object.keys(artifacts));
    const catalogTargets = new Set();
    const operations = new Set(['append-lines', 'copy', 'reconcile-template', 'template']);

    if (catalog.schemaVersion !== 1) {
      fail('emit-contract', `${PROFILE_CATALOG}: schemaVersion must be 1`);
    }
    if (catalog.defaultProfile !== 'full') {
      fail('emit-contract', `${PROFILE_CATALOG}: defaultProfile must be full`);
    }
    if (Object.keys(profiles).sort().join(',') !== [...PROFILE_NAMES].sort().join(',')) {
      fail('emit-contract', `${PROFILE_CATALOG}: profiles must be exactly ${PROFILE_NAMES.join(', ')}`);
    }

    for (const [id, artifact] of Object.entries(artifacts)) {
      if (!artifact || typeof artifact !== 'object' || typeof artifact.target !== 'string' || !artifact.target) {
        fail('emit-contract', `${PROFILE_CATALOG}: artifact ${id} needs a non-empty target`);
        continue;
      }
      catalogTargets.add(artifact.target);
      if (!operations.has(artifact.operation)) {
        fail('emit-contract', `${PROFILE_CATALOG}: artifact ${id} has unknown operation ${artifact.operation}`);
      }
      if (artifact.operation === 'append-lines' && (!Array.isArray(artifact.lines) || artifact.lines.length === 0)) {
        fail('emit-contract', `${PROFILE_CATALOG}: append-lines artifact ${id} needs a non-empty lines array`);
      }
      if (artifact.operation !== 'append-lines' && (!artifact.source || typeof artifact.source !== 'string')) {
        fail('emit-contract', `${PROFILE_CATALOG}: artifact ${id} needs a source`);
      }
      if (artifact.source && !existsSync(join(ROOT, artifact.source))) {
        fail('emit-contract', `${PROFILE_CATALOG}: artifact ${id} source does not exist: ${artifact.source}`);
      }
    }

    for (const profile of PROFILE_NAMES) {
      if (!Array.isArray(profiles[profile])) {
        fail('emit-contract', `${PROFILE_CATALOG}: profile ${profile} must be an artifact-id array`);
        continue;
      }
      for (const id of profiles[profile]) {
        if (!artifactIds.has(id)) {
          fail('emit-contract', `${PROFILE_CATALOG}: profile ${profile} references unknown artifact ${id}`);
        }
      }
      if (new Set(profiles[profile]).size !== profiles[profile].length) {
        fail('emit-contract', `${PROFILE_CATALOG}: profile ${profile} contains duplicate artifact ids`);
      }
    }

    const isSubset = (left, right) => Array.isArray(left) && Array.isArray(right)
      && left.every((id) => right.includes(id));
    if (!isSubset(profiles['doc-only'], profiles.standard) || !isSubset(profiles.standard, profiles.full)) {
      fail('emit-contract', `${PROFILE_CATALOG}: profiles must be cumulative (doc-only ⊆ standard ⊆ full)`);
    }

    for (const [group, members] of Object.entries(catalog.atomicGroups ?? {})) {
      if (!Array.isArray(members) || members.length === 0) {
        fail('emit-contract', `${PROFILE_CATALOG}: atomic group ${group} must be a non-empty artifact-id array`);
        continue;
      }
      for (const id of members) {
        if (!artifactIds.has(id)) {
          fail('emit-contract', `${PROFILE_CATALOG}: atomic group ${group} references unknown artifact ${id}`);
        }
      }
      for (const profile of PROFILE_NAMES) {
        if (!Array.isArray(profiles[profile])) continue;
        const included = members.filter((id) => profiles[profile].includes(id));
        if (included.length > 0 && included.length < members.length) {
          fail('emit-contract', `${PROFILE_CATALOG}: profile ${profile} splits atomic group ${group}`);
        }
      }
    }

    for (const artifact of shipped) {
      if (!catalogTargets.has(artifact)) {
        fail('emit-contract', `${PROFILE_CATALOG}: does not catalog ${artifact}, which ships in this repo`);
      }
    }
  }

  for (const [contract, catalogReference] of CONTRACT_FILES) {
    const contractPath = join(ROOT, contract);
    if (!existsSync(contractPath)) continue;
    const text = readFileSync(contractPath, 'utf8');
    if (!text.includes(catalogReference)) {
      fail('emit-contract', `${contract}: does not reference ${catalogReference}`);
    }
    for (const profile of PROFILE_NAMES) {
      if (!text.includes(profile)) fail('emit-contract', `${contract}: does not name profile ${profile}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
if (FIX && fixes.length > 0) {
  for (const f of fixes) console.log(`FIXED: description-quote — ${f}`);
}

// Brownfield-baseline advisories are recorded (printed) but never gate.
if (BASELINE && warnings.length > 0) {
  for (const line of warnings) console.error(line);
  console.error(`\n${warnings.length} brownfield-baseline advisory warning(s) — not gating (exit 0 unless a non-advisory check failed).`);
}

if (failures.length > 0) {
  for (const line of failures) {
    console.error(line);
    if (FIX && /^FAIL: skill-name /.test(line)) {
      console.error('  SUGGEST: rename the folder or the `name:` field so they match (not auto-applied).');
    } else if (FIX && /^FAIL: applyTo /.test(line)) {
      console.error('  SUGGEST: replace `**` with a specific glob for the paths this file governs (not auto-applied).');
    }
  }
  console.error(`\n${failures.length} harness validation failure(s).`);
  process.exit(1);
}
