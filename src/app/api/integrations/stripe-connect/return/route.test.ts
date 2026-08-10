/**
 * Stripe-hosted onboarding `return_url` (charter test 24, legs a–e).
 *
 * The invariant under test is READY-1: arriving here proves nothing. Readiness is
 * only ever written from a fresh `accounts.retrieve`, never inferred from the
 * fact that Stripe redirected the owner back.
 *
 * The state is minted with the REAL `signOAuthState`, so the tamper and
 * expiry legs exercise the real HMAC rather than a hand-rolled stand-in.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  admin: {
    id: 'admin_1',
    isSuperAdmin: false,
    salons: [{ salonId: 'salon_return_a' }],
  } as { id: string; isSuperAdmin: boolean; salons: { salonId: string }[] },
  signedIn: true,
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdmin: vi.fn(async (salonId: string) => {
    if (!auth.signedIn) {
      return {
        ok: false,
        response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      };
    }
    if (auth.admin.isSuperAdmin
      || auth.admin.salons.some(membership => membership.salonId === salonId)) {
      return { ok: true, admin: auth.admin };
    }
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    };
  }),
}));

const stripeMock = vi.hoisted(() => ({
  accountsCreate: vi.fn(),
  accountsRetrieve: vi.fn(),
  accountLinksCreate: vi.fn(),
}));

vi.mock('@/libs/stripe', async () => {
  const { default: RealStripe } = await vi.importActual<typeof import('stripe')>('stripe');
  const unpinned = new RealStripe('sk_test_placeholder');
  const actualModule = await vi.importActual<typeof import('@/libs/stripe')>('@/libs/stripe');
  return {
    stripe: {
      accounts: { create: stripeMock.accountsCreate, retrieve: stripeMock.accountsRetrieve },
      accountLinks: { create: stripeMock.accountLinksCreate },
      webhooks: unpinned.webhooks,
    },
    EXPECTED_STRIPE_API_VERSION: actualModule.EXPECTED_STRIPE_API_VERSION,
  };
});

const { GET } = await import('./route');
const { Env } = await import('@/libs/Env');
const { signOAuthState } = await import('@/libs/lusterSecurity');

const SALON_A = 'salon_return_a';
const SALON_B = 'salon_return_b';
const OAUTH_SECRET = 'test-oauth-state-secret-at-least-32-characters';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let ipCounter = 0;

function request(state: string | null): NextRequest {
  ipCounter += 1;
  const url = state === null
    ? 'http://localhost/api/integrations/stripe-connect/return'
    : `http://localhost/api/integrations/stripe-connect/return?s=${encodeURIComponent(state)}`;
  return new Request(url, {
    // A fresh IP per call keeps the shared endpoint rate limiter out of the way
    // of every leg except the one that deliberately tests it.
    headers: { 'x-forwarded-for': `10.2.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}` },
  }) as unknown as NextRequest;
}

function stateFor(salonId: string, ttl = 86_400) {
  return signOAuthState({ provider: 'stripe_connect', salonId }, ttl);
}

function accountPayload(chargesEnabled: boolean) {
  return {
    id: 'acct_return',
    object: 'account',
    charges_enabled: chargesEnabled,
    payouts_enabled: chargesEnabled,
    details_submitted: true,
    country: 'CA',
    controller: {
      stripe_dashboard: { type: 'full' },
      losses: { payments: 'stripe' },
      fees: { payer: 'account' },
      requirement_collection: 'stripe',
    },
    requirements: {
      currently_due: [],
      eventually_due: [],
      past_due: [],
      pending_verification: [],
      current_deadline: null,
      disabled_reason: null,
    },
    metadata: {},
  };
}

async function seedLiveBinding() {
  await db.insert(schema.salonStripeAccountSchema).values({
    id: 'sacct_return',
    salonId: SALON_A,
    stripeAccountId: 'acct_return',
    livemode: false,
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
  });
}

function redirectTarget(response: Response) {
  return new URL(response.headers.get('location') ?? '', 'http://localhost');
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    { id: SALON_A, name: 'Return A', slug: 'return-a' },
    { id: SALON_B, name: 'Return B', slug: 'return-b' },
  ]);
});

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  auth.admin = { id: 'admin_1', isSuperAdmin: false, salons: [{ salonId: SALON_A }] };
  auth.signedIn = true;
  await db.delete(schema.salonStripeAccountSchema);
  await db.update(schema.salonSchema).set({ slug: 'return-a' }).where(eq(schema.salonSchema.id, SALON_A));

  vi.spyOn(Env, 'OAUTH_STATE_SECRET', 'get').mockReturnValue(OAUTH_SECRET);
});

describe('test 24 — return route', () => {
  it('(a) no admin session redirects to /en/admin with zero Stripe calls and zero writes', async () => {
    auth.signedIn = false;
    await seedLiveBinding();

    const response = await GET(request(stateFor(SALON_A)));
    const target = redirectTarget(response);

    expect(response.status).toBe(302);
    expect(target.pathname).toBe('/en/admin');
    expect(target.searchParams.get('stripe')).toBe('forbidden');
    expect(stripeMock.accountsRetrieve).not.toHaveBeenCalled();

    const [row] = await db.select().from(schema.salonStripeAccountSchema);

    expect(row?.chargesEnabled).toBe(false);
    expect(row?.lastSyncedAt).toBeNull();
  });

  it('(b) a tampered state redirects and never calls Stripe', async () => {
    await seedLiveBinding();
    const valid = stateFor(SALON_A);
    // Flip one byte of the payload; the signature no longer verifies.
    const [encoded, signature] = valid.split('.');
    const tampered = `${encoded!.slice(0, -1)}${encoded!.endsWith('A') ? 'B' : 'A'}.${signature}`;

    const response = await GET(request(tampered));

    expect(response.status).toBe(302);
    expect(redirectTarget(response).searchParams.get('stripe')).toBe('link_expired');
    expect(stripeMock.accountsRetrieve).not.toHaveBeenCalled();
  });

  it('(b) an expired state redirects and never calls Stripe', async () => {
    await seedLiveBinding();
    // Negative TTL mints a state whose `exp` is already in the past.
    const expired = stateFor(SALON_A, -60);

    const response = await GET(request(expired));

    expect(response.status).toBe(302);
    expect(redirectTarget(response).searchParams.get('stripe')).toBe('link_expired');
    expect(stripeMock.accountsRetrieve).not.toHaveBeenCalled();
  });

  it('(b) a missing state redirects and never calls Stripe', async () => {
    const response = await GET(request(null));

    expect(response.status).toBe(302);
    expect(redirectTarget(response).searchParams.get('stripe')).toBe('link_expired');
    expect(stripeMock.accountsRetrieve).not.toHaveBeenCalled();
  });

  it('(c) a salon-A state presented by a salon-B admin is refused with zero writes', async () => {
    // The state names a salon; it carries no privilege. `requireAdmin` is still
    // the authorization, so a leaked link cannot cross a tenant boundary.
    auth.admin = { id: 'admin_2', isSuperAdmin: false, salons: [{ salonId: SALON_B }] };
    await seedLiveBinding();

    const response = await GET(request(stateFor(SALON_A)));

    expect(response.status).toBe(302);
    expect(redirectTarget(response).searchParams.get('stripe')).toBe('forbidden');
    expect(stripeMock.accountsRetrieve).not.toHaveBeenCalled();

    const [row] = await db.select().from(schema.salonStripeAccountSchema);

    expect(row?.lastSyncedAt).toBeNull();
  });

  it('(d) a slug renamed mid-onboarding still resolves, and the redirect carries the CURRENT slug', async () => {
    // The slug is mutable and re-assignable, which is why the state carries the
    // id. Carrying the slug instead would 404 this round trip.
    await seedLiveBinding();
    const state = stateFor(SALON_A);
    stripeMock.accountsRetrieve.mockResolvedValue(accountPayload(true));

    await db.update(schema.salonSchema)
      .set({ slug: 'return-a-renamed' })
      .where(eq(schema.salonSchema.id, SALON_A));

    const response = await GET(request(state));
    const target = redirectTarget(response);

    expect(response.status).toBe(302);
    expect(target.pathname).toBe('/en/admin');
    expect(target.searchParams.get('salon')).toBe('return-a-renamed');
    expect(stripeMock.accountsRetrieve).toHaveBeenCalledTimes(1);

    const [row] = await db.select().from(schema.salonStripeAccountSchema);

    expect(row?.salonId).toBe(SALON_A);
  });

  it('(e) readiness follows the retrieve, and is never flipped optimistically', async () => {
    await seedLiveBinding();
    const state = stateFor(SALON_A);

    // First return: Stripe still says charges are not enabled. Arrival here is
    // NOT evidence — the stored value must stay false.
    stripeMock.accountsRetrieve.mockResolvedValue(accountPayload(false));
    await GET(request(state));

    const [afterFirst] = await db.select().from(schema.salonStripeAccountSchema);

    expect(afterFirst?.chargesEnabled).toBe(false);
    expect(afterFirst?.lastSyncedAt).not.toBeNull();

    // Second return: Stripe now says yes, so the stored value follows.
    stripeMock.accountsRetrieve.mockResolvedValue(accountPayload(true));
    await GET(request(state));

    const [afterSecond] = await db.select().from(schema.salonStripeAccountSchema);

    expect(afterSecond?.chargesEnabled).toBe(true);
  });

  it('(e) a failing retrieve leaves readiness untouched and still lands the owner', async () => {
    await seedLiveBinding();
    stripeMock.accountsRetrieve.mockRejectedValue(new Error('stripe down'));

    const response = await GET(request(stateFor(SALON_A)));

    expect(response.status).toBe(302);
    expect(redirectTarget(response).searchParams.get('stripe')).toBe('sync_failed');

    const [row] = await db.select().from(schema.salonStripeAccountSchema);

    expect(row?.chargesEnabled).toBe(false);
    expect(row?.lastSyncedAt).toBeNull();
  });
});
