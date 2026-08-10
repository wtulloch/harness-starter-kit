#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, usage, UsageError } from './lib/args.mjs';
import { run } from './lib/app.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8'));

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
  } else if (options.version) {
    console.log(packageJson.version);
  } else {
    process.exitCode = await run(options);
  }
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`starter-harness: ${error.message}`);
    console.error('Run "starter-harness --help" for usage.');
    process.exitCode = 1;
  } else {
    console.error(`starter-harness: ${error.message}`);
    process.exitCode = 1;
  }
}