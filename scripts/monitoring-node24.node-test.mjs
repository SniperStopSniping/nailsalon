import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';

import { getPublicSentryRuntimeConfig } from '../src/libs/sentry/runtime.ts';

test('Node 24 monitoring parses request URLs and preserves private-data scrubbing', async (t) => {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Run this check with Node 24 or newer');
  const warnings = [];
  const recordWarning = warning => warnings.push(warning.code);
  process.on('warning', recordWarning);

  const original = { connect: net.Socket.prototype.connect, http: http.request, https: https.request, fetch: globalThis.fetch };
  let networkAttempts = 0;
  const rejectNetwork = () => {
    networkAttempts += 1;
    throw new Error('Monitoring regression checks must not contact a provider');
  };
  net.Socket.prototype.connect = rejectNetwork;
  http.request = rejectNetwork;
  https.request = rejectNetwork;
  globalThis.fetch = rejectNetwork;

  let sentry;
  let initialized = false;
  t.after(async () => {
    try {
      if (initialized) {
        await sentry.close(2000);
      }
    } finally {
      net.Socket.prototype.connect = original.connect;
      http.request = original.http;
      https.request = original.https;
      globalThis.fetch = original.fetch;
      process.off('warning', recordWarning);
    }
  });

  // Resolve through the app SDK, including a nested dependency if npm puts it
  // there. A separate top-level instrumentation copy is not sufficient proof.
  const require = createRequire(import.meta.url);
  const nextRequire = createRequire(require.resolve('@sentry/nextjs'));
  const nodeRequire = createRequire(nextRequire.resolve('@sentry/node'));
  const httpRequire = createRequire(nodeRequire.resolve('@opentelemetry/instrumentation-http'));
  const utilityPath = httpRequire.resolve('./utils.js');
  const utilityModule = { exports: {} };
  // Node 24 excludes code inside node_modules from application deprecations,
  // even with --pending-deprecation. Execute the exact installed utility with
  // its real dependency resolution but an application-bundle source location.
  // No source is rewritten and the installed package is never modified.
  compileFunction(readFileSync(utilityPath, 'utf8'), ['exports', 'require', 'module', '__filename', '__dirname'], {
    filename: fileURLToPath(new URL('./monitoring-http-fixture.cjs', import.meta.url)),
  })(utilityModule.exports, createRequire(utilityPath), utilityModule, utilityPath, path.dirname(utilityPath));
  const { getIncomingRequestAttributes } = utilityModule.exports;
  const logger = { verbose() {}, debug() {}, warn() {}, error() {}, info() {} };
  const paths = ['/', '/api/health', '/api/public/customer-booking/check?token=synthetic-only', '/salon/menu?category=gel&extra=1', '/set%20care'];

  for (const component of ['http', 'https']) {
    for (const url of paths) {
      await t.test(`${component} request ${url}`, () => {
        const attributes = getIncomingRequestAttributes({
          headers: { 'host': 'example.invalid', 'user-agent': 'synthetic-review' },
          method: 'GET',
          url,
          httpVersion: '1.1',
          socket: { remoteAddress: '127.0.0.1', remotePort: 12345, localAddress: '127.0.0.1', localPort: component === 'http' ? 80 : 443 },
        }, { component }, logger);

        assert.equal(attributes['http.target'], url);
        assert.equal(attributes['http.url'], `${component}://example.invalid${url}`);
        assert.equal(attributes['http.method'], 'GET');
      });
    }
  }
  await setImmediate();
  assert.ok(!warnings.includes('DEP0169'), 'The installed monitoring dependency still calls deprecated URL parsing');

  sentry = nextRequire('@sentry/node');
  const core = nodeRequire('@sentry/core');
  const envelopes = [];
  sentry.init({
    ...getPublicSentryRuntimeConfig({
      NEXT_PUBLIC_SENTRY_DSN: 'https://synthetic@example.invalid/1',
      NEXT_PUBLIC_SENTRY_ENVIRONMENT: 'synthetic-diagnostic',
      NEXT_PUBLIC_SENTRY_RELEASE: 'synthetic-only',
    }),
    serverName: 'synthetic-diagnostic',
    transport: () => ({
      send: async (envelope) => {
        envelopes.push(envelope);
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
  });
  initialized = true;

  const routes = ['/api/admin/owner-assistant/chat', '/api/public/customer-assistant/message', '/api/public/customer-booking/submit'];
  for (const route of routes) {
    const query = route.startsWith('/api/public/') ? 'token=synthetic-private-query' : 'salon=synthetic';
    sentry.captureEvent({
      message: 'synthetic-diagnostic',
      sdkProcessingMetadata: {
        normalizedRequest: core.httpRequestToRequestData({
          url: `${route}?${query}`,
          method: 'POST',
          socket: { encrypted: true },
          body: { message: 'synthetic-private-words' },
          cookies: { session: 'synthetic-cookie' },
          headers: { host: 'example.invalid', Authorization: 'Bearer synthetic-token', Cookie: 'synthetic-cookie', Accept: 'application/json' },
        }),
      },
    });
  }
  assert.equal(await sentry.flush(2000), true);
  const events = envelopes.flatMap(envelope => envelope[1].filter(item => item[0].type === 'event').map(item => item[1]));
  assert.equal(events.length, routes.length);

  for (const route of routes) {
    await t.test(`scrubs ${route} through the actual SDK`, () => {
      const event = events.find(candidate => candidate.request?.url?.startsWith(`https://example.invalid${route}`));
      assert.ok(event);
      assert.equal(event.request.data, undefined);
      assert.equal(event.request.cookies, undefined);
      const serialized = JSON.stringify(event);
      for (const value of ['synthetic-private-words', 'synthetic-cookie', 'synthetic-token', 'synthetic-private-query']) {
        assert.equal(serialized.includes(value), false);
      }
      if (route.startsWith('/api/public/')) {
        assert.equal(event.request.url.includes('?'), false);
        assert.equal(event.request.headers, undefined);
        assert.equal(event.request.query_string, undefined);
      } else {
        assert.equal(event.request.headers.Accept, 'application/json');
        assert.equal(event.request.query_string, 'salon=synthetic');
      }
    });
  }

  for (const route of routes) {
    await t.test(`scrubs transaction requests and span attributes for ${route}`, async () => {
      const start = Date.now() / 1000;
      const query = route.startsWith('/api/public/') ? 'token=synthetic-private-query' : 'salon=synthetic';
      const url = `https://example.invalid${route}?${query}`;
      sentry.captureEvent({
        type: 'transaction',
        transaction: route,
        start_timestamp: start,
        timestamp: start + 1,
        contexts: { trace: { trace_id: '11111111111111111111111111111111', span_id: '2222222222222222', op: 'http.server', data: { 'db.user': 'synthetic-private-db-user', 'http.url': url, 'http.status_code': 200 } } },
        spans: [{ trace_id: '11111111111111111111111111111111', span_id: '3333333333333333', parent_span_id: '2222222222222222', op: 'db', start_timestamp: start, timestamp: start + 0.5, data: { 'db.user': 'synthetic-private-db-user', 'db.system': 'postgresql', 'http.url': url } }],
        sdkProcessingMetadata: {
          normalizedRequest: {
            ...core.winterCGRequestToRequestData(new Request(url, { method: 'POST', headers: { Authorization: 'Bearer synthetic-private-auth', Cookie: 'synthetic-private-cookie', Accept: 'application/json' } })),
            data: { message: 'synthetic-private-body' },
            cookies: { session: 'synthetic-private-cookie' },
          },
        },
      });
      assert.equal(await sentry.flush(2000), true);
      const transactions = envelopes.flatMap(envelope => envelope[1].filter(item => item[0].type === 'transaction').map(item => item[1]));
      const transaction = transactions.find(candidate => candidate.transaction === route);
      assert.ok(transaction);
      assert.equal(JSON.stringify(transaction).includes('synthetic-private-'), false);
      assert.equal(transaction.contexts.trace.data['http.status_code'], 200);
      assert.equal(transaction.spans.length, 1);
      assert.equal(transaction.spans[0].data['db.system'], 'postgresql');
      const expectedUrl = route.startsWith('/api/public/') ? url.split('?')[0] : url;
      assert.equal(transaction.request.url, expectedUrl);
      assert.equal(transaction.contexts.trace.data['http.url'], expectedUrl);
      assert.equal(transaction.spans[0].data['http.url'], expectedUrl);
      assert.equal(transaction.request.headers?.accept, route.startsWith('/api/public/') ? undefined : 'application/json');
      if (route.startsWith('/api/public/')) {
        assert.equal(transaction.request.query_string, undefined);
      } else {
        assert.equal(transaction.request.query_string, 'salon=synthetic');
      }
    });
  }
  await setImmediate();
  assert.ok(!warnings.includes('DEP0169'));
  assert.equal(networkAttempts, 0);
});
