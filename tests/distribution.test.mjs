import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = resolve(
  REPO_ROOT,
  '.github/skills/scaffold-harness/references/adoption-profiles.json',
);
const packageJson = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));

function readCatalog(root = REPO_ROOT) {
  return JSON.parse(readFileSync(resolve(
    root,
    '.github/skills/scaffold-harness/references/adoption-profiles.json',
  ), 'utf8'));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: options.env ?? process.env,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  };
}

function assertSuccess(result, label) {
  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    `${label} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

function parseJsonOutput(result, label) {
  assertSuccess(result, label);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`${label} emitted invalid JSON: ${error.message}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
}

function runNpm(args, options = {}) {
  if (process.platform === 'win32') {
    return run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...args], options);
  }
  return run('npm', args, options);
}

function runNpx(args, options = {}) {
  if (process.platform === 'win32') {
    return run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npx.cmd', ...args], options);
  }
  return run('npx', args, options);
}

function linkedBinPath(consumer) {
  const suffix = process.platform === 'win32' ? '.cmd' : '';
  return resolve(consumer, 'node_modules', '.bin', `starter-harness${suffix}`);
}

function runLinkedBin(consumer, args) {
  const executable = linkedBinPath(consumer);
  if (process.platform === 'win32') {
    return run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', executable, ...args], { cwd: consumer });
  }
  return run(executable, args, { cwd: consumer });
}

