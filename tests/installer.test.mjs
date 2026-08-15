import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, UsageError } from '../installer/lib/args.mjs';
import { createPlan } from '../installer/lib/planner.mjs';
import { buildInstallation } from '../installer/lib/manifest.mjs';
import { executePlan } from '../installer/lib/transaction.mjs';
import { inspectInstallation, run } from '../installer/lib/app.mjs';
import { loadCatalog, sha256, validateCatalog } from '../installer/lib/catalog.mjs';

test('parser defaults the target and leaves profile resolution to the catalog', () => {
  const options = parseArgs(['plan'], 'C:\\work\\demo');
  assert.equal(options.command, 'plan');
  assert.equal(options.target, resolve('C:\\work\\demo'));
  assert.equal(options.profile, undefined);
  assert.equal(options.dryRun, false);
  assert.equal(options.migrateInstructions, false);
});

test('parser accepts inline values and mutation flags', () => {
  const options = parseArgs([
    'init', '--target=repo', '--profile', 'full', '--project-name', 'Demo',
    '--project-slug=demo', '--json', '--yes', '--migrate-instructions',
  ], 'C:\\work');
  assert.equal(options.target, resolve('C:\\work', 'repo'));
  assert.equal(options.profile, 'full');
  assert.equal(options.projectName, 'Demo');
  assert.equal(options.projectSlug, 'demo');
  assert.equal(options.json, true);
  assert.equal(options.yes, true);
  assert.equal(options.migrateInstructions, true);
});

test('parser rejects unknown profiles and options', () => {
  assert.throws(() => parseArgs(['plan', '--profile', 'tiny']), UsageError);
  assert.throws(() => parseArgs(['plan', '--force']), UsageError);
});

test('parser restricts mutation and project flags by command', () => {
  assert.throws(() => parseArgs(['status', '--dry-run']), UsageError);
  assert.throws(() => parseArgs(['validate', '--yes']), UsageError);
  assert.throws(() => parseArgs(['status', '--migrate-instructions']), UsageError);
  assert.throws(() => parseArgs(['update', '--project-name', 'Demo']), UsageError);
  assert.throws(() => parseArgs(['init', '--json']), UsageError);
});

test('parser recognizes help and version without a command', () => {
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.deepEqual(parseArgs(['--version']), { version: true });
});

function fixture() {
  const target = mkdtempSync(join(tmpdir(), 'starter-harness-'));
  return { target, cleanup: () => rmSync(target, { recursive: true, force: true }) };
}

function catalogFixture() {
  return structuredClone(loadCatalog().catalog);
}

test('catalog rejects unknown hosts and capabilities', () => {
  const unknownHost = catalogFixture();
  unknownHost.artifacts['agents-brief'].hosts = ['other-host'];
  assert.throws(() => validateCatalog(unknownHost), /unknown host other-host/);

  const unknownCapability = catalogFixture();
  unknownCapability.artifacts['agents-brief'].capability = 'other-capability';
  assert.throws(() => validateCatalog(unknownCapability), /unknown capability other-capability/);
});

test('catalog requires the canonical skill in the generator core and full union', () => {
  const missingSkill = catalogFixture();
  missingSkill.artifacts['build-harness-skill'].capability = 'harness-core';
  assert.throws(
    () => validateCatalog(missingSkill),
    /generator core is missing \.github\/skills\/build-harness\/SKILL\.md/,
  );

  const incompleteFull = catalogFixture();
  incompleteFull.profiles.full = incompleteFull.profiles.full.filter((id) => id !== 'build-harness-skill');
  assert.throws(() => validateCatalog(incompleteFull), /full profile is not the artifact union/);
});

