import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';

const nodeModules = process.env.CHECKLY_TEST_NODE_MODULES || path.join(process.cwd(), 'node_modules');
const require = createRequire(path.join(nodeModules, '__checkly-axios-test__.cjs'));
const lockfile = JSON.parse(readFileSync(path.join(process.cwd(), 'package-lock.json'), 'utf8'));
const originalNetwork = { connect: net.Socket.prototype.connect, http: http.request, https: https.request, fetch: globalThis.fetch };
let networkAttempts = 0;
const rejectNetwork = () => {
  networkAttempts += 1;
  throw new Error('Checkly Axios compatibility tests must not contact a provider');
};
net.Socket.prototype.connect = rejectNetwork;
http.request = rejectNetwork;
https.request = rejectNetwork;
globalThis.fetch = rejectNetwork;

test('Checkly REST request and interceptor compatibility uses the scoped Axios remediation', async () => {
  try {
    Object.assign(process.env, {
      CHECKLY_API_KEY: 'synthetic-checkly-api-key',
      CHECKLY_ACCOUNT_ID: 'synthetic-checkly-account',
      CHECKLY_ENV: 'production',
      GITHUB_ACTIONS: 'true',
      GITHUB_WORKFLOW: 'synthetic-checkly-transport',
      HTTP_PROXY: 'http://checkly-proxy.invalid:8080',
      HTTPS_PROXY: 'http://checkly-proxy.invalid:8080',
      ALL_PROXY: '',
      NO_PROXY: '',
      http_proxy: 'http://checkly-proxy.invalid:8080',
      https_proxy: 'http://checkly-proxy.invalid:8080',
      all_proxy: '',
      no_proxy: '',
    });
    const checklyApiPath = path.join(path.dirname(require.resolve('checkly')), 'rest/api.js');
    const checklyRequire = createRequire(checklyApiPath);
    const axiosPackage = checklyRequire('axios/package.json');
    const axiosRequire = createRequire(checklyRequire.resolve('axios'));
    const checklyProxy = checklyRequire('proxy-from-env');
    const axiosProxy = axiosRequire('proxy-from-env');
    const checklyProxyPackage = JSON.parse(readFileSync(path.join(path.dirname(checklyRequire.resolve('proxy-from-env')), 'package.json'), 'utf8'));
    const axiosProxyPackage = JSON.parse(readFileSync(path.join(path.dirname(axiosRequire.resolve('proxy-from-env')), 'package.json'), 'utf8'));
    assert.equal(axiosPackage.version, '1.20.0');
    assert.equal(checklyProxyPackage.version, '1.1.0');
    assert.equal(axiosProxyPackage.version, '2.1.0');
    assert.equal(lockfile.packages['node_modules/checkly/node_modules/axios']?.version, '1.20.0');
    assert.equal(lockfile.packages['node_modules/checkly/node_modules/axios/node_modules/proxy-from-env']?.version, '2.1.0');
    assert.equal(checklyProxy.getProxyForUrl('https://api.checklyhq.com'), 'http://checkly-proxy.invalid:8080');
    assert.equal(axiosProxy.getProxyForUrl('https://api.checklyhq.com'), 'http://checkly-proxy.invalid:8080');
    process.env.NO_PROXY = 'api.checklyhq.com';
    process.env.no_proxy = 'api.checklyhq.com';
    assert.equal(checklyProxy.getProxyForUrl('https://api.checklyhq.com'), '');
    assert.equal(axiosProxy.getProxyForUrl('https://api.checklyhq.com'), '');
    process.env.NO_PROXY = '';
    process.env.no_proxy = '';
    const { api } = require(checklyApiPath);
    const requests = [];
    api.defaults.adapter = async (config) => {
      requests.push(config);
      if (config.url === '/v1/synthetic-timeout') {
        throw Object.assign(new Error('synthetic timeout'), { config, response: { status: 408 } });
      }
      return { config, data: { received: true }, headers: {}, request: {}, status: 200, statusText: 'OK' };
    };

    await api.post('/v1/synthetic', { booking: 'synthetic-only' });
    await api.get('https://api.example.invalid/v1/absolute');

    assert.equal(requests.length, 2);
    const [relative, absolute] = requests;
    assert.equal(relative.baseURL, 'https://api.checklyhq.com');
    assert.equal(relative.url, '/v1/synthetic');
    assert.equal(relative.data, JSON.stringify({ booking: 'synthetic-only' }));
    assert.equal(relative.headers.get('Authorization'), 'Bearer synthetic-checkly-api-key');
    assert.equal(relative.headers.get('x-checkly-account'), 'synthetic-checkly-account');
    assert.equal(relative.headers.get('x-checkly-ci-name'), 'GitHub Actions');
    assert.equal(relative.headers.get('Content-Type'), 'application/json');
    assert.equal(absolute.baseURL, 'https://api.checklyhq.com');
    assert.equal(absolute.url, 'https://api.example.invalid/v1/absolute');

    await assert.rejects(api.get('/v1/synthetic-timeout'), {
      message: 'Encountered an error connecting to Checkly. This can be triggered by a slow internet connection or a network with high packet loss.',
    });
    assert.equal(networkAttempts, 0);
  } finally {
    net.Socket.prototype.connect = originalNetwork.connect;
    http.request = originalNetwork.http;
    https.request = originalNetwork.https;
    globalThis.fetch = originalNetwork.fetch;
  }
});
