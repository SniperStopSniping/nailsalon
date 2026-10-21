import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HASH = /^[0-9a-f]{40}$/;

export class DependencyPairError extends Error {
  constructor(code) {
    super(`dependency_pair_${code}`);
    this.code = code;
  }
}

function fail(code) {
  throw new DependencyPairError(code);
}

export function parseRegistry(source) {
  let registry;
  try {
    registry = JSON.parse(source);
  } catch {
    fail('registry_json');
  }
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)
    || Object.keys(registry).length !== 2 || registry.schemaVersion !== 1 || !Array.isArray(registry.pairs)) {
    fail('registry_shape');
  }
  const pairs = new Set();
  for (const pair of registry.pairs) {
    if (!pair || typeof pair !== 'object' || Array.isArray(pair)
      || Object.keys(pair).length !== 2 || typeof pair.packageJson !== 'string'
      || typeof pair.packageLock !== 'string' || !HASH.test(pair.packageJson) || !HASH.test(pair.packageLock)) {
      fail('registry_pair');
    }
    const key = `${pair.packageJson}:${pair.packageLock}`;
    if (pairs.has(key)) {
      fail('registry_duplicate');
    }
    pairs.add(key);
  }
  if (pairs.size === 0) {
    fail('registry_empty');
  }
  return registry;
}

export function blobId(file, cwd = process.cwd()) {
  const result = spawnSync('git', ['hash-object', '--no-filters', file], { cwd, encoding: 'utf8' });
  if (result.status !== 0 || !HASH.test(result.stdout.trim())) {
    fail('blob');
  }
  return result.stdout.trim();
}

export function verifyDependencyPair({ cwd = process.cwd(), registryPath = 'scripts/reviewed-dependency-pairs.json' } = {}) {
  const registry = parseRegistry(readFileSync(resolve(cwd, registryPath), 'utf8'));
  const packageJson = blobId('package.json', cwd);
  const packageLock = blobId('package-lock.json', cwd);
  if (!registry.pairs.some(pair => pair.packageJson === packageJson && pair.packageLock === packageLock)) {
    fail('unreviewed');
  }
  return { packageJson, packageLock, registry };
}

if (import.meta.main) {
  try {
    const result = verifyDependencyPair();
    process.stdout.write(`Reviewed dependency pair: ${result.packageJson}:${result.packageLock}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
