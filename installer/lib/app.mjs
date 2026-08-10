import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createPlan, INSTALLATION_PATH } from './planner.mjs';
import { buildInstallation } from './manifest.mjs';
import { executePlan } from './transaction.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKAGE_VERSION = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')).version;

function planResult(plan) {
  return {
    command: plan.command,
    target: plan.target,
    profile: plan.profile,
    baseline: plan.baseline,
    changes: plan.operations.filter((operation) => operation.type !== 'noop').map((operation) => ({
      action: operation.type, path: operation.path, ownership: operation.ownership,
    })),
    conflicts: plan.conflicts,
  };
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`${result.command.toUpperCase()}: ${result.profile ?? 'installation'} at ${result.target}`);
  for (const change of result.changes ?? []) console.log(`  ${change.action.padEnd(7)} ${change.path}`);
  for (const conflict of result.conflicts ?? []) console.error(`CONFLICT: ${conflict.path} — ${conflict.reason}`);
}

async function confirm(options, result) {
  if (options.yes) return true;
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Confirmation required; rerun with --yes');
  printResult(result, false);
  const reader = createInterface({ input: stdin, output: stdout });
  const answer = await reader.question('Apply this plan? [y/N] ');
  reader.close();
  return /^y(es)?$/i.test(answer.trim());
}

function runTargetScript(target, script, args = []) {
  const result = spawnSync(process.execPath, [resolve(target, script), ...args], {
    cwd: target, encoding: 'utf8', shell: false,
  });
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function inspectInstallation(options) {
  const plan = createPlan({ ...options, command: 'status' });
  const drift = [
    ...plan.conflicts,
    ...plan.operations.filter((operation) => operation.type === 'write')
      .map((operation) => ({ path: operation.path, reason: 'owned content is missing or has an upstream update' })),
  ];
  return {
    command: 'status', target: plan.target, profile: plan.profile,
    installed: Boolean(plan.installation), clean: drift.length === 0, drift,
    changes: [], conflicts: drift,
  };
}

export async function run(options) {
  if (options.command === 'status') {
    const result = inspectInstallation(options);
    printResult(result, options.json);
    return result.clean ? 0 : 1;
  }
  if (options.command === 'validate' || options.command === 'doctor') {
    const status = inspectInstallation(options);
    if (!status.installed || !status.clean) {
      printResult(status, options.json);
      return 1;
    }
    if (status.profile === 'doc-only') {
      const result = { command: options.command, target: status.target, available: false, skipped: true, code: 0 };
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else console.log(`${options.command}: unavailable for doc-only profile; installer state is clean.`);
      return 0;
    }
    const script = options.command === 'validate' ? 'harness-scripts/validate-harness.mjs' : 'harness-scripts/doctor.mjs';
    const child = runTargetScript(status.target, script);
    if (options.json) console.log(JSON.stringify({ command: options.command, target: status.target, ...child }, null, 2));
    else {
      if (child.stdout) process.stdout.write(child.stdout);
      if (child.stderr) process.stderr.write(child.stderr);
    }
    return child.code;
  }

  const plan = createPlan(options);
  const result = planResult(plan);
  if (options.command === 'plan' || options.dryRun || plan.conflicts.length > 0) {
    printResult(result, options.json);
    return plan.conflicts.length > 0 ? 1 : 0;
  }
  if (!(await confirm(options, result))) return 1;

  const installation = buildInstallation(plan, PACKAGE_VERSION);
  const manifestText = JSON.stringify(installation, null, 2) + '\n';
  const transaction = executePlan(plan, manifestText);
  if (plan.profile !== 'doc-only') {
    const validation = runTargetScript(
      plan.target,
      'harness-scripts/validate-harness.mjs',
      plan.baseline ? ['--baseline'] : [],
    );
    if (validation.code !== 0) {
      transaction.rollback();
      throw new Error(`Post-install validation failed:\n${validation.stderr || validation.stdout}`);
    }
  }
  const applied = { ...result, command: options.command, manifest: INSTALLATION_PATH, applied: true };
  printResult(applied, options.json);
  return 0;
}