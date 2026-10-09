import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';

test('Node 24 bundled Redis URLs preserve connection settings without deprecated parsing', async (t) => {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Run this check with Node 24 or newer');
  const warnings = [];
  const recordWarning = warning => warnings.push(warning.code);
  process.on('warning', recordWarning);
  const originalConnect = net.Socket.prototype.connect;
  let networkAttempts = 0;
  net.Socket.prototype.connect = () => {
    networkAttempts += 1;
    throw new Error('Redis URL regression must not connect to any server');
  };
  t.after(() => {
    net.Socket.prototype.connect = originalConnect;
    process.off('warning', recordWarning);
  });

  const require = createRequire(import.meta.url);
  const redisRequire = createRequire(require.resolve('ioredis'));
  const utilityPath = redisRequire.resolve('./utils/index.js');
  const clientPath = redisRequire.resolve('./Redis.js');
  function loadBundledModule(filename, moduleRequire) {
    const compiledModule = { exports: {} };
    // Node 24 excludes node_modules callers from application deprecations.
    // Use the exact installed source and dependency resolution at an app-bundle
    // location, matching the production stack. Never patch url.parse or source.
    compileFunction(readFileSync(filename, 'utf8'), ['exports', 'require', 'module', '__filename', '__dirname'], {
      filename: fileURLToPath(new URL(`./redis-bundle-${path.basename(filename)}`, import.meta.url)),
    })(compiledModule.exports, moduleRequire, compiledModule, filename, path.dirname(filename));
    return compiledModule.exports;
  }
  const utils = loadBundledModule(utilityPath, createRequire(utilityPath));
  const clientRequire = createRequire(clientPath);
  const { default: Redis } = loadBundledModule(clientPath, specifier => (
    specifier === './utils' ? utils : clientRequire(specifier)
  ));
  function authenticatedUrl(base, username, password) {
    const url = new URL(base);
    url.username = encodeURIComponent(username);
    url.password = encodeURIComponent(password);
    return url.href;
  }

  // Synthetic values only. Cover hosted TLS/ACL URLs, local IPv4/IPv6,
  // percent-encoded credentials, database selection and legacy 5.x entry forms.
  const cases = [
    ['default TCP', 'redis://cache.example.invalid', { host: 'cache.example.invalid', port: 6379, db: 0 }],
    ['port and database', 'redis://cache.example.invalid:6380/4', { port: 6380, db: 4 }],
    ['TLS', 'rediss://cache.example.invalid:6380/2', { host: 'cache.example.invalid', port: 6380, db: 2, tls: true }],
    ['password only', authenticatedUrl('redis://cache.example.invalid', '', 'synthetic'), { username: '', password: 'synthetic' }],
    ['ACL credentials', authenticatedUrl('redis://cache.example.invalid', 'owner', 'synthetic'), { username: 'owner', password: 'synthetic' }],
    ['encoded credentials', authenticatedUrl('rediss://cache.example.invalid/3', 'owner@studio', 'p:a/s#s%+é'), { username: 'owner@studio', password: 'p:a/s#s%+é', db: 3, tls: true }],
    ['username only', 'redis://owner@cache.example.invalid', { username: 'owner', password: '' }],
    ['IPv6', 'redis://[::1]:6380/5', { host: '::1', port: 6380, db: 5 }],
    ['host and port', 'cache.example.invalid:6380', { host: 'cache.example.invalid', port: 6380 }],
    ['protocol relative', '//cache.example.invalid:6380', { host: 'cache.example.invalid', port: 6380, path: undefined }],
    ['protocol relative database', '//cache.example.invalid:6380/3?family=6', { host: 'cache.example.invalid', port: 6380, db: 3, family: 6, path: undefined }],
    ['Unix socket', '/tmp/synthetic-redis.sock?db=2&family=6', { path: '/tmp/synthetic-redis.sock', db: 2, family: 6 }],
    ['port only', '6380', { port: 6380 }],
    ['query settings', 'redis://cache.example.invalid?db=3&family=4&connectionName=synthetic', { db: 3, family: 4, connectionName: 'synthetic' }],
    ['path database precedence', 'redis://cache.example.invalid/2?db=7', { db: 2 }],
    ['root path', 'redis://cache.example.invalid/', { db: 0, path: undefined }],
    ['TLS IPv6 and query', authenticatedUrl('rediss://[::1]:6380/2?family=6', '', 'synthetic'), { host: '::1', port: 6380, db: 2, family: 6, password: 'synthetic', tls: true }],
  ];
  const retryStrategy = times => times > 3 ? null : Math.min(times * 100, 1000);
  for (const [label, url, expected] of cases) {
    await t.test(label, () => {
      const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3, retryStrategy });
      try {
        assert.equal(client.status, 'wait');
        assert.equal(client.options.lazyConnect, true);
        assert.equal(client.options.maxRetriesPerRequest, 3);
        assert.equal(client.options.retryStrategy, retryStrategy);
        for (const [key, value] of Object.entries(expected)) {
          assert.deepEqual(client.options[key], value, key);
        }
      } finally {
        client.disconnect();
      }
    });
  }
  await setImmediate();
  assert.equal(networkAttempts, 0);
  assert.ok(!warnings.includes('DEP0169'), 'The installed bundled Redis client still invokes deprecated URL parsing');
});
