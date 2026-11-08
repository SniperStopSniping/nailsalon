/** Independent boundary/race tests. Every SDK call uses closed in-memory HTTP. */
import { readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createInactiveStripeCheckoutAdapter } from './checkoutAdapter';
import type { InactiveStripeCheckoutInput } from './checkoutContract';

vi.mock('server-only', () => ({}));

const now = Date.parse('2026-11-08T15:00:00Z');
const binding = { platformAccountId: 'acct_reviewPlatform', connectedAccountId: 'acct_reviewSalon', mode: 'test', returnOrigin: 'https://review.invalid' } as const;
function material(suffix = '1'): InactiveStripeCheckoutInput {
  return {
    operationId: `10000000-0000-4000-8000-00000000000${suffix}`,
    requestId: `20000000-0000-4000-8000-00000000000${suffix}`,
    quoteId: `30000000-0000-4000-8000-00000000000${suffix}`,
    salonId: 'review_salon',
    appointmentId: `review_appointment_${suffix}`,
    contextHash: 'a'.repeat(64),
    createdAt: now,
    quoteExpiresAt: now + 300000,
    sessionExpiresAt: now + 2100000,
    successUrl: 'https://review.invalid/success',
    cancelUrl: 'https://review.invalid/cancel',
    quote: { currency: 'cad', servicesCents: 10000, discountCents: 0, taxCents: 1300, tipCents: 0, collection: 'full', feePolicy: { payer: 'salon', feeCents: 100, taxTreatment: 'not_collected_in_test_mode' } },
  };
}
function session(suffix = '1') {
  return {
    id: `cs_test_review${suffix}`,
    object: 'checkout.session',
    livemode: false,
    mode: 'payment',
    client_reference_id: material(suffix).quoteId,
    currency: 'cad',
    amount_total: 11300,
    amount_subtotal: 11300,
    created: now / 1000,
    expires_at: material().sessionExpiresAt / 1000,
    payment_method_types: ['card'],
    automatic_tax: { enabled: false },
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
    status: 'open',
    payment_status: 'unpaid',
    payment_intent: 'pi_sharedReview',
  };
}
type Step = { method: string; path: string; account?: string; value: object; pause?: Promise<void>; fail?: boolean };
function preflight(): Step[] {
  return [
    { method: 'GET', path: '/v1/account', value: { id: binding.platformAccountId, object: 'account' } },
    { method: 'GET', path: '/v1/balance', value: { object: 'balance', livemode: false } },
    { method: 'GET', path: `/v1/accounts/${binding.connectedAccountId}`, value: {
      id: binding.connectedAccountId,
      object: 'account',
      country: 'CA',
      default_currency: 'cad',
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      capabilities: { card_payments: 'active' },
      controller: { stripe_dashboard: { type: 'full' }, fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe' },
      requirements: { disabled_reason: null, currently_due: [], past_due: [], pending_verification: [], errors: null },
    } },
    { method: 'GET', path: '/v1/balance', account: binding.connectedAccountId, value: { object: 'balance', livemode: false } },
  ];
}
const post = (suffix = '1'): Step => ({ method: 'POST', path: '/v1/checkout/sessions', account: binding.connectedAccountId, value: session(suffix) });
function setup(steps: Step[]) {
  const calls: Array<{ method: string; path: string }> = [];
  const violations: string[] = [];
  const pending = [...steps];
  const client: Stripe.HttpClient = {
    getClientName: () => 'review-closed-http',
    async makeRequest(host, port, rawPath, method, headers, _body, protocol) {
      const requestPath = decodeURI(rawPath);
      const requestHeaders = headers as Record<string, string>;
      calls.push({ method, path: requestPath });
      const step = pending.shift();
      if (host !== 'api.stripe.com' || port !== '443' || protocol !== 'https'
        || !step || method !== step.method || requestPath !== step.path
        || requestHeaders['Stripe-Account'] !== step.account) {
        violations.push(`${method} ${requestPath}`);
        throw new Error('REVIEW_UNEXPECTED_HTTP');
      }
      await step.pause;
      if (step.fail) {
        throw Object.assign(new Error('private transport detail'), { code: 'ECONNRESET' });
      }
      const responseHeaders = { 'stripe-version': '2024-06-20', 'request-id': 'req_review' };
      return {
        getStatusCode: () => 200,
        getHeaders: () => responseHeaders,
        getRawResponse: () => ({ statusCode: 200 }),
        toStream: () => {
          throw new Error('REVIEW_STREAM_FORBIDDEN');
        },
        toJSON: async () => structuredClone(step.value),
      };
    },
  };
  const adapter = createInactiveStripeCheckoutAdapter({ enabled: true, purpose: 'unregistered_test_adapter', binding, testSecretKey: 'sk_test_placeholder', httpClient: client });
  return { adapter, calls, violations, pending };
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.spyOn(http, 'request').mockImplementation(() => {
    throw new Error('REVIEW_REAL_HTTP_FORBIDDEN');
  });
  vi.spyOn(https, 'request').mockImplementation(() => {
    throw new Error('REVIEW_REAL_HTTPS_FORBIDDEN');
  });
  vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error('REVIEW_REAL_FETCH_FORBIDDEN');
  }));
});

