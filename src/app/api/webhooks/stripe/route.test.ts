/**
 * Billing/Connect separation pin (charter test 29).
 *
 * NEW FILE, ZERO DIFF to `src/app/api/webhooks/stripe/route.ts`. D2 adds a second
 * Stripe endpoint, and the failure this pins is the quiet one: a Connect event
 * arriving at the BILLING endpoint and being acted on there, where none of the
 * Connect-side livemode, scope or binding fences exist.
 *
 * The pin is that `account.updated` falls through to the unhandled branch —
 * logged, 200'd, and never touching the database. If a future change teaches the
 * billing route to handle Connect events, this test goes red and the author has
 * to justify it rather than discover it in production.
 *
 * `constructEvent` is REAL. Stubbing it is the repo's existing anti-pattern
 * (`twilio/status/route.test.ts:4-27,51-58`) and would make the 200 meaningless.
 */
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// The billing route must not read or write a single row for a Connect event.
// A throwing proxy states that more strongly than counting rows afterwards.
const dbTouched = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return new Proxy({}, {
      get(_target, property) {
        dbTouched.calls.push(String(property));
        throw new Error(`billing route touched the database for a Connect event: .${String(property)}()`);
      },
    });
  },
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const BILLING_SECRET = 'whsec_billing_separation_test';

vi.mock('@/libs/Env', () => ({
  Env: {
    STRIPE_SECRET_KEY: 'sk_test_placeholder',
    STRIPE_WEBHOOK_SECRET: BILLING_SECRET,
    // Deliberately a DIFFERENT secret: the two endpoints never share one.
    STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connect_separation_test',
  },
}));

vi.mock('@/libs/stripe', async () => {
  const { default: RealStripe } = await vi.importActual<typeof import('stripe')>('stripe');
  const unpinned = new RealStripe('sk_test_placeholder');
  const actualModule = await vi.importActual<typeof import('@/libs/stripe')>('@/libs/stripe');
  return {
    stripe: {
      accounts: { create: vi.fn(), retrieve: vi.fn() },
      accountLinks: { create: vi.fn() },
      subscriptions: { retrieve: vi.fn() },
      // REAL HMAC — never stub.
      webhooks: unpinned.webhooks,
    },
    EXPECTED_STRIPE_API_VERSION: actualModule.EXPECTED_STRIPE_API_VERSION,
  };
});

const { POST } = await import('./route');
const { stripe } = await import('@/libs/stripe');

function signedRequest(payload: object, secret = BILLING_SECRET): NextRequest {
  const body = JSON.stringify(payload);
  const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    body,
    headers: { 'stripe-signature': header, 'content-type': 'application/json' },
  }) as unknown as NextRequest;
}

function connectShapedEvent(type: string) {
  return {
    id: `evt_sep_${type.replace(/\W/g, '_')}`,
    object: 'event',
    type,
    // `account` present is what makes an event Connect-scoped.
    account: 'acct_connect_victim',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'acct_connect_victim',
        object: 'account',
        charges_enabled: true,
        details_submitted: true,
      },
    },
  };
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dbTouched.calls = [];
  vi.clearAllMocks();
  // `failOnConsole` is on (`vitest-setup.ts:14-20`), so both the unhandled
  // branch's warning and the signature-rejection error have to be captured
  // rather than allowed to reach the console.
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('test 29 — the billing endpoint does not act on Connect events', () => {
  it('account.updated falls through to the unhandled branch with zero DB access', async () => {
    const response = await POST(signedRequest(connectShapedEvent('account.updated')));

    expect(response.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled event type: account.updated'),
    );
    expect(dbTouched.calls).toEqual([]);
  });

  it('account.application.deauthorized is likewise unhandled here', async () => {
    // The deauthorization signal is one-shot. If the billing endpoint ever
    // swallowed it, the Connect side would never learn the salon is gone.
    const response = await POST(signedRequest(connectShapedEvent('account.application.deauthorized')));

    expect(response.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled event type: account.application.deauthorized'),
    );
    expect(dbTouched.calls).toEqual([]);
  });

  it('an event signed with the CONNECT secret is rejected by the billing endpoint', async () => {
    // The two endpoints hold different secrets precisely so neither can be
    // driven by traffic intended for the other.
    const response = await POST(
      signedRequest(connectShapedEvent('account.updated'), 'whsec_connect_separation_test'),
    );

    expect(response.status).toBe(400);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Signature verification failed'),
    );
    expect(dbTouched.calls).toEqual([]);
  });

  it('the real HMAC implementation is present, not a stub', async () => {
    expect(vi.isMockFunction(stripe.webhooks.constructEvent)).toBe(false);
  });
});
