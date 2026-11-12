import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';

import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildInactiveStripeCheckoutOperation } from './checkoutContract';
import { createInactiveStripeCheckoutSdkKernel } from './checkoutSdkKernel';
import type { ClosedCheckoutSdkStep, ClosedSdkCheckoutAuthorization, ClosedSdkCheckoutOutcome } from './closedCheckoutSdkTransport';
import { createClosedCheckoutSdkExecution, createClosedCheckoutSdkTransport, getSdkClosedOutcome, inspectClosedCheckoutSdkTransport, releaseClosedCheckoutSdkTransport } from './closedCheckoutSdkTransport';
import type { DurableCheckoutLease, DurableCheckoutResult } from './durableCheckoutRepository';
import * as durableRepository from './durableCheckoutRepository';
import { createDurableCheckoutSdkBridge } from './durableCheckoutSdkBridge';

vi.mock('server-only', () => ({}));
const now = Date.parse('2026-11-08T12:00:00.000Z');
const binding = { platformAccountId: 'acct_platform', connectedAccountId: 'acct_salon', mode: 'test', returnOrigin: 'https://closed.invalid' } as const;
const operation = buildInactiveStripeCheckoutOperation({
  operationId: '10000000-0000-4000-8000-000000000001',
  requestId: '20000000-0000-4000-8000-000000000001',
  salonId: 'salon_one',
  appointmentId: 'appointment_one',
  quoteId: '30000000-0000-4000-8000-000000000001',
  contextHash: 'a'.repeat(64),
  createdAt: now,
  quoteExpiresAt: now + 300000,
  sessionExpiresAt: now + 2100000,
  successUrl: 'https://closed.invalid/payment-return',
  cancelUrl: 'https://closed.invalid/payment-cancel',
  quote: { currency: 'cad', servicesCents: 10000, discountCents: 0, taxCents: 1300, tipCents: 2000, collection: 'full', feePolicy: { payer: 'salon', feeCents: 100, taxTreatment: 'not_collected_in_test_mode' } },
}, binding);
const claim: DurableCheckoutLease = { operationId: operation.material.operationId, version: 2, token: randomUUID(), activity: 'create' };
function session() {
  return { id: 'cs_test_wire', object: 'checkout.session', livemode: false, mode: 'payment', client_reference_id: operation.material.quoteId, currency: 'cad', amount_total: 13300, amount_subtotal: 13300, created: now / 1000, expires_at: operation.params.expires_at, payment_method_types: ['card'], automatic_tax: { enabled: false }, total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 }, status: 'open', payment_status: 'unpaid', payment_intent: null, url: 'private-url', customer_details: { email: 'private@example.invalid' } };
}
function preflight(ready = true): ClosedCheckoutSdkStep[] {
  return [
    { method: 'GET', path: '/v1/account', response: { id: binding.platformAccountId, object: 'account' } },
    { method: 'GET', path: '/v1/balance', response: { object: 'balance', livemode: false } },
    { method: 'GET', path: `/v1/accounts/${binding.connectedAccountId}`, response: { id: binding.connectedAccountId, object: 'account', country: 'CA', default_currency: 'cad', charges_enabled: ready, payouts_enabled: ready, details_submitted: true, capabilities: { card_payments: ready ? 'active' : 'inactive' }, controller: { stripe_dashboard: { type: 'full' }, fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe' }, requirements: { disabled_reason: ready ? null : 'paused', currently_due: [], past_due: [], pending_verification: [], errors: [] } } },
    { method: 'GET', path: '/v1/balance', account: binding.connectedAccountId, response: { object: 'balance', livemode: false } },
  ];
}
const post = (patch: Partial<ClosedCheckoutSdkStep> = {}): ClosedCheckoutSdkStep => ({ method: 'POST', path: '/v1/checkout/sessions', account: binding.connectedAccountId, response: session(), ...patch });
const retrieve = (patch: Partial<ClosedCheckoutSdkStep> = {}): ClosedCheckoutSdkStep => ({ method: 'GET', path: '/v1/checkout/sessions/cs_test_wire?expand[0]=payment_intent.latest_charge', account: binding.connectedAccountId, response: session(), ...patch });
function authorization(activity: DurableCheckoutLease['activity'] = 'create'): ClosedSdkCheckoutAuthorization {
  return { result: { state: 'dispatch_intent', providerOriginVerified: false, financialPostingAllowed: false } as DurableCheckoutResult, lease: { ...claim, activity, version: 3 }, permit: { databaseNow: now, sampleStarted: performance.now(), leaseUntil: now + 60000, quoteExpiresAt: activity === 'create' ? operation.material.quoteExpiresAt : null, sessionId: activity === 'create' ? null : 'cs_test_wire' } };
}
function fakeRepository() {
  const auth = authorization();
  const events: string[] = [];
  const repository = {
    reserveAuthenticated: vi.fn(async () => {
      events.push('reserve');
      return { operation, result: auth.result };
    }),
    resumeAuthenticated: vi.fn(async () => {
      events.push('resume');
      return { operation, result: auth.result };
    }),
    restoreForReconciliation: vi.fn(async () => ({ operation, result: auth.result })),
    claimCreate: vi.fn(async () => {
      events.push('claim');
      return { result: auth.result, lease: claim };
    }),
    claimReconcile: vi.fn(async () => ({ result: { ...auth.result, state: 'review', session: { sessionId: 'cs_test_wire' } }, lease: { ...claim, activity: 'retrieve' as const } })),
    recordDispatchIntent: vi.fn(async () => {
      events.push('intent');
      return { result: auth.result, lease: claim };
    }),
    consumeSdkPermit: vi.fn(async (_operation: typeof operation, lease: DurableCheckoutLease) => {
      events.push('committed-consume');
      return authorization(lease.activity);
    }),
    recordSdkOutcome: vi.fn(async (_operation: typeof operation, lease: DurableCheckoutLease, outcome: ClosedSdkCheckoutOutcome) => {
      events.push('outcome');

      expect(getSdkClosedOutcome(outcome, operation, lease)).toMatchObject({ ok: true });

      return auth.result;
    }),
  };
  return { repository, events };
}

beforeEach(() => {
  // Unit tests isolate installed-SDK timing/wire behavior. Real repository mint,
  // private capability refusal and restart semantics have separate integration tests.
  vi.spyOn(durableRepository, 'consumeCommittedSdkAuthorization').mockImplementation(value => value);
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
  vi.spyOn(http, 'request').mockImplementation(() => {
    throw new Error('NETWORK_FORBIDDEN');
  });
  vi.spyOn(https, 'request').mockImplementation(() => {
    throw new Error('NETWORK_FORBIDDEN');
  });
  vi.spyOn(Stripe, 'createNodeHttpClient').mockImplementation(() => {
    throw new Error('NODE_HTTP_FORBIDDEN');
  });
  vi.spyOn(Stripe, 'createFetchHttpClient').mockImplementation(() => {
    throw new Error('FETCH_HTTP_FORBIDDEN');
  });
  vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error('NETWORK_FORBIDDEN');
  }));
});

