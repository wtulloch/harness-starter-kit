import { basename } from 'node:path';

export const BEGIN_SENTINEL = '<!-- HARNESS:BEGIN (managed by scaffold-harness — edits inside are overwritten) -->';
export const END_SENTINEL = '<!-- HARNESS:END -->';

export function stripTemplateHeader(text) {
  return text.split(/\r?\n/)
    .filter((line) => !/^\s*\{\{!.*\}\}\s*$/.test(line))
    .join('\n');
}

export function projectValues(target, options = {}) {
  const inferredSlug = basename(target).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  const slug = options.projectSlug ?? inferredSlug;
  const name = options.projectName ?? slug.split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  const date = new Date().toISOString().slice(0, 10);
  return { slug, name, date };
}

export function renderTemplate(text, values) {
  const replacements = {
    'project-name': values.name,
    'project-slug': values.slug,
    'kebab-case-identifier': values.slug,
    'Human-readable project name': values.name,
    'YYYY-MM-DD': values.date,
    'session-label': 'initial harness setup',
    'phase': 'scaffold',
    'current phase': 'scaffold',
    'first phase': 'scaffold',
    'current step': 'initial harness setup',
    'initiative': values.name,
    'branch': 'current branch',
    'path': 'AGENTS.md',
    'path/': 'src/',
    'purpose': 'project source',
    'install command': 'project-specific',
    'other setup steps': 'Add project-specific setup steps.',
    'build command': 'project-specific',
    'lint command': 'project-specific',
    'test command': 'project-specific',
    'check command': 'project-specific',
    'One or two sentences on the active task.': 'Establish and tailor the engineering harness.',
    'recently completed item': 'Harness initialized',
    'in-flight item': 'Tailor project-specific guidance',
    'next step': 'Review and tailor generated guidance',
    'blocker or "None open."': 'None open.',
    'feature title': 'Tailor the starter harness',
    'owner': 'team',
    'acceptance criterion': 'Project-specific harness guidance is complete',
    'workspace-relative path': 'AGENTS.md',
    'optional notes': '',
  };
  return stripTemplateHeader(text).replace(/\{\{([^}]+)\}\}/g, (_match, key) => replacements[key] ?? 'TBD');
}

export function managedBlock(renderedAgents) {
  const begin = renderedAgents.indexOf(BEGIN_SENTINEL);
  const end = renderedAgents.indexOf(END_SENTINEL);
  if (begin === -1 || end < begin) throw new Error('AGENTS.md template has no valid managed block');
  return renderedAgents.slice(begin, end + END_SENTINEL.length);
}

export function sentinelState(text) {
  const begins = text.split(BEGIN_SENTINEL).length - 1;
  const ends = text.split(END_SENTINEL).length - 1;
  if (begins === 0 && ends === 0) return { kind: 'absent' };
  if (begins !== 1 || ends !== 1) return { kind: 'malformed' };
  const begin = text.indexOf(BEGIN_SENTINEL);
  const end = text.indexOf(END_SENTINEL);
  if (end < begin) return { kind: 'malformed' };
  return { kind: 'present', begin, end: end + END_SENTINEL.length, block: text.slice(begin, end + END_SENTINEL.length) };
}