function relativeImports(source) {
  return [...source.matchAll(/(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"](\.[^'"]+)['"]/g)]
    .map((match) => match[1]);
}

function installerModules(root, binTarget) {
  const pending = [resolve(root, binTarget)];
  const visited = new Set();
  while (pending.length > 0) {
    const modulePath = pending.pop();
    assert.equal(existsSync(modulePath), true, `mirror package is missing ${relative(root, modulePath)}`);
    if (visited.has(modulePath)) continue;
    visited.add(modulePath);
    const source = readFileSync(modulePath, 'utf8');
    for (const specifier of relativeImports(source)) {
      const importedPath = resolve(dirname(modulePath), specifier);
      assert.equal(
        relative(root, importedPath).startsWith('..'),
        false,
        `installer import escapes package root: ${specifier}`,
      );
      pending.push(importedPath);
    }
  }
  return visited;
}

function mirrorPackageBoundary(root, expectedStatus = 'complete') {
  const mirrorPackagePath = resolve(root, 'package.json');
  assert.equal(existsSync(mirrorPackagePath), true, 'mirror package is missing package.json');
  const mirrorPackage = JSON.parse(readFileSync(mirrorPackagePath, 'utf8'));
  assert.equal(mirrorPackage.type, 'module');
  assert.deepEqual(mirrorPackage.dependencies ?? {}, {});
  const bins = Object.entries(mirrorPackage.bin ?? {});
  assert.deepEqual(bins, [['starter-harness', 'installer/cli.mjs']]);
  const [[, binTarget]] = bins;
  assert.ok(installerModules(root, binTarget).size > 1, 'mirror installer module graph is incomplete');

  const mirrorCatalog = readCatalog(root);
  const catalogSources = [...new Set(Object.values(mirrorCatalog.artifacts)
    .flatMap((artifact) => artifact.source ? [artifact.source] : []))];
  const missingSources = catalogSources.filter((source) => !existsSync(resolve(root, source)));
  let functionalChecksPassed = false;
  if (missingSources.length === 0) {
    const planTarget = mkdtempSync(join(tmpdir(), 'starter-harness-mirror-plan-'));
    try {
      const planResult = run(process.execPath, [resolve(root, binTarget),
        'plan', '--target', planTarget, '--profile', 'full', '--json'], { cwd: root });
      assertSuccess(planResult, 'complete mirror functional plan');
      const plan = parseJsonOutput(planResult, 'complete mirror functional plan');
      functionalChecksPassed = plan.command === 'plan'
        && plan.profile === 'full'
        && plan.conflicts.length === 0;
    } finally {
      rmSync(planTarget, { recursive: true, force: true });
    }
  }
  const status = missingSources.length === 0 && functionalChecksPassed ? 'complete' : 'metadata-only';
  assert.equal(
    status,
    expectedStatus,
    `mirror package status is ${status}; missing catalog sources: ${missingSources.join(', ') || 'none'}`,
  );
  if (status === 'complete') {
    assert.equal(functionalChecksPassed, true, 'complete mirror status requires functional checks');
  }
  return { status, missingSources, functionalChecksPassed };
}

function copyDirectory(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

function seedTemplate(source, target) {
  if (existsSync(target)) return;
  mkdirSync(dirname(target), { recursive: true });
  const content = readFileSync(source, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('{{!'))
    .join('\n');
  writeFileSync(target, content);
}

function stageMirror(target) {
  for (const directory of [
    '.github/skills',
    '.github/instructions',
    'harness-scripts',
    'installer',
    'tests',
  ]) {
    copyDirectory(resolve(REPO_ROOT, directory), resolve(target, directory));
  }
  for (const file of [
    '.github/agents/harness-builder.agent.md',
    '.github/workflows/validate.yml',
    '.github/hooks/hooks.json',
    '.githooks/pre-commit',
    'README.md',
    'AGENTS.md',
    'ADOPTING.md',
    'LICENSE',
    'package.json',
    '.gitignore',
    '.gitattributes',
  ]) {
    const destination = resolve(target, file);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(resolve(REPO_ROOT, file), destination);
  }
  cpSync(resolve(REPO_ROOT, 'README.md'), resolve(target, 'HARNESS_README.md'));
  const templateRoot = resolve(REPO_ROOT, '.github/skills/scaffold-harness/assets/templates');
  seedTemplate(resolve(templateRoot, 'PROGRESS.md.template'), resolve(target, 'PROGRESS.md'));
  seedTemplate(resolve(templateRoot, 'features.yml.template'), resolve(target, 'features.yml'));
  for (const file of ['doctor.yml', 'guards.yml', 'incidents.jsonl']) {
    seedTemplate(resolve(templateRoot, `${file}.template`), resolve(target, `harness/${file}`));
  }
}

function runMirrorValidator(root) {
  return run(process.execPath, [
    resolve(root, 'harness-scripts/validate-harness.mjs'), '--baseline',
  ], { cwd: root });
}

function mirrorCopySources() {
  const workflow = readFileSync(
    resolve(REPO_ROOT, '.github/workflows/sync-starter-kit.yml'),
    'utf8',
  );
  return [...workflow.matchAll(/^\s*cp\s+((?:source\/\S+\s+)+)target\//gm)]
    .flatMap((match) => match[1].trim().split(/\s+/))
    .map((source) => source.slice('source/'.length));
}

if (process.argv.includes('--mirror-boundary')) {
  const result = mirrorPackageBoundary(REPO_ROOT);
  process.stdout.write(`MIRROR_PACKAGE_STATUS=${result.status}\n`);
} else {

test('starter-kit mirror copy sources exist', () => {
  const sources = mirrorCopySources();
  assert.ok(sources.length > 0, 'mirror workflow has no modeled copy sources');
  for (const source of sources) {
    assert.equal(existsSync(resolve(REPO_ROOT, source)), true, `mirror copy source is missing: ${source}`);
  }
});

test('npm package closure includes catalog sources and executable metadata', () => {
  const result = runNpm(['pack', '--dry-run', '--json']);
  const manifests = parseJsonOutput(result, 'npm pack --dry-run');
  assert.equal(manifests.length, 1);

  const manifest = manifests[0];
  assert.equal(manifest.name, packageJson.name);
  assert.equal(manifest.version, packageJson.version);
  assert.equal(packageJson.license, 'MIT');
  assert.equal(packageJson.type, 'module');
  assert.deepEqual(packageJson.dependencies ?? {}, {});

  const bins = Object.entries(packageJson.bin ?? {});
  assert.deepEqual(bins, [['starter-harness', 'installer/cli.mjs']]);
  const [[, binTarget]] = bins;
  const packedFiles = new Map(manifest.files.map((file) => [file.path, file]));
  const catalogSources = Object.values(readCatalog().artifacts)
    .flatMap((artifact) => artifact.source ? [artifact.source] : []);
  const requiredPaths = new Set([
    ...catalogSources,
    '.github/skills/scaffold-harness/references/adoption-profiles.json',
    'package.json',
    'README.md',
    'LICENSE',
    binTarget,
  ]);

  for (const path of requiredPaths) {
    assert.ok(packedFiles.has(path), `npm package is missing ${path}`);
  }
  for (const path of [
    '.github/skills/scaffold-harness/references/starter-harness/index.md',
    '.github/skills/scaffold-harness/references/starter-harness/architecture.md',
    '.github/skills/scaffold-harness/references/starter-harness/conventions.md',
    '.github/skills/scaffold-harness/references/starter-harness/glossary.md',
    '.github/skills/scaffold-harness/references/toolchain-detection.md',
  ]) {
    assert.ok(packedFiles.has(path), `npm package is missing starter reference ${path}`);
  }
  assert.equal(
    [...packedFiles.keys()].some((path) => path.startsWith('knowledge-base/')),
    false,
    'npm package must not contain project-owned root knowledge-base files',
  );
  assert.match(readFileSync(resolve(REPO_ROOT, binTarget), 'utf8'), /^#!\/usr\/bin\/env node\r?\n/);
});

test('exact packed tarball runs the installed CLI lifecycle', { timeout: 120_000 }, () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'starter-harness-distribution-'));
  const packDirectory = resolve(temporaryRoot, 'pack');
  const consumer = resolve(temporaryRoot, 'consumer');
  const target = resolve(temporaryRoot, 'target');
  try {
    mkdirSync(packDirectory);
    mkdirSync(consumer);
    mkdirSync(target);
    writeFileSync(resolve(consumer, 'package.json'), '{"private":true}\n');

    const packResult = runNpm(['pack', '--json', '--pack-destination', packDirectory]);
    const [manifest] = parseJsonOutput(packResult, 'npm pack');
    assert.equal(manifest.name, packageJson.name);
    assert.equal(manifest.version, packageJson.version);
    const tarball = resolve(packDirectory, manifest.filename);
    assert.equal(existsSync(tarball), true, `packed tarball not found: ${tarball}`);

    const installResult = runNpm([
      'install', '--ignore-scripts', '--no-audit', '--no-fund', '--offline', tarball,
    ], { cwd: consumer });
    assertSuccess(installResult, 'install exact tarball');
    assert.equal(existsSync(linkedBinPath(consumer)), true, 'npm did not link the declared binary');

    const versionResult = runLinkedBin(consumer, ['--version']);
    assertSuccess(versionResult, 'installed --version');
    assert.equal(versionResult.stdout.trim(), packageJson.version);
    assert.equal(versionResult.stderr, '');

    const planResult = runLinkedBin(consumer, [
      'plan', '--target', target, '--profile', 'full', '--json',
    ]);
    const plan = parseJsonOutput(planResult, 'installed plan');
    assert.equal(plan.command, 'plan');
    assert.equal(plan.profile, 'full');
    assert.equal(plan.conflicts.length, 0);
    assert.ok(plan.changes.some((change) => change.path === 'harness-scripts/validate-harness.mjs'));
    assert.ok(plan.changes.some((change) => change.path === '.github/skills/build-harness/SKILL.md'));
    assert.equal(existsSync(resolve(target, 'AGENTS.md')), false, 'plan mutated the target');

    const initResult = runLinkedBin(consumer, [
      'init', '--target', target, '--profile', 'full', '--yes', '--json',
    ]);
    const initialized = parseJsonOutput(initResult, 'installed init --yes');
    assert.equal(initialized.command, 'init');
    assert.equal(initialized.profile, 'full');
    assert.equal(initialized.applied, true);
    assert.equal(initialized.manifest, 'harness/installation.yml');
    assert.equal(existsSync(resolve(target, 'harness', 'installation.yml')), true);
    assert.equal(existsSync(resolve(target, 'harness-scripts', 'validate-harness.mjs')), true);
    assert.equal(existsSync(resolve(target, '.github/skills/build-harness/SKILL.md')), true);

    const idempotentUpdate = runLinkedBin(consumer, [
      'update', '--target', target, '--profile', 'full', '--yes', '--json',
    ]);
    assert.equal(parseJsonOutput(idempotentUpdate, 'installed idempotent update').applied, true);

    writeFileSync(resolve(target, '.github/skills/build-harness/SKILL.md'), 'local edit\n');
    const conflictResult = runLinkedBin(consumer, [
      'update', '--target', target, '--profile', 'full', '--yes', '--json',
    ]);
    assert.equal(conflictResult.status, 1);
    const conflict = JSON.parse(conflictResult.stdout);
    assert.match(conflict.conflicts.map((item) => item.reason).join('\n'), /locally modified/);
    assert.equal(readFileSync(resolve(target, '.github/skills/build-harness/SKILL.md'), 'utf8'), 'local edit\n');

    const statusResult = runLinkedBin(consumer, ['status', '--target', target, '--json']);
    assert.equal(statusResult.status, 1);
    assert.match(statusResult.stdout, /locally modified/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('local Git package infers the executable and forwards full-profile arguments', { timeout: 120_000 }, () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'starter-harness-git-package-'));
  const mirror = resolve(temporaryRoot, 'mirror');
  const target = resolve(temporaryRoot, 'target');
  try {
    mkdirSync(mirror);
    mkdirSync(target);
    stageMirror(mirror);
    for (const args of [
      ['init'],
      ['config', 'user.email', 'starter-harness@example.invalid'],
      ['config', 'user.name', 'Starter Harness Test'],
      ['add', '-A'],
      ['commit', '-m', 'test: stage complete Git package'],
    ]) {
      assertSuccess(run('git', args, { cwd: mirror }), `git ${args.join(' ')}`);
    }

    const packageSpec = pathToFileURL(mirror).href.replace(/^file:/, 'git+file:');
    const versionResult = runNpx(['--yes', packageSpec, '--version'], { cwd: temporaryRoot });
    assertSuccess(versionResult, 'local Git package --version');
    assert.equal(versionResult.stdout.trim(), packageJson.version);
    assert.equal(versionResult.stderr, '');

    const planResult = runNpx([
      '--yes', packageSpec, 'plan', '--target', target, '--profile', 'full', '--json',
    ], { cwd: temporaryRoot });
    const plan = parseJsonOutput(planResult, 'local Git package full plan');
    assert.equal(plan.command, 'plan');
    assert.equal(plan.profile, 'full');
    assert.equal(plan.conflicts.length, 0);
    assert.ok(plan.changes.some((change) => change.path === '.github/workflows/validate.yml'));
    assert.ok(plan.changes.some((change) => change.path === '.github/skills/build-harness/SKILL.md'));
    assert.equal(existsSync(resolve(target, 'AGENTS.md')), false, 'plan mutated the target');

    const initResult = runNpx([
      '--yes', packageSpec, 'init', '--target', target, '--profile', 'full', '--yes', '--json',
    ], { cwd: temporaryRoot });
    const initialized = parseJsonOutput(initResult, 'local Git package full init');
    assert.equal(initialized.profile, 'full');
    assert.equal(initialized.applied, true);
    assert.equal(existsSync(resolve(target, '.github/skills/build-harness/SKILL.md')), true);
    assert.equal(existsSync(resolve(target, '.github/agents/harness-builder.agent.md')), true);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('mirror workflow covers package triggers, copy, boundary gate, and credential scope', () => {
  const workflow = readFileSync(resolve(REPO_ROOT, '.github/workflows/sync-starter-kit.yml'), 'utf8');
  assert.match(workflow, /- 'package\.json'/);
  assert.match(workflow, /- 'installer\/\*\*'/);
  assert.match(workflow, /rsync -a --delete source\/installer\/ target\/installer\//);
  assert.match(workflow, /source\/package\.json target\//);
  assert.match(workflow, /complete Git package/);
  assert.match(workflow, /Contents: read\/write/);
  assert.match(workflow, /Workflows: read\/write/);
  assert.match(workflow, /source\/\.github\/workflows\/validate\.yml/);
  assert.match(workflow, /source\/\.githooks\/pre-commit/);
  assert.match(workflow, /source\/\.github\/hooks\/hooks\.json/);
  assert.doesNotMatch(workflow, /metadata-only/);

  const boundaryIndex = workflow.indexOf('node tests/distribution.test.mjs --mirror-boundary');
  const validatorIndex = workflow.indexOf('node harness-scripts/validate-harness.mjs');
  const commitIndex = workflow.indexOf('git commit -m');
  assert.ok(boundaryIndex > workflow.indexOf('Seed tracking files'));
  assert.ok(boundaryIndex < validatorIndex);
  assert.ok(validatorIndex < commitIndex);
});

test('adoption commands use the package semantic-version tag', () => {
  const adopting = readFileSync(resolve(REPO_ROOT, 'ADOPTING.md'), 'utf8');
  const readme = readFileSync(resolve(REPO_ROOT, 'README.md'), 'utf8');
  const hook = readFileSync(resolve(REPO_ROOT, '.githooks/pre-commit'), 'utf8');
  const expectedRef = `github:wtulloch/harness-starter-kit#v${packageJson.version}`;
  const expectedPattern = new RegExp(expectedRef.replaceAll('.', '\\.'));

  assert.match(adopting, expectedPattern);
  assert.match(readme, expectedPattern);
  assert.doesNotMatch(adopting, /TARGET-40-CHARACTER-COMMIT-SHA-AFTER-ACCEPTANCE/);
  assert.doesNotMatch(readme, /TARGET-40-CHARACTER-COMMIT-SHA-AFTER-ACCEPTANCE/);
  assert.equal(packageJson.scripts.version, 'node tools/sync-adoption-version.mjs && git add ADOPTING.md README.md');
  assert.equal(packageJson.scripts['version:docs:check'], 'node tools/sync-adoption-version.mjs --check');
  assert.match(hook, /\[ -f tools\/sync-adoption-version\.mjs \]/);
  assert.match(hook, /node tools\/sync-adoption-version\.mjs --check \|\| exit 1/);

  const checkResult = run(process.execPath, [resolve(REPO_ROOT, 'tools/sync-adoption-version.mjs'), '--check']);
  assertSuccess(checkResult, 'adoption version check');

  const fixture = mkdtempSync(join(tmpdir(), 'starter-harness-version-docs-'));
  try {
    writeFileSync(resolve(fixture, 'package.json'), '{"version":"1.2.3"}\n');
    writeFileSync(resolve(fixture, 'ADOPTING.md'), 'github:wtulloch/harness-starter-kit#v1.2.2\ngit checkout v1.2.2\n');
    writeFileSync(resolve(fixture, 'README.md'), 'github:wtulloch/harness-starter-kit#v1.2.2\n');

    const staleResult = run(process.execPath, [
      resolve(REPO_ROOT, 'tools/sync-adoption-version.mjs'), `--root=${fixture}`, '--check',
    ]);
    assert.equal(staleResult.status, 1);
    assert.match(staleResult.stderr, /ADOPTING\.md does not reference v1\.2\.3/);

    const updateResult = run(process.execPath, [
      resolve(REPO_ROOT, 'tools/sync-adoption-version.mjs'), `--root=${fixture}`,
    ]);
    assertSuccess(updateResult, 'adoption version update');
    assert.match(readFileSync(resolve(fixture, 'ADOPTING.md'), 'utf8'), /starter-kit#v1\.2\.3[\s\S]*git checkout v1\.2\.3/);
    assert.match(readFileSync(resolve(fixture, 'README.md'), 'utf8'), /starter-kit#v1\.2\.3/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('mirror workflow retains no retired prompt-adapter references', () => {
  const workflow = readFileSync(resolve(REPO_ROOT, '.github/workflows/sync-starter-kit.yml'), 'utf8');
  assert.doesNotMatch(workflow, /\.github\/prompts/, 'workflow metadata or sync command still references .github/prompts');
  assert.doesNotMatch(workflow, /\.prompt\.md/, 'workflow trigger still watches a retired prompt file');
});

test('mirror workflow smoke uses the resulting target SHA for read-only all-profile plans', () => {
  const workflow = readFileSync(resolve(REPO_ROOT, '.github/workflows/sync-starter-kit.yml'), 'utf8');
  const pushStep = workflow.match(/- name: Commit and push if changed[\s\S]*?(?=\n      - name:)/)?.[0] ?? '';
  const smokeStep = workflow.match(/- name: Smoke test pinned GitHub package[\s\S]*$/)?.[0] ?? '';

  assert.match(pushStep, /id: sync-target/);
  assert.match(pushStep, /version="\$\(node -p "require\('\.\/package\.json'\)\.version"\)"/);
  assert.match(pushStep, /tag="v\$\{version\}"/);
  assert.match(pushStep, /git fetch --force --tags origin/);
  assert.match(pushStep, /git rev-list -n 1 "\$tag"/);
  assert.match(pushStep, /Tag \$tag already points to another commit/);
  assert.match(pushStep, /git push --atomic origin HEAD:main "\$tag"/);
  assert.match(pushStep, /target_sha="\$\(git rev-parse HEAD\)"/);
  assert.match(pushStep, /echo "target_sha=\$target_sha" >> "\$GITHUB_OUTPUT"/);
  assert.match(smokeStep, /TARGET_SHA: \$\{\{ steps\.sync-target\.outputs\.target_sha \}\}/);
  assert.match(smokeStep, /package="github:wtulloch\/harness-starter-kit#\$\{TARGET_SHA\}"/);
  assert.match(smokeStep, /npx --yes "\$package" --version/);
  assert.match(smokeStep, /for profile in doc-only standard full; do/);
  assert.match(smokeStep, /smoke_root="\$\(mktemp -d\)"/);
  assert.match(smokeStep, /target="\$smoke_root\/\$profile"/);
  assert.match(smokeStep, /npx --yes "\$package" plan --target "\$target" --profile "\$profile" --json/);
  assert.match(smokeStep, /test -z "\$\(find "\$target" -mindepth 1 -print -quit\)"/);
  assert.doesNotMatch(smokeStep, /\b(?:init|apply)\b/);
});

test('workflow-equivalent staged mirror is a complete, valid Git package', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'starter-harness-mirror-'));
  try {
    stageMirror(temporaryRoot);
    const versionResult = run(process.execPath, [resolve(temporaryRoot, 'installer/cli.mjs'), '--version'], {
      cwd: temporaryRoot,
    });
    assertSuccess(versionResult, 'staged mirror --version');
    assert.equal(versionResult.stdout.trim(), packageJson.version);
    assert.equal(versionResult.stderr, '');

    const boundaryResult = run(process.execPath, [
      resolve(temporaryRoot, 'tests/distribution.test.mjs'), '--mirror-boundary',
    ], { cwd: temporaryRoot });
    assertSuccess(boundaryResult, 'target-local mirror boundary');
    assert.equal(boundaryResult.stdout, 'MIRROR_PACKAGE_STATUS=complete\n');
    assert.equal(boundaryResult.stderr, '');

    const boundary = mirrorPackageBoundary(temporaryRoot);
    assert.deepEqual(boundary.missingSources, []);
    assert.equal(boundary.functionalChecksPassed, true);

    const validatorResult = runMirrorValidator(temporaryRoot);
    assertSuccess(validatorResult, 'staged mirror validator');
    assert.equal(validatorResult.stdout, '');
    assert.equal(validatorResult.stderr, '');
    assert.equal(existsSync(resolve(
      temporaryRoot,
      '.github/skills/scaffold-harness/references/adoption-profiles.json',
    )), true, 'mirror validator did not restore the canonical catalog');
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('mirror boundary rejects missing modules and any missing catalog source', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'starter-harness-mirror-negative-'));
  try {
    stageMirror(temporaryRoot);
    rmSync(resolve(temporaryRoot, 'installer/lib/app.mjs'));
    assert.throws(
      () => mirrorPackageBoundary(temporaryRoot),
      /mirror package is missing installer[\\/]lib[\\/]app\.mjs/,
    );

    copyDirectory(resolve(REPO_ROOT, 'installer'), resolve(temporaryRoot, 'installer'));
    rmSync(resolve(temporaryRoot, '.github/workflows/validate.yml'));
    assert.throws(
      () => mirrorPackageBoundary(temporaryRoot),
      /mirror package status is metadata-only/,
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
}