import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InactiveStripeCheckoutConfiguration } from './checkoutAdapter';
import { createInactiveStripeCheckoutAdapter } from './checkoutAdapter';
import type { InactiveStripeCheckoutInput } from './checkoutContract';
import { buildInactiveStripeCheckoutOperation, INACTIVE_STRIPE_IDEMPOTENCY_WINDOW_MS } from './checkoutContract';

vi.mock('server-only', () => ({}));

const now = Date.parse('2026-11-08T12:00:00.000Z');
const binding = { platformAccountId: 'acct_platform', connectedAccountId: 'acct_salon', mode: 'test', returnOrigin: 'https://luster.invalid' } as const;
function input(): InactiveStripeCheckoutInput {
  return {
    operationId: '10000000-0000-4000-8000-000000000001',
    requestId: '20000000-0000-4000-8000-000000000001',
    salonId: 'salon_one',
    appointmentId: 'appointment_one',
    quoteId: '30000000-0000-4000-8000-000000000001',
    contextHash: 'a'.repeat(64),
    createdAt: now,
    quoteExpiresAt: now + 5 * 60 * 1000,
    sessionExpiresAt: now + 35 * 60 * 1000,
    successUrl: 'https://luster.invalid/payment-return',
    cancelUrl: 'https://luster.invalid/payment-cancel',
    quote: { currency: 'cad', servicesCents: 10000, discountCents: 0, taxCents: 1300, tipCents: 2000, collection: 'full', feePolicy: { payer: 'salon', feeCents: 100, taxTreatment: 'not_collected_in_test_mode' } },
  };
}
function account() {
  return {
    id: binding.connectedAccountId,
    object: 'account',
    country: 'CA',
    default_currency: 'cad',
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    capabilities: { card_payments: 'active', transfers: 'active' },
    controller: { stripe_dashboard: { type: 'full' }, fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe' },
    requirements: { currently_due: [], past_due: [], pending_verification: [], errors: [], disabled_reason: null },
  };
}
function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_test_session',
    object: 'checkout.session',
    livemode: false,
    mode: 'payment',
    client_reference_id: input().quoteId,
    currency: 'cad',
    amount_total: 13300,
    amount_subtotal: 13300,
    payment_method_types: ['card'],
    created: now / 1000,
    expires_at: input().sessionExpiresAt / 1000,
    automatic_tax: { enabled: false, liability: null, status: null },
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
    status: 'open',
    payment_status: 'unpaid',
    payment_intent: null,
    // Deliberately realistic unrelated SDK data. None is returned as authority or retained.
    metadata: { payment_status: 'paid', arbitrary: 'private-metadata' },
    url: 'https://checkout.stripe.com/c/pay/cs_test_private',
    customer_details: { email: 'private@example.invalid' },
    ...overrides,
  };
}
function intent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pi_payment',
    object: 'payment_intent',
    livemode: false,
    amount: 13300,
    amount_received: 13300,
    currency: 'cad',
    application_fee_amount: 100,
    capture_method: 'automatic',
    payment_method_types: ['card'],
    status: 'succeeded',
    transfer_data: null,
    on_behalf_of: null,
    latest_charge: {
      id: 'ch_payment',
      object: 'charge',
      livemode: false,
      payment_intent: 'pi_payment',
      amount: 13300,
      amount_captured: 13300,
      amount_refunded: 0,
      currency: 'cad',
      paid: true,
      captured: true,
      refunded: false,
      status: 'succeeded',
      application_fee_amount: 100,
      application_fee: 'fee_payment',
      transfer_data: null,
      on_behalf_of: null,
    },
    ...overrides,
  };
}
function paidSession(overrides: Record<string, unknown> = {}) {
  return session({ status: 'complete', payment_status: 'paid', payment_intent: intent(), ...overrides });
}
type Step = { method: string; path: string; account?: string; body?: object; status?: number; errorCode?: string; responseHeaders?: Record<string, string>; pause?: Promise<void> };
type Call = { path: string; method: string; account?: string; body: string | null; idempotencyKey?: string; apiVersion?: string };
function preflightSteps(connected = account()): Step[] {
  return [
    { method: 'GET', path: '/v1/account', body: { id: binding.platformAccountId, object: 'account' } },
    { method: 'GET', path: '/v1/balance', body: { object: 'balance', livemode: false, available: [], pending: [] } },
    { method: 'GET', path: `/v1/accounts/${binding.connectedAccountId}`, body: connected },
    { method: 'GET', path: '/v1/balance', account: binding.connectedAccountId, body: { object: 'balance', livemode: false, available: [], pending: [] } },
  ];
}
const createStep = (body: object = session()): Step => ({ method: 'POST', path: '/v1/checkout/sessions', account: binding.connectedAccountId, body });
const retrieveStep = (body: object = paidSession()): Step => ({ method: 'GET', path: '/v1/checkout/sessions/cs_test_session?expand[0]=payment_intent.latest_charge', account: binding.connectedAccountId, body });

