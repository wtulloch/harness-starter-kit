import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { loadCatalog, PACKAGE_ROOT, profileArtifacts, sha256 } from './catalog.mjs';
import { managedBlock, projectValues, renderTemplate, sentinelState } from './templates.mjs';

export const INSTALLATION_PATH = 'harness/installation.yml';
const PROFILE_ORDER = ['doc-only', 'standard', 'full'];

function safeTarget(root, relativePath) {
  const target = resolve(root, relativePath);
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Target path escapes repository: ${relativePath}`);
  let cursor = target;
  while (cursor !== root && !existsSync(cursor)) cursor = dirname(cursor);
  if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error(`Target path crosses a symlink: ${relativePath}`);
  return target;
}

function readOptional(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function parseInstallation(target) {
  const path = safeTarget(target, INSTALLATION_PATH);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    const value = JSON.parse(raw);
    if (value.schemaVersion !== 1 || !value.profile || !Array.isArray(value.artifacts)) throw new Error('unsupported shape');
    Object.defineProperty(value, 'fileHash', { value: sha256(raw), enumerable: false });
    return value;
  } catch (error) {
    throw new Error(`Invalid ${INSTALLATION_PATH}: ${error.message}`);
  }
}

function detectTools(target) {
  let names = [];
  try { names = readdirSync(target); } catch { return []; }
  const found = new Map();
  const add = (name, check, required) => found.set(name, { name, check, required });
  if (names.includes('package.json')) {
    add('node', ['node', '--version'], true);
    add('npm', ['npm', '--version'], false);
    if (names.includes('pnpm-lock.yaml')) add('pnpm', ['pnpm', '--version'], false);
    if (names.includes('yarn.lock')) add('yarn', ['yarn', '--version'], false);
  }
  if (names.some((name) => name === 'pyproject.toml' || name === 'requirements.txt')) add('python', ['python', '--version'], true);
  if (names.includes('go.mod')) add('go', ['go', 'version'], true);
  if (names.includes('Cargo.toml')) add('cargo', ['cargo', '--version'], true);
  if (names.some((name) => name === 'pom.xml' || name === 'build.gradle')) add('java', ['java', '-version'], true);
  if (names.includes('pom.xml')) add('mvn', ['mvn', '--version'], false);
  if (names.includes('build.gradle')) add('gradle', ['gradle', '--version'], false);
  if (names.some((name) => /\.(csproj|sln)$/.test(name))) add('dotnet', ['dotnet', '--version'], true);
  return [...found.values()];
}

function appendDoctorTools(text, tools) {
  const have = new Set([...text.matchAll(/^\s*- name:\s*(.+?)\s*$/gm)].map((match) => match[1]));
  const additions = tools.filter((tool) => !have.has(tool.name)).map((tool) =>
    `  - name: ${tool.name}\n    check: ${JSON.stringify(tool.check)}\n    required: ${tool.required}`);
  if (additions.length === 0) return text;
  return text.replace(/\s*$/, '\n') + additions.join('\n') + '\n';
}

function planAgents({ id, target, source, values, installedRecord, conflicts }) {
  const agentsPath = safeTarget(target, 'AGENTS.md');
  const legacyPath = safeTarget(target, '.github/copilot-instructions.md');
  const current = readOptional(agentsPath);
  const legacy = readOptional(legacyPath);
  const rendered = renderTemplate(source, values);
  const block = managedBlock(rendered);
  let desired;
  if (current === null) {
    desired = legacy === null
      ? rendered
      : `# AGENTS.md\n\n## Migrated project guidance\n\n${legacy.trim()}\n\n${block}\n`;
  } else {
    const state = sentinelState(current);
    if (state.kind === 'malformed') {
      conflicts.push({ path: 'AGENTS.md', reason: 'managed block sentinels are malformed or duplicated' });
      return [];
    }
    if (state.kind === 'present' && installedRecord?.installedHash && sha256(state.block) !== installedRecord.installedHash && state.block !== block) {
      conflicts.push({ path: 'AGENTS.md', reason: 'managed block was locally modified' });
      return [];
    }
    const migrated = legacy === null ? '' : `## Migrated project guidance\n\n${legacy.trim()}\n\n`;
    desired = state.kind === 'present'
      ? current.slice(0, state.begin) + migrated + block + current.slice(state.end)
      : current.replace(/\s*$/, '\n\n') + migrated + block + '\n';
  }
  const operations = [{ id, type: current === desired ? 'noop' : 'write', path: 'AGENTS.md', content: desired, ownership: 'managed-block', sourceHash: sha256(source), installedHash: sha256(block), expectedHash: current === null ? null : sha256(current) }];
  if (legacy !== null) operations.push({ type: 'delete', path: '.github/copilot-instructions.md', ownership: 'migration', expectedHash: sha256(legacy) });
  return operations;
}

