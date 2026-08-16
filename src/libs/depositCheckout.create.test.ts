import { readFileSync } from 'node:fs';

import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/* eslint-disable import/first */
import {
  buildDepositCheckoutIdempotencyKey,
  buildDepositCheckoutParams,
  classifyStripeFailure,
  createDepositCheckoutSession,
  DEPOSIT_HOLD_WINDOW_MINUTES,
  DEPOSIT_STRIPE_API_VERSION,
  DEPOSIT_STRIPE_TIMEOUT_MS,
  type DepositCheckoutRow,
  type DepositStripeClient,
} from './depositCheckout';
import { MIN_DEPOSIT_CENTS } from './depositPolicy';
import { SMART_FIT_MIN_LEAD_TIME_MINUTES } from './smartFit';
import { EXPECTED_STRIPE_API_VERSION } from './stripe';
/* eslint-enable import/first */

const HOLD_EXPIRES_AT = new Date('2099-03-13T15:35:00.000Z');
// 2099-03-13T15:00:00Z is 10:00 AM in America/Toronto (EST until Mar 14 2099).
const APPOINTMENT_START = new Date('2099-03-13T15:00:00.000Z');

function buildDeposit(overrides: Partial<DepositCheckoutRow> = {}): DepositCheckoutRow {
  return {
    id: 'dep_1',
    salonId: 'salon_1',
    appointmentId: 'appt_1',
    amountCents: 2500,
    stripeAccountId: 'acct_connected',
    checkoutSuccessUrl: 'https://salon.example.com/deposit/return',
    checkoutCancelUrl: 'https://salon.example.com/deposit/cancel',
    holdExpiresAt: HOLD_EXPIRES_AT,
    appointmentStartTime: APPOINTMENT_START,
    serviceNameSnapshots: ['BIAB Overlay'],
    ...overrides,
  };
}

/**
 * An INJECTED STUB, never a mock of the module under test: mocking
 * `depositCheckout` itself would assert nothing about the parameters that
 * actually reach Stripe.
 */
function buildStubClient(impl?: {
  create?: DepositStripeClient['checkout']['sessions']['create'];
}) {
  const create = vi.fn(impl?.create ?? (async () => ({
    id: 'cs_test_1',
    url: 'https://checkout.stripe.com/c/pay/cs_test_1',
    expires_at: Math.floor(HOLD_EXPIRES_AT.getTime() / 1000),
    payment_intent: 'pi_1',
  } as unknown as Stripe.Checkout.Session)));
  const client = {
    checkout: { sessions: { create, expire: vi.fn(), retrieve: vi.fn() } },
  } as unknown as DepositStripeClient;
  return { client, create };
}