/** Closed in-memory HTTP: unexpected requests throw, with no fallback or socket creation. */
function closedHttp(steps: Step[]) {
  const calls: Call[] = [];
  const violations: string[] = [];
  const pending = [...steps];
  const client: Stripe.HttpClient = {
    getClientName: () => 'closed-offline-http',
    async makeRequest(host, _port, path, method, headers, body, protocol) {
      const values = headers as Record<string, string>;
      const call = { path: decodeURI(path), method, account: values['Stripe-Account'], body, idempotencyKey: values['Idempotency-Key'], apiVersion: values['Stripe-Version'] };
      calls.push(call);
      const step = pending.shift();
      if (host !== 'api.stripe.com' || protocol !== 'https' || !step || step.method !== method || step.path !== call.path || step.account !== call.account) {
        violations.push(`${method} ${call.path}`);
        throw new Error('UNEXPECTED_CLOSED_HTTP_REQUEST');
      }
      if (step.pause) {
        await step.pause;
      }
      if (step.errorCode) {
        throw Object.assign(new Error('private provider error body'), { code: step.errorCode });
      }
      const responseHeaders = {
        'request-id': 'req_offline',
        'stripe-version': '2024-06-20',
        ...(call.account ? { 'stripe-account': call.account } : {}),
        ...(call.idempotencyKey ? { 'idempotency-key': call.idempotencyKey } : {}),
        ...step.responseHeaders,
      };
      const response: Stripe.HttpClientResponse = {
        getStatusCode: () => step.status ?? 200,
        getHeaders: () => responseHeaders,
        getRawResponse: () => ({ statusCode: step.status ?? 200, headers: responseHeaders }),
        toStream: () => {
          throw new Error('NO_STREAMS');
        },
        toJSON: async () => structuredClone(step.body ?? {}),
      };
      return response;
    },
  };
  return { client, calls, violations, pending };
}
const transports: ReturnType<typeof closedHttp>[] = [];
function setup(steps: Step[], overrides: Partial<InactiveStripeCheckoutConfiguration> = {}) {
  const wire = closedHttp(steps);
  transports.push(wire);
  const config: InactiveStripeCheckoutConfiguration = {
    enabled: true,
    purpose: 'unregistered_test_adapter',
    binding,
    // Public dummy literal used elsewhere in the repository. Not an actual credential.
    testSecretKey: 'sk_test_placeholder',
    httpClient: wire.client,
    ...overrides,
  };
  const adapter = createInactiveStripeCheckoutAdapter(config);
  return { wire, adapter, config };
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.spyOn(http, 'request').mockImplementation(() => {
    throw new Error('REAL_HTTP_FORBIDDEN');
  });
  vi.spyOn(https, 'request').mockImplementation(() => {
    throw new Error('REAL_HTTPS_FORBIDDEN');
  });
  vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error('REAL_FETCH_FORBIDDEN');
  }));
});