async function runQuiet(options) {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try { return await run(options); } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function addLegacyKnowledgeRecord(target, id = 'knowledge-index', content = '# Legacy starter knowledge\n') {
  const relativePath = id === 'knowledge-index'
    ? 'knowledge-base/index.md'
    : `knowledge-base/${id.replace('knowledge-', '')}.md`;
  const path = join(target, ...relativePath.split('/'));
  mkdirSync(join(target, 'knowledge-base'), { recursive: true });
  writeFileSync(path, content);
  const manifestPath = join(target, 'harness', 'installation.yml');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.artifacts.push({
    id,
    path: relativePath,
    ownership: 'managed-file',
    sourceHash: sha256(content),
    installedHash: sha256(content),
  });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return { path, manifestPath };
}

function addLegacyTemplateRecord(target, id = 'agents-brief-template', relativePath = 'templates/AGENTS.md.template') {
  const filename = relativePath.split('/').at(-1);
  const content = readFileSync(resolve('.github/skills/scaffold-harness/assets/templates', filename), 'utf8');
  const path = join(target, ...relativePath.split('/'));
  mkdirSync(join(target, 'templates'), { recursive: true });
  writeFileSync(path, content);
  const manifestPath = join(target, 'harness', 'installation.yml');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.artifacts.push({
    id,
    path: relativePath,
    ownership: 'managed-file',
    sourceHash: sha256(content),
    installedHash: sha256(content),
  });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return { path, manifestPath };
}

test('plan resolves the catalog default without writing', () => {
  const { target, cleanup } = fixture();
  try {
    const plan = createPlan({ command: 'plan', target });
    assert.equal(plan.profile, 'standard');
    assert.equal(plan.conflicts.length, 0);
    assert.equal(plan.operations.filter((operation) => operation.type === 'write').length, 18);
    assert.deepEqual(readdirSync(target), []);
  } finally { cleanup(); }
});

test('brownfield plan requires explicit consent before instruction migration', () => {
  const { target, cleanup } = fixture();
  try {
    writeFileSync(join(target, 'AGENTS.md'), '# Existing\n\nKeep me.\n');
    mkdirSync(join(target, '.github'), { recursive: true });
    writeFileSync(join(target, '.github', 'copilot-instructions.md'), 'Legacy rule.\n');
    const preserved = readFileSync(join(target, '.github', 'copilot-instructions.md'), 'utf8');
    const blocked = createPlan({ command: 'plan', target, profile: 'doc-only', yes: true });
    assert.match(blocked.conflicts.map((item) => item.reason).join('\n'), /--migrate-instructions/);
    assert.equal(blocked.operations.some((operation) => operation.path === 'AGENTS.md'), false);
    assert.equal(blocked.operations.some((operation) => operation.type === 'delete'), false);
    assert.equal(readFileSync(join(target, '.github', 'copilot-instructions.md'), 'utf8'), preserved);

    const plan = createPlan({ command: 'plan', target, profile: 'doc-only', migrateInstructions: true });
    const agents = plan.operations.find((operation) => operation.path === 'AGENTS.md');
    assert.match(agents.content, /Keep me/);
    assert.match(agents.content, /Legacy rule/);
    assert.ok(agents.content.indexOf('Legacy rule') < agents.content.indexOf('HARNESS:BEGIN'));
    assert.equal(plan.operations.some((operation) => operation.type === 'delete'), true);
    assert.equal(plan.baseline, true);
  } finally { cleanup(); }
});

test('plan rejects a partially present executable group', () => {
  const { target, cleanup } = fixture();
  try {
    mkdirSync(join(target, 'harness-scripts'));
    writeFileSync(join(target, 'harness-scripts', 'signature.mjs'), 'local');
    const plan = createPlan({ command: 'plan', target });
    assert.match(plan.conflicts.map((item) => item.reason).join('\n'), /atomic group executable-layer is partially present/);
  } finally { cleanup(); }
});

test('standard omits the generator bootstrap and full includes its complete atomic group', () => {
  const { target, cleanup } = fixture();
  try {
    const standard = createPlan({ command: 'plan', target, profile: 'standard' });
    const full = createPlan({ command: 'plan', target, profile: 'full' });
    const standardPaths = new Set(standard.operations.map((operation) => operation.path));
    const fullPaths = new Set(full.operations.map((operation) => operation.path));
    assert.equal(standardPaths.has('.github/skills/build-harness/SKILL.md'), false);
    assert.equal(standardPaths.has('.github/skills/scaffold-harness/assets/templates/AGENTS.md.template'), false);
    for (const path of [
      '.github/skills/build-harness/SKILL.md',
      '.github/agents/harness-builder.agent.md',
      '.github/skills/scaffold-harness/SKILL.md',
      '.github/skills/scaffold-harness/references/adoption-profiles.json',
      '.github/skills/scaffold-harness/references/starter-harness/index.md',
      '.github/instructions/customization-authoring.instructions.md',
      '.github/skills/scaffold-harness/assets/templates/AGENTS.md.template',
      '.github/skills/scaffold-harness/assets/templates/state.md.template',
    ]) {
      assert.equal(fullPaths.has(path), true, `full profile is missing ${path}`);
    }
  } finally { cleanup(); }
});

test('full plan rejects a partially present generator bootstrap', () => {
  const { target, cleanup } = fixture();
  try {
    const skill = join(target, '.github', 'skills', 'build-harness', 'SKILL.md');
    mkdirSync(join(target, '.github', 'skills', 'build-harness'), { recursive: true });
    writeFileSync(skill, 'local skill\n');
    const plan = createPlan({ command: 'plan', target, profile: 'full' });
    assert.match(plan.conflicts.map((item) => item.reason).join('\n'), /atomic group generator-bootstrap is partially present/);
  } finally { cleanup(); }
});

test('full plan leaves an untracked project knowledge base untouched', () => {
  const { target, cleanup } = fixture();
  try {
    mkdirSync(join(target, 'knowledge-base'));
    writeFileSync(join(target, 'knowledge-base', 'index.md'), '# Project knowledge\n');
    const plan = createPlan({ command: 'plan', target, profile: 'full' });
    assert.equal(plan.conflicts.some((item) => item.path === 'knowledge-base/index.md'), false);
    assert.equal(plan.operations.some((operation) => operation.path === 'knowledge-base/index.md'), false);
    assert.equal(readFileSync(join(target, 'knowledge-base', 'index.md'), 'utf8'), '# Project knowledge\n');
  } finally { cleanup(); }
});

test('plan appends manifest-derived doctor tools without replacing existing entries', () => {
  const { target, cleanup } = fixture();
  try {
    writeFileSync(join(target, 'package.json'), '{}\n');
    const plan = createPlan({ command: 'plan', target });
    const doctor = plan.operations.find((operation) => operation.path === 'harness/doctor.yml');
    assert.match(doctor.content, /name: git/);
    assert.match(doctor.content, /name: node/);
    assert.match(doctor.content, /name: npm/);
  } finally { cleanup(); }
});

test('init applies standard profile, validates it, and records clean ownership', async () => {
  const { target, cleanup } = fixture();
  try {
    const code = await runQuiet({ command: 'init', target, profile: undefined, yes: true, json: true, dryRun: false });
    assert.equal(code, 0);
    assert.equal(existsSync(join(target, 'harness', 'installation.yml')), true);
    assert.equal(existsSync(join(target, 'harness-scripts', 'validate-harness.mjs')), true);
    const installation = JSON.parse(readFileSync(join(target, 'harness', 'installation.yml'), 'utf8'));
    assert.equal(installation.installer.name, 'starter-harness');
    assert.equal(installation.profile, 'standard');
    assert.equal(installation.artifacts.length, 18);
    assert.equal(inspectInstallation({ target }).clean, true);
  } finally { cleanup(); }
});

test('update is idempotent and dry-run writes nothing', async () => {
  const { target, cleanup } = fixture();
  try {
    await runQuiet({ command: 'init', target, profile: 'doc-only', yes: true, json: true, dryRun: false });
    const before = readFileSync(join(target, 'AGENTS.md'), 'utf8');
    const dryCode = await runQuiet({ command: 'update', target, profile: 'standard', yes: false, json: true, dryRun: true });
    assert.equal(dryCode, 0);
    assert.equal(readFileSync(join(target, 'AGENTS.md'), 'utf8'), before);
    const updateCode = await runQuiet({ command: 'update', target, profile: 'doc-only', yes: true, json: true, dryRun: false });
    assert.equal(updateCode, 0);
    assert.equal(readFileSync(join(target, 'AGENTS.md'), 'utf8'), before);
    assert.equal(inspectInstallation({ target }).clean, true);
  } finally { cleanup(); }
});

test('update reports a locally modified managed file without overwriting it', async () => {
  const { target, cleanup } = fixture();
  try {
    await runQuiet({ command: 'init', target, profile: 'standard', yes: true, json: true, dryRun: false });
    const script = join(target, 'harness-scripts', 'signature.mjs');
    writeFileSync(script, 'local edit\n');
    const plan = createPlan({ command: 'update', target });
    assert.match(plan.conflicts.map((item) => item.reason).join('\n'), /locally modified/);
    assert.equal(readFileSync(script, 'utf8'), 'local edit\n');
  } finally { cleanup(); }
});

test('transaction rollback restores all prior bytes after a write failure', () => {
  const { target, cleanup } = fixture();
  try {
    writeFileSync(join(target, '.gitignore'), 'dist/\n');
    const plan = createPlan({ command: 'init', target, profile: 'doc-only' });
    const manifest = JSON.stringify(buildInstallation(plan, '0.1.0'), null, 2) + '\n';
    assert.throws(() => executePlan(plan, manifest, { failAfter: 2 }), /Injected transaction failure/);
    assert.deepEqual(readdirSync(target), ['.gitignore']);
    assert.equal(readFileSync(join(target, '.gitignore'), 'utf8'), 'dist/\n');
  } finally { cleanup(); }
});

test('status reports a removed owned append line as drift', async () => {
  const { target, cleanup } = fixture();
  try {
    await runQuiet({ command: 'init', target, profile: 'doc-only', yes: true, json: true, dryRun: false });
    writeFileSync(join(target, '.gitattributes'), 'other=value\n');
    const status = inspectInstallation({ target });
    assert.equal(status.clean, false);
    assert.equal(status.drift.some((item) => item.path === '.gitattributes'), true);
  } finally { cleanup(); }
});

test('legacy-only brownfield state migrates only with explicit consent', () => {
  const { target, cleanup } = fixture();
  try {
    mkdirSync(join(target, '.github'), { recursive: true });
    writeFileSync(join(target, '.github', 'copilot-instructions.md'), 'Preserve this.\n');
    const blocked = createPlan({ command: 'plan', target, profile: 'doc-only' });
    assert.match(blocked.conflicts.map((item) => item.reason).join('\n'), /--migrate-instructions/);
    assert.equal(blocked.operations.some((operation) => operation.type === 'delete'), false);
    assert.equal(readFileSync(join(target, '.github', 'copilot-instructions.md'), 'utf8'), 'Preserve this.\n');

    const plan = createPlan({ command: 'plan', target, profile: 'doc-only', migrateInstructions: true });
    const agents = plan.operations.find((operation) => operation.path === 'AGENTS.md').content;
    assert.ok(agents.indexOf('Preserve this.') < agents.indexOf('HARNESS:BEGIN'));
    assert.equal(plan.operations.some((operation) => operation.type === 'delete'), true);
  } finally { cleanup(); }
});

test('AGENTS-only brownfield state preserves project content and appends one block', () => {
  const { target, cleanup } = fixture();
  try {
    writeFileSync(join(target, 'AGENTS.md'), '# Project\n\nOwned.\n');
    const plan = createPlan({ command: 'plan', target, profile: 'doc-only' });
    const content = plan.operations.find((operation) => operation.path === 'AGENTS.md').content;
    assert.match(content, /Owned/);
    assert.equal(content.split('HARNESS:BEGIN').length - 1, 1);
  } finally { cleanup(); }
});

test('malformed managed sentinels conflict without producing an AGENTS write', () => {
  const { target, cleanup } = fixture();
  try {
    writeFileSync(join(target, 'AGENTS.md'), '<!-- HARNESS:BEGIN (managed by scaffold-harness — edits inside are overwritten) -->\n');
    const plan = createPlan({ command: 'plan', target, profile: 'doc-only' });
    assert.match(plan.conflicts[0].reason, /malformed/);
    assert.equal(plan.operations.some((operation) => operation.path === 'AGENTS.md'), false);
  } finally { cleanup(); }
});

test('update supports cumulative full upgrade and refuses downgrade', async () => {
  const { target, cleanup } = fixture();
  try {
    await runQuiet({ command: 'init', target, profile: 'standard', yes: true, json: true, dryRun: false });
    const code = await runQuiet({ command: 'update', target, profile: 'full', yes: true, json: true, dryRun: false });
    assert.equal(code, 0);
    assert.equal(existsSync(join(target, '.github', 'workflows', 'validate.yml')), true);
    assert.equal(existsSync(join(target, '.github', 'skills', 'build-harness', 'SKILL.md')), true);
    assert.equal(existsSync(join(target, '.github', 'agents', 'harness-builder.agent.md')), true);
    assert.equal(existsSync(join(target, '.github', 'skills', 'scaffold-harness', 'SKILL.md')), true);
    assert.equal(existsSync(join(target, '.github', 'skills', 'scaffold-harness', 'references', 'starter-harness', 'index.md')), true);
    assert.equal(existsSync(join(target, 'knowledge-base')), false);
    assert.equal(existsSync(join(target, '.github', 'skills', 'scaffold-harness', 'assets', 'templates', 'AGENTS.md.template')), true);
    assert.equal(existsSync(join(target, 'templates')), false);
    assert.equal(JSON.parse(readFileSync(join(target, 'harness', 'installation.yml'))).profile, 'full');
    assert.equal(await runQuiet({ command: 'update', target, profile: 'full', yes: true, json: true, dryRun: false }), 0);
    assert.equal(inspectInstallation({ target }).clean, true);
    assert.throws(() => createPlan({ command: 'update', target, profile: 'standard' }), /downgrade/);
  } finally { cleanup(); }
});

test('full update preserves a locally modified generator bootstrap file', async () => {
  const { target, cleanup } = fixture();
  try {
    await runQuiet({ command: 'init', target, profile: 'full', yes: true, json: true, dryRun: false });
    const skill = join(target, '.github', 'skills', 'build-harness', 'SKILL.md');
    writeFileSync(skill, 'local edit\n');
    const plan = createPlan({ command: 'update', target, profile: 'full' });
    assert.match(plan.conflicts.map((item) => item.reason).join('\n'), /locally modified/);
    assert.equal(readFileSync(skill, 'utf8'), 'local edit\n');
  } finally { cleanup(); }
});

test('full update relocates an unchanged legacy managed root template', async () => {
  const { target, cleanup } = fixture();
  try {
    await runQuiet({ command: 'init', target, profile: 'full', yes: true, json: true, dryRun: false });
    const { path, manifestPath } = addLegacyTemplateRecord(target);
    const plan = createPlan({ command: 'update', target, profile: 'full' });
    assert.equal(plan.conflicts.length, 0);
    assert.equal(plan.operations.some((operation) => operation.type === 'delete' && operation.path === 'templates/AGENTS.md.template'), true);

    assert.equal(await runQuiet({ command: 'update', target, profile: 'full', yes: true, json: true, dryRun: false }), 0);
    assert.equal(existsSync(path), false);
    assert.equal(existsSync(join(target, '.github', 'skills', 'scaffold-harness', 'assets', 'templates', 'AGENTS.md.template')), true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.artifacts.some((artifact) => artifact.id === 'agents-brief-template'), false);
    assert.equal(manifest.artifacts.some((artifact) => artifact.id === 'scaffold-agents-brief-template'), true);
    assert.equal(manifest.migrations.some((migration) => migration.retiredId === 'agents-brief-template'), true);
    assert.equal(inspectInstallation({ target }).clean, true);
  } finally { cleanup(); }
});

test('full update blocks relocation of a locally modified legacy root template', async () => {
  const { target, cleanup } = fixture();
  try {
    await runQuiet({ command: 'init', target, profile: 'full', yes: true, json: true, dryRun: false });
    const { path } = addLegacyTemplateRecord(target);
    writeFileSync(path, 'local template edit\n');
    const plan = createPlan({ command: 'update', target, profile: 'full' });
    assert.match(plan.conflicts.map((item) => item.reason).join('\n'), /retired managed file agents-brief-template was locally modified/);
    assert.equal(readFileSync(path, 'utf8'), 'local template edit\n');
  } finally { cleanup(); }
});

test('full update retires an already absent legacy root template record', async () => {
  const { target, cleanup } = fixture();
  try {
    await runQuiet({ command: 'init', target, profile: 'full', yes: true, json: true, dryRun: false });
    const { path, manifestPath } = addLegacyTemplateRecord(target);
    rmSync(path);
    const plan = createPlan({ command: 'update', target, profile: 'full' });
    assert.equal(plan.conflicts.length, 0);
    assert.equal(plan.operations.some((operation) => operation.type === 'noop' && operation.retiredId === 'agents-brief-template'), true);

    assert.equal(await runQuiet({ command: 'update', target, profile: 'full', yes: true, json: true, dryRun: false }), 0);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.artifacts.some((artifact) => artifact.id === 'agents-brief-template'), false);
  } finally { cleanup(); }
});

