/**
 * Stripe-hosted onboarding `refresh_url` (charter test 24, leg f).
 *
 * Every GET here mints one outbound `accountLinks.create`, and both Stripe and a
 * browser can loop this URL — so the rate limit is checked FIRST, before the
 * state is even parsed, and a revoked binding never reaches the provider at all.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
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
    salons: [{ salonId: 'salon_refresh_a' }],
  } as { id: string; isSuperAdmin: boolean; salons: { salonId: string }[] },
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdmin: vi.fn(async (salonId: string) => {
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

const SALON_A = 'salon_refresh_a';
const OAUTH_SECRET = 'test-oauth-state-secret-at-least-32-characters';
// BILLING tier is 10 requests per 60s (`src/libs/rateLimit.ts:175`).
const BILLING_MAX_REQUESTS = 10;

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let ipCounter = 0;

function request(state: string, ip?: string): NextRequest {
  ipCounter += 1;
  return new Request(
    `http://localhost/api/integrations/stripe-connect/refresh?s=${encodeURIComponent(state)}`,
    { headers: { 'x-forwarded-for': ip ?? `10.3.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}` } },
  ) as unknown as NextRequest;
}

function stateFor(salonId: string) {
  return signOAuthState({ provider: 'stripe_connect', salonId }, 86_400);
}

function redirectTarget(response: Response) {
  return new URL(response.headers.get('location') ?? '', 'http://localhost');
}

async function seedBinding(revoked: boolean) {
  await db.insert(schema.salonStripeAccountSchema).values({
    id: 'sacct_refresh',
    salonId: SALON_A,
    stripeAccountId: 'acct_refresh',
    livemode: false,
    ...(revoked
      ? { revokedAt: new Date('2026-08-01T00:00:00Z'), revocationCause: 'revoked_local' as const }
      : {}),
  });
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({ id: SALON_A, name: 'Refresh A', slug: 'refresh-a' });
});

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  auth.admin = { id: 'admin_1', isSuperAdmin: false, salons: [{ salonId: SALON_A }] };
  await db.delete(schema.salonStripeAccountSchema);

  vi.spyOn(Env, 'OAUTH_STATE_SECRET', 'get').mockReturnValue(OAUTH_SECRET);
  stripeMock.accountLinksCreate.mockResolvedValue({ url: 'https://connect.stripe.com/setup/refreshed' });
});

describe('test 24(f) — refresh route', () => {
  it('mints a fresh onboarding link for a live binding', async () => {
    await seedBinding(false);

    const response = await GET(request(stateFor(SALON_A)));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://connect.stripe.com/setup/refreshed');
    expect(stripeMock.accountLinksCreate).toHaveBeenCalledTimes(1);
  });

  it('the 11th call in a minute is refused with 429 and mints no link', async () => {
    // Without this the URL is an unbounded outbound-call amplifier: Stripe's own
    // hosted flow will follow it, and so will a refresh-happy browser.
    await seedBinding(false);
    const state = stateFor(SALON_A);
    const ip = '10.9.9.9';

    for (let call = 0; call < BILLING_MAX_REQUESTS; call += 1) {
      const allowed = await GET(request(state, ip));

      expect(allowed.status).toBe(302);
    }

    expect(stripeMock.accountLinksCreate).toHaveBeenCalledTimes(BILLING_MAX_REQUESTS);

    const limited = await GET(request(state, ip));

    expect(limited.status).toBe(429);
    expect(stripeMock.accountLinksCreate).toHaveBeenCalledTimes(BILLING_MAX_REQUESTS);
  });

  it('a revoked binding redirects to stripe=error with no provider call', async () => {
    // A deauthorized salon must not be handed a live onboarding link for an
    // account the platform can no longer act on.
    await seedBinding(true);

    const response = await GET(request(stateFor(SALON_A)));
    const target = redirectTarget(response);

    expect(response.status).toBe(302);
    expect(target.pathname).toBe('/en/admin');
    expect(target.searchParams.get('stripe')).toBe('error');
    expect(target.searchParams.get('salon')).toBe('refresh-a');
    expect(stripeMock.accountLinksCreate).not.toHaveBeenCalled();
  });

  it('a salon with no binding at all redirects to stripe=error with no provider call', async () => {
    const response = await GET(request(stateFor(SALON_A)));

    expect(response.status).toBe(302);
    expect(redirectTarget(response).searchParams.get('stripe')).toBe('error');
    expect(stripeMock.accountLinksCreate).not.toHaveBeenCalled();
  });

  it('an admin without membership is redirected, never handed a link', async () => {
    auth.admin = { id: 'admin_2', isSuperAdmin: false, salons: [{ salonId: 'salon_other' }] };
    await seedBinding(false);

    const response = await GET(request(stateFor(SALON_A)));

    expect(response.status).toBe(302);
    expect(redirectTarget(response).searchParams.get('stripe')).toBe('forbidden');
    expect(stripeMock.accountLinksCreate).not.toHaveBeenCalled();
  });
});