export function createPlan(options) {
  const target = resolve(options.target);
  const { catalog, hash: catalogHash } = loadCatalog();
  const installation = parseInstallation(target);
  const command = options.command ?? 'plan';
  const profile = options.profile ?? installation?.profile ?? catalog.defaultProfile;
  if (!catalog.profiles[profile]) throw new Error(`Unknown profile: ${profile}`);
  if (command === 'init' && installation) throw new Error('An installation manifest already exists; use update');
  if (command === 'update' && !installation) throw new Error('No installation manifest exists; use init');
  if (installation && PROFILE_ORDER.indexOf(profile) < PROFILE_ORDER.indexOf(installation.profile)) {
    throw new Error(`Profile downgrade from ${installation.profile} to ${profile} is not supported`);
  }

  const artifacts = profileArtifacts(catalog, profile);
  const conflicts = [];
  const operations = [];
  const values = projectValues(target, options);
  const installedById = new Map((installation?.artifacts ?? []).map((item) => [item.id, item]));
  const activeIds = new Set(artifacts.map((artifact) => artifact.id));

  for (const installedRecord of installation?.artifacts ?? []) {
    const retired = catalog.retiredArtifacts?.[installedRecord.id];
    if (activeIds.has(installedRecord.id) || !retired) continue;
    if (installedRecord.ownership !== 'managed-file' || installedRecord.path !== retired.target) {
      conflicts.push({ path: installedRecord.path, reason: `retired artifact ${installedRecord.id} has inconsistent ownership metadata` });
      continue;
    }
    const path = safeTarget(target, retired.target);
    const current = readOptional(path);
    if (current === null) {
      operations.push({ retiredId: installedRecord.id, type: 'noop', path: retired.target, ownership: 'retirement' });
      continue;
    }
    if (!installedRecord.installedHash || sha256(current) !== installedRecord.installedHash) {
      conflicts.push({ path: retired.target, reason: `retired managed file ${installedRecord.id} was locally modified` });
      operations.push({ retiredId: installedRecord.id, type: 'conflict', path: retired.target, ownership: 'retirement' });
      continue;
    }
    operations.push({
      retiredId: installedRecord.id,
      type: 'delete',
      path: retired.target,
      ownership: 'retirement',
      expectedHash: installedRecord.installedHash,
    });
  }

  for (const [group, groupIds] of Object.entries(catalog.atomicGroups ?? {})) {
    const selected = groupIds.every((id) => artifacts.some((artifact) => artifact.id === id));
    if (!selected) continue;
    const present = groupIds.filter((id) => existsSync(safeTarget(target, catalog.artifacts[id].target)));
    if (!installation && present.length > 0 && present.length < groupIds.length) {
      conflicts.push({ path: catalog.artifacts[present[0]].target, reason: `atomic group ${group} is partially present` });
    }
  }

  for (const artifact of artifacts) {
    const installedRecord = installedById.get(artifact.id);
    if (artifact.operation === 'reconcile-template') {
      const source = readFileSync(resolve(PACKAGE_ROOT, artifact.source), 'utf8');
      operations.push(...planAgents({ id: artifact.id, target, source, values, installedRecord, conflicts }));
      continue;
    }
    const path = safeTarget(target, artifact.target);
    const current = readOptional(path);
    if (artifact.operation === 'append-lines') {
      const existingLines = new Set((current ?? '').split(/\r?\n/));
      const missing = artifact.lines.filter((line) => !existingLines.has(line));
      const content = missing.length === 0 ? current ?? '' : (current ?? '').replace(/\s*$/, '\n') + missing.join('\n') + '\n';
      operations.push({ id: artifact.id, type: missing.length === 0 ? 'noop' : 'write', path: artifact.target, content, ownership: 'append-lines', lines: artifact.lines, installedHash: sha256(content), expectedHash: current === null ? null : sha256(current) });
      continue;
    }

    const raw = readFileSync(resolve(PACKAGE_ROOT, artifact.source), 'utf8');
    let desired = artifact.operation === 'copy' ? raw : renderTemplate(raw, values);
    if (artifact.id === 'incident-log') desired = '';
    if (artifact.id === 'doctor-manifest') desired = appendDoctorTools(current ?? desired, detectTools(target));
    const ownership = artifact.operation === 'copy' ? 'managed-file' : 'seed-only';

    if (ownership === 'managed-file' && current !== null && current !== desired) {
      if (!installedRecord || sha256(current) !== installedRecord.installedHash) {
        conflicts.push({ path: artifact.target, reason: 'managed file exists with unowned or locally modified content' });
        operations.push({ id: artifact.id, type: 'conflict', path: artifact.target, ownership });
        continue;
      }
    }
    if (ownership === 'seed-only' && current !== null && artifact.id !== 'doctor-manifest') {
      operations.push({ id: artifact.id, type: 'noop', path: artifact.target, ownership, sourceHash: sha256(raw), installedHash: sha256(current) });
      continue;
    }
    operations.push({
      id: artifact.id, type: current === desired ? 'noop' : 'write', path: artifact.target, content: desired,
      ownership, sourceHash: sha256(raw), installedHash: sha256(desired),
      expectedHash: current === null ? null : sha256(current),
    });
  }

  return {
    schemaVersion: 1,
    command,
    target,
    profile,
    catalogHash,
    baseline: installation?.baseline ?? existsSync(safeTarget(target, 'AGENTS.md')),
    values,
    operations,
    conflicts,
    installation,
  };
}