test('transaction rollback restores a retired legacy root template and manifest', async () => {
  const { target, cleanup } = fixture();
  try {
    await runQuiet({ command: 'init', target, profile: 'full', yes: true, json: true, dryRun: false });
    const { path, manifestPath } = addLegacyTemplateRecord(target);
    const content = readFileSync(path, 'utf8');
    const manifestBefore = readFileSync(manifestPath, 'utf8');
    const plan = createPlan({ command: 'update', target, profile: 'full' });
    const manifestText = JSON.stringify(buildInstallation(plan, '0.1.0'), null, 2) + '\n';

    assert.throws(() => executePlan(plan, manifestText, { failAfter: 1 }), /Injected transaction failure/);
    assert.equal(readFileSync(path, 'utf8'), content);
    assert.equal(readFileSync(manifestPath, 'utf8'), manifestBefore);
  } finally { cleanup(); }
});

test('full update retires unchanged legacy managed knowledge files', async () => {
  const { target, cleanup } = fixture();
  try {
    await runQuiet({ command: 'init', target, profile: 'full', yes: true, json: true, dryRun: false });
    const { path, manifestPath } = addLegacyKnowledgeRecord(target);
    const plan = createPlan({ command: 'update', target, profile: 'full' });
    assert.equal(plan.conflicts.length, 0);
    assert.equal(plan.operations.some((operation) => operation.type === 'delete' && operation.path === 'knowledge-base/index.md'), true);

    assert.equal(await runQuiet({ command: 'update', target, profile: 'full', yes: true, json: true, dryRun: false }), 0);
    assert.equal(existsSync(path), false);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.artifacts.some((artifact) => artifact.id === 'knowledge-index'), false);
    assert.equal(manifest.migrations.some((migration) => migration.retiredId === 'knowledge-index'), true);
    assert.equal(inspectInstallation({ target }).clean, true);
  } finally { cleanup(); }
});