describe('deposit Checkout — the provider contract (§14 test 2)', () => {
  it('sends exactly the sanctioned parameter set', () => {
    const params = buildDepositCheckoutParams(buildDeposit());

    expect(params.mode).toBe('payment');
    expect(params.line_items?.[0]?.quantity).toBe(1);
    expect(params.line_items?.[0]?.price_data?.currency).toBe('cad');
    expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(2500);
    expect(Number.isInteger(params.line_items?.[0]?.price_data?.unit_amount)).toBe(true);
    expect(params.line_items?.[0]?.price_data?.product_data?.name).toBe('Booking deposit');
    expect(params.payment_method_types).toEqual(['card']);

    // 0% pilot: the parameter must be POSITIVE if present, so omission is the
    // documented-safe encoding of zero. Absence, not a zero value.
    expect('application_fee_amount' in params).toBe(false);

    expect(params.expires_at).toBe(Math.floor(HOLD_EXPIRES_AT.getTime() / 1000));
    expect(params.client_reference_id).toBe('appt_1');

    const expectedMetadata = {
      appointment_id: 'appt_1',
      salon_id: 'salon_1',
      deposit_id: 'dep_1',
      appointment_start: `${new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Toronto',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(APPOINTMENT_START)} (America/Toronto)`,
      service: 'BIAB Overlay',
    };

    expect(params.metadata).toEqual(expectedMetadata);
    expect(params.payment_intent_data?.metadata).toEqual(expectedMetadata);
    // The owner-facing payments-list line: reference · service · local time.
    expect(params.payment_intent_data?.description).toBe(
      `Appt appt_1 · BIAB Overlay · ${new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Toronto',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(APPOINTMENT_START)}`,
    );
  });

  it('renders the appointment time in the salon-operating timezone, not UTC', () => {
    // 15:00 UTC on 2099-03-13 is 11:00 AM in America/Toronto (EDT, UTC−4) — a
    // wrong-timezone build would print 3:00 PM. This is the exact class of
    // confusion the owner hit when Stripe showed a "3:00 AM" payment.
    const params = buildDepositCheckoutParams(buildDeposit());
    const description = params.payment_intent_data?.description ?? '';

    expect(description).toContain('11:00 AM');
    expect(description).not.toContain('3:00 PM');
  });

  it('canonicalises service names: order-independent, trimmed, truncated, empty-safe', () => {
    const orderA = buildDepositCheckoutParams(
      buildDeposit({ serviceNameSnapshots: ['Pedicure', ' BIAB Overlay '] }),
    );
    const orderB = buildDepositCheckoutParams(
      buildDeposit({ serviceNameSnapshots: ['BIAB Overlay', 'Pedicure'] }),
    );

    // The reaper's probe reads snapshots back in DB order; the booking path
    // passes user-selection order. Both must produce identical bytes.
    expect(orderA).toEqual(orderB);
    expect(orderA.metadata?.service).toBe('BIAB Overlay, Pedicure');

    const noServices = buildDepositCheckoutParams(buildDeposit({ serviceNameSnapshots: [] }));

    expect(noServices.metadata && 'service' in noServices.metadata).toBe(false);
    expect(noServices.payment_intent_data?.description).not.toContain('·  ·');

    const oversized = buildDepositCheckoutParams(
      buildDeposit({ serviceNameSnapshots: ['x'.repeat(600)] }),
    );

    expect(String(oversized.metadata?.service ?? '').length).toBeLessThanOrEqual(200);
    expect((oversized.payment_intent_data?.description ?? '').length).toBeLessThanOrEqual(500);
  });

  it('keeps client PII out of every parameter', () => {
    // The builder receives no client fields at all — pin that the serialized
    // params never gain name/phone/email keys by accident.
    const serialized = JSON.stringify(buildDepositCheckoutParams(buildDeposit()));

    for (const banned of ['client_name', 'clientName', 'phone', 'email', 'customer_email']) {
      expect(serialized).not.toContain(banned);
    }
  });

  it('carries the {CHECKOUT_SESSION_ID} template on BOTH redirect URLs', () => {
    const params = buildDepositCheckoutParams(buildDeposit());

    expect(params.success_url).toBe(
      'https://salon.example.com/deposit/return?session_id={CHECKOUT_SESSION_ID}',
    );
    // Without this the cancel page arrives with NO query parameter at all: it
    // cannot call the session-status endpoint, cannot render the hold expiry,
    // and cannot produce the resume link.
    expect(params.cancel_url).toBe(
      'https://salon.example.com/deposit/cancel?session_id={CHECKOUT_SESSION_ID}',
    );
  });

  it('is DETERMINISTIC: mutable salon fields cannot reach the parameters', () => {
    // Stripe compares incoming parameters against the original request under an
    // idempotency key and errors if they differ. Salon name/slug/customDomain
    // are all runtime-mutable, so any of them leaking in turns a retry — or the
    // reaper's probe — into a hard idempotency_error.
    const deposit = buildDeposit();
    const paramsA = buildDepositCheckoutParams(deposit);
    const paramsB = buildDepositCheckoutParams(deposit);

    expect(paramsA).toEqual(paramsB);

    // Simulate the salon being renamed and re-slugged between the two calls.
    // The committed deposit row is unchanged, so the params must be too.
    const renamedSalonDeposit = buildDeposit();
    const paramsC = buildDepositCheckoutParams(renamedSalonDeposit);

    expect(paramsC).toEqual(paramsA);
    expect(JSON.stringify(paramsA)).not.toContain('salon.example.com/name');

    // The identification fields derive from the committed appointment row and
    // its write-once service snapshots — inputs that cannot change while the
    // appointment is `awaiting_payment` (HOLD_LOCKED) — never from live salon
    // state. Same rows in, same bytes out.
    const paramsD = buildDepositCheckoutParams(buildDeposit({
      serviceNameSnapshots: [...buildDeposit().serviceNameSnapshots].reverse(),
    }));

    expect(paramsD).toEqual(paramsA);
  });

  it('passes the connected account and the stable idempotency key', async () => {
    const { client, create } = buildStubClient();

    await createDepositCheckoutSession({ deposit: buildDeposit(), client });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![1]).toEqual({
      // Required for direct charges: a platform-scoped lookup would 404.
      stripeAccount: 'acct_connected',
      idempotencyKey: 'deposit-checkout:v1:appt_1',
    });
    expect(buildDepositCheckoutIdempotencyKey('appt_1')).toBe('deposit-checkout:v1:appt_1');
    expect(buildDepositCheckoutIdempotencyKey('appt_1').length).toBeLessThanOrEqual(255);
  });

  it('constructs the deposit client with its own apiVersion, timeout and retry policy', () => {
    // Asserted on the CONSTRUCTED client, so re-using the SaaS billing
    // singleton (which sets no timeout and leaves maxNetworkRetries at 1) fails.
    const constructed = new Stripe('sk_test_x', {
      apiVersion: DEPOSIT_STRIPE_API_VERSION,
      timeout: DEPOSIT_STRIPE_TIMEOUT_MS,
      maxNetworkRetries: 0,
      typescript: true,
    });

    expect((constructed as unknown as { _api: { timeout: number } })._api.timeout).toBe(6000);
    expect(DEPOSIT_STRIPE_TIMEOUT_MS).toBe(6000);
  });

  /**
   * THE CROSS-CONSTANT ASSERTION — MANDATORY (§14 requirement (v)).
   *
   * `apiVersion === DEPOSIT_STRIPE_API_VERSION` alone compares a constant
   * against ITSELF and is satisfied by any value: without this leg, every
   * Checkout Session could be created at version X while D2's Connect endpoint
   * delivers at version Y and D5's guard flags every delivery — with a green
   * suite throughout.
   */
  it('pins DEPOSIT_STRIPE_API_VERSION to D2\'s EXPECTED_STRIPE_API_VERSION', () => {
    expect(DEPOSIT_STRIPE_API_VERSION).toBe(EXPECTED_STRIPE_API_VERSION);
  });
});

