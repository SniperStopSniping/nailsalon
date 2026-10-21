import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const modules = process.env.WS7_TEST_NODE_MODULES;
const dependencyRequire = modules
  ? createRequire(path.join(modules, 'ws7-fixture.cjs'))
  : require;
// An independently integrity-verified extracted package permits bounded local
// byte tests without installing or altering the existing dependency tree.
const artifact = process.env.WS7_TEST_ARTIFACT;
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const ws7Paths = [
  'node_modules/mqtt/node_modules/ws',
  'node_modules/webpack-bundle-analyzer/node_modules/ws',
];

function ownerRequire(owner) {
  return createRequire(dependencyRequire.resolve(owner));
}

function patchedWs() {
  const loader = artifact
    ? createRequire(path.join(artifact, 'package.json'))
    : ownerRequire('mqtt');
  const packageJson = artifact ? loader('./package.json') : loader('ws/package.json');
  assert.equal(packageJson.version, '7.5.11');
  return artifact ? loader('./index.js') : loader('ws');
}

test('ws7 override and lock preserve the production ws major', () => {
  assert.equal(manifest.overrides['ws@^7.0.0'], '7.5.11');
  assert.equal(manifest.dependencies.ws, '^8.21.3');
  assert.equal(lock.packages['node_modules/ws'].version, '8.21.3');
  assert.equal(lock.packages['node_modules/ws'].dev, undefined);
  for (const packagePath of ws7Paths) {
    assert.equal(lock.packages[packagePath].version, '7.5.11');
    assert.equal(lock.packages[packagePath].dev, true);
    assert.equal(lock.packages[packagePath].integrity, 'sha512-zS54Oen9bITtp7kp2XM3AydrCIq1D+HwJOuH+c+e4LfpL/lotP5osijd+UoMnxwAam1GN8R4KtLAyIrIcBNpiA==');
  }
});

test('installed MQTT and analyzer owners resolve the patched ws7 package', {
  skip: artifact ? 'Extracted-package run; installed-tree qualification requires a fresh dependency install.' : false,
}, () => {
  for (const owner of ['mqtt', 'webpack-bundle-analyzer']) {
    assert.equal(ownerRequire(owner)('ws/package.json').version, '7.5.11');
  }
  assert.equal(dependencyRequire('ws/package.json').version, '8.21.3');
});

test('patched ws7 receives an ordinary bounded fragmented message', { timeout: 1000 }, async () => {
  const { Receiver } = patchedWs();
  const receiver = new Receiver('nodebuffer', {}, false, 1024, 4, 4);
  const message = once(receiver, 'message');
  receiver.write(Buffer.from([0x02, 1, 0x61]));
  receiver.write(Buffer.from([0x00, 1, 0x62]));
  receiver.write(Buffer.from([0x80, 1, 0x63]));
  const [data] = await message;
  assert.equal(Buffer.isBuffer(data), true);
  assert.equal(data.toString(), 'abc');
  receiver.destroy();
});

test('patched ws7 rejects tiny fragments before unbounded accumulation', { timeout: 1000 }, async () => {
  const { Receiver } = patchedWs();
  const receiver = new Receiver('nodebuffer', {}, false, 1024, 4, 4);
  const rejected = new Promise(resolve => receiver.once('error', resolve));
  receiver.write(Buffer.from([0x02, 1, 0x61]));
  for (let i = 0; i < 4; i += 1) {
    receiver.write(Buffer.from([0x00, 1, 0x61]), () => {});
  }
  assert.equal((await rejected).code, 'WS_ERR_TOO_MANY_BUFFERED_PARTS');
  assert.equal(receiver.destroyed, true);
});

test('patched ws7 rejects tiny data chunks below its payload-size limit', { timeout: 1000 }, async () => {
  const { Receiver } = patchedWs();
  const receiver = new Receiver('nodebuffer', {}, false, 1024, 4, 4);
  const rejected = new Promise(resolve => receiver.once('error', resolve));
  receiver.write(Buffer.from([0x82, 127, 0, 0, 0, 0, 0, 0, 3, 232]));
  for (let i = 0; i < 5; i += 1) {
    receiver.write(Buffer.from([0x61]), () => {});
  }
  assert.equal((await rejected).code, 'WS_ERR_TOO_MANY_BUFFERED_PARTS');
  assert.equal(receiver.destroyed, true);
});

test('Checkly socket options retain synthetic auth without overriding ws options', async () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'luster-ws7-config-'));
  const values = {
    CHECKLY_ENV: 'production',
    CHECKLY_API_KEY: 'synthetic-checkly-api-key',
    CHECKLY_ACCOUNT_ID: 'synthetic-checkly-account',
    HOME: fixture,
    XDG_CONFIG_HOME: fixture,
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    ALL_PROXY: '',
    NO_PROXY: '',
    http_proxy: '',
    https_proxy: '',
    all_proxy: '',
    no_proxy: '',
  };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  const network = { connect: net.Socket.prototype.connect, http: http.request, https: https.request, fetch: globalThis.fetch };
  let attempts = 0;
  const deny = () => {
    attempts += 1;
    throw new Error('ws7 fixtures must not contact a provider');
  };
  net.Socket.prototype.connect = deny;
  http.request = deny;
  https.request = deny;
  globalThis.fetch = deny;
  let mqtt;
  let connectAsync;
  try {
    Object.assign(process.env, values);
    const checkly = ownerRequire('checkly');
    mqtt = checkly('async-mqtt');
    connectAsync = mqtt.connectAsync;
    const calls = [];
    const client = { synthetic: true };
    mqtt.connectAsync = async (...args) => {
      calls.push(args);
      return client;
    };
    const socketPath = path.join(path.dirname(checkly.resolve('checkly')), 'services/socket-client.js');
    const { SocketClient } = checkly(socketPath);
    assert.equal(await SocketClient.connect(), client);
    assert.equal(calls.length, 1);
    const [url, options, manualConnect] = calls[0];
    assert.equal(url, 'wss://events.checklyhq.com?authenticationScheme=userApiKey');
    assert.deepEqual(options, {
      reconnectPeriod: 0,
      username: values.CHECKLY_ACCOUNT_ID,
      password: values.CHECKLY_API_KEY,
    });
    assert.equal(manualConnect, false);
    // No explicit wsOptions means the fixed ws client defaults remain active.
    assert.equal(options.wsOptions, undefined);
    assert.equal(attempts, 0);
  } finally {
    if (mqtt) {
      mqtt.connectAsync = connectAsync;
    }
    net.Socket.prototype.connect = network.connect;
    http.request = network.http;
    https.request = network.https;
    globalThis.fetch = network.fetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(fixture, { recursive: true, force: true });
  }
});