afterEach(() => {
  for (const wire of transports.splice(0)) {
    expect(wire.violations).toEqual([]);
  }

  expect(http.request).not.toHaveBeenCalled();
  expect(https.request).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();

  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('unregistered Stripe SDK Checkout adapter', () => {
  it('constructs and prepares without provider calls, and serializes a real SDK direct-charge create', async () => {
    const { adapter, wire } = setup([...preflightSteps(), createStep()]);
    const operation = adapter.prepare(input());

    expect(wire.calls).toEqual([]);
    expect(operation.snapshot).toMatchObject({ chargeCents: 13300, applicationFeeCents: 100, tipCents: 2000, customerPlatformFeeCents: 0 });

    const result = await adapter.create(operation);
    const post = wire.calls.at(-1)!;
    const form = Object.fromEntries(new URLSearchParams(post.body!));

    expect(result).toMatchObject({ state: 'session_observed', providerOriginVerified: false, financialPostingAllowed: false, session: { paymentStatus: 'unpaid', paymentIntentId: null, feeCheck: 'awaiting_intent' } });
    expect(form).toEqual({
      'mode': 'payment',
      'payment_method_types[0]': 'card',
      'client_reference_id': input().quoteId,
      'success_url': input().successUrl,
      'cancel_url': input().cancelUrl,
      'expires_at': String(input().sessionExpiresAt / 1000),
      'automatic_tax[enabled]': 'false',
      'allow_promotion_codes': 'false',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'cad',
      'line_items[0][price_data][unit_amount]': '13300',
      'line_items[0][price_data][product_data][name]': 'Appointment payment and optional tip',
      'payment_intent_data[application_fee_amount]': '100',
      'payment_intent_data[capture_method]': 'automatic',
      'expand[0]': 'payment_intent.latest_charge',
    });
    expect(post).toMatchObject({ account: binding.connectedAccountId, idempotencyKey: operation.idempotencyKey, apiVersion: '2024-06-20' });
    expect(wire.calls).toHaveLength(5);
    expect(JSON.stringify(result)).not.toMatch(/private|checkout\.stripe|metadata|secret/i);
    expect(await adapter.create(operation)).toBe(result);
    expect(wire.calls).toHaveLength(5);
  });

  it('reconciles only its create-bound Session ID with real SDK expansion/scoping after quote expiry', async () => {
    const { adapter, wire } = setup([...preflightSteps(), createStep(), ...preflightSteps(), retrieveStep()]);
    const operation = adapter.prepare(input());
    await adapter.create(operation);
    vi.mocked(Date.now).mockReturnValue(now + 10 * 60 * 1000);

    const result = await adapter.reconcile(operation);

    expect(result).toMatchObject({ state: 'session_observed', financialPostingAllowed: false, session: { sessionId: 'cs_test_session', paymentIntentId: 'pi_payment', chargeId: 'ch_payment', feeCheck: 'captured_charge_amount_matches', paymentStatus: 'paid' } });
    expect(wire.calls.at(-1)).toMatchObject({ method: 'GET', account: binding.connectedAccountId, idempotencyKey: undefined });
    expect(wire.pending).toHaveLength(0);
  });

  it('retrieves an existing Session while its account is paused, without permitting new checkout creation', async () => {
    const pausedAccount = {
      ...account(),
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      capabilities: { card_payments: 'inactive' },
      requirements: { currently_due: ['identity'], past_due: ['identity'], pending_verification: ['business'], errors: [{ code: 'verification_failed' }], disabled_reason: 'requirements.past_due' },
    };
    const reads = preflightSteps();
    reads[2]!.body = pausedAccount;
    const { adapter, wire } = setup([...preflightSteps(), createStep(), ...reads, retrieveStep()]);
    const operation = adapter.prepare(input());
    await adapter.create(operation);

    expect(await adapter.reconcile(operation)).toMatchObject({ state: 'session_observed', financialPostingAllowed: false, session: { paymentStatus: 'paid', chargeId: 'ch_payment' } });
    expect(wire.calls.slice(5).every(call => call.method === 'GET')).toBe(true);
    expect(wire.calls.filter(call => call.method === 'POST')).toHaveLength(1);

    const blocked = setup(reads);

    await expect(blocked.adapter.create(blocked.adapter.prepare(input()))).rejects.toThrow('PREFLIGHT_FAILED_WITHOUT_CREATE');
    expect(blocked.wire.calls.every(call => call.method === 'GET')).toBe(true);
  });

  it.each([
    ['account identity', 2, { ...account(), id: 'acct_other' }, 200],
    ['controller scope', 2, { ...account(), controller: { ...account().controller, losses: { payments: 'application' } } }, 200],
    ['connected mode', 3, { object: 'balance', livemode: true }, 200],
    ['provider authorization', 2, { error: { type: 'invalid_request_error', message: 'private authorization error' } }, 403],
  ])('still refuses %s mismatch during read-only reconciliation', async (_name, index, body, status) => {
    const reads = preflightSteps();
    reads[index] = { ...reads[index]!, body, status };
    const { adapter, wire } = setup([...preflightSteps(), createStep(), ...reads]);
    const operation = adapter.prepare(input());
    await adapter.create(operation);

    expect(await adapter.reconcile(operation)).toMatchObject({ state: 'uncertain', reason: 'retrieval_unresolved', financialPostingAllowed: false, session: { sessionId: 'cs_test_session' } });
    expect(wire.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(wire.calls.filter(call => call.path.startsWith('/v1/checkout/sessions/'))).toHaveLength(0);
  });

  it.each([
    ['unexpanded intent', 'pi_payment', 'awaiting_intent'],
    ['unexpanded latest charge', intent({ latest_charge: 'ch_payment' }), 'intent_amount_matches'],
    ['expanded fee reference', intent({ latest_charge: { ...intent().latest_charge, application_fee: { id: 'fee_payment', object: 'application_fee' } } }), 'captured_charge_amount_matches'],
  ])('handles %s without inventing missing fee/capture proof', async (_name, paymentIntent, feeCheck) => {
    const { adapter } = setup([...preflightSteps(), createStep(paidSession({ payment_intent: paymentIntent }))]);
    const result = await adapter.create(adapter.prepare(input()));

    expect(result).toMatchObject({ state: 'session_observed', financialPostingAllowed: false, providerOriginVerified: false, session: { feeCheck } });
  });

  it('reuses quote math for deposit plus tip and explicit zero-fee scenarios', async () => {
    const material = input();
    material.quote = { ...material.quote, collection: 'deposit', depositCents: 3000, feePolicy: { ...material.quote.feePolicy, feeCents: 0 } };
    const { adapter, wire } = setup([...preflightSteps(), createStep(session({ amount_total: 5000, amount_subtotal: 5000 }))]);
    const operation = adapter.prepare(material);
    await adapter.create(operation);
    const body = new URLSearchParams(wire.calls.at(-1)!.body!);

    expect(operation.snapshot).toMatchObject({ chargeCents: 5000, remainingCents: 8300, applicationFeeCents: 0 });
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('5000');
    expect(body.has('payment_intent_data[application_fee_amount]')).toBe(false);
    expect(body.get('line_items[0][price_data][product_data][name]')).toBe('Appointment deposit and optional tip');
  });

  it('accepts a zero-fee captured response with null fee fields and no transfers capability', async () => {
    const connected = { ...account(), capabilities: { card_payments: 'active' } };
    const steps = preflightSteps();
    steps[2]!.body = connected;
    const paymentIntent = intent({ application_fee_amount: null, latest_charge: { ...intent().latest_charge, application_fee_amount: null, application_fee: null } });
    const { adapter } = setup([...steps, createStep(paidSession({ payment_intent: paymentIntent }))]);
    const material = input();
    material.quote.feePolicy.feeCents = 0;

    expect(await adapter.create(adapter.prepare(material))).toMatchObject({ state: 'session_observed', session: { feeCheck: 'captured_charge_amount_matches' } });
  });

  it('allows a declined uncaptured card attempt with no fee to evolve into a new successful charge', async () => {
    const declined = intent({
      status: 'requires_payment_method',
      amount_received: 0,
      latest_charge: { ...intent().latest_charge, id: 'ch_declined', status: 'failed', paid: false, captured: false, amount_captured: 0, application_fee: null, application_fee_amount: null },
    });
    const { adapter } = setup([...preflightSteps(), createStep(session({ payment_intent: declined })), ...preflightSteps(), retrieveStep()]);
    const operation = adapter.prepare(input());

    expect(await adapter.create(operation)).toMatchObject({ state: 'session_observed', session: { chargeId: 'ch_declined', feeCheck: 'intent_amount_matches', paymentStatus: 'unpaid' } });
    expect(await adapter.reconcile(operation)).toMatchObject({ state: 'session_observed', session: { chargeId: 'ch_payment', feeCheck: 'captured_charge_amount_matches', paymentStatus: 'paid' } });
  });

  it('does not permit an already captured charge to change on the same intent', async () => {
    const replacement = intent({ latest_charge: { ...intent().latest_charge, id: 'ch_replacement' } });
    const { adapter } = setup([...preflightSteps(), createStep(paidSession()), ...preflightSteps(), retrieveStep(paidSession({ payment_intent: replacement }))]);
    const operation = adapter.prepare(input());
    await adapter.create(operation);

    expect(await adapter.reconcile(operation)).toMatchObject({ state: 'review', session: { chargeId: 'ch_payment' } });
  });

  it.each([
    ['customer-paid fees', { quote: { ...input().quote, feePolicy: { ...input().quote.feePolicy, payer: 'customer' } } }],
    ['in-person collection', { quote: { ...input().quote, collection: 'offline' } }],
    ['foreign currency', { quote: { ...input().quote, currency: 'usd' } }],
    ['fractional cents', { quote: { ...input().quote, tipCents: 0.5 } }],
    ['oversize charge', { quote: { ...input().quote, servicesCents: 50_000_000 } }],
    ['caller-supplied metadata', { metadata: { payment_status: 'paid' } }],
    ['foreign success origin', { successUrl: 'https://other.invalid/return' }],
    ['invalid ownership identifier', { salonId: 'salon\n' }],
    ['missing explicit fee policy', { quote: { ...input().quote, feePolicy: undefined } }],
  ])('refuses %s in immutable preparation', (_name, patch) => {
    const { adapter, wire } = setup([]);

    expect(() => adapter.prepare({ ...input(), ...patch } as InactiveStripeCheckoutInput)).toThrow();
    expect(wire.calls).toEqual([]);
  });

  it('binds owner, account, quote, context, amount and expiry into a stable idempotency identity', () => {
    const baseline = buildInactiveStripeCheckoutOperation(input(), binding);

    expect(buildInactiveStripeCheckoutOperation(structuredClone(input()), { ...binding }).idempotencyKey).toBe(baseline.idempotencyKey);

    for (const patch of [
      { salonId: 'salon_other' },
      { appointmentId: 'appointment_other' },
      { contextHash: 'b'.repeat(64) },
      { quoteId: '30000000-0000-4000-8000-000000000002' },
      { quote: { ...input().quote, tipCents: 2100 } },
      { sessionExpiresAt: input().sessionExpiresAt + 1000 },
    ]) {
      expect(buildInactiveStripeCheckoutOperation({ ...input(), ...patch }, binding).idempotencyKey).not.toBe(baseline.idempotencyKey);
    }

    expect(buildInactiveStripeCheckoutOperation(input(), { ...binding, connectedAccountId: 'acct_other' }).idempotencyKey).not.toBe(baseline.idempotencyKey);
  });

  it.each(['NODE_ENV', 'APP_ENV', 'VERCEL_ENV'])('rejects production %s before SDK construction or dispatch', async (marker) => {
    const { adapter, wire } = setup([]);
    const operation = adapter.prepare(input());
    vi.stubEnv(marker, 'production');

    expect(() => setup([])).toThrow('RUNTIME_DISABLED');
    await expect(adapter.create(operation)).rejects.toThrow('RUNTIME_DISABLED');
    expect(wire.calls).toEqual([]);
  });

  it.each([
    { testSecretKey: 'sk_live_placeholder' },
    { testSecretKey: 'ci-placeholder-not-a-secret' },
    { binding: { ...binding, mode: 'live' } },
    { binding: { ...binding, connectedAccountId: binding.platformAccountId } },
    { enabled: false },
  ])('rejects invalid explicit configuration without network', (patch) => {
    expect(() => setup([], patch as Partial<InactiveStripeCheckoutConfiguration>)).toThrow('INVALID_TEST_CONFIGURATION');
  });

  it.each([
    ['platform identity', 0, { object: 'account', id: 'acct_other' }],
    ['platform mode', 1, { object: 'balance', livemode: true }],
    ['connected identity', 2, { ...account(), id: 'acct_other' }],
    ['connected mode', 3, { object: 'balance', livemode: true }],
    ['country', 2, { ...account(), country: 'US' }],
    ['default currency', 2, { ...account(), default_currency: 'usd' }],
    ['dashboard', 2, { ...account(), controller: { ...account().controller, stripe_dashboard: { type: 'express' } } }],
    ['fee payer', 2, { ...account(), controller: { ...account().controller, fees: { payer: 'application' } } }],
    ['losses', 2, { ...account(), controller: { ...account().controller, losses: { payments: 'application' } } }],
    ['requirements collector', 2, { ...account(), controller: { ...account().controller, requirement_collection: 'application' } }],
    ['pending requirements', 2, { ...account(), requirements: { ...account().requirements, pending_verification: ['identity'] } }],
    ['disabled charges', 2, { ...account(), charges_enabled: false }],
    ['inactive card', 2, { ...account(), capabilities: { card_payments: 'inactive', transfers: 'active' } }],
  ])('fails %s preflight before any checkout mutation', async (_name, index, body) => {
    const steps = preflightSteps();
    steps[index]!.body = body;
    const { adapter, wire } = setup(steps);
    const operation = adapter.prepare(input());

    await expect(adapter.create(operation)).rejects.toThrow('PREFLIGHT_FAILED_WITHOUT_CREATE');
    expect(adapter.inspect(operation)).toMatchObject({ state: 'prepared', reason: 'not_dispatched' });
    expect(wire.calls.every(call => call.method === 'GET')).toBe(true);
  });

  it.each(['ETIMEDOUT', 'ECONNRESET', 'EPIPE'])('treats %s as uncertain with one POST despite SDK connection retry behavior', async (errorCode) => {
    const { adapter, wire } = setup([...preflightSteps(), { ...createStep(), errorCode }]);
    const operation = adapter.prepare(input());
    const result = await adapter.create(operation);

    expect(result).toMatchObject({ state: 'uncertain', reason: 'create_outcome_unknown', session: null });
    await expect(adapter.create(operation)).rejects.toThrow('RECONCILIATION_REQUIRED');
    expect(await adapter.reconcile(operation)).toMatchObject({ state: 'uncertain', reason: 'no_bound_session' });
    expect(wire.calls.filter(call => call.method === 'POST')).toHaveLength(1);

    vi.mocked(Date.now).mockReturnValue(now + INACTIVE_STRIPE_IDEMPOTENCY_WINDOW_MS);

    expect(await adapter.reconcile(operation)).toMatchObject({ state: 'review', reason: 'no_bound_session' });
    expect(wire.calls).toHaveLength(5);
  });

  it.each([400, 401, 402, 403, 409, 429, 500, 503])('sanitizes HTTP %s and never infers execution absence or automatically retries', async (status) => {
    const errorBody = { error: { type: status >= 500 ? 'api_error' : 'invalid_request_error', message: 'private error response with credential and customer material' } };
    const { adapter, wire } = setup([...preflightSteps(), { ...createStep(errorBody), status }]);
    const result = await adapter.create(adapter.prepare(input()));

    expect(result).toMatchObject({ state: 'uncertain', reason: 'create_outcome_unknown' });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(wire.calls).toHaveLength(5);
  });

  it('does not treat a retrieval 404 as absence or clear earlier paid/captured observations', async () => {
    const { adapter, wire } = setup([...preflightSteps(), createStep(paidSession()), ...preflightSteps(), { ...retrieveStep({ error: { type: 'invalid_request_error', code: 'resource_missing', message: 'private' } }), status: 404 }]);
    const operation = adapter.prepare(input());
    await adapter.create(operation);

    expect(await adapter.reconcile(operation)).toMatchObject({ state: 'uncertain', reason: 'retrieval_unresolved', session: { paymentStatus: 'paid', chargeId: 'ch_payment' } });
    await expect(adapter.create(operation)).rejects.toThrow('RECONCILIATION_REQUIRED');
    expect(wire.calls.filter(call => call.method === 'POST')).toHaveLength(1);
  });

  it.each([
    ['live session', { livemode: true }],
    ['live identifier', { id: 'cs_live_session' }],
    ['amount', { amount_total: 13299 }],
    ['subtotal', { amount_subtotal: 13299 }],
    ['currency', { currency: 'usd' }],
    ['reference', { client_reference_id: '40000000-0000-4000-8000-000000000001' }],
    ['unrequested tax', { total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 1 } }],
    ['unrequested method', { payment_method_types: ['card', 'us_bank_account'] }],
    ['expiry', { expires_at: (input().sessionExpiresAt / 1000) + 1 }],
    ['missing paid intent', { payment_intent: null }],
    ['intent fee', { payment_intent: intent({ application_fee_amount: 101 }) }],
    ['live intent', { payment_intent: intent({ livemode: true }) }],
    ['received amount', { payment_intent: intent({ amount_received: 13299 }) }],
    ['destination charge', { payment_intent: intent({ transfer_data: { destination: 'acct_other' } }) }],
    ['charge parent', { payment_intent: intent({ latest_charge: { ...intent().latest_charge, payment_intent: 'pi_other' } }) }],
    ['charge fee', { payment_intent: intent({ latest_charge: { ...intent().latest_charge, application_fee_amount: 99 } }) }],
    ['missing fee identity', { payment_intent: intent({ latest_charge: { ...intent().latest_charge, application_fee: null } }) }],
    ['partial capture', { payment_intent: intent({ latest_charge: { ...intent().latest_charge, amount_captured: 13299 } }) }],
    ['refunded charge', { payment_intent: intent({ latest_charge: { ...intent().latest_charge, amount_refunded: 100 } }) }],
  ])('retains %s mismatch as review, never financial authority', async (_name, patch) => {
    const { adapter } = setup([...preflightSteps(), createStep(paidSession(patch))]);
    const result = await adapter.create(adapter.prepare(input()));

    expect(result).toMatchObject({ state: 'review', reason: 'session_evidence_mismatch', financialPostingAllowed: false });
  });

  const contradictoryResponseHeaders: Record<string, string>[] = [
    { 'stripe-account': 'acct_other' },
    { 'stripe-version': '2025-01-01' },
    { 'idempotency-key': 'another-operation' },
  ];

  it.each(contradictoryResponseHeaders)('rejects contradictory SDK response scope', async (responseHeaders) => {
    const { adapter } = setup([...preflightSteps(), { ...createStep(), responseHeaders }]);

    expect(await adapter.create(adapter.prepare(input()))).toMatchObject({ state: 'review', reason: 'session_evidence_mismatch' });
  });

  it('rejects a different retrieved Session even with the correct quote reference/metadata', async () => {
    const { adapter } = setup([...preflightSteps(), createStep(), ...preflightSteps(), retrieveStep(session({ id: 'cs_test_other' }))]);
    const operation = adapter.prepare(input());
    await adapter.create(operation);

    expect(await adapter.reconcile(operation)).toMatchObject({ state: 'review', reason: 'session_evidence_mismatch', session: { sessionId: 'cs_test_session' } });
  });

  it('retains paid history when a later unpaid/open response conflicts', async () => {
    const { adapter } = setup([...preflightSteps(), createStep(paidSession()), ...preflightSteps(), retrieveStep(session())]);
    const operation = adapter.prepare(input());
    await adapter.create(operation);

    expect(await adapter.reconcile(operation)).toMatchObject({ state: 'review', session: { paymentStatus: 'paid' } });
  });

  it('holds both operation owners when a second quote claims an existing intent/charge', async () => {
    const second = { ...input(), operationId: '10000000-0000-4000-8000-000000000002', requestId: '20000000-0000-4000-8000-000000000002', quoteId: '30000000-0000-4000-8000-000000000002', appointmentId: 'appointment_two' };
    const { adapter } = setup([...preflightSteps(), createStep(paidSession()), ...preflightSteps(), createStep(paidSession({ id: 'cs_test_second', client_reference_id: second.quoteId }))]);
    const firstOperation = adapter.prepare(input());
    await adapter.create(firstOperation);

    expect(await adapter.create(adapter.prepare(second))).toMatchObject({ state: 'review', reason: 'object_ownership_conflict' });
    expect(adapter.inspect(firstOperation)).toMatchObject({ state: 'review', reason: 'object_ownership_conflict' });
  });

  it('snapshots caller material/config and rejects changed identities, copied handles and competing requests', async () => {
    const { adapter, config } = setup([...preflightSteps(), createStep()]);
    const material = input();
    const operation = adapter.prepare(material);
    material.quote.tipCents = 5000;
    config.binding = { ...binding, connectedAccountId: 'acct_other' };

    expect(operation.snapshot.chargeCents).toBe(13300);
    expect(Object.isFrozen(operation.params.line_items[0]!.price_data)).toBe(true);
    expect(adapter.prepare(input())).toBe(operation);
    expect(() => adapter.prepare(material)).toThrow('IMMUTABLE_IDENTITY_MISMATCH');
    expect(() => adapter.prepare({ ...input(), operationId: '10000000-0000-4000-8000-000000000002' })).toThrow('OPERATION_ALREADY_RESERVED');
    await expect(adapter.create(structuredClone(operation))).rejects.toThrow('UNKNOWN_OPERATION_HANDLE');
    expect(await adapter.create(operation)).toMatchObject({ state: 'session_observed' });
  });

  it('does not dispatch an expired quote or silently default/extend the Session lifetime', async () => {
    const { adapter, wire } = setup([]);
    const operation = adapter.prepare(input());
    vi.mocked(Date.now).mockReturnValue(input().quoteExpiresAt);

    await expect(adapter.create(operation)).rejects.toThrow('QUOTE_EXPIRED');
    expect(() => buildInactiveStripeCheckoutOperation({ ...input(), sessionExpiresAt: input().quoteExpiresAt }, binding)).toThrow('INVALID_QUOTE_CONTEXT');
    expect(() => buildInactiveStripeCheckoutOperation({ ...input(), sessionExpiresAt: now + 25 * 60 * 60 * 1000 }, binding)).toThrow('INVALID_QUOTE_CONTEXT');
    expect(wire.calls).toEqual([]);
  });

  it.each(['runtime', 'expiry'])('rechecks %s after async preflight before create and fences concurrent creates', async (change) => {
    let release!: () => void;
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const steps = preflightSteps();
    steps[3]!.pause = pause;
    const { adapter, wire } = setup(steps);
    const operation = adapter.prepare(input());
    const pending = adapter.create(operation);
    await vi.waitFor(() => expect(wire.calls).toHaveLength(4));

    await expect(adapter.create(operation)).rejects.toThrow('RECONCILIATION_REQUIRED');

    if (change === 'runtime') {
      vi.stubEnv('APP_ENV', 'production');
    } else {
      vi.mocked(Date.now).mockReturnValue(input().quoteExpiresAt);
    }
    release();

    await expect(pending).rejects.toThrow('PREFLIGHT_FAILED_WITHOUT_CREATE');
    expect(wire.calls.every(call => call.method === 'GET')).toBe(true);
  });

  it('has no runtime dependency on global credentials, the fake journal, DB or financial writers', () => {
    const source = readFileSync(new URL('./checkoutAdapter.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/process\.env\.(?:STRIPE|DATABASE)|from ['"](?:@\/libs\/(?:stripe|DB)|.*provider\/|.*server\/)/);
    expect(source).not.toMatch(/\.refunds\.|\.paymentIntents\.|\.webhookEndpoints\.|\.accounts\.create/);
  });
});