test('full update blocks retirement of a locally modified legacy knowledge file', async () => {
  const { target, cleanup } = fixture();
  try {
    await runQuiet({ command: 'init', target, profile: 'full', yes: true, json: true, dryRun: false });
    const { path } = addLegacyKnowledgeRecord(target);
    writeFileSync(path, '# Project edit\n');
    const plan = createPlan({ command: 'update', target, profile: 'full' });
    assert.match(plan.conflicts.map((item) => item.reason).join('\n'), /retired managed file knowledge-index was locally modified/);
    assert.equal(readFileSync(path, 'utf8'), '# Project edit\n');
  } finally { cleanup(); }
});

test('full update retires an already absent legacy knowledge record', async () => {
  const { target, cleanup } = fixture();
  try {
    await runQuiet({ command: 'init', target, profile: 'full', yes: true, json: true, dryRun: false });
    const { path, manifestPath } = addLegacyKnowledgeRecord(target);
    rmSync(path);
    const plan = createPlan({ command: 'update', target, profile: 'full' });
    assert.equal(plan.conflicts.length, 0);
    assert.equal(plan.operations.some((operation) => operation.type === 'noop' && operation.retiredId === 'knowledge-index'), true);

    assert.equal(await runQuiet({ command: 'update', target, profile: 'full', yes: true, json: true, dryRun: false }), 0);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.artifacts.some((artifact) => artifact.id === 'knowledge-index'), false);
  } finally { cleanup(); }
});

