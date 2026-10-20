import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fixtureNodeModules = process.env.TOOLING_TEST_NODE_MODULES
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../node_modules');

function disableNetwork(t) {
  const deny = () => {
    throw new Error('network is disabled in the release tooling fixture');
  };
  const original = {
    fetch: globalThis.fetch,
    socketConnect: net.Socket.prototype.connect,
    httpRequest: http.request,
    httpGet: http.get,
    httpsRequest: https.request,
    httpsGet: https.get,
  };
  globalThis.fetch = deny;
  net.Socket.prototype.connect = deny;
  http.request = deny;
  http.get = deny;
  https.request = deny;
  https.get = deny;
  t.after(() => {
    globalThis.fetch = original.fetch;
    net.Socket.prototype.connect = original.socketConnect;
    http.request = original.httpRequest;
    http.get = original.httpGet;
    https.request = original.httpsRequest;
    https.get = original.httpsGet;
  });
}

test('updates only the compatible semantic-release lodash-es resolution', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const parents = [
    'semantic-release',
    '@semantic-release/commit-analyzer',
    '@semantic-release/github',
    '@semantic-release/npm',
    '@semantic-release/release-notes-generator',
  ];

  assert.equal(manifest.overrides['lodash-es'], undefined);
  assert.equal(lock.packages['node_modules/lodash'].version, '4.17.21');
  assert.equal(lock.packages['node_modules/lodash-es'].version, '4.18.1');
  assert.equal(
    lock.packages['node_modules/lodash-es'].integrity,
    'sha512-J8xewKD/Gk22OZbhpOVSwcs60zhd95ESDwezOFuA3/099925PdHJ7OFHNTGtajL3AlZkykD32HykiMo+BIBI8A==',
  );
  for (const parent of parents) {
    assert.equal(lock.packages[`node_modules/${parent}`].dependencies['lodash-es'], '^4.17.21');
  }
});

test('real semantic-release branch expansion renders templates with fixture lodash-es and a fake Git command', async (t) => {
  disableNetwork(t);
  const semanticRequire = createRequire(path.join(fixtureNodeModules, 'semantic-release/package.json'));
  const lodashPath = semanticRequire.resolve('lodash-es/package.json');
  assert.match(lodashPath, /node_modules[/\\]lodash-es[/\\]package\.json$/);
  assert.equal(semanticRequire('lodash-es/package.json').version, '4.18.1');

  const cwd = mkdtempSync(path.join(os.tmpdir(), 'semantic-release-branches-'));
  const fakeBin = path.join(cwd, 'bin');
  mkdirSync(fakeBin);
  const fakeGit = path.join(fakeBin, 'git');
  writeFileSync(fakeGit, `#!/bin/sh\nif [ "$1" = "ls-remote" ] && [ "$2" = "--heads" ] && [ "$3" = "https://release.invalid/example.git" ]; then\n  printf '%s\\n' '1111111111111111111111111111111111111111 refs/heads/main' '2222222222222222222222222222222222222222 refs/heads/beta'\n  exit 0\nfi\nprintf '%s\\n' 'unexpected git command' >&2\nexit 64\n`);
  chmodSync(fakeGit, 0o755);
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const originalPath = process.env.PATH;
  process.env.PATH = fakeBin;
  t.after(() => {
    process.env.PATH = originalPath;
  });

  const { default: expand } = await import(pathToFileURL(path.join(fixtureNodeModules, 'semantic-release/lib/branches/expand.js')).href);
  const branch = {
    name: 'main',
    channel: 'release-<%= name %>',
    range: '<%= name %>-stable',
    custom: { retained: true },
  };
  const result = await expand(
    'https://release.invalid/example.git',
    { cwd, env: {} },
    [branch],
  );
  assert.deepEqual(result, [{
    name: 'main',
    channel: 'release-main',
    range: 'main-stable',
    custom: { retained: true },
  }]);
  assert.deepEqual(branch, {
    name: 'main',
    channel: 'release-<%= name %>',
    range: '<%= name %>-stable',
    custom: { retained: true },
  });
});
