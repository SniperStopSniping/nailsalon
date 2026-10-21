'use strict';
// Pure VM mocks; no native transport, DNS, subprocess, credentials, or services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, 'node-egress-guard.cjs'), 'utf8');

const calls = [];
class Socket {
  connect(...args) {
    calls.push(['connect', args]);
    return this;
  }
}
const dns = { lookup: () => calls.push(['dns']), promises: { lookup: async () => {
  calls.push(['dns']);
  return {};
} } };
const net = { Socket };
const tls = { connect: (...args) => {
  calls.push(['tls', args]);
  return {};
} };
const request = (...args) => {
  calls.push(['http', args]);
  return { end() {} };
};
const http = { request };
const https = { request };
const child = {};
for (const name of ['spawn', 'spawnSync', 'fork']) {
  child[name] = (...args) => {
    calls.push([name, args]);
    return {};
  };
}
const modules = {
  'node:dns': dns,
  'node:net': net,
  'node:http': http,
  'node:https': https,
  'node:tls': tls,
  'node:fs': { createWriteStream: () => calls.push(['file']) },
  'node:path': require('node:path'),
  'node:child_process': child,
  'node:module': { syncBuiltinESMExports() {} },
};
const sandbox = { require: (name) => {
  assert.ok(modules[name], name);
  return modules[name];
}, URL, process: { env: { FRESH_OWNER_CHILD_ROLE: 'browser' }, nextTick: fn => fn() }, fetch: (input) => {
  calls.push(['fetch']);
  if (String(input).includes('redirect-test')) {
    tls.connect({ host: 'forbidden.example', port: 443 });
  }
  return Promise.resolve({});
} };
vm.runInNewContext(source, sandbox, { timeout: 1000 });
const blocked = fn => assert.throws(fn, /FRESH_OWNER_EGRESS_BLOCKED/);
blocked(() => new Socket().connect({ host: 'forbidden.example', port: 443 }));
blocked(() => new Socket().connect({ host: '127.0.0.1', port: 5432 }));
blocked(() => new Socket().connect({ path: '/tmp/shared.sock' }));
blocked(() => dns.lookup('forbidden.example', () => {}));
blocked(() => http.request('http://forbidden.example'));
blocked(() => https.request('https://api.clerk.com', { hostname: 'forbidden.example' }));
blocked(() => https.request('https://fonts.googleapis.com/css', { method: 'POST' }));
blocked(() => https.request('https://api.clerk.com', { hostname: 'fonts.googleapis.com', method: 'POST' }));
blocked(() => sandbox.fetch('https://forbidden.example'));
blocked(() => sandbox.fetch('https://api.clerk.com/redirect-test'));
// redirected transport rechecked
blocked(() => tls.connect({ socket: {}, host: 'api.clerk.com', port: 443 }));
const socket = new Socket();
socket.connect({ host: 'api.clerk.com', port: 443 });
blocked(() => tls.connect({ socket, host: 'musical-muskox-47.clerk.accounts.dev', port: 443 }));
blocked(() => tls.connect({ host: 'api.clerk.com', port: 443, rejectUnauthorized: false }));
assert.throws(() => modules['node:fs'].createWriteStream('/owned/app/.next/trace'), /FRESH_OWNER_TRACE_FILE_FORBIDDEN/);
https.request('https://api.clerk.com/v1/instance');
https.request('https://fonts.gstatic.com/font.woff2', { method: 'GET' });
new Socket().connect({ host: 'localhost', port: 56512 });
for (const name of ['spawn', 'spawnSync', 'fork']) {
  child[name]('owned-child', [], { detached: true });
  assert.equal(calls.at(-1)[1][2].detached, false);
}
assert.equal(calls.filter(row => row[0] === 'http').length, 2);
process.stdout.write(`${JSON.stringify({ offlineEgressContracts: 'passed', nativeTransports: 0, realDnsLookups: 0, nativeSubprocesses: 0, secretValuesRead: false })}\n`);