test('transaction rollback restores a retired legacy knowledge file and manifest', async () => {
  const { target, cleanup } = fixture();
  try {
    await runQuiet({ command: 'init', target, profile: 'full', yes: true, json: true, dryRun: false });
    const content = '# Legacy starter knowledge\n';
    const { path, manifestPath } = addLegacyKnowledgeRecord(target, 'knowledge-index', content);
    const manifestBefore = readFileSync(manifestPath, 'utf8');
    const plan = createPlan({ command: 'update', target, profile: 'full' });
    const manifestText = JSON.stringify(buildInstallation(plan, '0.1.0'), null, 2) + '\n';

    assert.throws(() => executePlan(plan, manifestText, { failAfter: 1 }), /Injected transaction failure/);
    assert.equal(readFileSync(path, 'utf8'), content);
    assert.equal(readFileSync(manifestPath, 'utf8'), manifestBefore);
  } finally { cleanup(); }
});

test('doc-only validate and doctor intentionally skip after ownership validation', async () => {
  const { target, cleanup } = fixture();
  try {
    await runQuiet({ command: 'init', target, profile: 'doc-only', yes: true, json: true, dryRun: false });
    assert.equal(await runQuiet({ command: 'validate', target, json: true }), 0);
    assert.equal(await runQuiet({ command: 'doctor', target, json: true }), 0);
  } finally { cleanup(); }
});

