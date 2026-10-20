import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const toolingTestNodeModules = process.env.TOOLING_TEST_NODE_MODULES;
const require = toolingTestNodeModules
  ? createRequire(join(toolingTestNodeModules, 'fixture-entry.cjs'))
  : createRequire(import.meta.url);
const npmRunAllRequire = toolingTestNodeModules
  ? createRequire(join(toolingTestNodeModules, 'npm-run-all/package.json'))
  : createRequire(require.resolve('npm-run-all/package.json'));
const eslintRequire = toolingTestNodeModules
  ? createRequire(join(toolingTestNodeModules, 'eslint/package.json'))
  : createRequire(require.resolve('eslint/package.json'));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

function installedVersion(loader, name, path) {
  let directory = dirname(loader.resolve(name));
  let version;
  while (directory !== dirname(directory)) {
    const packageJson = join(directory, 'package.json');
    if (existsSync(packageJson)) {
      version = JSON.parse(readFileSync(packageJson, 'utf8')).version;
      break;
    }
    directory = dirname(directory);
  }
  assert.ok(version, `${name} package metadata must be discoverable from its installed entrypoint`);
  assert.equal(version, lock.packages[path].version, `${name} must match its reviewed lock entry`);
  return version;
}

function siblingVersion(anchor, name, path) {
  let directory = dirname(require.resolve(anchor));
  while (directory !== dirname(directory) && directory !== 'node_modules') {
    if (directory.endsWith('/node_modules')) {
      const version = JSON.parse(readFileSync(join(directory, name, 'package.json'), 'utf8')).version;
      assert.equal(version, lock.packages[path].version, `${name} must match its reviewed lock entry`);
      return version;
    }
    directory = dirname(directory);
  }
  throw new Error(`unable to locate node_modules for ${anchor}`);
}

test('patched cross-spawn releases execute a local fixture from both compatible owner chains', () => {
  for (const [loader, path, expected] of [
    [require, 'node_modules/cross-spawn', '7.0.5'],
    [npmRunAllRequire, 'node_modules/npm-run-all/node_modules/cross-spawn', '6.0.6'],
  ]) {
    assert.equal(installedVersion(loader, 'cross-spawn', path), expected);
    const child = loader('cross-spawn').sync(process.execPath, [
      '-e',
      'process.stdout.write(\'fixture\')',
    ], { encoding: 'utf8' });
    assert.equal(child.status, 0);
    assert.equal(child.stdout, 'fixture');
  }
});

test('patched js-yaml releases parse a bounded fixture through both compatible major lines', () => {
  assert.equal(installedVersion(require, 'js-yaml', 'node_modules/js-yaml'), '3.15.2');
  assert.equal(installedVersion(eslintRequire, 'js-yaml', 'node_modules/eslint/node_modules/js-yaml'), '4.3.2');
  for (const loader of [require, eslintRequire]) {
    const yaml = loader('js-yaml');
    assert.deepEqual(yaml.load('service: manicure\nminutes: 45\n'), { service: 'manicure', minutes: 45 });
  }
});

test('patched Octokit request helpers retain local endpoint construction', async () => {
  for (const [name, path, expected] of [
    ['@octokit/endpoint', 'node_modules/@octokit/endpoint', '10.1.3'],
    ['@octokit/request', 'node_modules/@octokit/request', '9.2.1'],
    ['@octokit/request-error', 'node_modules/@octokit/request-error', '6.1.7'],
    ['@octokit/plugin-paginate-rest', 'node_modules/@octokit/plugin-paginate-rest', '11.4.1'],
    ['fast-content-type-parse', 'node_modules/fast-content-type-parse', '2.0.1'],
  ]) {
    assert.equal(installedVersion(require, name, path), expected);
  }
  assert.equal(siblingVersion('@octokit/endpoint', '@octokit/types', 'node_modules/@octokit/types'), '13.7.0');
  assert.equal(siblingVersion('@octokit/endpoint', '@octokit/openapi-types', 'node_modules/@octokit/openapi-types'), '23.0.1');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('network is prohibited in tooling dependency fixtures');
  };
  try {
    const { endpoint } = await import(pathToFileURL(require.resolve('@octokit/endpoint')).href);
    const { request } = await import(pathToFileURL(require.resolve('@octokit/request')).href);
    assert.equal(endpoint('GET /repos/{owner}/{repo}', { owner: 'fixture', repo: 'salon' }).url, 'https://api.github.com/repos/fixture/salon');
    assert.equal(request.endpoint('GET /repos/{owner}/{repo}', { owner: 'fixture', repo: 'salon' }).url, 'https://api.github.com/repos/fixture/salon');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
