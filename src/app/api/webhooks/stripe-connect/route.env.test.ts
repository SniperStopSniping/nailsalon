/**
 * Connect webhook — fail-closed configuration (charter test 22).
 *
 * This lives in its own file because `Env` is frozen at module load
 * (`src/libs/Env.ts:4`): "secret present" and "secret absent" cannot coexist in
 * one module graph. The `Env` mock below still supplies `STRIPE_SECRET_KEY`,
 * because loading the real `@/libs/stripe` constructs its module-scope client and
 * `src/libs/stripe.ts:16` would otherwise build `new Stripe(undefined)`.
 *
 * `constructEvent` is NEVER stubbed. It is wrapped with `vi.spyOn`, which calls
 * through to the real HMAC implementation while still recording calls — so the
 * "never called" assertion is made against the genuine verifier, not a stand-in
 * that could pass while authenticating nothing.
 */
import type { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Any database access at all is a failure here: the route must refuse before it
// reads the body, verifies a signature, or claims an event row. A throwing proxy
// is a stronger assertion than counting rows after the fact.
const dbTouched = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return new Proxy({}, {
      get(_target, property) {
        dbTouched.calls.push(String(property));
        throw new Error(`database touched on the fail-closed path: .${String(property)}()`);
      },
    });
  },
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

// The whole point of this file: the Connect webhook secret is absent, while
// STRIPE_SECRET_KEY stays present so the real stripe module can still load.
vi.mock('@/libs/Env', () => ({
  Env: {
    STRIPE_SECRET_KEY: 'sk_test_placeholder',
    STRIPE_CONNECT_WEBHOOK_SECRET: undefined,
    STRIPE_WEBHOOK_SECRET: 'whsec_billing_unrelated',
    OAUTH_STATE_SECRET: 'test-oauth-state-secret-at-least-32-characters',
    DEPOSITS_CONNECT_WEBHOOK_PROCESSING_ENABLED: 'true',
    LUSTER_DEPOSITS_PILOT_SALON_IDS: undefined,
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
      // REAL HMAC — never stub.
      webhooks: unpinned.webhooks,
    },
    EXPECTED_STRIPE_API_VERSION: actualModule.EXPECTED_STRIPE_API_VERSION,
  };
});

const { POST } = await import('./route');
const { stripe } = await import('@/libs/stripe');

const SECRET = 'whsec_connect_absent_test';

function signedRequest(payload: object): NextRequest {
  const body = JSON.stringify(payload);
  const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET });
  return new Request('http://localhost/api/webhooks/stripe-connect', {
    method: 'POST',
    body,
    headers: { 'stripe-signature': header, 'content-type': 'application/json' },
  }) as unknown as NextRequest;
}

beforeEach(() => {
  dbTouched.calls = [];
  vi.clearAllMocks();
});

// `vi.spyOn` on `stripe.webhooks.constructEvent` must be undone between tests,
// or the "not a stub" assertion below observes the previous test's spy rather
// than the real implementation.
afterEach(() => {
  vi.restoreAllMocks();
});

describe('test 22 — ENV-1: the Connect webhook fails closed with no secret', () => {
  it('returns 503, never verifies a signature, and never touches the database', async () => {
    // A Connect endpoint that accepts events it cannot authenticate is worse
    // than one that is down: Stripe retries a 503 for up to three days, so
    // refusing loudly loses nothing and forging is impossible meanwhile.
    const constructEvent = vi.spyOn(stripe.webhooks, 'constructEvent');

    const response = await POST(signedRequest({
      id: 'evt_env_1',
      type: 'account.updated',
      account: 'acct_env_1',
      livemode: false,
      data: { object: { id: 'acct_env_1', object: 'account' } },
    }));

    expect(response.status).toBe(503);
    expect(constructEvent).not.toHaveBeenCalled();
    expect(dbTouched.calls).toEqual([]);
  });

  it('refuses a correctly-signed event just the same', async () => {
    // The signature being valid against SOME secret is irrelevant — with no
    // configured secret there is nothing to verify against, so the route must
    // not fall through to a permissive branch.
    const constructEvent = vi.spyOn(stripe.webhooks, 'constructEvent');

    const response = await POST(signedRequest({
      id: 'evt_env_2',
      type: 'account.application.deauthorized',
      account: 'acct_env_2',
      livemode: false,
      data: { object: { id: 'acct_env_2', object: 'account' } },
    }));

    expect(response.status).toBe(503);
    expect(constructEvent).not.toHaveBeenCalled();
    expect(dbTouched.calls).toEqual([]);
  });

  it('the real HMAC implementation is present, not a stub', async () => {
    // Guards the guard: if a future refactor stubs `constructEvent`, every
    // signature assertion in the sibling suite becomes theatre.
    expect(vi.isMockFunction(stripe.webhooks.constructEvent)).toBe(false);
  });
});
