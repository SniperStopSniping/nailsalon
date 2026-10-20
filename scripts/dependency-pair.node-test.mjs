import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { blobId, parseRegistry, verifyDependencyPair } from './verify-dependency-pair.mjs';

const registrySource = readFileSync(new URL('./reviewed-dependency-pairs.json', import.meta.url), 'utf8');

test('current dependency blobs are an exact reviewed pair', () => {
  const result = verifyDependencyPair();
  assert.equal(result.packageJson, blobId('package.json'));
  assert.equal(result.packageLock, blobId('package-lock.json'));
  assert.ok(result.registry.pairs.some(pair => pair.packageJson === result.packageJson && pair.packageLock === result.packageLock));
});

test('registry rejects malformed, duplicate and non-string hashes', () => {
  assert.throws(() => parseRegistry('{'), /registry_json/);
  assert.throws(() => parseRegistry(JSON.stringify({ schemaVersion: 1, pairs: [] })), /registry_empty/);
  const registry = parseRegistry(registrySource);
  const duplicate = structuredClone(registry);
  duplicate.pairs.push(structuredClone(duplicate.pairs[0]));
  assert.throws(() => parseRegistry(JSON.stringify(duplicate)), /registry_duplicate/);
  const wrongType = structuredClone(registry);
  wrongType.pairs[0].packageJson = [wrongType.pairs[0].packageJson];
  assert.throws(() => parseRegistry(JSON.stringify(wrongType)), /registry_pair/);
});

test('verifier rejects changed and cross-mixed actual manifest and lock bytes', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'luster-exact-pairs-'));
  const write = (name, text) => writeFileSync(path.join(cwd, name), text);
  const pair = () => Object.fromEntries([
    ['packageJson', 'package.json'],
    ['packageLock', 'package-lock.json'],
  ].map(([key, name]) => [key, execFileSync('git', ['hash-object', '--no-filters', name], { cwd, encoding: 'utf8' }).trim()]));
  try {
    write('package.json', '{"name":"synthetic-a"}\n');
    write('package-lock.json', '{"name":"synthetic-lock-a"}\n');
    const first = pair();
    write('package.json', '{"name":"synthetic-b"}\n');
    write('package-lock.json', '{"name":"synthetic-lock-b"}\n');
    const second = pair();
    write('registry.json', JSON.stringify({ schemaVersion: 1, pairs: [first, second] }));
    const check = () => verifyDependencyPair({ cwd, registryPath: 'registry.json' });
    check();
    write('package.json', '{"name":"synthetic-a"}\n');
    assert.throws(check, /unreviewed/);
    write('package-lock.json', '{"name":"synthetic-lock-a"}\n');
    check();
    write('package.json', '{"name":"unreviewed"}\n');
    assert.throws(check, /unreviewed/);
    write('package.json', '{"name":"synthetic-a"}\n');
    write('package-lock.json', '{"name":"unreviewed-lock"}\n');
    assert.throws(check, /unreviewed/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('release configuration runs the registrar after npm and commits only release outputs', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const plugins = packageJson.release.plugins;
  const npmIndex = plugins.findIndex(plugin => Array.isArray(plugin) && plugin[0] === '@semantic-release/npm');
  const registerIndex = plugins.indexOf('./scripts/register-release-dependency-pair.mjs');
  const git = plugins.find(plugin => Array.isArray(plugin) && plugin[0] === '@semantic-release/git');
  assert.ok(npmIndex >= 0 && registerIndex === npmIndex + 1);
  assert.deepEqual(git[1].assets, ['CHANGELOG.md', 'package.json', 'package-lock.json', 'scripts/reviewed-dependency-pairs.json']);
});