describe('deposit Checkout — the retry and failure contract', () => {
  it('retries a retryable failure ONCE with the same key, then reports ambiguous', async () => {
    const rateLimited = new Stripe.errors.StripeRateLimitError({ type: 'rate_limit_error', message: 'slow down' });
    const { client, create } = buildStubClient({
      create: vi.fn(async () => {
        throw rateLimited;
      }) as unknown as DepositStripeClient['checkout']['sessions']['create'],
    });

    const result = await createDepositCheckoutSession({ deposit: buildDeposit(), client });

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![1]).toEqual(create.mock.calls[1]![1]);
    expect(create.mock.calls[0]![0]).toEqual(create.mock.calls[1]![0]);
    // NEVER 'definite': a saved result, including a saved 500, is replayed under
    // the same key for >= 24 h, so a session may exist that we cannot see.
    expect(result).toEqual({ ok: false, failure: 'ambiguous', error: rateLimited });
  });

  it('does not retry a definite rejection', async () => {
    const invalid = new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', message: 'expires_at too soon' });
    const { client, create } = buildStubClient({
      create: vi.fn(async () => {
        throw invalid;
      }) as unknown as DepositStripeClient['checkout']['sessions']['create'],
    });

    const result = await createDepositCheckoutSession({ deposit: buildDeposit(), client });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, failure: 'definite', error: invalid });
  });
});