afterEach(() => {
  expect(http.request).not.toHaveBeenCalled();
  expect(https.request).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();

  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('independent inactive Stripe adapter boundaries', () => {
  it.each([false, true])('keeps ownership review absorbing when an earlier retrieval finishes, failure=%s', async (fail) => {
    let release!: () => void;
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const wire = setup([
      ...preflight(),
      post(),
      ...preflight(),
      { method: 'GET', path: '/v1/checkout/sessions/cs_test_review1?expand[0]=payment_intent.latest_charge', account: binding.connectedAccountId, value: session(), pause, fail },
      ...preflight(),
      post('2'),
    ]);
    const first = wire.adapter.prepare(material());
    const second = wire.adapter.prepare(material('2'));
    await wire.adapter.create(first);
    const retrieval = wire.adapter.reconcile(first);
    await vi.waitFor(() => expect(wire.calls).toHaveLength(10));

    expect(await wire.adapter.create(second)).toMatchObject({ state: 'review', reason: 'object_ownership_conflict' });

    release();

    expect(await retrieval).toMatchObject({ state: 'review', reason: 'object_ownership_conflict' });
    expect(wire.adapter.inspect(first)).toMatchObject({ state: 'review', reason: 'object_ownership_conflict' });
    expect(wire.adapter.inspect(second)).toMatchObject({ state: 'review', reason: 'object_ownership_conflict' });
    expect(wire.calls.filter(call => call.method === 'POST')).toHaveLength(2);
    expect(wire.violations).toEqual([]);
    expect(wire.pending).toEqual([]);
  });

  it.each(['runtime', 'expiry'])('rechecks %s inside the SDK asynchronous request gap', async (change) => {
    let continuePost!: () => void;
    let requestCount = 0;
    const prototype = Stripe.prototype as unknown as { getClientUserAgent: (callback: (value: string) => void) => void };
    vi.spyOn(prototype, 'getClientUserAgent').mockImplementation((callback) => {
      requestCount++;
      if (requestCount === 5) {
        continuePost = () => callback('{}');
      } else {
        callback('{}');
      }
    });
    const wire = setup(preflight());
    const pending = wire.adapter.create(wire.adapter.prepare(material()));
    await vi.waitFor(() => expect(continuePost).toBeTypeOf('function'));
    if (change === 'runtime') {
      vi.stubEnv('APP_ENV', 'production');
    } else {
      vi.mocked(Date.now).mockReturnValue(material().quoteExpiresAt);
    }
    continuePost();
    await pending;

    expect(wire.calls).toHaveLength(4);
    expect(wire.calls.every(call => call.method === 'GET')).toBe(true);
    expect(wire.violations).toEqual([]);
  });

  it.each(['production', 'unknown', 'staging'])('rejects an unsupported runtime before touching the HTTP transport: %s', (value) => {
    vi.stubEnv('APP_ENV', value);
    const getter = vi.fn(() => {
      throw new Error('TRANSPORT_SHOULD_NOT_BE_READ');
    });
    const configuration = { enabled: true as const, purpose: 'unregistered_test_adapter' as const, binding, testSecretKey: 'sk_test_placeholder', get httpClient(): Stripe.HttpClient {
      return getter();
    } };

    expect(() => createInactiveStripeCheckoutAdapter(configuration)).toThrow('RUNTIME_DISABLED');
    expect(getter).not.toHaveBeenCalled();
  });

  it('has no import from application or existing offline runtime into the new adapter', () => {
    const sourceRoot = path.resolve('src');
    const adapterRoot = path.join(sourceRoot, 'libs/customerPayments/inactiveStripe');
    const references: string[] = [];
    function visit(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (file === adapterRoot) {
          continue;
        }
        if (entry.isDirectory()) {
          visit(file);
        } else if (/\.tsx?$/.test(file) && !/\.(?:test|spec)\.tsx?$/.test(file)
          && /inactiveStripe\/|checkoutAdapter['"]/.test(readFileSync(file, 'utf8'))) {
          references.push(file);
        }
      }
    }
    visit(sourceRoot);

    expect(references).toEqual([]);
  });
});
