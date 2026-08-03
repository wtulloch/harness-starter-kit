#!/usr/bin/env node
// harness.mjs — command-verb dispatcher for the optional executable layer.
//
// Thin sugar over the argument-less Layer 1/3 scripts. Raw `node harness-scripts/<file>.mjs`
// calls remain the fail-open / local == CI source of truth; this only maps a verb to
// the matching script and forwards argv, preserving the child's exit code. Node
// built-ins only — no npm install.
//
//   node harness-scripts/harness.mjs validate
//   node harness-scripts/harness.mjs heal
//   node harness-scripts/harness.mjs session-start
//   node harness-scripts/harness.mjs session-end
//   node harness-scripts/harness.mjs backpressure-stats
//   node harness-scripts/harness.mjs doctor
//   node harness-scripts/harness.mjs guard
//
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERBS = {
  validate: 'validate-harness.mjs',
  heal: 'heal-harness.mjs',
  'session-start': 'session-start.mjs',
  'session-end': 'session-end.mjs',
  'backpressure-stats': 'backpressure-stats.mjs',
  doctor: 'doctor.mjs',
  guard: 'guard.mjs',
};

const [verb, ...rest] = process.argv.slice(2);

if (!verb || verb === '--help' || verb === '-h' || verb === 'help') {
  console.log('Usage: node harness-scripts/harness.mjs <verb> [args]\n\nVerbs:');
  for (const v of Object.keys(VERBS)) console.log(`  ${v}`);
  process.exit(verb ? 0 : 1);
}

const target = VERBS[verb];
if (!target) {
  console.error(`Unknown verb: ${verb}. Run "node harness-scripts/harness.mjs --help".`);
  process.exit(1);
}

const r = spawnSync(process.execPath, [resolve(HERE, target), ...rest], { stdio: 'inherit' });
process.exit(r.status ?? 0);
