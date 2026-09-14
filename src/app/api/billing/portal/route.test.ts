/**
 * Billing Portal session — P5b (G41, G26, D9, D18) proofs.
 *
 * This is a LIVE route used by legacy-flow customers today; P5b's only
 * behaviour changes are (1) the Stripe customer resolves through a live
 * `billing_subscription` row first, falling back to the legacy
 * `salon.stripeCustomerId` projection (G41 — the new billing domain never
 * writes the legacy column, so a new-track subscriber used to hit
 * NO_BILLING_ACCOUNT here even with a live subscription), and (2) the error
 * response is masked (G26 — no more raw `error.message` passthrough). For a
 * legacy-only salon, the `stripe.billingPortal.sessions.create` call and the
 * success response shape must be BYTE-FOR-BYTE identical to the pre-P5b
 * route, which always did:
 *
 *   const session = await stripe.billingPortal.sessions.create({
 *     customer: salon.stripeCustomerId,
 *     return_url: returnUrl || defaultReturnUrl,
 *   });
 *   return NextResponse.json({ url: session.url });
 *
 * The "before" expectation pinned in the first describe block below is that
 * exact call shape, transcribed from the pre-P5b route.ts before any change
 * in this PR.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const envHolder = vi.hoisted(() => ({
  NEXT_PUBLIC_APP_URL: 'https://app.test' as string | undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

// Mirrors requireAdmin's real membership check (adminAuth.ts:443-454): an
// admin authenticated for one salon is refused a FOREIGN salonId with the
// same 403 Forbidden shape production returns — proves the cross-salon
// rejection happens before any DB read or Stripe call.
const adminHolder = vi.hoisted(() => ({
  deniedSalonIds: new Set<string>(),
}));
vi.mock('@/libs/adminAuth', () => ({
  requireAdmin: vi.fn(async (salonId: string) => {
    if (adminHolder.deniedSalonIds.has(salonId)) {
      return {
        ok: false,
        response: new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      };
    }
    return { ok: true, admin: { clerkUserId: 'user_default' } };
  }),
}));

vi.mock('@/libs/rateLimit', () => ({
  checkEndpointRateLimit: () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
  rateLimitResponse: () => new Response('rate limited', { status: 429 }),
}));

const stripeMock = vi.hoisted(() => ({
  billingPortal: {
    sessions: {
      create: vi.fn(),
    },
  },
}));
vi.mock('@/libs/stripe', () => ({ stripe: stripeMock }));

const sentryMock = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: sentryMock.captureException }));

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

beforeEach(() => {
  envHolder.NEXT_PUBLIC_APP_URL = 'https://app.test';
  adminHolder.deniedSalonIds = new Set();
  stripeMock.billingPortal.sessions.create.mockReset();
  stripeMock.billingPortal.sessions.create.mockImplementation(async () => ({
    id: 'bps_test_session',
    url: 'https://billing.stripe.test/session',
  }));
  sentryMock.captureException.mockReset();
});

const post = async (body: unknown) => {
  const { POST } = await import('./route');
  return POST(new NextRequest('http://localhost/api/billing/portal', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }));
};

let salonCounter = 0;
async function seedSalon(stripeCustomerId: string | null): Promise<string> {
  salonCounter += 1;
  const id = `sal_portal_${salonCounter}`;
  await db.insert(schema.salonSchema).values({
    id,
    name: id,
    slug: id,
    stripeCustomerId,
  });
  return id;
}

let subCounter = 0;
async function seedSubscription(salonId: string, overrides: Partial<{
  status: schema.BillingSubscriptionStatus;
  stripeCustomerId: string;
  updatedAt: Date;
}> = {}): Promise<string> {
  subCounter += 1;
  const id = `bsub_portal_${subCounter}`;
  const now = new Date();
  await db.insert(schema.billingSubscriptionSchema).values({
    id,
    salonId,
    stripeSubscriptionId: `sub_${id}`,
    stripeCustomerId: overrides.stripeCustomerId ?? `cus_new_${id}`,
    planDefinitionKey: 'pro_2026_08',
    billingOfferKey: 'pro_2026_08_monthly',
    billingCadence: 'monthly',
    status: overrides.status ?? 'active',
    paidThrough: new Date('2026-10-01T00:00:00.000Z'),
    creditCycleAnchor: now,
    createdAt: now,
    updatedAt: overrides.updatedAt ?? now,
  });
  return id;
}

describe('legacy-flow customers — byte-identical behaviour', () => {
  it('creates a portal session with the legacy customer id and the exact pre-P5b call arguments', async () => {
    const salonId = await seedSalon('cus_legacy_abc');

    const response = await post({ salonId });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: 'https://billing.stripe.test/session' });

    // The "before" expectation, transcribed from the pre-P5b route: the ONLY
    // call is `stripe.billingPortal.sessions.create({ customer, return_url })`
    // with the salon's legacy stripeCustomerId and the default return URL.
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_legacy_abc',
      return_url: 'https://app.test/admin?tab=billing',
    });
  });

  it('honours an explicit returnUrl exactly as before', async () => {
    const salonId = await seedSalon('cus_legacy_custom_return');

    await post({ salonId, returnUrl: 'https://app.test/admin?tab=settings' });

    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_legacy_custom_return',
      return_url: 'https://app.test/admin?tab=settings',
    });
  });
});

describe('customer resolution (G41)', () => {
  it('uses the live billing_subscription customer id even when the legacy column differs', async () => {
    const salonId = await seedSalon('cus_legacy_stale');
    await seedSubscription(salonId, { status: 'active', stripeCustomerId: 'cus_new_track_live' });

    const response = await post({ salonId });

    expect(response.status).toBe(200);
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_new_track_live',
      return_url: 'https://app.test/admin?tab=billing',
    });
  });

  it('prefers the most recently updated LIVE row when several exist', async () => {
    const salonId = await seedSalon(null);
    await seedSubscription(salonId, {
      status: 'canceled',
      stripeCustomerId: 'cus_old_canceled',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await seedSubscription(salonId, {
      status: 'past_due',
      stripeCustomerId: 'cus_current_live',
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });

    await post({ salonId });

    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_current_live',
      return_url: 'https://app.test/admin?tab=billing',
    });
  });

  it('falls back to the legacy column when the only billing_subscription row is canceled (live-row rule)', async () => {
    const salonId = await seedSalon('cus_legacy_wins');
    await seedSubscription(salonId, { status: 'canceled', stripeCustomerId: 'cus_dead_attempt' });

    const response = await post({ salonId });

    expect(response.status).toBe(200);
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_legacy_wins',
      return_url: 'https://app.test/admin?tab=billing',
    });
  });

  it('falls back to a canceled billing_subscription row when no legacy id exists (third tier)', async () => {
    const salonId = await seedSalon(null);
    await seedSubscription(salonId, { status: 'canceled', stripeCustomerId: 'cus_canceled_only' });

    const response = await post({ salonId });

    expect(response.status).toBe(200);
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_canceled_only',
      return_url: 'https://app.test/admin?tab=billing',
    });
  });

  it('returns 400 NO_BILLING_ACCOUNT when there is no billing_subscription row and no legacy customer id', async () => {
    const salonId = await seedSalon(null);

    const response = await post({ salonId });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('NO_BILLING_ACCOUNT');
    expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
  });
});

describe('error masking (G26)', () => {
  it('returns a fixed message and exactly one Sentry capture on a Stripe error, never error.message', async () => {
    const salonId = await seedSalon('cus_legacy_err');
    stripeMock.billingPortal.sessions.create.mockRejectedValueOnce(
      new Error('secret internal Stripe diagnostic detail'),
    );

    const response = await post({ salonId });

    expect(response.status).toBe(500);

    const body = await response.json();

    expect(body.error.code).toBe('PORTAL_ERROR');
    expect(body.error.message).toBe('The billing portal is temporarily unavailable.');
    expect(JSON.stringify(body)).not.toContain('secret internal Stripe diagnostic detail');

    expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    expect(sentryMock.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      { tags: { endpoint: 'billing/portal' } },
    );
  });
});

describe('access control and input validation (unchanged)', () => {
  it('returns 403 before any DB read or Stripe call for a cross-salon admin', async () => {
    const salonId = await seedSalon('cus_legacy_guarded');
    adminHolder.deniedSalonIds = new Set([salonId]);

    const response = await post({ salonId });

    expect(response.status).toBe(403);
    expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_INPUT when salonId is missing, as today', async () => {
    const response = await post({});

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_INPUT');
    expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
  });
});
