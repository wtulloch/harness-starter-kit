#!/usr/bin/env node
// scaffold-new-project.test.mjs — automated Tier-1 slice of
// tests/scaffold-new-project.test.md.
//
// It cannot drive the LLM generator (interview + confirm gate + creative
// authoring are agent behaviour), so it deterministically *simulates* a scaffold
// by emitting the template-driven files + minimal valid agent-authored stubs into
// a throwaway target, then runs the emitted executable layer against that tree —
// the same assertions Stages 2-5 and 7 make by hand.
//
// Uses the built-in node:test runner/reporter (no npm install):
//
//   node --test
//   node tests/scaffold-new-project.test.mjs   (also works standalone)
//
//   Exit 0  every check passed
//   Exit 1  one or more checks failed
//
// Node built-ins only — no npm install. Read-only w.r.t. this repo; all writes
// happen inside an OS temp dir that is removed on exit.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync, readdirSync, statSync, renameSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TPL = join(ROOT, 'templates');
const PROFILE_CATALOG_PATH = join(ROOT, '.github', 'skills', 'scaffold-harness', 'references', 'adoption-profiles.json');
const PROFILE_CATALOG = JSON.parse(readFileSync(PROFILE_CATALOG_PATH, 'utf8'));

// Registers a node:test case. The boolean/detail are computed synchronously
// during the imperative scaffold simulation below (same sequencing the prior
// hand-rolled check()/results accumulator used) — the test body just asserts on
// the already-computed outcome, so registration order == execution order and
// node:test's own reporter/exit-code contract replaces the manual one.
const check = (name, ok, detail = '') => {
  test(name, () => { assert.ok(ok, detail || name); });
};

// Canonical profile contract. Keep these checks in-process: profile structure is
// data, so subprocess validation would add runtime without increasing coverage.
const PROFILE_NAMES = ['doc-only', 'standard', 'full'];
const artifactIds = new Set(Object.keys(PROFILE_CATALOG.artifacts ?? {}));
const profileEntries = Object.entries(PROFILE_CATALOG.profiles ?? {});
const unknownProfileArtifacts = profileEntries.flatMap(([profile, ids]) =>
  ids.filter((id) => !artifactIds.has(id)).map((id) => `${profile}: ${id}`));
const missingProfileSources = Object.entries(PROFILE_CATALOG.artifacts ?? {})
  .filter(([, artifact]) => artifact.source && !existsSync(join(ROOT, artifact.source)))
  .map(([id, artifact]) => `${id}: ${artifact.source}`);
const operations = new Set(['append-lines', 'copy', 'reconcile-template', 'template']);
const malformedArtifacts = Object.entries(PROFILE_CATALOG.artifacts ?? {})
  .filter(([, artifact]) => !artifact.target || !operations.has(artifact.operation)
    || (artifact.operation === 'append-lines' && (!Array.isArray(artifact.lines) || artifact.lines.length === 0))
    || (artifact.operation !== 'append-lines' && !artifact.source))
  .map(([id]) => id);
const isSubset = (left, right) => left.every((id) => right.includes(id));
const atomicGroupsSplit = profileEntries.flatMap(([profile, ids]) =>
  Object.entries(PROFILE_CATALOG.atomicGroups ?? {}).flatMap(([group, members]) => {
    const included = members.filter((id) => ids.includes(id));
    return included.length > 0 && included.length < members.length ? [`${profile}: ${group}`] : [];
  }));

check('profile-catalog-schema', PROFILE_CATALOG.schemaVersion === 1
  && PROFILE_CATALOG.defaultProfile === 'standard'
  && PROFILE_NAMES.every((name) => Array.isArray(PROFILE_CATALOG.profiles?.[name]))
  && Object.keys(PROFILE_CATALOG.profiles ?? {}).length === PROFILE_NAMES.length);
check('profile-catalog-artifacts', unknownProfileArtifacts.length === 0
  && missingProfileSources.length === 0 && malformedArtifacts.length === 0,
  [...unknownProfileArtifacts, ...missingProfileSources, ...malformedArtifacts].join(', '));
check('profile-catalog-cumulative', isSubset(PROFILE_CATALOG.profiles['doc-only'], PROFILE_CATALOG.profiles.standard)
  && isSubset(PROFILE_CATALOG.profiles.standard, PROFILE_CATALOG.profiles.full));
check('profile-catalog-atomic-groups', atomicGroupsSplit.length === 0, atomicGroupsSplit.join(', '));

// --- Placeholder substitution for the human/agent-fill template blanks. --------
const MAP = {
  '{{project-name}}': 'Demo Service',
  '{{project-slug}}': 'demo-service',
  '{{kebab-case-identifier}}': 'demo-service',
  '{{Human-readable project name}}': 'Demo Service',
  '{{YYYY-MM-DD}}': '2026-07-09',
  '{{current phase}}': 'scaffold',
  '{{first phase}}': 'scaffold',
  '{{phase}}': 'scaffold',
  '{{current step}}': 'initial scaffold',
  '{{workspace-relative path}}': 'AGENTS.md',
};
const fill = (text) => text.replace(/\{\{[^}]*\}\}/g, (m) => MAP[m] ?? 'fixture');