afterEach(() => {
  expect(http.request).not.toHaveBeenCalled();
  expect(https.request).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(Stripe.createNodeHttpClient).not.toHaveBeenCalled();
  expect(Stripe.createFetchHttpClient).not.toHaveBeenCalled();

  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('actual SDK closed durable dispatch boundary', () => {
  it('uses actual SDK methods and commits one-use authority only at the exact serialized POST', async () => {
    const transport = createClosedCheckoutSdkTransport([...preflight(), post()]);
    const execution = createClosedCheckoutSdkExecution(transport, operation, 'create', null);
    await execution.preflight();
    const committed = authorization();
    const consume = vi.fn(async () => {
      expect(inspectClosedCheckoutSdkTransport(transport).calls).toHaveLength(4);

      return committed;
    });
    const result = await execution.execute(claim, consume);

    expect(consume).toHaveBeenCalledTimes(1);
    expect(inspectClosedCheckoutSdkTransport(transport).calls[4]).toMatchObject({ method: 'POST', account: binding.connectedAccountId, idempotencyKey: operation.idempotencyKey, apiVersion: '2024-06-20', parameterHash: operation.parameterHash });
    expect(getSdkClosedOutcome(result.outcome!, operation, result.lease!)).toMatchObject({ ok: true, response: { id: 'cs_test_wire' } });
    expect(JSON.stringify(inspectClosedCheckoutSdkTransport(transport))).not.toMatch(/private-url|private@example|sk_test|success_url|cancel_url/);
    await expect(execution.execute(claim, consume)).rejects.toThrow('SDK_EXECUTION_NOT_PREPARED');
  });

  it.each(['ECONNRESET', 'EPIPE', 'ETIMEDOUT'] as const)('suppresses the installed SDK hidden %s retry after one consumed POST', async (errorCode) => {
    const transport = createClosedCheckoutSdkTransport([...preflight(), post({ errorCode })]);
    const execution = createClosedCheckoutSdkExecution(transport, operation, 'create', null);
    await execution.preflight();
    const consume = vi.fn(async () => authorization());
    const observed = await execution.execute(claim, consume);

    expect(getSdkClosedOutcome(observed.outcome!, operation, observed.lease!)).toEqual({ ok: false });
    expect(consume).toHaveBeenCalledTimes(1);
    expect(inspectClosedCheckoutSdkTransport(transport).calls.filter(call => call.method === 'POST')).toHaveLength(1);
  });

  it('sends nothing for an uncertain commit and cannot repeat the SDK execution', async () => {
    const transport = createClosedCheckoutSdkTransport([...preflight(), post()]);
    const execution = createClosedCheckoutSdkExecution(transport, operation, 'create', null);
    await execution.preflight();
    const consume = vi.fn(async () => {
      throw new Error('COMMIT_OUTCOME_UNKNOWN');
    });

    await expect(execution.execute(claim, consume)).rejects.toThrow('SDK_PERMIT_NOT_CONFIRMED');
    expect(consume).toHaveBeenCalledTimes(1);
    expect(inspectClosedCheckoutSdkTransport(transport).calls).toHaveLength(4);
    await expect(execution.execute(claim, consume)).rejects.toThrow('SDK_EXECUTION_NOT_PREPARED');
  });

  it.each(['runtime', 'lease', 'quote', 'elapsed', 'bound-session'] as const)('rechecks %s after committed authorization, immediately before closed send', async (change) => {
    const transport = createClosedCheckoutSdkTransport([...preflight(), post()]);
    const execution = createClosedCheckoutSdkExecution(transport, operation, 'create', null);
    await execution.preflight();
    const observed = await execution.execute(claim, async () => {
      const auth = authorization();
      if (change === 'runtime') {
        vi.stubEnv('APP_ENV', 'production');
      }
      if (change === 'lease') {
        return { ...auth, permit: { ...auth.permit!, leaseUntil: now } };
      }
      if (change === 'elapsed') {
        return { ...auth, permit: { ...auth.permit!, sampleStarted: performance.now() - 60001 } };
      }
      if (change === 'quote') {
        return { ...auth, permit: { ...auth.permit!, databaseNow: operation.material.quoteExpiresAt, leaseUntil: now + 600000 } };
      }
      if (change === 'bound-session') {
        return { ...auth, permit: { ...auth.permit!, sessionId: 'cs_test_wrong' } };
      }
      return auth;
    });
    vi.stubEnv('APP_ENV', 'development');

    expect(inspectClosedCheckoutSdkTransport(transport).calls).toHaveLength(4);
    expect(getSdkClosedOutcome(observed.outcome!, operation, observed.lease!)).toEqual({ ok: false });
  });

  it.each(['method', 'path', 'account', 'api-version', 'idempotency', 'body', 'host', 'credential'] as const)('rejects altered actual SDK %s before obtaining authorization or consuming HTTP', async (change) => {
    const transport = createClosedCheckoutSdkTransport([...preflight(), post()]);
    const execution = createClosedCheckoutSdkExecution(transport, operation, 'create', null);
    await execution.preflight();
    type RequestOptions = { requestMethod: string; requestPath: string; headers: Record<string, string>; bodyData: Record<string, unknown>; host: string; auth: string };
    const resource = (Stripe as unknown as { StripeResource: { prototype: { _getRequestOpts: (...args: unknown[]) => RequestOptions } } }).StripeResource.prototype;
    const original = resource._getRequestOpts;
    vi.spyOn(resource, '_getRequestOpts').mockImplementation(function (this: unknown, ...args) {
      const request = original.apply(this, args);
      if (change === 'method') {
        request.requestMethod = 'DELETE';
      }
      if (change === 'path') {
        request.requestPath = '/v1/refunds';
      }
      if (change === 'account') {
        request.headers['Stripe-Account'] = 'acct_wrong';
      }
      if (change === 'api-version') {
        request.headers['Stripe-Version'] = '2020-08-27';
      }
      if (change === 'idempotency') {
        request.headers['Idempotency-Key'] = 'wrong-key';
      }
      if (change === 'body') {
        request.bodyData.mode = 'subscription';
      }
      if (change === 'host') {
        request.host = 'example.invalid';
      }
      if (change === 'credential') {
        request.auth = 'sk_test_wrong';
      }
      return request;
    });
    const consume = vi.fn(async () => authorization());

    await expect(execution.execute(claim, consume)).rejects.toThrow('SDK_PERMIT_NOT_CONFIRMED');
    expect(consume).not.toHaveBeenCalled();
    expect(inspectClosedCheckoutSdkTransport(transport).calls).toHaveLength(4);
  });

  it('counts async SDK preparation before requesting the durable permit', async () => {
    const transport = createClosedCheckoutSdkTransport([...preflight(), post()]);
    const execution = createClosedCheckoutSdkExecution(transport, operation, 'create', null);
    await execution.preflight();
    const sdkPrototype = Stripe.prototype as unknown as { getClientUserAgent: (callback: (value: string) => void) => void };
    let release: (() => void) | undefined;
    vi.spyOn(sdkPrototype, 'getClientUserAgent').mockImplementation((callback) => {
      release = () => callback('{}');
    });
    const consume = vi.fn(async () => ({ ...authorization(), permit: null, lease: null }));
    const pending = execution.execute(claim, consume);
    await vi.waitFor(() => expect(release).toBeDefined());

    expect(consume).not.toHaveBeenCalled();
    expect(inspectClosedCheckoutSdkTransport(transport).calls).toHaveLength(4);

    release!();
    const result = await pending;

    expect(result.outcome).toBeNull();
    expect(consume).toHaveBeenCalledTimes(1);
    expect(inspectClosedCheckoutSdkTransport(transport).calls).toHaveLength(4);
  });

  it('reconciles only the exact durably bound ID even when account creation readiness is disabled', async () => {
    const transport = createClosedCheckoutSdkTransport([...preflight(false), retrieve()]);
    const execution = createClosedCheckoutSdkExecution(transport, operation, 'retrieve', 'cs_test_wire');
    await execution.preflight();
    const observed = await execution.execute({ ...claim, activity: 'retrieve' }, async () => authorization('retrieve'));

    expect(getSdkClosedOutcome(observed.outcome!, operation, observed.lease!)).toMatchObject({ ok: true });
    expect(inspectClosedCheckoutSdkTransport(transport).calls.at(-1)?.path).toBe(retrieve().path);
    expect(() => createClosedCheckoutSdkExecution(transport, operation, 'retrieve', null)).toThrow('SDK_EXACT_SESSION_REQUIRED');
  });

  it('holds 404 and malformed response scope without another POST or provider authority', async () => {
    for (const step of [retrieve({ status: 404, response: { error: { type: 'invalid_request_error', code: 'resource_missing' } } }), retrieve({ responseHeaders: { 'stripe-account': 'acct_wrong' } })]) {
      const transport = createClosedCheckoutSdkTransport([...preflight(), step]);
      const execution = createClosedCheckoutSdkExecution(transport, operation, 'retrieve', 'cs_test_wire');
      await execution.preflight();
      const observed = await execution.execute({ ...claim, activity: 'retrieve' }, async () => authorization('retrieve'));

      expect(getSdkClosedOutcome(observed.outcome!, operation, observed.lease!)).toEqual(step.status ? { ok: false } : { ok: true, response: {} });
      expect(inspectClosedCheckoutSdkTransport(transport).calls.every(call => call.method === 'GET')).toBe(true);
    }
  });

  it('keeps late response evidence private-branded and bound to its consumed identity and claim', async () => {
    const transport = createClosedCheckoutSdkTransport([...preflight(), post({ pause: true })]);
    const execution = createClosedCheckoutSdkExecution(transport, operation, 'create', null);
    await execution.preflight();
    const pending = execution.execute(claim, async () => authorization());
    await vi.waitFor(() => expect(inspectClosedCheckoutSdkTransport(transport).paused).toBe(1));
    releaseClosedCheckoutSdkTransport(transport);
    const observed = await pending;

    expect(() => getSdkClosedOutcome({ kind: 'sdk_closed_http_outcome' }, operation, observed.lease!)).toThrow('DURABLE_CLOSED_SDK_OUTCOME_REQUIRED');
    expect(() => getSdkClosedOutcome(structuredClone(observed.outcome) as ClosedSdkCheckoutOutcome, operation, observed.lease!)).toThrow('DURABLE_CLOSED_SDK_OUTCOME_REQUIRED');
    expect(() => getSdkClosedOutcome(observed.outcome!, operation, { ...observed.lease!, version: 99 })).toThrow('DURABLE_CLOSED_SDK_OUTCOME_REQUIRED');
    expect(Object.keys(observed.outcome!)).toEqual(['kind']);
  });

  it('rejects structural transport forgeries, caller code and missing HTTP client without any network fallback', () => {
    expect(() => createClosedCheckoutSdkExecution({ kind: 'closed_checkout_sdk_http' }, operation, 'create', null)).toThrow('CLOSED_SDK_TRANSPORT_REQUIRED');
    expect(() => createClosedCheckoutSdkTransport([{ ...post(), callback: () => {} }] as never)).toThrow('INVALID_CLOSED_SDK_SCRIPT');
    expect(() => createClosedCheckoutSdkTransport([{ ...post(), response: { execute: () => {} } }])).toThrow('INVALID_CLOSED_SDK_SCRIPT');
    expect(() => createInactiveStripeCheckoutSdkKernel(binding, 'sk_test_placeholder', undefined as never)).toThrow('SDK_HTTP_CLIENT_REQUIRED');
  });

  it('orchestrates authenticated reservation before preflight, intent, actual consumption and immutable observation', async () => {
    const transport = createClosedCheckoutSdkTransport([...preflight(), post()]);
    const { repository, events } = fakeRepository();
    const bridge = createDurableCheckoutSdkBridge(repository as never, transport);
    await bridge.create({ token: 'in-memory-only', salonId: operation.material.salonId, appointmentId: operation.material.appointmentId, quoteId: operation.material.quoteId, operationId: operation.material.operationId, requestId: operation.material.requestId, platformAccountId: binding.platformAccountId });

    expect(events).toEqual(['reserve', 'claim', 'intent', 'committed-consume', 'outcome']);
    expect(inspectClosedCheckoutSdkTransport(transport).calls).toHaveLength(5);
    expect(repository.recordSdkOutcome).toHaveBeenCalledTimes(1);
  });

  it('keeps internal reserved recovery read-only and separate from customer authentication', async () => {
    const transport = createClosedCheckoutSdkTransport([...preflight(false), retrieve()]);
    const { repository } = fakeRepository();
    const bridge = createDurableCheckoutSdkBridge(repository as never, transport);
    await bridge.reconcileReserved({ operationId: operation.material.operationId, salonId: operation.material.salonId, appointmentId: operation.material.appointmentId });

    expect(repository.restoreForReconciliation).toHaveBeenCalledOnce();
    expect(repository.resumeAuthenticated).not.toHaveBeenCalled();
    expect(repository.reserveAuthenticated).not.toHaveBeenCalled();
    expect(repository.claimCreate).not.toHaveBeenCalled();
    expect(repository.recordDispatchIntent).not.toHaveBeenCalled();
    expect(inspectClosedCheckoutSdkTransport(transport).calls.every(call => call.method === 'GET')).toBe(true);
    expect(repository.recordSdkOutcome).toHaveBeenCalledOnce();
  });

  it('contains no environment credential lookup, arbitrary client/fetch injection or real request fallback', () => {
    const source = readFileSync(new URL('./closedCheckoutSdkTransport.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/process\.env|createNodeHttpClient|createFetchHttpClient|\bfetch\(|https?\.request|\.env/);
    expect(source).toContain('const CLOSED_SDK_DUMMY_KEY = \'sk_test_placeholder\'');
  });
});
