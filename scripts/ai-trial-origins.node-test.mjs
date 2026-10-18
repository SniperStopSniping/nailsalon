import assert from 'node:assert/strict';
import test from 'node:test';

import { aiTrialOrigins, assertHttpsTrialStep, restrictAiTrialNetwork, trialApiTarget, trialLoopbackRequest } from './lib/ai-trial-origins.mjs';
import { aiTrialTunnelPort } from './lib/ai-trial-proxy.mjs';

test('HTTPS trials retain distinct browser origins and map only to fixed loopback ports', () => {
  const profile = aiTrialOrigins(true);
  assert.notEqual(profile.origin, profile.rendererOrigin);
  assert.deepEqual(trialLoopbackRequest(`${profile.origin}/api/admin/business-setup?a=1`, profile), { kind: 'loopback', url: 'https://127.0.0.1:3443/api/admin/business-setup?a=1', host: 'luster-builder.test:3443' });
  assert.deepEqual(trialLoopbackRequest(`${profile.rendererOrigin}/renderer`, profile), { kind: 'loopback', url: 'https://127.0.0.1:3444/renderer', host: 'luster-render.test:3444' });
});

test('foreign, insecure, credential-bearing and wrong-port requests are refused', () => {
  const profile = aiTrialOrigins(true);
  for (const url of ['https://example.com/', 'http://luster-builder.test:3443/', 'https://luster-builder.test:443/', 'https://luster-render.test:3443/', 'https://user:password@luster-builder.test:3443/', 'https://luster-builder.test.evil.invalid:3443/']) {
    assert.deepEqual(trialLoopbackRequest(url, profile), { kind: 'blocked' });
  }
});

test('the existing development profile stays loopback-only', () => {
  const profile = aiTrialOrigins();
  assert.deepEqual(trialLoopbackRequest(`${profile.origin}/admin`, profile), { kind: 'continue' });
  assert.deepEqual(trialLoopbackRequest('https://api.openai.com/', profile), { kind: 'blocked' });
});

test('HTTPS verification cannot submit another billable generation request', () => {
  for (const step of ['message', 'photos', 'conversation', 'generate']) {
    assert.throws(() => assertHttpsTrialStep(step), /cannot make a new paid model request/u);
  }
  for (const step of ['preview', 'book', 'publish', 'service-price']) {
    assert.doesNotThrow(() => assertHttpsTrialStep(step));
  }
});

test('server-side negative probes cannot become arbitrary URL requests', () => {
  const profile = aiTrialOrigins(true);
  assert.deepEqual(trialApiTarget('/api/appointments', profile), { url: 'https://luster-builder.test:3443/api/appointments', headers: {} });
  assert.throws(() => trialApiTarget('//external.invalid/api', profile), /isolated application/u);
  assert.throws(() => trialApiTarget('https://user:password@luster-builder.test:3443/api', profile), /URL credentials/u);
});

test('the CONNECT proxy permits only the two fixed HTTPS authorities', () => {
  const profile = aiTrialOrigins(true);
  assert.equal(aiTrialTunnelPort('luster-builder.test:3443', profile), 3443);
  assert.equal(aiTrialTunnelPort('luster-render.test:3444', profile), 3444);
  for (const target of ['example.com:443', '127.0.0.1:55432', 'luster-builder.test:3444', 'luster-builder.test:443', 'user@luster-builder.test:3443', 'luster-builder.test:3443/']) {
    assert.equal(aiTrialTunnelPort(target, profile), null);
  }
});

test('browser HTTPS requests keep native cookie handling instead of API replay', async () => {
  const profile = aiTrialOrigins(true);
  let handler;
  await restrictAiTrialNetwork({ route: async (_pattern, callback) => {
    handler = callback;
  } }, profile);
  const effects = [];
  const request = url => ({
    request: () => ({ url: () => url }),
    continue: async () => effects.push('continue'),
    abort: async () => effects.push('abort'),
    fetch: async () => {
      throw new Error('Do not replay browser cookies through an API request.');
    },
  });
  await handler(request(`${profile.origin}/admin/business-setup`));
  await handler(request(`${profile.rendererOrigin}/renderer`));
  await handler(request('https://external.invalid/'));
  assert.deepEqual(effects, ['continue', 'continue', 'abort']);
});
