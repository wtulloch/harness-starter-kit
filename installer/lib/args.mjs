import { resolve } from 'node:path';

export const COMMANDS = new Set(['plan', 'init', 'update', 'status', 'validate', 'doctor']);
export const PROFILES = new Set(['doc-only', 'standard', 'full']);

const VALUE_FLAGS = new Map([
  ['--target', 'target'],
  ['--profile', 'profile'],
  ['--project-name', 'projectName'],
  ['--project-slug', 'projectSlug'],
]);
const BOOLEAN_FLAGS = new Map([
  ['--json', 'json'],
  ['--dry-run', 'dryRun'],
  ['--yes', 'yes'],
]);

export class UsageError extends Error {}

export function parseArgs(argv, cwd = process.cwd()) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    return { version: true };
  }

  const [command, ...tokens] = argv;
  if (!COMMANDS.has(command)) throw new UsageError(`Unknown command: ${command}`);

  const options = {
    command,
    target: resolve(cwd),
    profile: undefined,
    projectName: undefined,
    projectSlug: undefined,
    json: false,
    dryRun: false,
    yes: false,
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const booleanName = BOOLEAN_FLAGS.get(token);
    if (booleanName) {
      options[booleanName] = true;
      continue;
    }

    const [flag, inlineValue] = token.split('=', 2);
    const valueName = VALUE_FLAGS.get(flag);
    if (!valueName) throw new UsageError(`Unknown option: ${token}`);
    const value = inlineValue ?? tokens[++index];
    if (!value || value.startsWith('--')) throw new UsageError(`Missing value for ${flag}`);
    options[valueName] = valueName === 'target' ? resolve(cwd, value) : value;
  }

  if (options.profile && !PROFILES.has(options.profile)) {
    throw new UsageError(`Unknown profile: ${options.profile}`);
  }
  if (options.dryRun && !['plan', 'init', 'update'].includes(command)) {
    throw new UsageError(`--dry-run is not valid for ${command}`);
  }
  if (options.yes && !['init', 'update'].includes(command)) {
    throw new UsageError(`--yes is not valid for ${command}`);
  }
  if ((options.projectName || options.projectSlug) && !['plan', 'init'].includes(command)) {
    throw new UsageError(`Project options are not valid for ${command}`);
  }
  if (options.json && ['init', 'update'].includes(command) && !options.dryRun && !options.yes) {
    throw new UsageError('--json mutations require --yes or --dry-run');
  }

  return options;
}

export function usage() {
  return `Usage: starter-harness <command> [options]

Commands:
  plan      Preview a new installation
  init      Install a harness profile
  update    Update an existing installation
  status    Inspect installation ownership and drift
  validate  Validate installation and harness state
  doctor    Check declared target tooling

Options:
  --target <path>        Target repository (default: current directory)
  --profile <name>       doc-only, standard, or full
  --project-name <name>  Template project name (plan/init only)
  --project-slug <slug>  Template project slug (plan/init only)
  --dry-run              Preview mutation without writing
  --yes                  Apply without prompting
  --json                 Emit machine-readable output
  -h, --help             Show help
  -v, --version          Show package version`;
}