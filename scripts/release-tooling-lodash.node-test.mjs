import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const fixtureNodeModules = process.env.TOOLING_TEST_NODE_MODULES
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../node_modules');

function requireFromFixture(packagePath) {
  return createRequire(path.join(fixtureNodeModules, packagePath, 'package.json'));
}

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

test('scopes patched CommonJS lodash to semantic-release Git and changelog parents', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

  assert.deepEqual(manifest.overrides['@semantic-release/git'], { lodash: '4.18.1' });
  assert.deepEqual(manifest.overrides['@semantic-release/changelog'], { lodash: '4.18.1' });
  assert.equal(manifest.overrides.lodash, undefined);
  assert.equal(lock.packages['node_modules/lodash'].version, '4.17.21');
  assert.equal(lock.packages['node_modules/lodash-es'].version, '4.18.1');

  for (const parent of ['git', 'changelog']) {
    const parentPath = `node_modules/@semantic-release/${parent}`;
    const lodashPath = `${parentPath}/node_modules/lodash`;
    assert.equal(lock.packages[parentPath].dependencies.lodash, '^4.17.4');
    assert.equal(lock.packages[lodashPath].version, '4.18.1');
  }
});

test('patched nested lodash resolves actual release templates and local changelog preparation without network or Git preparation', async (t) => {
  disableNetwork(t);

  const gitRequire = requireFromFixture('@semantic-release/git');
  const changelogRequire = requireFromFixture('@semantic-release/changelog');
  const gitLodashPath = gitRequire.resolve('lodash/package.json');
  const changelogLodashPath = changelogRequire.resolve('lodash/package.json');
  assert.match(gitLodashPath, /@semantic-release[/\\]git[/\\]node_modules[/\\]lodash[/\\]package\.json$/);
  assert.match(changelogLodashPath, /@semantic-release[/\\]changelog[/\\]node_modules[/\\]lodash[/\\]package\.json$/);
  assert.equal(gitRequire('lodash/package.json').version, '4.18.1');
  assert.equal(changelogRequire('lodash/package.json').version, '4.18.1');

  const git = gitRequire('@semantic-release/git');
  git.verifyConditions({}, {
    options: {
      prepare: [{
        path: '@semantic-release/git',
        assets: 'CHANGELOG.md',
        message: 'release <%= nextRelease.version %> on <%= branch.name %>',
      }],
    },
  });
  const template = gitRequire('lodash/template');
  assert.equal(
    template('release <%= nextRelease.version %> on <%= branch.name %>')({
      nextRelease: { version: '1.144.2' },
      branch: { name: 'main' },
    }),
    'release 1.144.2 on main',
  );

  const cwd = mkdtempSync(path.join(os.tmpdir(), 'semantic-release-changelog-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const changelog = changelogRequire('@semantic-release/changelog');
  await changelog.prepare(
    { changelogFile: 'CHANGELOG.md', changelogTitle: '# Changelog' },
    {
      cwd,
      nextRelease: { notes: '## 1.144.2\n- fixture release note' },
      logger: { log() {} },
    },
  );
  assert.equal(
    readFileSync(path.join(cwd, 'CHANGELOG.md'), 'utf8'),
    '# Changelog\n\n## 1.144.2\n- fixture release note\n',
  );
});