test('standard validate and doctor delegate to installed scripts', async () => {
  const { target, cleanup } = fixture();
  try {
    await runQuiet({ command: 'init', target, profile: 'standard', yes: true, json: true, dryRun: false });
    assert.equal(await runQuiet({ command: 'validate', target, json: true }), 0);
    assert.equal(await runQuiet({ command: 'doctor', target, json: true }), 0);
  } finally { cleanup(); }
});

test('brownfield standard init migrates legacy guidance and baseline-validates', async () => {
  const { target, cleanup } = fixture();
  try {
    writeFileSync(join(target, 'AGENTS.md'), '# Existing project\n\nPreserve this.\n');
    mkdirSync(join(target, '.github'), { recursive: true });
    writeFileSync(join(target, '.github', 'copilot-instructions.md'), 'Legacy guidance.\n');
    mkdirSync(join(target, 'project-notes'), { recursive: true });
    writeFileSync(join(target, 'project-notes', 'legacy.md'), `${'AKIA'}${'ABCDEFGHIJKLMNOP'}\n`);
    const declined = await runQuiet({ command: 'init', target, profile: 'standard', yes: true, json: true, dryRun: false });
    assert.equal(declined, 1);
    assert.equal(readFileSync(join(target, '.github', 'copilot-instructions.md'), 'utf8'), 'Legacy guidance.\n');
    assert.equal(existsSync(join(target, 'harness', 'installation.yml')), false);

    const code = await runQuiet({
      command: 'init', target, profile: 'standard', yes: true, json: true, dryRun: false,
      migrateInstructions: true,
    });
    assert.equal(code, 0);
    assert.equal(existsSync(join(target, '.github', 'copilot-instructions.md')), false);
    const agents = readFileSync(join(target, 'AGENTS.md'), 'utf8');
    assert.match(agents, /Preserve this/);
    assert.match(agents, /Legacy guidance/);
    assert.equal(JSON.parse(readFileSync(join(target, 'harness', 'installation.yml'))).baseline, true);
  } finally { cleanup(); }
});