const emit = (target, rel, text) => {
  const full = join(target, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const emitFromTemplate = (target, rel, tplRel, { substitute = true } = {}) => {
  const raw = readFileSync(join(TPL, tplRel), 'utf8');
  // Generator headers are stripped on emit, not substituted — leaving them to the
  // placeholder pass would put junk lines at the top of every emitted manifest.
  const stripped = raw.split(/\r?\n/).filter((line) => !/^\s*\{\{!.*\}\}\s*$/.test(line)).join('\n');
  emit(target, rel, substitute ? fill(stripped) : stripped);
};
// The executable layer is repo-agnostic, so the generator copies each live source
// file verbatim (no template twin, no header stripping).
const emitFromSource = (target, rel) => {
  const full = join(target, rel);
  mkdirSync(dirname(full), { recursive: true });
  copyFileSync(join(ROOT, rel), full);
};

const profileArtifacts = (profile = PROFILE_CATALOG.defaultProfile) => {
  const ids = PROFILE_CATALOG.profiles[profile];
  if (!ids) throw new Error(`Unknown adoption profile: ${profile}`);
  return ids.map((id) => ({ id, ...PROFILE_CATALOG.artifacts[id] }));
};

const emitProfile = (target, profile = PROFILE_CATALOG.defaultProfile) => {
  for (const artifact of profileArtifacts(profile)) {
    if (artifact.operation === 'copy') {
      emitFromSource(target, artifact.target);
    } else if (artifact.operation === 'template' || artifact.operation === 'reconcile-template') {
      emitFromTemplate(target, artifact.target, artifact.source.replace(/^templates\//, ''));
    } else if (artifact.operation === 'append-lines') {
      emit(target, artifact.target, `${artifact.lines.join('\n')}\n`);
    }
  }
};

// --- Build a scaffolded-harness fixture in a temp dir. -------------------------
function scaffoldFixture(profile = PROFILE_CATALOG.defaultProfile) {
  const target = mkdtempSync(join(tmpdir(), 'harness-scaffold-'));

  // Fixed artifacts come only from the canonical profile catalog.
  emitProfile(target, profile);

  // Phase-aware state is procedural and deliberately outside fixed profiles.
  emitFromTemplate(target, 'harness/state/demo-service/state.md', 'state.md.template');

  // Agent-authored files the generator writes (not template-copied) — minimal
  // valid stubs so the doc-harness assertions have something real to check.
  emit(target, '.github/instructions/general.instructions.md',
    '---\ndescription: "General coding rules for demo-service."\napplyTo: "src/**"\n---\n\n# General\n\n- Match neighboring patterns.\n');
  emit(target, '.github/skills/maintain-harness/SKILL.md',
    '---\nname: maintain-harness\ndescription: "Audit and maintain the demo-service harness."\n---\n\n# Maintain Harness\n\nAudit for bloat.\n');
  emit(target, '.github/prompts/example.prompt.md',
    '---\ndescription: "Example reusable task prompt for demo-service."\n---\n\n# Example\n\nDo the thing.\n');
  emit(target, 'knowledge-base/index.md',
    '# Knowledge Base\n\n- [conventions.md](conventions.md) — authoring conventions.\n');
  emit(target, 'knowledge-base/conventions.md', '# Conventions\n\nLink, don\u2019t inline.\n');

  return target;
}

// --- Helpers to run the emitted scripts and capture the exit code. -------------
function runNode(target, scriptRel, args = []) {
  // spawnSync captures stdout AND stderr regardless of exit code — advisory
  // (--baseline) runs exit 0 yet still emit WARN lines on stderr, so a success
  // branch that discarded stderr would hide them.
  const r = spawnSync('node', [scriptRel, ...args], { cwd: target, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function listTree(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listTree(full, base, out);
    else out.push(relative(base, full).split('\\').join('/'));
  }
  return out.sort();
}

// --- Run the checks. ----------------------------------------------------------
let target;
try {
  target = scaffoldFixture('full');

  // Stage 2/3 — required files emitted.
  const required = [
    'AGENTS.md', 'PROGRESS.md', 'features.yml',
    'harness/state/demo-service/state.md',
    '.github/instructions/general.instructions.md',
    '.github/skills/maintain-harness/SKILL.md',
    '.github/prompts/example.prompt.md',
    'knowledge-base/index.md',
    'harness-scripts/validate-harness.mjs', 'harness-scripts/session-start.mjs',
    'harness-scripts/session-end.mjs',
    'harness-scripts/heal-harness.mjs',
    'harness-scripts/backpressure-stats.mjs',
    'harness-scripts/signature.mjs',
    'harness-scripts/guard.mjs',
    'harness-scripts/harness.mjs',
    '.github/workflows/validate.yml', '.githooks/pre-commit',
    '.gitignore', '.gitattributes',
  ];
  const missing = required.filter((r) => !existsSync(join(target, r)));
  check('files-emitted', missing.length === 0, missing.join(', '));

  // Doctor pattern — default-on emission (mirror of agent-hooks-default-config-absent, inverted).
  check('doctor-default-present',
    existsSync(join(target, 'harness-scripts', 'doctor.mjs')) && existsSync(join(target, 'harness', 'doctor.yml')));

  // Guard layer — same default-on posture; without the manifest the heal-loop cap
  // documented in the emitted AGENTS.md has nothing enforcing it.
  check('guards-default-present',
    existsSync(join(target, 'harness-scripts', 'guard.mjs')) && existsSync(join(target, 'harness', 'guards.yml')));

  // Stage 2 — no unsubstituted {{placeholder}} tokens remain in committed docs.
  const committed = ['AGENTS.md', 'PROGRESS.md', 'features.yml', 'harness/state/demo-service/state.md'];
  const withPlaceholders = committed.filter((r) => readFileSync(join(target, r), 'utf8').includes('{{'));
  check('no-placeholders', withPlaceholders.length === 0, withPlaceholders.join(', '));

  // Stage 7 — .copilot-tracking/ is gitignored.
  check('tracking-ignored', readFileSync(join(target, '.gitignore'), 'utf8').includes('.copilot-tracking/'));

  // Stage 7 — .gitattributes normalizes emitted files to LF (local == CI).
  check('gitattributes-lf', readFileSync(join(target, '.gitattributes'), 'utf8').includes('eol=lf'));

  // Stage 3 — the hook file is emitted, but scaffold does not activate it.
  check('hook-emitted-inactive', existsSync(join(target, '.githooks', 'pre-commit')) && !existsSync(join(target, '.git')));

  // Generator contract — every owning surface points to the canonical catalog
  // and names the supported profiles without replicating its artifact roster.
  const contractFiles = [
    '.github/prompts/build-harness.prompt.md',
    '.github/skills/scaffold-harness/SKILL.md',
    '.github/agents/harness-builder.agent.md',
    'ADOPTING.md',
    'tests/scaffold-new-project.test.md',
  ];
  const contractOmissions = [];
  for (const file of contractFiles) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    if (!text.includes('.github/skills/scaffold-harness/references/adoption-profiles.json')) {
      contractOmissions.push(`${file}: profile catalog`);
    }
    for (const profile of PROFILE_NAMES) {
      if (!text.includes(profile)) contractOmissions.push(`${file}: ${profile}`);
    }
  }
  check('profile-surface-contract', contractOmissions.length === 0, contractOmissions.join(', '));

  // Stage 4 — deterministic validator passes clean.
  const v = runNode(target, 'harness-scripts/validate-harness.mjs');
  check('validator-clean', v.code === 0, `exit ${v.code}${v.stderr ? ' — ' + v.stderr.trim() : ''}`);

  // Stage 4a2 — a valid .github/hooks/hooks.json (Check 13) still validates clean.
  emitFromSource(target, '.github/hooks/hooks.json');
  const vHooks = runNode(target, 'harness-scripts/validate-harness.mjs');
  rmSync(join(target, '.github', 'hooks', 'hooks.json'));
  check('validator-hooks-config-clean', vHooks.code === 0, `exit ${vHooks.code}${vHooks.stderr ? ' — ' + vHooks.stderr.trim() : ''}`);

  // Doctor pattern — the seeded git-required manifest runs clean (exit 0, `OK: git`).
  const doc = runNode(target, 'harness-scripts/doctor.mjs');
  check('doctor-positive-run', doc.code === 0 && /OK:\s+git/.test(doc.stdout), `exit ${doc.code} — ${doc.stdout.trim()}`);

  // Doctor pattern — a required tool that cannot exist hard-gates (exit 1, `MISSING:`).
  const doctorYamlPath = join(target, 'harness', 'doctor.yml');
  const bogusManifest = 'tools:\n  - name: totally-bogus-tool-xyz\n    check: ["totally-bogus-tool-xyz", "--version"]\n    required: true\n';
  const originalManifest = readFileSync(doctorYamlPath, 'utf8');
  writeFileSync(doctorYamlPath, bogusManifest);
  const docNeg = runNode(target, 'harness-scripts/doctor.mjs');
  writeFileSync(doctorYamlPath, originalManifest);
  check('doctor-negative-run', docNeg.code === 1 && /MISSING:/.test(docNeg.stderr), `exit ${docNeg.code}`);

  // Doctor pattern — the valid manifest also validates clean (Check 14, mirrors validator-hooks-config-clean).
  check('validator-doctor-yaml-clean', runNode(target, 'harness-scripts/validate-harness.mjs').code === 0);

  // Doctor --scan (WI-02) — each case seeds a recognized manifest, runs, asserts,
  // then restores harness/doctor.yml + removes the manifest so nothing leaks forward.
  const pkgJsonPath = join(target, 'package.json');

  // --scan (no --write) previews candidate tools but mutates nothing.
  const scanBefore = readFileSync(doctorYamlPath, 'utf8');
  writeFileSync(pkgJsonPath, '{"name":"x"}\n');
  const scanPrev = runNode(target, 'harness-scripts/doctor.mjs', ['--scan']);
  const scanAfter = readFileSync(doctorYamlPath, 'utf8');
  rmSync(pkgJsonPath);
  check('doctor-scan-preview',
    scanPrev.code === 0 && /SCAN:\s+\+node/.test(scanPrev.stdout) && scanAfter === scanBefore,
    `exit ${scanPrev.code} — ${scanPrev.stdout.trim()}`);

  // --scan --write appends the name-missing node entry and exits 0.
  const writeBefore = readFileSync(doctorYamlPath, 'utf8');
  writeFileSync(pkgJsonPath, '{"name":"x"}\n');
  const scanWrite = runNode(target, 'harness-scripts/doctor.mjs', ['--scan', '--write']);
  const writeAfter = readFileSync(doctorYamlPath, 'utf8');
  writeFileSync(doctorYamlPath, writeBefore);
  rmSync(pkgJsonPath);
  check('doctor-scan-write-append',
    scanWrite.code === 0 && /WROTE:/.test(scanWrite.stdout) && /name:\s+node/.test(writeAfter),
    `exit ${scanWrite.code} — ${scanWrite.stdout.trim()}`);

  // A second --scan --write finds nothing new (append-if-name-missing is idempotent).
  const idemBefore = readFileSync(doctorYamlPath, 'utf8');
  writeFileSync(pkgJsonPath, '{"name":"x"}\n');
  runNode(target, 'harness-scripts/doctor.mjs', ['--scan', '--write']); // first append
  const afterFirst = readFileSync(doctorYamlPath, 'utf8');
  const idemSecond = runNode(target, 'harness-scripts/doctor.mjs', ['--scan', '--write']); // no-op
  const afterSecond = readFileSync(doctorYamlPath, 'utf8');
  writeFileSync(doctorYamlPath, idemBefore);
  rmSync(pkgJsonPath);
  check('doctor-scan-idempotent',
    idemSecond.code === 0 && /no new toolchain entries detected/.test(idemSecond.stdout) &&
      /name:\s+node/.test(afterFirst) && afterSecond === afterFirst,
    `exit ${idemSecond.code} — ${idemSecond.stdout.trim()}`);

  // The post-write manifest still passes validator Check 14 (mirrors validator-doctor-yaml-clean).
  const afterScanBefore = readFileSync(doctorYamlPath, 'utf8');
  writeFileSync(pkgJsonPath, '{"name":"x"}\n');
  runNode(target, 'harness-scripts/doctor.mjs', ['--scan', '--write']);
  const afterScanWritten = readFileSync(doctorYamlPath, 'utf8');
  const vAfterScan = runNode(target, 'harness-scripts/validate-harness.mjs');
  writeFileSync(doctorYamlPath, afterScanBefore);
  rmSync(pkgJsonPath);
  check('validator-doctor-yaml-after-scan',
    vAfterScan.code === 0 && /name:\s+node/.test(afterScanWritten),
    `exit ${vAfterScan.code}${vAfterScan.stderr ? ' — ' + vAfterScan.stderr.trim() : ''}`);

  // --scan --write seeds an absent harness/doctor.yml (DD-02 remediation) Check-14-valid.
  const createMissingOriginal = readFileSync(doctorYamlPath, 'utf8');
  rmSync(doctorYamlPath);
  writeFileSync(pkgJsonPath, '{"name":"x"}\n');
  const createMissing = runNode(target, 'harness-scripts/doctor.mjs', ['--scan', '--write']);
  const createdExists = existsSync(doctorYamlPath);
  const vCreateMissing = runNode(target, 'harness-scripts/validate-harness.mjs');
  writeFileSync(doctorYamlPath, createMissingOriginal);
  rmSync(pkgJsonPath);
  check('doctor-scan-write-create-missing',
    createMissing.code === 0 && createdExists && vCreateMissing.code === 0,
    `exit ${createMissing.code} — created ${createdExists}, validate ${vCreateMissing.code}`);

  // --scan --write splices new entries inside the tools: block, never after a
  // trailing sibling top-level key (guards the end-of-file append regression).
  const multiKeyOriginal = readFileSync(doctorYamlPath, 'utf8');
  writeFileSync(doctorYamlPath, `${multiKeyOriginal.replace(/\n$/, '')}\nmeta:\n  schema: 1\n`);
  writeFileSync(pkgJsonPath, '{"name":"x"}\n');
  const multiKey = runNode(target, 'harness-scripts/doctor.mjs', ['--scan', '--write']);
  const multiKeyWritten = readFileSync(doctorYamlPath, 'utf8');
  const vMultiKey = runNode(target, 'harness-scripts/validate-harness.mjs');
  writeFileSync(doctorYamlPath, multiKeyOriginal);
  rmSync(pkgJsonPath);
  check('doctor-scan-write-inside-block',
    multiKey.code === 0 && vMultiKey.code === 0 &&
      multiKeyWritten.indexOf('name: node') < multiKeyWritten.indexOf('meta:'),
    `exit ${multiKey.code} — node@${multiKeyWritten.indexOf('name: node')} meta@${multiKeyWritten.indexOf('meta:')}, validate ${vMultiKey.code}`);

  // Stage 4b — validator fails loudly on a seeded fault.
  const fault = join(target, 'knowledge-base', '_faulttest.md');
  writeFileSync(fault, '# fault\n[broken](does-not-exist.md)\n');
  const vf = runNode(target, 'harness-scripts/validate-harness.mjs');
  rmSync(fault);
  check('validator-negative', vf.code === 1 && /FAIL: link/.test(vf.stderr), `exit ${vf.code}`);

  // Stage 5 — session banner runs read-only and exits 0.
  const before = listTree(target);
  const s = runNode(target, 'harness-scripts/session-start.mjs');
  const after = listTree(target);
  check('session-start-exit', s.code === 0, `exit ${s.code}`);
  check('session-start-readonly', JSON.stringify(before) === JSON.stringify(after));
  check('session-start-banner', /Harness session start/.test(s.stdout) && /demo-service/.test(s.stdout));

  // Stage 5d — session-end wrap-up is read-only, fail-open (no incident log yet), exits 0.
  const beforeSE = listTree(target);
  const se = runNode(target, 'harness-scripts/session-end.mjs');
  const afterSE = listTree(target);
  check('session-end-exit', se.code === 0, `exit ${se.code}`);
  check('session-end-readonly', JSON.stringify(beforeSE) === JSON.stringify(afterSE));
  check('session-end-clean', /Harness session end/.test(se.stdout) && /Wrap-up:/.test(se.stdout));

  // Stage 4c — emitted backpressure-stats runs fail-open (exit 0) with no incident log.
  const bp = runNode(target, 'harness-scripts/backpressure-stats.mjs');
  check('backpressure-stats-failopen', bp.code === 0, `exit ${bp.code}${bp.stderr ? ' — ' + bp.stderr.trim() : ''}`);

  // Stage 4g — command-verb dispatcher travels with the scaffold and forwards argv.
  const dv = runNode(target, 'harness-scripts/harness.mjs', ['validate']);
  check('harness-verb-validate', dv.code === 0, `exit ${dv.code}${dv.stderr ? ' — ' + dv.stderr.trim() : ''}`);
  const du = runNode(target, 'harness-scripts/harness.mjs', ['bogus']);
  check('harness-verb-unknown', du.code === 1 && /Unknown verb/.test(du.stderr), `exit ${du.code}`);
  const dh = runNode(target, 'harness-scripts/harness.mjs', ['--help']);
  check('harness-verb-help',
    dh.code === 0 && /validate/.test(dh.stdout) && /session-start/.test(dh.stdout) && /session-end/.test(dh.stdout) && /backpressure-stats/.test(dh.stdout) && /heal/.test(dh.stdout),
    `exit ${dh.code}`);
  // Every advertised verb must resolve to an emitted script — `guard` was advertised
  // by the dispatcher long before guard.mjs was in the emit set.
  const dg = runNode(target, 'harness-scripts/harness.mjs', ['guard']);
  check('harness-verb-guard', dg.code === 0, `exit ${dg.code}${dg.stderr ? ' — ' + dg.stderr.trim() : ''}`);

  // Stage 4h — L4 heal wrapper: healthy tree exits 0; a seeded fault exits 2 with a directive.
  const hc = runNode(target, 'harness-scripts/heal-harness.mjs');
  check('heal-clean', hc.code === 0 && /healthy/.test(hc.stdout), `exit ${hc.code}${hc.stderr ? ' — ' + hc.stderr.trim() : ''}`);
  // Regression: the combined-healthy condition (validator AND doctor.mjs both clean) still holds.
  check('heal-clean-doctor-included', /healthy/.test(hc.stdout) && hc.code === 0);
  const healFault = join(target, 'knowledge-base', '_healtest.md');
  writeFileSync(healFault, '# heal fault\n[broken](does-not-exist.md)\n');
  const hn = runNode(target, 'harness-scripts/heal-harness.mjs');
  rmSync(healFault);
  check('heal-negative',
    hn.code === 2 && /check: link/.test(hn.stdout) && /REPAIR_JSON:/.test(hn.stdout),
    `exit ${hn.code}`);

  // Every directive carries a terminal-vs-repairable class, and REPAIR_JSON stays
  // parseable — an agent needs the class to know which failures a re-run can fix.
  const parseRepairJson = (stdout) => {
    const line = stdout.split(/\r?\n/).find((l) => l.startsWith('REPAIR_JSON:'));
    try { return JSON.parse(line.slice('REPAIR_JSON:'.length).trim()); } catch { return null; }
  };
  const linkDirectives = parseRepairJson(hn.stdout);
  check('heal-directive-class',
    Array.isArray(linkDirectives) &&
      linkDirectives.length > 0 &&
      linkDirectives.every((d) => d.class === 'repairable' || d.class === 'terminal') &&
      linkDirectives.some((d) => d.check === 'link' && d.class === 'repairable') &&
      /^\s+class:\s+repairable$/m.test(hn.stdout),
    JSON.stringify(linkDirectives));

  // A secret-scan hit is terminal: rotating the credential is an upstream action
  // no editing pass can perform, so heal says so instead of inviting a re-run.
  const healSecret = join(target, 'project-notes', '_healsecret.md');
  mkdirSync(dirname(healSecret), { recursive: true });
  writeFileSync(healSecret, `# fixture\n\n${'AKIA'}${'ABCDEFGHIJKLMNOP'}\n`);
  const hs = runNode(target, 'harness-scripts/heal-harness.mjs');
  rmSync(healSecret, { force: true });
  const secretDirectives = parseRepairJson(hs.stdout) ?? [];
  check('heal-directive-class-terminal',
    hs.code === 2 &&
      secretDirectives.some((d) => d.check === 'secret-scan' && d.class === 'terminal') &&
      /1 terminal/.test(hs.stdout),
    `exit ${hs.code} — ${JSON.stringify(secretDirectives)}`);
  const hnv = runNode(target, 'harness-scripts/harness.mjs', ['heal']);
  check('harness-verb-heal', hnv.code === 0 && /healthy/.test(hnv.stdout), `exit ${hnv.code}`);

  // --- Closed-loop fault-injection: inject -> heal (exit 2 + directive) -> apply -> heal (green). ---
  // Proves the self-healing LOOP closes, not just that each rung fires in isolation:
  //   1. each seeded fault surfaces an exit-2 directive naming the RIGHT check,
  //   2. applying the shape that directive describes is SUFFICIENT to restore green
  //      (so heal-harness.mjs's REPAIR map stays in sync with the checks it maps),
  //   3. the repaired tree is silent-green on a re-run (convergence, no oscillation).
  // The tree is green here (heal-clean passed above); every case fully restores it.
  const closedLoop = (name, checkLabel, { setup, mutate, repair, cleanup }) => {
    if (setup) setup();
    mutate();
    const broken = runNode(target, 'harness-scripts/heal-harness.mjs');
    const emitted =
      broken.code === 2 &&
      new RegExp(`check: ${checkLabel}(\\s|$)`, 'm').test(broken.stdout) &&
      /REPAIR_JSON:/.test(broken.stdout);
    repair();
    const healed = runNode(target, 'harness-scripts/heal-harness.mjs');
    const converged = healed.code === 0 && /healthy/.test(healed.stdout);
    if (cleanup) cleanup();
    check(
      `closed-loop-${name}`,
      emitted && converged,
      `emitted(exit2+directive)=${emitted}[${broken.code}] converged(exit0)=${converged}[${healed.code}]`,
    );
  };

  const clPrompt = join(target, '.github/prompts/example.prompt.md');
  let origPrompt;
  closedLoop('frontmatter', 'frontmatter', {
    setup: () => { origPrompt = readFileSync(clPrompt, 'utf8'); },
    mutate: () => writeFileSync(clPrompt, '# Example\n\nNo frontmatter block.\n'),
    repair: () => writeFileSync(clPrompt, '---\ndescription: "Example reusable task prompt for demo-service."\n---\n\n# Example\n'),
    cleanup: () => writeFileSync(clPrompt, origPrompt),
  });

  const clSkill = join(target, '.github/skills/maintain-harness/SKILL.md');
  let origSkill;
  closedLoop('skill-name', 'skill-name', {
    setup: () => { origSkill = readFileSync(clSkill, 'utf8'); },
    mutate: () => writeFileSync(clSkill, '---\nname: wrong-name\ndescription: "Mismatched skill name."\n---\n\n# X\n'),
    repair: () => writeFileSync(clSkill, '---\nname: maintain-harness\ndescription: "Audit and maintain the demo-service harness."\n---\n\n# Maintain Harness\n'),
    cleanup: () => writeFileSync(clSkill, origSkill),
  });

  const clInstr = join(target, '.github/instructions/general.instructions.md');
  let origInstr;
  closedLoop('applyTo', 'applyTo', {
    setup: () => { origInstr = readFileSync(clInstr, 'utf8'); },
    mutate: () => writeFileSync(clInstr, '---\ndescription: "Over-broad."\napplyTo: "**"\n---\n\n# General\n'),
    repair: () => writeFileSync(clInstr, '---\ndescription: "Scoped general rules."\napplyTo: "src/**"\n---\n\n# General\n'),
    cleanup: () => writeFileSync(clInstr, origInstr),
  });

  const clDoc = join(target, 'project-notes', 'closed-loop.md');
  closedLoop('link', 'link', {
    setup: () => mkdirSync(dirname(clDoc), { recursive: true }),
    mutate: () => writeFileSync(clDoc, '# Doc\n\n[gone](does-not-exist.md)\n'),
    repair: () => writeFileSync(clDoc, '# Doc\n\n[agents](../AGENTS.md)\n'),
    cleanup: () => rmSync(clDoc, { force: true }),
  });

  const clAgents = join(target, 'AGENTS.md');
  let origAgents;
  closedLoop('tracking-citation', 'tracking-citation', {
    setup: () => { origAgents = readFileSync(clAgents, 'utf8'); },
    mutate: () => writeFileSync(clAgents, origAgents + '\n[bad](.copilot-tracking/x.md)\n'),
    repair: () => writeFileSync(clAgents, origAgents + '\nSee .copilot-tracking/x.md (plain-text path).\n'),
    cleanup: () => writeFileSync(clAgents, origAgents),
  });

  const clCopilot = join(target, '.github/copilot-instructions.md');
  closedLoop('always-on', 'always-on', {
    mutate: () => writeFileSync(clCopilot, '# Co-shipped always-on file (should be flagged)\n'),
    repair: () => rmSync(clCopilot, { force: true }),
    cleanup: () => rmSync(clCopilot, { force: true }),
  });

  const clInc = join(target, 'harness', 'incidents.jsonl');
  // Schema-valid record (Check 8's field-level validation) — the shape documented
  // in .github/skills/review-session/SKILL.md, plus a resolution line.
  const validIncident = JSON.stringify({
    id: 'cl-2026-07-30-01',
    title: 'Closed-loop fixture incident',
    status: 'open',
    severity: 'low',
    symptom: 'Fixture symptom',
    detection_signal: { type: 'tool-failure', evidence: 'x2', threshold_hit: '>2 corrections on one issue' },
    trigger: 'Fixture trigger',
    root_cause: 'Fixture root cause',
    remediation: { layer: 'probabilistic', kind: 'one-off-correction', action: 'Fix by hand', artifact: null },
    prevention_rule: 'ALWAYS keep the fixture schema-valid',
    followups: [],
  });
  const validResolution = JSON.stringify({ type: 'resolution', resolves: 'cl-2026-07-30-01', files_modified: [], date: '2026-07-30' });
  closedLoop('incident-log', 'incident-log', {
    setup: () => mkdirSync(dirname(clInc), { recursive: true }),
    mutate: () => writeFileSync(clInc, '{"ok":1}\nnot-json\n'),
    repair: () => writeFileSync(clInc, `${validIncident}\n${validResolution}\n`),
    cleanup: () => rmSync(clInc, { force: true }),
  });

  const clFeats = join(target, 'features.yml');
  let origFeats;
  closedLoop('tracked-artifact', 'tracked-artifact', {
    setup: () => { origFeats = readFileSync(clFeats, 'utf8'); },
    mutate: () => writeFileSync(clFeats, origFeats.replace('artifacts:\n', 'artifacts:\n      - docs/closed-loop-artifact.md\n')),
    repair: () => { mkdirSync(join(target, 'docs'), { recursive: true }); writeFileSync(join(target, 'docs', 'closed-loop-artifact.md'), '# artifact\n'); },
    cleanup: () => { writeFileSync(clFeats, origFeats); rmSync(join(target, 'docs'), { recursive: true, force: true }); },
  });

  closedLoop('features-schema', 'features-schema', {
    setup: () => { origFeats = readFileSync(clFeats, 'utf8'); },
    mutate: () => writeFileSync(clFeats, origFeats.replace(/status: (planned|done|in_progress)/, 'status: imaginary')),
    repair: () => writeFileSync(clFeats, origFeats),
    cleanup: () => writeFileSync(clFeats, origFeats),
  });

  closedLoop('doctor-missing-tool', 'doctor-missing-tool', {
    mutate: () => writeFileSync(doctorYamlPath, bogusManifest),
    repair: () => writeFileSync(doctorYamlPath, originalManifest),
    // No cleanup needed — repair() fully restores harness/doctor.yml to valid content.
  });

  // Removing signature.mjs is the partial emit that shipped: heal must name the
  // check and re-copying the module must be sufficient to converge.
  const clSignature = join(target, 'harness-scripts', 'signature.mjs');
  let origSignature;
  closedLoop('script-imports', 'script-imports', {
    setup: () => { origSignature = readFileSync(clSignature, 'utf8'); },
    mutate: () => rmSync(clSignature),
    repair: () => writeFileSync(clSignature, origSignature),
  });

  // Convergence: a green tree heals silently twice (no oscillation / phantom repairs).
  const conv1 = runNode(target, 'harness-scripts/heal-harness.mjs');
  const conv2 = runNode(target, 'harness-scripts/heal-harness.mjs');
  check('heal-convergence',
    conv1.code === 0 && conv2.code === 0 && /healthy/.test(conv2.stdout),
    `run1=${conv1.code} run2=${conv2.code}`);

  // Fail-open: with no validator to wrap, heal degrades to a labeled note and exits 0.
  const clValidator = join(target, 'harness-scripts', 'validate-harness.mjs');
  const validatorBak = clValidator + '.bak';
  renameSync(clValidator, validatorBak);
  const failOpen = runNode(target, 'harness-scripts/heal-harness.mjs');
  renameSync(validatorBak, clValidator);
  check('heal-fail-open',
    failOpen.code === 0 && /not found|nothing to check/.test(failOpen.stdout),
    `exit ${failOpen.code} — ${failOpen.stdout.trim()}`);

  // Stage 4d — validator Check 8 fails loudly on a malformed incident-log line.
  mkdirSync(join(target, 'harness'), { recursive: true });
  const incidents = join(target, 'harness', 'incidents.jsonl');
  writeFileSync(incidents, '{"kind":"ok"}\nnot-json\n');
  const vi = runNode(target, 'harness-scripts/validate-harness.mjs');
  rmSync(incidents);
  check('validator-incident-negative', vi.code === 1 && /FAIL: incident-log/.test(vi.stderr), `exit ${vi.code}`);

  // Stage 6 — non-destructive create-missing-only re-run preserves edits + tops up gaps.
  const emitIfMissing = (rel, text) => {
    const f = join(target, rel);
    if (!existsSync(f)) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); }
  };
  const editMarker = '\n<!-- user-edit-preserved -->\n';
  writeFileSync(join(target, 'AGENTS.md'), readFileSync(join(target, 'AGENTS.md'), 'utf8') + editMarker);
  rmSync(join(target, 'knowledge-base', 'conventions.md'));
  // Re-run with create-missing-only semantics: existing files are skipped, gaps topped up.
  emitIfMissing('AGENTS.md', 'OVERWRITE-MUST-NOT-HAPPEN');
  emitIfMissing('knowledge-base/conventions.md', '# Conventions\n\nRestored.\n');
  const editSurvived = readFileSync(join(target, 'AGENTS.md'), 'utf8').includes('user-edit-preserved');
  const gapFilled = existsSync(join(target, 'knowledge-base', 'conventions.md'));
  check('nondestructive-rerun', editSurvived && gapFilled, `editSurvived=${editSurvived} gapFilled=${gapFilled}`);

  // --- backpressure-stats aggregation logic (grouping + PROMOTE threshold). ------
  const incidentLog = join(target, 'harness', 'incidents.jsonl');
  const inc = (id, type, cause, extra = {}) =>
    JSON.stringify({ id, status: 'open', severity: 'high', detection_signal: { type }, root_cause: cause, ...extra });
  mkdirSync(dirname(incidentLog), { recursive: true });
  writeFileSync(incidentLog, [
    inc('bp-1', 'tool-failure', 'relative path confusion after cd', { prevention_rule: 'Always cd with an absolute path before running path-relative tools' }),
    inc('bp-2', 'tool-failure', 'relative path confusion after cd'),
    inc('bp-3', 'tool-failure', 'relative path confusion after cd'),
    inc('bp-4', 'edit-thrash', 'a different unrelated cause'),
  ].join('\n') + '\n');

  // Stage 4e — three same-signature open incidents cross the promote threshold.
  const bpPromote = runNode(target, 'harness-scripts/backpressure-stats.mjs');
  check('backpressure-stats-promote',
    bpPromote.code === 0 && /PROMOTE/.test(bpPromote.stdout) && /1 signature\(s\) at promote threshold/.test(bpPromote.stdout),
    `exit ${bpPromote.code} — ${bpPromote.stdout.trim()}`);

  // Stage 4e-2 — a promoted signature emits a seeded validator-check stub (print only, exit 0).
  check('backpressure-stats-stub',
    bpPromote.code === 0 &&
      /Seeded stub for harness-scripts\/validate-harness\.mjs/.test(bpPromote.stdout) &&
      /\/\/ ---- Check:/.test(bpPromote.stdout) &&
      /\(function check\w+\(\)/.test(bpPromote.stdout) &&
      /no template twin/.test(bpPromote.stdout),
    `exit ${bpPromote.code} — ${bpPromote.stdout.trim()}`);

  // Stage 5b — session-start Health line reflects open incidents + at-threshold nudge.
  const sHealth = runNode(target, 'harness-scripts/session-start.mjs');
  check('session-start-health',
    sHealth.code === 0 && /Health:\s+4 open incident\(s\); 1 at promote threshold — run review-session/.test(sHealth.stdout),
    sHealth.stdout.split('\n').find((l) => l.includes('Health:')) ?? 'no Health line');

  // Stage 5c — open incidents with a prevention_rule surface a top-N rules banner.
  check('session-start-rules',
    sHealth.code === 0 &&
      /Prevention rules to keep in mind \(1\):/.test(sHealth.stdout) &&
      /• Always cd with an absolute path before running path-relative tools/.test(sHealth.stdout),
    sHealth.stdout.split('\n').filter((l) => /rule|•/.test(l)).join(' | ') || 'no rules banner');

  // Stage 5e — session-end nudges review-session when a signature is at the promote threshold.
  const seTrigger = runNode(target, 'harness-scripts/session-end.mjs');
  check('session-end-trigger',
    seTrigger.code === 0 &&
      /1 signature\(s\) at promote threshold/.test(seTrigger.stdout) &&
      /run the review-session skill/.test(seTrigger.stdout),
    `exit ${seTrigger.code} — ${seTrigger.stdout.trim()}`);

  // Stage 4f — resolution lines close incidents, dropping the signature below threshold.
  const resolve2 = (id) => JSON.stringify({ type: 'resolution', resolves: id, files_modified: [], date: '2026-07-14' });
  writeFileSync(incidentLog, readFileSync(incidentLog, 'utf8') + resolve2('bp-1') + '\n' + resolve2('bp-2') + '\n');
  const bpResolved = runNode(target, 'harness-scripts/backpressure-stats.mjs');
  check('backpressure-stats-resolution',
    bpResolved.code === 0 && /0 signature\(s\) at promote threshold/.test(bpResolved.stdout) && !/PROMOTE/.test(bpResolved.stdout),
    `exit ${bpResolved.code} — ${bpResolved.stdout.trim()}`);
  rmSync(incidentLog);

  // --- `--fix` applies the safe subset: quote a colon-bearing description. -------
  const fixDir = join(target, '.github', 'instructions');
  mkdirSync(fixDir, { recursive: true });
  const fixTarget = join(fixDir, 'fixme.instructions.md');
  writeFileSync(fixTarget,
    '---\ndescription: Fix me: this value has a colon and is unquoted\napplyTo: "src/**"\n---\n\n# Fixme\n');
  const fixRun = runNode(target, 'harness-scripts/validate-harness.mjs', ['--fix']);
  const fixedText = readFileSync(fixTarget, 'utf8');
  rmSync(fixTarget);
  check('validator-fix-quote',
    /FIXED: description-quote/.test(fixRun.stdout) &&
      /description: "Fix me: this value has a colon and is unquoted"/.test(fixedText),
    `stdout=${fixRun.stdout.trim()} | line=${fixedText.split('\n').find((l) => l.startsWith('description:'))}`);

  // --- Validator negative coverage: each check must actually fire on a fault. -----
  // Runs the validator against a temporary single-fault mutation, then restores.
  const expectFail = (name, faultLabel, file, mutate) => {
    const orig = existsSync(file) ? readFileSync(file, 'utf8') : null;
    mutate();
    const r = runNode(target, 'harness-scripts/validate-harness.mjs');
    if (orig === null) rmSync(file, { force: true });
    else writeFileSync(file, orig);
    check(name, r.code === 1 && new RegExp(`FAIL: ${faultLabel}`).test(r.stderr), `exit ${r.code}`);
  };

  const prompt = join(target, '.github/prompts/example.prompt.md');
  expectFail('validator-frontmatter-negative', 'frontmatter', prompt,
    () => writeFileSync(prompt, '# Example\n\nNo frontmatter block here.\n'));
  expectFail('validator-description-negative', 'frontmatter', prompt,
    () => writeFileSync(prompt, '---\nname: example\ndescription: ""\n---\n\n# Example\n'));

  const skill = join(target, '.github/skills/maintain-harness/SKILL.md');
  expectFail('validator-skill-name-negative', 'skill-name', skill,
    () => writeFileSync(skill, '---\nname: wrong-name\ndescription: "Mismatched skill name."\n---\n\n# X\n'));

  const instr = join(target, '.github/instructions/general.instructions.md');
  expectFail('validator-applyto-negative', 'applyTo', instr,
    () => writeFileSync(instr, '---\ndescription: "Over-broad."\napplyTo: "**"\n---\n\n# General\n'));
  expectFail('validator-applyto-globstar-negative', 'applyTo', instr,
    () => writeFileSync(instr, '---\ndescription: "Over-broad."\napplyTo: "**/*"\n---\n\n# General\n'));

  const feats = join(target, 'features.yml');
  expectFail('validator-features-schema-negative', 'features-schema', feats,
    () => writeFileSync(feats, 'status_legend:\n  done: x\nfeatures:\n  - id: F-1\n    title: T\n    status: done\n'));
  expectFail('validator-feature-id-negative', 'features-schema', feats,
    () => writeFileSync(feats, readFileSync(feats, 'utf8') + '\n  - id: F-001\n    title: Duplicate\n    status: planned\n'));
  expectFail('validator-feature-status-negative', 'features-schema', feats,
    () => writeFileSync(feats, readFileSync(feats, 'utf8').replace('status: planned', 'status: imaginary')));
  expectFail('validator-tracked-artifact-negative', 'tracked-artifact', feats,
    () => writeFileSync(feats, readFileSync(feats, 'utf8').replace(
      'artifacts:\n',
      'artifacts:\n      - missing-artifact.md\n',
    )));

  const copilotInstr = join(target, '.github/copilot-instructions.md');
  expectFail('validator-always-on-negative', 'always-on', copilotInstr,
    () => writeFileSync(copilotInstr, '# Co-shipped always-on file (should be flagged)\n'));

  const agents = join(target, 'AGENTS.md');
  expectFail('validator-tracking-citation-negative', 'tracking-citation', agents,
    () => writeFileSync(agents, readFileSync(agents, 'utf8') + '\n[bad](.copilot-tracking/x.md)\n'));

  const projectNote = join(target, 'project-notes', 'coverage.md');
  expectFail('validator-expanded-link-negative', 'link', projectNote,
    () => {
      mkdirSync(dirname(projectNote), { recursive: true });
      writeFileSync(projectNote, '# Coverage\n\n[broken](missing.md)\n');
    });

  // --- Check 11 — AGENTS.md line-budget negative case (fires past 200 lines). ----
  expectFail('validator-agents-budget-negative', 'agents-budget', agents,
    () => writeFileSync(agents, Array(201).fill('x').join('\n')));

  // --- Check 12 — secret-scan negative cases (one per pattern family). Values are
  // built via concatenation/template interpolation so the *literal source text of
  // this test file* never contains an unbroken match — only the runtime-written
  // fixture (scanned separately, inside the temp target) does. ------------------
  const secretFile = join(target, 'project-notes', 'secret-fixture.md');
  expectFail('validator-secret-scan-aws-negative', 'secret-scan', secretFile,
    () => {
      mkdirSync(dirname(secretFile), { recursive: true });
      writeFileSync(secretFile, `# Fixture\n\n${'AKIA'}${'ABCDEFGHIJKLMNOP'}\n`);
    });
  expectFail('validator-secret-scan-github-negative', 'secret-scan', secretFile,
    () => {
      mkdirSync(dirname(secretFile), { recursive: true });
      writeFileSync(secretFile, `# Fixture\n\nghp_${'a'.repeat(36)}\n`);
    });
  expectFail('validator-secret-scan-pem-negative', 'secret-scan', secretFile,
    () => {
      mkdirSync(dirname(secretFile), { recursive: true });
      writeFileSync(secretFile, `# Fixture\n\n${'-----BEGIN RSA PRIVATE'} ${'KEY-----'}\n`);
    });

  // --- Check 13 — hooks-config negative cases (malformed JSON, missing
  // "version", missing "hooks", dangling harness-scripts/*.mjs reference). The fixture
  // never emits .github/hooks/hooks.json itself (it's a separate opt-in), so
  // each case creates then removes it. ------------------------------------------
  const hooksConfig = join(target, '.github', 'hooks', 'hooks.json');
  expectFail('validator-hooks-config-badjson-negative', 'hooks-config', hooksConfig,
    () => {
      mkdirSync(dirname(hooksConfig), { recursive: true });
      writeFileSync(hooksConfig, '{ not valid json');
    });
  expectFail('validator-hooks-config-missing-version-negative', 'hooks-config', hooksConfig,
    () => {
      mkdirSync(dirname(hooksConfig), { recursive: true });
      writeFileSync(hooksConfig, JSON.stringify({ hooks: {} }));
    });
  expectFail('validator-hooks-config-missing-hooks-negative', 'hooks-config', hooksConfig,
    () => {
      mkdirSync(dirname(hooksConfig), { recursive: true });
      writeFileSync(hooksConfig, JSON.stringify({ version: 1 }));
    });
  expectFail('validator-hooks-config-dangling-script-negative', 'hooks-config', hooksConfig,
    () => {
      mkdirSync(dirname(hooksConfig), { recursive: true });
      writeFileSync(hooksConfig, JSON.stringify({
        version: 1,
        hooks: { sessionStart: [{ type: 'command', command: 'node harness-scripts/does-not-exist.mjs' }] },
      }));
    });
  expectFail('validator-hooks-config-unknown-event-negative', 'hooks-config', hooksConfig,
    () => {
      mkdirSync(dirname(hooksConfig), { recursive: true });
      writeFileSync(hooksConfig, JSON.stringify({
        version: 1,
        hooks: { onAgentExit: [{ type: 'command', command: 'node harness-scripts/session-end.mjs' }] },
      }));
    });
  // Case-fold negative: `agentstop` is the right family but a casing no runtime
  // fires (D-33 removed the old `.toLowerCase()` leniency that let it pass).
  expectFail('validator-hooks-config-casefold-event-negative', 'hooks-config', hooksConfig,
    () => {
      mkdirSync(dirname(hooksConfig), { recursive: true });
      writeFileSync(hooksConfig, JSON.stringify({
        version: 1,
        hooks: { agentstop: [{ type: 'command', command: 'node harness-scripts/session-end.mjs' }] },
      }));
    });
  // Positive: the PascalCase family is still accepted exactly (both families kept).
  mkdirSync(dirname(hooksConfig), { recursive: true });
  writeFileSync(hooksConfig, JSON.stringify({
    version: 1,
    hooks: {
      SessionStart: [{ type: 'command', command: 'node harness-scripts/session-start.mjs' }],
      AgentStop: [{ type: 'command', command: 'node harness-scripts/session-end.mjs' }],
    },
  }));
  const vHooksPascal = runNode(target, 'harness-scripts/validate-harness.mjs');
  rmSync(hooksConfig, { force: true });
  check('validator-hooks-config-pascalcase-clean', vHooksPascal.code === 0,
    `exit ${vHooksPascal.code}${vHooksPascal.stderr ? ' — ' + vHooksPascal.stderr.trim() : ''}`);

  // --- Check 8 — incident-record schema negative cases (missing id, undeclared
  // detection_signal.type, missing remediation.layer/kind, resolution line with
  // no `resolves`). The fixture emits no incident log, so each case creates then
  // removes it. -----------------------------------------------------------------
  const incidentFixture = join(target, 'harness', 'incidents.jsonl');
  const incidentLine = (over = {}) => JSON.stringify({
    id: 'neg-2026-07-30-01',
    status: 'open',
    severity: 'low',
    detection_signal: { type: 'tool-failure' },
    remediation: { layer: 'probabilistic', kind: 'one-off-correction' },
    ...over,
  });
  const writeIncident = (body) => () => {
    mkdirSync(dirname(incidentFixture), { recursive: true });
    writeFileSync(incidentFixture, body + '\n');
  };
  expectFail('validator-incident-schema-missing-id-negative', 'incident-log', incidentFixture,
    writeIncident(incidentLine({ id: undefined })));
  expectFail('validator-incident-schema-bad-detection-negative', 'incident-log', incidentFixture,
    writeIncident(incidentLine({ detection_signal: { type: 'made-up-signal' } })));
  expectFail('validator-incident-schema-missing-layer-negative', 'incident-log', incidentFixture,
    writeIncident(incidentLine({ remediation: { kind: 'one-off-correction' } })));
  expectFail('validator-incident-schema-missing-kind-negative', 'incident-log', incidentFixture,
    writeIncident(incidentLine({ remediation: { layer: 'deterministic' } })));
  expectFail('validator-incident-schema-bad-status-negative', 'incident-log', incidentFixture,
    writeIncident(incidentLine({ status: 'kinda-open' })));
  expectFail('validator-incident-schema-resolution-negative', 'incident-log', incidentFixture,
    writeIncident(JSON.stringify({ type: 'resolution', date: '2026-07-30' })));
  // Positive: `guard-trip` is a declared detection signal and a full record passes.
  writeIncident(incidentLine({ detection_signal: { type: 'guard-trip' } }))();
  const vIncidentOk = runNode(target, 'harness-scripts/validate-harness.mjs');
  rmSync(incidentFixture, { force: true });
  check('validator-incident-schema-clean', vIncidentOk.code === 0,
    `exit ${vIncidentOk.code}${vIncidentOk.stderr ? ' — ' + vIncidentOk.stderr.trim() : ''}`);

  // --- Check 15 — guards-yaml negative cases (missing `guards:` key, entry
  // missing `id`, unknown `mode`). The fixture emits a valid harness/guards.yml by
  // default, so each case mutates then restores it (same pattern as doctor-yaml).
  const guardsYaml = join(target, 'harness', 'guards.yml');
  const origGuards = readFileSync(guardsYaml, 'utf8');
  const writeGuards = (body) => () => {
    mkdirSync(dirname(guardsYaml), { recursive: true });
    writeFileSync(guardsYaml, body);
  };
  expectFail('validator-guards-yaml-missing-guards-negative', 'guards-yaml', guardsYaml,
    writeGuards('version: 1\ndefaults:\n  mode: audit\n'));
  expectFail('validator-guards-yaml-missing-id-negative', 'guards-yaml', guardsYaml,
    writeGuards('guards:\n  - mode: audit\n    window: 3\n'));
  expectFail('validator-guards-yaml-unknown-mode-negative', 'guards-yaml', guardsYaml,
    writeGuards('guards:\n  - id: heal-loop-cap\n    mode: paranoid\n'));
  expectFail('validator-guards-yaml-unknown-defaults-mode-negative', 'guards-yaml', guardsYaml,
    writeGuards('defaults:\n  mode: paranoid\nguards:\n  - id: heal-loop-cap\n    mode: audit\n'));
  expectFail('validator-guards-yaml-small-window-negative', 'guards-yaml', guardsYaml,
    writeGuards('guards:\n  - id: no-progress\n    mode: audit\n    window: 1\n'));
  // Positive: the emitted manifest itself validates clean (mirrors validator-doctor-yaml-clean).
  writeFileSync(guardsYaml, origGuards);
  const vGuards = runNode(target, 'harness-scripts/validate-harness.mjs');
  check('validator-guards-yaml-clean', vGuards.code === 0,
    `exit ${vGuards.code}${vGuards.stderr ? ' — ' + vGuards.stderr.trim() : ''}`);

  // --- Check 16 — state-artifact-registry audit. Structural cases (duplicate
  // `path:`, entry with no `type:`) plus the reverse harness-scripts coverage
  // (shipped→listed). Each case writes a throwaway registry under a fresh slug so
  // the scaffold's placeholder-only demo-service registry stays untouched. -------
  const auditState = join(target, 'harness', 'state', '_audit-fixture', 'state.md');
  const scriptRow = (p) => `  - path: "${p}"\n    type: "script"\n`;
  const writeState = (body) => () => {
    mkdirSync(dirname(auditState), { recursive: true });
    writeFileSync(auditState, body);
  };
  expectFail('validator-state-registry-duplicate-negative', 'state-artifact-registry', auditState,
    writeState(`# S\n\n\`\`\`yaml\nartifacts:\n${scriptRow('AGENTS.md')}${scriptRow('AGENTS.md')}\`\`\`\n`));
  expectFail('validator-state-registry-missing-type-negative', 'state-artifact-registry', auditState,
    writeState('# S\n\n```yaml\nartifacts:\n  - path: "AGENTS.md"\n```\n'));
  expectFail('validator-state-registry-unregistered-script-negative', 'state-artifact-registry', auditState,
    writeState(`# S\n\n\`\`\`yaml\nartifacts:\n${scriptRow('harness-scripts/validate-harness.mjs')}\`\`\`\n`));
  // Positive: a registry listing every shipped harness-scripts/*.mjs validates clean.
  const shippedScripts = readdirSync(join(target, 'harness-scripts'))
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => scriptRow(`harness-scripts/${f}`))
    .join('');
  writeState(`# S\n\n\`\`\`yaml\nartifacts:\n${shippedScripts}\`\`\`\n`)();
  const vState = runNode(target, 'harness-scripts/validate-harness.mjs');
  rmSync(join(target, 'harness', 'state', '_audit-fixture'), { recursive: true, force: true });
  check('validator-state-registry-clean', vState.code === 0,
    `exit ${vState.code}${vState.stderr ? ' — ' + vState.stderr.trim() : ''}`);

  // --- Check 14 — doctor-yaml negative cases (missing `tools:` key, entry
  // missing `name`, invalid/empty `check` array, non-boolean `required`). The
  // fixture already emits a valid harness/doctor.yml by default, so each case
  // mutates then restores it (same pattern as the hooks-config cases above).
  const doctorYaml = join(target, 'harness', 'doctor.yml');
  expectFail('validator-doctor-yaml-missing-tools-negative', 'doctor-yaml', doctorYaml,
    () => writeFileSync(doctorYaml, 'no-tools-key: true\n'));
  expectFail('validator-doctor-yaml-missing-name-negative', 'doctor-yaml', doctorYaml,
    () => writeFileSync(doctorYaml, 'tools:\n  - check: ["git", "--version"]\n    required: true\n'));
  expectFail('validator-doctor-yaml-invalid-check-negative', 'doctor-yaml', doctorYaml,
    () => writeFileSync(doctorYaml, 'tools:\n  - name: git\n    check: []\n    required: true\n'));
  expectFail('validator-doctor-yaml-non-boolean-required-negative', 'doctor-yaml', doctorYaml,
    () => writeFileSync(doctorYaml, 'tools:\n  - name: git\n    check: ["git", "--version"]\n    required: maybe\n'));

  // --- Extended frontmatter parser — a declared-but-empty `tools:` list fails. ----
  const agentFixture = join(target, '.github', 'agents', 'fixture.agent.md');
  expectFail('validator-frontmatter-list-negative', 'frontmatter', agentFixture,
    () => {
      mkdirSync(dirname(agentFixture), { recursive: true });
      writeFileSync(agentFixture, '---\ndescription: "Fixture agent with an empty tools list."\ntools:\n---\n\nBody.\n');
    });

  // --- Check 18 — script-imports. The fixture is the original break verbatim:
  // signature.mjs is an unconditional import of three sibling scripts, so a target
  // missing it crashes them at load. This is the one check that fires target-side.
  const sigScript = join(target, 'harness-scripts', 'signature.mjs');
  expectFail('validator-script-imports-negative', 'script-imports', sigScript,
    () => rmSync(sigScript));

  // --- Check 19 — emit-contract. Emitted targets omit the generator catalog, so
  // install a minimal source-side catalog here to exercise profile enforcement.
  const scaffoldSkill = join(target, '.github', 'skills', 'scaffold-harness', 'SKILL.md');
  const repoLocalWorkflows = new Set([
    '.github/workflows/self-test.yml',
    '.github/workflows/sync-starter-kit.yml',
  ]);
  const topLevel = (dir) => {
    const abs = join(target, dir);
    if (!existsSync(abs)) return [];
    return readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => `${dir}/${e.name}`);
  };
  const emitArtifacts = [
    ...readdirSync(join(target, 'harness-scripts')).filter((f) => f.endsWith('.mjs')).map((f) => `harness-scripts/${f}`),
    ...topLevel('harness'),
    ...topLevel('.github/workflows'),
    ...topLevel('.githooks'),
    ...topLevel('.github/hooks'),
  ].filter((path) => !repoLocalWorkflows.has(path));
  const fixtureIds = emitArtifacts.map((_, index) => `artifact-${index}`);
  const fixtureArtifacts = Object.fromEntries(emitArtifacts.map((path, index) => [
    fixtureIds[index],
    { source: path, target: path, operation: 'copy' },
  ]));
  const profileCatalog = join(target, '.github', 'skills', 'scaffold-harness', 'references', 'adoption-profiles.json');
  const cleanCatalog = {
    schemaVersion: 1,
    defaultProfile: 'standard',
    atomicGroups: {},
    artifacts: fixtureArtifacts,
    profiles: { 'doc-only': [], standard: fixtureIds, full: fixtureIds },
  };
  mkdirSync(dirname(profileCatalog), { recursive: true });
  writeFileSync(profileCatalog, `${JSON.stringify(cleanCatalog, null, 2)}\n`);
  writeFileSync(scaffoldSkill,
    '---\nname: scaffold-harness\ndescription: "Emit the harness into a target repo."\n---\n\n'
    + '# Scaffold\n\nRead `.github/skills/scaffold-harness/references/adoption-profiles.json` and resolve doc-only, standard, or full.\n');

  expectFail('validator-emit-contract-surface-negative', 'emit-contract', scaffoldSkill,
    () => writeFileSync(scaffoldSkill,
      '---\nname: scaffold-harness\ndescription: "Emit the harness into a target repo."\n---\n\n# Scaffold\n\nResolve doc-only, standard, or full.\n'));

  const guardsEntry = Object.entries(fixtureArtifacts).find(([, artifact]) => artifact.target === 'harness/guards.yml');
  expectFail('validator-emit-contract-tree-negative', 'emit-contract', profileCatalog,
    () => {
      const changed = structuredClone(cleanCatalog);
      delete changed.artifacts[guardsEntry[0]];
      for (const profile of ['standard', 'full']) changed.profiles[profile] = changed.profiles[profile].filter((id) => id !== guardsEntry[0]);
      writeFileSync(profileCatalog, `${JSON.stringify(changed, null, 2)}\n`);
    });

  expectFail('validator-emit-contract-source-negative', 'emit-contract', profileCatalog,
    () => {
      const changed = structuredClone(cleanCatalog);
      changed.artifacts[fixtureIds[0]].source = 'missing/source.mjs';
      writeFileSync(profileCatalog, `${JSON.stringify(changed, null, 2)}\n`);
    });

  expectFail('validator-emit-contract-cumulative-negative', 'emit-contract', profileCatalog,
    () => {
      const changed = structuredClone(cleanCatalog);
      changed.profiles['doc-only'] = [fixtureIds[0]];
      changed.profiles.standard = [];
      writeFileSync(profileCatalog, `${JSON.stringify(changed, null, 2)}\n`);
    });

  expectFail('validator-emit-contract-atomic-negative', 'emit-contract', profileCatalog,
    () => {
      const changed = structuredClone(cleanCatalog);
      changed.atomicGroups.executable = [fixtureIds[0], fixtureIds[1]];
      changed.profiles.standard = changed.profiles.standard.filter((id) => id !== fixtureIds[1]);
      writeFileSync(profileCatalog, `${JSON.stringify(changed, null, 2)}\n`);
    });

  const unknownWorkflow = join(target, '.github', 'workflows', 'unknown-repo-local.yml');
  expectFail('validator-emit-contract-unlisted-workflow-negative', 'emit-contract', unknownWorkflow,
    () => writeFileSync(unknownWorkflow, 'name: unknown-repo-local\n'));

  const vEmit = runNode(target, 'harness-scripts/validate-harness.mjs');
  rmSync(join(target, '.github', 'skills', 'scaffold-harness'), { recursive: true, force: true });
  check('validator-emit-contract-clean', vEmit.code === 0,
    `exit ${vEmit.code}${vEmit.stderr ? ' — ' + vEmit.stderr.trim() : ''}`);
} finally {
  if (target) rmSync(target, { recursive: true, force: true });
}

// --- Phase 3 profile matrix: doc-only < standard (default) < full. ----------
let target2;
try {
  target2 = scaffoldFixture('doc-only');
  check('profile-doc-only-layer0-present', existsSync(join(target2, 'AGENTS.md'))
    && existsSync(join(target2, 'harness', 'incidents.jsonl')));
  check('profile-doc-only-executable-absent', !existsSync(join(target2, 'harness-scripts'))
    && !existsSync(join(target2, 'harness', 'doctor.yml'))
    && !existsSync(join(target2, 'harness', 'guards.yml')));
} finally {
  if (target2) rmSync(target2, { recursive: true, force: true });
}

let target3;
try {
  target3 = scaffoldFixture();
  const executableTargets = PROFILE_CATALOG.atomicGroups['executable-layer']
    .map((id) => PROFILE_CATALOG.artifacts[id].target);
  check('profile-standard-is-default', PROFILE_CATALOG.defaultProfile === 'standard'
    && executableTargets.every((path) => existsSync(join(target3, path))));
  check('profile-standard-automation-absent', !existsSync(join(target3, '.github', 'workflows', 'validate.yml'))
    && !existsSync(join(target3, '.githooks', 'pre-commit'))
    && !existsSync(join(target3, '.github', 'hooks', 'hooks.json')));
} finally {
  if (target3) rmSync(target3, { recursive: true, force: true });
}

let targetFull;
try {
  targetFull = scaffoldFixture('full');
  check('profile-full-automation-present', existsSync(join(targetFull, '.github', 'workflows', 'validate.yml'))
    && existsSync(join(targetFull, '.githooks', 'pre-commit'))
    && existsSync(join(targetFull, '.github', 'hooks', 'hooks.json')));
  check('profile-full-hook-inactive', !existsSync(join(targetFull, '.git')));
} finally {
  if (targetFull) rmSync(targetFull, { recursive: true, force: true });
}

// --- Location-agnostic ROOT resolution (findRepoRoot anchor-search). -----------
// Proves the executable layer still finds the repo root when harness-scripts/ is
// relocated to an arbitrary depth (e.g. tools/harness-scripts/), instead of assuming a
// fixed one-level-up offset from the script's own on-disk location.
let target4;
try {
  target4 = scaffoldFixture();

  // Relocate the executable layer two levels deeper: target4/tools/harness-scripts/.
  const nestedDir = join(target4, 'tools', 'harness-scripts');
  mkdirSync(nestedDir, { recursive: true });
  for (const name of ['signature.mjs', 'validate-harness.mjs', 'session-start.mjs', 'harness.mjs']) {
    copyFileSync(join(target4, 'harness-scripts', name), join(nestedDir, name));
  }

  // A distinctive marker in PROGRESS.md's Blockers section (a section
  // session-start.mjs actually parses and prints) proves the banner read the
  // REAL root (target4, anchored on AGENTS.md), not target4/tools (the legacy
  // one-level-up assumption's wrong guess for this depth). Appending at the
  // file's absolute end would land past the template's trailing "Key files"
  // heading — a section session-start.mjs never prints — so the marker must
  // go inside a parsed section instead.
  const progressPath = join(target4, 'PROGRESS.md');
  const markedProgress = readFileSync(progressPath, 'utf8').replace(
    /(## Blockers \/ open questions\n)/,
    '$1- root-anchor-marker\n',
  );
  writeFileSync(progressPath, markedProgress);

  const nestedStart = runNode(target4, 'tools/harness-scripts/session-start.mjs');
  check('root-anchor-nested-session-start',
    nestedStart.code === 0 && /root-anchor-marker/.test(nestedStart.stdout),
    `exit ${nestedStart.code} — ${nestedStart.stdout.trim()}`);

  // The nested validator also resolves ROOT correctly and validates the (still
  // complete) doc harness clean.
  const nestedValidate = runNode(target4, 'tools/harness-scripts/validate-harness.mjs');
  check('root-anchor-nested-validator-clean',
    nestedValidate.code === 0,
    `exit ${nestedValidate.code}${nestedValidate.stderr ? ' — ' + nestedValidate.stderr.trim() : ''}`);

  // Check 13 regression: a hooks.json referencing the FULL nested relative path
  // (not just a trailing "harness-scripts/x.mjs" segment) must resolve without a false
  // FAIL, and a dangling nested reference must still be caught. Remove the
  // original harness-scripts/validate-harness.mjs first so a truncated match (the old
  // regex's bug) would report a dangling reference instead of accidentally
  // resolving against a copy left at the legacy location.
  rmSync(join(target4, 'harness-scripts', 'validate-harness.mjs'));
  const hooksConfig = join(target4, '.github', 'hooks', 'hooks.json');
  mkdirSync(dirname(hooksConfig), { recursive: true });
  writeFileSync(hooksConfig, JSON.stringify({
    version: 1,
    hooks: { sessionStart: [{ type: 'command', command: 'node tools/harness-scripts/validate-harness.mjs' }] },
  }));
  const nestedHooksClean = runNode(target4, 'tools/harness-scripts/validate-harness.mjs');
  check('root-anchor-nested-hooks-config-clean',
    nestedHooksClean.code === 0,
    `exit ${nestedHooksClean.code}${nestedHooksClean.stderr ? ' — ' + nestedHooksClean.stderr.trim() : ''}`);

  writeFileSync(hooksConfig, JSON.stringify({
    version: 1,
    hooks: { sessionStart: [{ type: 'command', command: 'node tools/harness-scripts/does-not-exist.mjs' }] },
  }));
  const nestedHooksDangling = runNode(target4, 'tools/harness-scripts/validate-harness.mjs');
  check('root-anchor-nested-hooks-config-dangling-negative',
    nestedHooksDangling.code === 1 &&
      /FAIL: hooks-config/.test(nestedHooksDangling.stderr) &&
      /tools\/harness-scripts\/does-not-exist\.mjs/.test(nestedHooksDangling.stderr),
    `exit ${nestedHooksDangling.code} — ${nestedHooksDangling.stderr.trim()}`);
} finally {
  if (target4) rmSync(target4, { recursive: true, force: true });
}

// --- Brownfield adoption: reconcile a NON-EMPTY target (pre-existing AGENTS.md +
// .github/copilot-instructions.md + a populated .gitignore + a secret-like file)
// without clobbering project-owned content. The LLM merge is agent behaviour, so
// this simulates the scaffold-harness reconciliation DETERMINISTICALLY — managed-
// block injection, append-if-line-missing, migrate-and-delete — then runs the
// REAL validator against the temp target to prove Check 17 (managed-block), the
// Check 5 (always-on) resolution, and the `--baseline` advisory posture. Closes
// decisions-log D-21.
let target5;
try {
  target5 = scaffoldFixture();

  // The managed block the scaffold injects, sliced verbatim from the template so
  // its sentinels + headings match exactly what Check 17 asserts.
  const tplAgents = readFileSync(join(TPL, 'AGENTS.md.template'), 'utf8');
  const BEGIN = '<!-- HARNESS:BEGIN (managed by scaffold-harness — edits inside are overwritten) -->';
  const END = '<!-- HARNESS:END -->';
  const MANAGED_BLOCK = tplAgents.slice(tplAgents.indexOf(BEGIN), tplAgents.indexOf(END) + END.length);

  // Pre-existing brownfield state: a project-owned AGENTS.md (no managed block), a
  // co-shipped copilot-instructions.md, and a populated .gitignore whose existing
  // lines must survive the append.
  const bfAgents = join(target5, 'AGENTS.md');
  const PROJECT_MARKER = '<!-- project-marker-preserved -->';
  const projectAgents =
    `# AGENTS.md\n\nProject-owned guidance for acme-widget. ${PROJECT_MARKER}\n\n` +
    '## Project overview\n\nacme-widget is a pre-existing service.\n\n' +
    '## Build and test commands\n\n- `npm run build`\n- `npm test`\n';
  writeFileSync(bfAgents, projectAgents);
  const bfCopilot = join(target5, '.github', 'copilot-instructions.md');
  mkdirSync(dirname(bfCopilot), { recursive: true });
  writeFileSync(bfCopilot, '# Legacy always-on\n\nMigrate me into AGENTS.md project sections.\n');
  const bfGitignore = join(target5, '.gitignore');
  writeFileSync(bfGitignore, 'node_modules/\ndist/\n');

  // Reconcile (what scaffold-harness / the agent does deterministically):
  //   a. inject the managed block (appended — no block present yet),
  //   b. append-if-line-missing the harness .gitignore lines,
  //   c. migrate-and-delete the co-shipped copilot-instructions.md.
  writeFileSync(bfAgents, `${projectAgents}\n${MANAGED_BLOCK}\n`);
  for (const line of ['.copilot-tracking/', '.env', '.env.*', '!.env.example']) {
    if (!readFileSync(bfGitignore, 'utf8').split(/\r?\n/).includes(line)) {
      writeFileSync(bfGitignore, readFileSync(bfGitignore, 'utf8') + line + '\n');
    }
  }
  rmSync(bfCopilot, { force: true });

  // Managed block landed: both sentinels + all four harness-owned headings present.
  const reconciled = readFileSync(bfAgents, 'utf8');
  check('brownfield-managed-block-injected',
    reconciled.includes(BEGIN) && reconciled.includes(END) &&
      ['Session start protocol', 'Session end protocol', 'Repository conventions', 'Where deeper knowledge lives']
        .every((h) => reconciled.includes(h)),
    'sentinels or a required heading missing from the reconciled AGENTS.md');

  // Project-owned content survived the injection untouched.
  check('brownfield-project-section-preserved',
    reconciled.includes(PROJECT_MARKER) && reconciled.includes('## Project overview'),
    'project marker/section lost during managed-block injection');

  // .gitignore append preserved the pre-existing lines AND added the harness line.
  const giFinal = readFileSync(bfGitignore, 'utf8');
  check('brownfield-gitignore-appended',
    giFinal.includes('node_modules/') && giFinal.includes('dist/') && giFinal.includes('.copilot-tracking/'),
    `gitignore=${JSON.stringify(giFinal)}`);

  // migrate-and-delete removed the co-shipped always-on file.
  check('brownfield-copilot-instructions-removed', !existsSync(bfCopilot));

  // Normal validator run on the reconciled tree is clean: Check 5 resolved (no
  // co-shipped copilot-instructions.md) and Check 17 passes (valid managed block).
  const vClean = runNode(target5, 'harness-scripts/validate-harness.mjs');
  check('brownfield-reconciled-validator-clean',
    vClean.code === 0 && !/FAIL: always-on/.test(vClean.stderr) && !/FAIL: managed-block/.test(vClean.stderr),
    `exit ${vClean.code}${vClean.stderr ? ' — ' + vClean.stderr.trim() : ''}`);

  // Check 17 negative: strip a required harness-owned heading from the block →
  // FAIL: managed-block (a truncated/incomplete merge is caught).
  writeFileSync(bfAgents, reconciled.replace('Where deeper knowledge lives (pointers)', 'Reference pointers'));
  const vStripped = runNode(target5, 'harness-scripts/validate-harness.mjs');
  writeFileSync(bfAgents, reconciled);
  check('brownfield-managed-block-negative',
    vStripped.code === 1 && /FAIL: managed-block/.test(vStripped.stderr),
    `exit ${vStripped.code} — ${vStripped.stderr.trim()}`);

  // Check 5 negative: the transient PRE-migration state (both files co-shipped)
  // gates — proving migrate-and-delete was required to keep the tree green.
  writeFileSync(bfCopilot, '# Co-shipped again\n');
  const vCoship = runNode(target5, 'harness-scripts/validate-harness.mjs');
  rmSync(bfCopilot, { force: true });
  check('brownfield-premigration-coship-gates',
    vCoship.code === 1 && /FAIL: always-on/.test(vCoship.stderr),
    `exit ${vCoship.code} — ${vCoship.stderr.trim()}`);

  // secret-scan baseline: a pre-existing secret-like file downgrades to a
  // non-gating advisory under --baseline (exit 0), but gates on a normal run. The
  // literal is concatenated so this test file's own source never carries a match.
  const bfSecret = join(target5, 'project-notes', 'legacy-config.md');
  mkdirSync(dirname(bfSecret), { recursive: true });
  writeFileSync(bfSecret, `# Legacy config\n\n${'AKIA'}${'ABCDEFGHIJKLMNOP'}\n`);
  const vBaseline = runNode(target5, 'harness-scripts/validate-harness.mjs', ['--baseline']);
  check('brownfield-secret-scan-baseline-advisory',
    vBaseline.code === 0 &&
      /WARN: secret-scan/.test(vBaseline.stderr) &&
      /brownfield-baseline advisory/.test(vBaseline.stderr),
    `exit ${vBaseline.code} — ${vBaseline.stderr.trim()}`);
  const vGating = runNode(target5, 'harness-scripts/validate-harness.mjs');
  rmSync(bfSecret, { force: true });
  check('brownfield-secret-scan-normal-gates',
    vGating.code === 1 && /FAIL: secret-scan/.test(vGating.stderr),
    `exit ${vGating.code} — ${vGating.stderr.trim()}`);
} finally {
  if (target5) rmSync(target5, { recursive: true, force: true });
}
