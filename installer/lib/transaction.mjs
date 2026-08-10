import {
  chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256 } from './catalog.mjs';

function currentHash(path) {
  return existsSync(path) ? sha256(readFileSync(path)) : null;
}

function restore(snapshots, root) {
  for (const snapshot of [...snapshots].reverse()) {
    if (!snapshot.existed) {
      rmSync(snapshot.path, { force: true });
      let directory = dirname(snapshot.path);
      while (directory !== root) {
        try { rmdirSync(directory); } catch { break; }
        directory = dirname(directory);
      }
      continue;
    }
    mkdirSync(dirname(snapshot.path), { recursive: true });
    writeFileSync(snapshot.path, snapshot.content);
    chmodSync(snapshot.path, snapshot.mode);
  }
}

export function executePlan(plan, manifestText, { dryRun = false, failAfter = Infinity } = {}) {
  if (plan.conflicts.length > 0) throw new Error(`Cannot apply a plan with ${plan.conflicts.length} conflict(s)`);
  if (dryRun) return { changed: false, rollback() {} };

  const operations = [
    ...plan.operations.filter((operation) => operation.type === 'write' || operation.type === 'delete'),
    {
      type: 'write', path: 'harness/installation.yml', content: manifestText,
      expectedHash: plan.installation?.fileHash ?? null,
    },
  ];
  const snapshots = [];
  const temporary = [];
  let applied = 0;

  try {
    for (const operation of operations) {
      const path = resolve(plan.target, operation.path);
      if (currentHash(path) !== (operation.expectedHash ?? null)) {
        throw new Error(`Target changed after planning: ${operation.path}`);
      }
      snapshots.push({
        path,
        existed: existsSync(path),
        content: existsSync(path) ? readFileSync(path) : null,
        mode: existsSync(path) ? statSync(path).mode : null,
      });
      if (operation.type === 'delete') {
        rmSync(path, { force: true });
      } else {
        mkdirSync(dirname(path), { recursive: true });
        const temp = `${path}.starter-harness-${randomUUID()}.tmp`;
        temporary.push(temp);
        writeFileSync(temp, operation.content);
        renameSync(temp, path);
      }
      applied += 1;
      if (applied >= failAfter) throw new Error('Injected transaction failure');
    }
  } catch (error) {
    for (const path of temporary) rmSync(path, { force: true });
    restore(snapshots, plan.target);
    throw error;
  }

  return {
    changed: operations.length > 1,
    rollback() { restore(snapshots, plan.target); },
  };
}