test('update replaces an unchanged older managed file and preserves seed-only edits', async () => {
  const { target, cleanup } = fixture();
  try {
    await runQuiet({ command: 'init', target, profile: 'standard', yes: true, json: true, dryRun: false });
    const scriptPath = join(target, 'harness-scripts', 'signature.mjs');
    const progressPath = join(target, 'PROGRESS.md');
    const manifestPath = join(target, 'harness', 'installation.yml');
    const desiredScript = readFileSync(scriptPath, 'utf8');
    const oldScript = '// installed by an older package\n';
    const customProgress = '# Team-owned progress\n';
    writeFileSync(scriptPath, oldScript);
    writeFileSync(progressPath, customProgress);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.artifacts.find((artifact) => artifact.id === 'signature-script').installedHash = sha256(oldScript);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    const code = await runQuiet({ command: 'update', target, profile: 'standard', yes: true, json: true, dryRun: false });
    assert.equal(code, 0);
    assert.equal(readFileSync(scriptPath, 'utf8'), desiredScript);
    assert.equal(readFileSync(progressPath, 'utf8'), customProgress);
  } finally { cleanup(); }
});

test('CLI emits machine-readable plan output', () => {
  const { target, cleanup } = fixture();
  try {
    const result = spawnSync(process.execPath, [
      resolve('installer/cli.mjs'), 'plan', '--target', target, '--profile', 'doc-only', '--json',
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.command, 'plan');
    assert.equal(output.profile, 'doc-only');
    assert.equal(output.changes.length, 6);
  } finally { cleanup(); }
});