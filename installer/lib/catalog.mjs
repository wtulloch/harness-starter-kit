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

function isContained(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function loadCatalog() {
  const raw = readFileSync(CATALOG_PATH, 'utf8');
  const catalog = JSON.parse(raw);
  const errors = [];
  if (catalog.schemaVersion !== 1) errors.push('unsupported catalog schema');
  if (!catalog.profiles?.[catalog.defaultProfile]) errors.push('invalid default profile');

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
      const target = resolve(PACKAGE_ROOT, artifact.target);
      if (!isContained(PACKAGE_ROOT, target)) errors.push(`artifact ${id} target escapes package root`);
      if (artifact.source && !existsSync(resolve(PACKAGE_ROOT, artifact.source))) {
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
  if (errors.length > 0) throw new Error(`Invalid adoption profile catalog: ${errors.join('; ')}`);
  return { catalog, raw, hash: sha256(raw) };
}

export function profileArtifacts(catalog, profile) {
  const ids = catalog.profiles[profile];
  if (!ids) throw new Error(`Unknown profile: ${profile}`);
  return ids.map((id) => ({ id, ...catalog.artifacts[id] }));
}