import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CATALOG_PATH = resolve(
  PACKAGE_ROOT,
  '.github/skills/scaffold-harness/references/adoption-profiles.json',
);

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const HOSTS = new Set(['shared', 'vscode', 'copilot-cli']);
const CAPABILITIES = new Set([
  'harness-core',
  'executable-layer',
  'generator-core',
  'generator-vscode-adapter',
  'hook-adapter',
]);
const GENERATOR_SKILL = '.github/skills/build-harness/SKILL.md';

function isContained(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function validateCatalog(catalog, packageRoot = PACKAGE_ROOT) {
  const errors = [];
  if (catalog.schemaVersion !== 1) errors.push('unsupported catalog schema');
  if (!catalog.profiles?.[catalog.defaultProfile]) errors.push('invalid default profile');

  for (const [id, artifact] of Object.entries(catalog.artifacts ?? {})) {
    if (!Array.isArray(artifact.hosts) || artifact.hosts.length === 0) {
      errors.push(`artifact ${id} has invalid hosts`);
    } else {
      if (new Set(artifact.hosts).size !== artifact.hosts.length) errors.push(`artifact ${id} has duplicate hosts`);
      for (const host of artifact.hosts) {
        if (!HOSTS.has(host)) errors.push(`artifact ${id} has unknown host ${host}`);
      }
    }
    if (!CAPABILITIES.has(artifact.capability)) {
      errors.push(`artifact ${id} has unknown capability ${artifact.capability}`);
    }
  }

  for (const [name, ids] of Object.entries(catalog.profiles ?? {})) {
    if (!Array.isArray(ids)) {
      errors.push(`profile ${name} is not an array`);
      continue;
    }
    for (const id of ids) {
      const artifact = catalog.artifacts?.[id];
      if (!artifact) {
        errors.push(`profile ${name} references unknown artifact ${id}`);
        continue;
      }
      const target = resolve(packageRoot, artifact.target);
      if (!isContained(packageRoot, target)) errors.push(`artifact ${id} target escapes package root`);
      if (artifact.source && !existsSync(resolve(packageRoot, artifact.source))) {
        errors.push(`artifact ${id} source is missing`);
      }
    }
  }

  const order = ['doc-only', 'standard', 'full'];
  for (let index = 1; index < order.length; index += 1) {
    const previous = new Set(catalog.profiles?.[order[index - 1]] ?? []);
    const current = new Set(catalog.profiles?.[order[index]] ?? []);
    if ([...previous].some((id) => !current.has(id))) errors.push('profiles are not cumulative');
  }
  for (const [groupName, groupIds] of Object.entries(catalog.atomicGroups ?? {})) {
    for (const [profile, ids] of Object.entries(catalog.profiles ?? {})) {
      const count = groupIds.filter((id) => ids.includes(id)).length;
      if (count !== 0 && count !== groupIds.length) errors.push(`${profile} splits atomic group ${groupName}`);
    }
  }
  const allArtifactIds = Object.keys(catalog.artifacts ?? {});
  const fullIds = new Set(catalog.profiles?.full ?? []);
  if (allArtifactIds.some((id) => !fullIds.has(id)) || fullIds.size !== allArtifactIds.length) {
    errors.push('full profile is not the artifact union');
  }
  const generatorCoreIds = allArtifactIds.filter(
    (id) => catalog.artifacts[id].capability === 'generator-core',
  );
  const generatorSkillId = generatorCoreIds.find(
    (id) => catalog.artifacts[id].target === GENERATOR_SKILL,
  );
  if (!generatorSkillId) errors.push(`generator core is missing ${GENERATOR_SKILL}`);
  if (generatorSkillId && !(catalog.atomicGroups?.['generator-bootstrap'] ?? []).includes(generatorSkillId)) {
    errors.push(`generator bootstrap is missing ${GENERATOR_SKILL}`);
  }
  if (generatorCoreIds.some((id) => !fullIds.has(id))) errors.push('full profile omits generator core');
  if (generatorCoreIds.some((id) => (catalog.profiles?.standard ?? []).includes(id))) {
    errors.push('standard profile includes generator core');
  }
  const activeIds = new Set(Object.keys(catalog.artifacts ?? {}));
  const activeTargets = new Set(Object.values(catalog.artifacts ?? {}).map((artifact) => artifact.target));
  const retiredTargets = new Set();
  for (const [id, artifact] of Object.entries(catalog.retiredArtifacts ?? {})) {
    if (activeIds.has(id)) errors.push(`retired artifact ${id} is still active`);
    if (!artifact?.target || artifact.ownership !== 'managed-file') {
      errors.push(`retired artifact ${id} has invalid metadata`);
      continue;
    }
    const target = resolve(packageRoot, artifact.target);
    if (!isContained(packageRoot, target)) errors.push(`retired artifact ${id} target escapes package root`);
    if (activeTargets.has(artifact.target)) errors.push(`retired artifact ${id} target is still active`);
    if (retiredTargets.has(artifact.target)) errors.push(`retired artifact target ${artifact.target} is duplicated`);
    retiredTargets.add(artifact.target);
  }
  if (errors.length > 0) throw new Error(`Invalid adoption profile catalog: ${errors.join('; ')}`);
  return catalog;
}

export function loadCatalog() {
  const raw = readFileSync(CATALOG_PATH, 'utf8');
  const catalog = validateCatalog(JSON.parse(raw));
  return { catalog, raw, hash: sha256(raw) };
}

export function profileArtifacts(catalog, profile) {
  const ids = catalog.profiles[profile];
  if (!ids) throw new Error(`Unknown profile: ${profile}`);
  return ids.map((id) => ({ id, ...catalog.artifacts[id] }));
}