/** §14 test 14 — the taxonomy, unit-tested against real Stripe error instances. */
describe('classifyStripeFailure (§14 test 14)', () => {
  it.each([
    ['StripeConnectionError', new Stripe.errors.StripeConnectionError({ type: 'api_error', message: 'reset' }), 'ambiguous'],
    ['StripeAPIError', new Stripe.errors.StripeAPIError({ type: 'api_error', message: 'boom' }), 'retryable'],
    ['StripeRateLimitError', new Stripe.errors.StripeRateLimitError({ type: 'rate_limit_error', message: '429' }), 'retryable'],
    ['StripeIdempotencyError', new Stripe.errors.StripeIdempotencyError({ type: 'idempotency_error', message: 'concurrent' }), 'retryable'],
    ['StripeInvalidRequestError (generic)', new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', message: 'bad param' }), 'definite'],
    ['StripeInvalidRequestError (not open)', new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', message: 'You cannot expire a Checkout Session that is not open' }), 'session_not_open'],
    ['StripeAuthenticationError', new Stripe.errors.StripeAuthenticationError({ type: 'authentication_error', message: 'bad key' }), 'permanent'],
    ['StripePermissionError', new Stripe.errors.StripePermissionError({ type: 'invalid_request_error', message: 'no access' }), 'permanent'],
    ['raw AbortError', Object.assign(new Error('aborted'), { name: 'AbortError' }), 'ambiguous'],
  ])('%s -> %s', (_label, error, expected) => {
    expect(classifyStripeFailure(error)).toBe(expected);
  });

  it('classifies a deauthorized connected account as permanent', () => {
    const deauthorized = new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', message: 'The provided key does not have access to account acct_x (deauthorized).' });

    expect(classifyStripeFailure(deauthorized)).toBe('permanent');
  });

  /**
   * The wording Stripe ACTUALLY returns in production when the session
   * auto-expired before the reaper's `expire` call. The old matcher missed it
   * ("can be expired" is not "cannot be expired"), classified it `definite`,
   * and every abandoned hold survived to the 120-minute backstop instead of
   * releasing on the next reaper cycle. Observed live twice on 2026-08-16.
   */
  it.each([
    [
      'exact production wording (backticks)',
      'Only Checkout Sessions with a status in ["open"] can be expired. This Checkout Session has a status of `expired`.',
    ],
    [
      'formatting variant (curly quotes, no trailing period)',
      'Only Checkout Sessions with a status in [“open”] can be expired. This Checkout Session has a status of expired',
    ],
    [
      'same rejection while the session is complete',
      'Only Checkout Sessions with a status in ["open"] can be expired. This Checkout Session has a status of `complete`.',
    ],
  ])('recognizes the live auto-expired rejection: %s', (_label, message) => {
    const error = new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', message });

    // session_not_open only ever routes the caller to the authoritative
    // re-GET — the classifier itself never finalizes a hold, so recognizing
    // the complete-status variant is safe by construction.
    expect(classifyStripeFailure(error)).toBe('session_not_open');
  });

  it.each([
    ['API key expired', 'Expired API Key provided: sk_live_***'],
    ['idempotency key expired', 'Keys for idempotent requests expire after 24 hours. This key expired.'],
    ['webhook timestamp expired', 'Timestamp outside the tolerance zone; the webhook signature expired.'],
    ['customer session expired', 'This customer session has expired.'],
    ['request expired', 'The request expired before it could be processed.'],
    ['arbitrary error containing expired', 'The coupon you supplied has expired.'],
    ['unrelated message containing can be expired', 'Only coupons with an active status can be expired.'],
  ])('does NOT misclassify unrelated expiry wording: %s', (_label, message) => {
    const error = new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', message });

    expect(classifyStripeFailure(error)).toBe('definite');
  });
});

/** §14 test 19. */
describe('hold window constants (§14 test 19)', () => {
  it('DEPOSIT_HOLD_WINDOW_MINUTES stays below the platform lead-time rule', () => {
    // A hold that could outlive the earliest bookable slot would reserve time
    // nobody is allowed to book.
    expect(DEPOSIT_HOLD_WINDOW_MINUTES).toBeLessThan(SMART_FIT_MIN_LEAD_TIME_MINUTES);
    expect(SMART_FIT_MIN_LEAD_TIME_MINUTES).toBe(120);
    // >= Stripe's 30-minute expires_at floor, with margin for the commit and one
    // bounded round trip.
    expect(DEPOSIT_HOLD_WINDOW_MINUTES).toBeGreaterThanOrEqual(30);
  });

  it('the minimum charge floor is the imported constant', () => {
    expect(MIN_DEPOSIT_CENTS).toBe(50);
  });
});

/**
 * §14 test 2c — SOURCE-TEXT PIN.
 *
 * `0065` ships CHECK ("currency" = 'cad'). An uppercase literal anywhere in this
 * PR's own deposit code would raise a check violation INSIDE the retried booking
 * transaction: the retry budget burns, the request 500s, and every deposit
 * booking at every deposit salon fails — from a two-character difference that is
 * invisible to any test that mocks the DB.
 */
describe('no uppercase currency literal survives in D4\'s own source (§14 test 2c)', () => {
  it('grep -c "\'CAD\'" over D4\'s new and edited deposit source is 0', () => {
    const files = [
      'src/libs/depositCheckout.ts',
      'src/libs/depositHoldReaper.ts',
      'src/libs/deposits/holdWriters.ts',
      'src/app/api/appointments/route.ts',
      'src/app/api/public/deposits/session-status/route.ts',
      'src/app/api/deposits/holds/reap/route.ts',
    ];

    // CODE only. The doc comments in these files deliberately NAME the
    // uppercase form in order to warn against it; the pin is about what the
    // compiler sees, not about prose.
    const offenders = files.filter((file) => {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map(line => line.replace(/(^|\s)\/\/.*$/, ''))
        .join('\n');
      return code.includes('\'CAD\'');
    });

    expect(offenders).toEqual([]);
  });
});
