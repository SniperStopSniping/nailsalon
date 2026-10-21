import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { blobId, parseRegistry } from './verify-dependency-pair.mjs';

const REGISTRY = 'scripts/reviewed-dependency-pairs.json';
const ALLOWED_DIRTY = new Set(['CHANGELOG.md', 'package.json', 'package-lock.json', REGISTRY]);

export class ReleasePairError extends Error {
  constructor(code) {
    super(`release_dependency_pair_${code}`);
    this.code = code;
  }
}

function fail(code) {
  throw new ReleasePairError(code);
}

function git(args, cwd, encoding = 'utf8') {
  const result = spawnSync('git', args, { cwd, encoding, maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) {
    fail(`git_${args[0]}`);
  }
  return result.stdout;
}

function fromHead(path, cwd) {
  return git(['show', `HEAD:${path}`], cwd);
}

function parseJson(source, code) {
  try {
    return JSON.parse(source);
  } catch {
    fail(code);
  }
}

function rootVersions(manifest, lock, code) {
  const lockRoot = lock?.packages?.[''];
  if (!manifest || typeof manifest.version !== 'string' || !lock || typeof lock.version !== 'string'
    || !lockRoot || typeof lockRoot.version !== 'string') {
    fail(code);
  }
  return [manifest.version, lock.version, lockRoot.version];
}

function versionOnlyChange(oldManifest, oldLock, nextManifest, nextLock, nextVersion) {
  const oldVersions = rootVersions(oldManifest, oldLock, 'old_versions');
  const nextVersions = rootVersions(nextManifest, nextLock, 'next_versions');
  if (new Set(oldVersions).size !== 1 || new Set(nextVersions).size !== 1 || nextVersions[0] !== nextVersion) {
    fail('version_values');
  }
  const oldCopy = structuredClone({ manifest: oldManifest, lock: oldLock });
  const nextCopy = structuredClone({ manifest: nextManifest, lock: nextLock });
  delete oldCopy.manifest.version;
  delete oldCopy.lock.version;
  delete oldCopy.lock.packages[''].version;
  delete nextCopy.manifest.version;
  delete nextCopy.lock.version;
  delete nextCopy.lock.packages[''].version;
  if (!isDeepStrictEqual(oldCopy, nextCopy)) {
    fail('non_version_mutation');
  }
}

function assertReleaseWorkspace(cwd) {
  const status = git(['status', '--porcelain=v1', '--untracked-files=all'], cwd);
  if (status.length === 0) {
    return;
  }
  for (const line of status.trimEnd().split('\n')) {
    const index = line.slice(0, 1);
    const worktree = line.slice(1, 2);
    const path = line.slice(3).replace(/^.* -> /, '');
    if (index !== ' ' || worktree !== 'M' || !ALLOWED_DIRTY.has(path)) {
      fail('workspace_dirty');
    }
  }
}

function registryState(headRegistry, currentRegistry, candidate) {
  const head = parseRegistry(headRegistry);
  parseRegistry(currentRegistry);
  const alreadyReviewed = head.pairs.some(pair => pair.packageJson === candidate.packageJson && pair.packageLock === candidate.packageLock);
  if (alreadyReviewed && currentRegistry === headRegistry) {
    return 'noop';
  }
  const expected = { schemaVersion: 1, pairs: [...head.pairs, candidate] };
  if (currentRegistry === headRegistry) {
    return 'append';
  }
  if (currentRegistry === `${JSON.stringify(expected, null, 2)}\n`) {
    return 'noop';
  }
  fail('registry_modified');
}

function atomicWrite(path, contents) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, path);
}

function assertRegistrationCodeMatchesHead(cwd) {
  for (const path of ['scripts/register-release-dependency-pair.mjs', 'scripts/verify-dependency-pair.mjs']) {
    const diff = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', path], { cwd });
    if (diff.status !== 0) {
      fail('registration_code_modified');
    }
  }
}

export async function prepare(_pluginConfig = {}, context = {}) {
  const cwd = context.cwd ?? process.cwd();
  const nextVersion = context.nextRelease?.version;
  if (typeof nextVersion !== 'string' || nextVersion.length === 0) {
    fail('next_version');
  }
  assertReleaseWorkspace(cwd);
  assertRegistrationCodeMatchesHead(cwd);

  const oldManifest = parseJson(fromHead('package.json', cwd), 'old_package_json');
  const oldLock = parseJson(fromHead('package-lock.json', cwd), 'old_package_lock');
  const nextManifest = parseJson(readFileSync(resolve(cwd, 'package.json'), 'utf8'), 'next_package_json');
  const nextLock = parseJson(readFileSync(resolve(cwd, 'package-lock.json'), 'utf8'), 'next_package_lock');
  versionOnlyChange(oldManifest, oldLock, nextManifest, nextLock, nextVersion);

  const headRegistry = fromHead(REGISTRY, cwd);
  const head = parseRegistry(headRegistry);
  const oldPackageJson = git(['rev-parse', 'HEAD:package.json'], cwd).trim();
  const oldPackageLock = git(['rev-parse', 'HEAD:package-lock.json'], cwd).trim();
  if (!head.pairs.some(pair => pair.packageJson === oldPackageJson && pair.packageLock === oldPackageLock)) {
    fail('unreviewed_head');
  }
  const registryPath = resolve(cwd, REGISTRY);
  const candidate = { packageJson: blobId('package.json', cwd), packageLock: blobId('package-lock.json', cwd) };
  const state = registryState(headRegistry, readFileSync(registryPath, 'utf8'), candidate);
  if (state === 'noop') {
    return;
  }
  atomicWrite(registryPath, `${JSON.stringify({ schemaVersion: 1, pairs: [...head.pairs, candidate] }, null, 2)}\n`);
}
