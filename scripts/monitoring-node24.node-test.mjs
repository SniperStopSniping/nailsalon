import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import net from 'node:net';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

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
  // there. Sentry 10 owns HTTP instrumentation and URL parsing through its
  // supported SDK APIs; it no longer ships OTel's instrumentation-http module.
  const require = createRequire(import.meta.url);
  const nextRequire = createRequire(require.resolve('@sentry/nextjs'));
  const nodeRequire = createRequire(nextRequire.resolve('@sentry/node'));
  sentry = nextRequire('@sentry/node');
  const core = nodeRequire('@sentry/core');
  const defaultIntegrations = sentry.getDefaultIntegrations({});
  assert.ok(defaultIntegrations.some(integration => integration.name === 'Http'), 'Sentry HTTP instrumentation must be enabled');
  assert.equal(typeof core.parseStringToURLObject, 'function', 'Sentry must expose its current URL parser');
  const paths = ['/', '/api/health', '/api/public/customer-booking/check?token=synthetic-only', '/salon/menu?category=gel&extra=1', '/set%20care'];

  for (const protocol of ['http', 'https']) {
    for (const url of paths) {
      await t.test(`Sentry normalizes ${protocol} request URL ${url}`, () => {
        const request = core.httpRequestToRequestData({
          url,
          method: 'GET',
          headers: { host: 'example.invalid' },
          socket: { encrypted: protocol === 'https' },
        });
        assert.equal(request.url, `${protocol}://example.invalid${url}`);
        assert.equal(request.method, 'GET');
        for (const input of [url, request.url]) {
          const parsed = core.parseStringToURLObject(input);
          assert.ok(parsed);
          assert.equal(parsed.pathname, url.split(/[?#]/, 1)[0]);
          assert.equal(parsed.search, url.includes('?') ? `?${url.split('?')[1].split('#')[0]}` : '');
        }
      });
    }
  }
  await setImmediate();
  assert.ok(!warnings.includes('DEP0169'), 'The installed monitoring dependency still calls deprecated URL parsing');

  const envelopes = [];
  let pendingCheckInDelivery;
  sentry.init({
    ...getPublicSentryRuntimeConfig({
      NEXT_PUBLIC_SENTRY_DSN: 'https://synthetic@example.invalid/1',
      NEXT_PUBLIC_SENTRY_ENVIRONMENT: 'synthetic-diagnostic',
      NEXT_PUBLIC_SENTRY_RELEASE: 'synthetic-only',
    }),
    serverName: 'synthetic-diagnostic',
    transport: (options) => {
      // Exercise the installed SDK's real buffer/drain without provider traffic.
      const transport = core.createTransport(options, async () => {
        await pendingCheckInDelivery;
        return { statusCode: 200 };
      });
      return {
        send: (envelope) => {
          envelopes.push(envelope);
          return transport.send(envelope);
        },
        flush: timeout => transport.flush(timeout),
      };
    },
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
  await t.test('healthy cron check-ins use their own envelope instead of an error event', async () => {
    const eventCount = envelopes.flatMap(envelope => envelope[1].filter(item => item[0].type === 'event')).length;
    let finishDelivery;
    pendingCheckInDelivery = new Promise((resolve) => {
      finishDelivery = resolve;
    });
    let flushFinished = false;
    sentry.captureCheckIn(
      { monitorSlug: 'synthetic-deposit-reconcile', status: 'ok' },
      { schedule: { type: 'crontab', value: '*/5 * * * *' }, checkinMargin: 5, maxRuntime: 5, timezone: 'UTC' },
    );
    const flush = sentry.flush(2000).then((result) => {
      flushFinished = true;
      return result;
    });
    try {
      await setImmediate();
      assert.equal(flushFinished, false, 'flush must wait for queued check-in transport');
    } finally {
      finishDelivery();
      pendingCheckInDelivery = undefined;
    }
    assert.equal(await flush, true);
    const checkIns = envelopes.flatMap(envelope => envelope[1].filter(item => item[0].type === 'check_in').map(item => item[1]));
    assert.equal(checkIns.length, 1);
    assert.equal(checkIns[0].monitor_slug, 'synthetic-deposit-reconcile');
    assert.equal(checkIns[0].status, 'ok');
    assert.equal(checkIns[0].monitor_config.schedule.value, '*/5 * * * *');
    assert.equal(envelopes.flatMap(envelope => envelope[1].filter(item => item[0].type === 'event')).length, eventCount);
  });
  await setImmediate();
  assert.ok(!warnings.includes('DEP0169'));
  assert.equal(networkAttempts, 0);
});
