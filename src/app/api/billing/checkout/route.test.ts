/**
 * Server-authoritative subscription Checkout — Gate C2 proofs.
 *
 * The vectors that matter: the dark switch rejects before ANY durable write
 * or provider call; placeholder Stripe mappings reject the same way; the
 * client can never supply a Price ID or amount; attempts serialize and
 * reuse; the founding claim is reserved before the session exists and
 * released when the provider refuses; a live subscription blocks checkout.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
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
  BILLING_PLAN_ENV: 'test' as string,
  BILLING_SUBSCRIPTIONS_ENABLED: undefined as string | undefined,
  NEXT_PUBLIC_APP_URL: 'https://app.test',
  BILLING_IDENTITY_HMAC_SECRET: undefined,
  BILLING_IDENTITY_HMAC_VERSION: undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

// One Clerk user = one durable business identity. Promotion tests set a
// DISTINCT user per case — the once-per-business claim is deliberately shared
// across every salon of one identity, so a shared user would make later
// founding tests silently reuse the first test's claim (which is itself
// correct behavior, pinned separately below).
const adminHolder = vi.hoisted(() => ({ clerkUserId: 'user_default' }));
vi.mock('@/libs/adminAuth', () => ({
  requireAdmin: vi.fn(async () => ({ ok: true, admin: { clerkUserId: adminHolder.clerkUserId } })),
}));

vi.mock('@/libs/rateLimit', () => ({
  checkEndpointRateLimit: () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
  rateLimitResponse: () => new Response('rate limited', { status: 429 }),
}));

const stripeMock = vi.hoisted(() => ({
  checkout: {
    sessions: {
      create: vi.fn(),
      retrieve: vi.fn(),
    },
  },
}));
vi.mock('@/libs/stripe', () => ({ stripe: stripeMock }));

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

// Placeholder mappings are the committed reality (no live IDs in the repo) —
// tests override resolution per-case, keeping BillingCatalogError real.
const priceMapHolder = vi.hoisted(() => ({
  priceId: 'price_test_resolved' as string | null,
  couponId: 'coupon_test_resolved' as string | null,
}));

// The COMMITTED promotion window is null/null = not open (dark posture —
// launch must configure it explicitly). Tests open it per-case; one test
// pins the committed state's refusal.
const promotionHolder = vi.hoisted(() => ({
  startsAt: '2026-01-01T00:00:00.000Z' as string | null,
  endsAt: null as string | null,
}));
vi.mock('@/libs/billing/promotions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/billing/promotions')>();
  return {
    ...actual,
    getPromotion: (key: string) => {
      const promotion = actual.getPromotion(key);
      return promotion === null
        ? null
        : { ...promotion, startsAt: promotionHolder.startsAt, endsAt: promotionHolder.endsAt };
    },
  };
});
vi.mock('@/libs/billing/stripePriceMap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/billing/stripePriceMap')>();
  return {
    ...actual,
    resolveStripePriceIdForOffer: (key: string) => {
      if (priceMapHolder.priceId === null) {
        throw new actual.BillingCatalogError('PRICE_UNCONFIGURED', `unconfigured: ${key}`);
      }
      return priceMapHolder.priceId;
    },
    resolveStripeCouponIdForPromotion: (key: string) => {
      if (priceMapHolder.couponId === null) {
        throw new actual.BillingCatalogError('PRICE_UNCONFIGURED', `unconfigured: ${key}`);
      }
      return priceMapHolder.couponId;
    },
  };
});

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

beforeEach(() => {
  envHolder.BILLING_SUBSCRIPTIONS_ENABLED = 'true';
  priceMapHolder.priceId = 'price_test_resolved';
  priceMapHolder.couponId = 'coupon_test_resolved';
  promotionHolder.startsAt = '2026-01-01T00:00:00.000Z';
  promotionHolder.endsAt = null;
  stripeMock.checkout.sessions.create.mockReset();
  stripeMock.checkout.sessions.retrieve.mockReset();
  stripeMock.checkout.sessions.create.mockImplementation(async () => ({
    id: `cs_${Math.random().toString(36).slice(2, 10)}`,
    url: 'https://checkout.stripe.test/session',
  }));
});

const post = async (body: unknown) => {
  const { POST } = await import('./route');
  return POST(new NextRequest('http://localhost/api/billing/checkout', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }));
};

async function seedSalon(id: string) {
  await db.insert(schema.salonSchema).values({ id, name: `Salon ${id}`, slug: `salon-${id}` });
}

const attemptRows = (salonId: string) =>
  db.select().from(schema.billingCheckoutAttemptSchema)
    .where(eq(schema.billingCheckoutAttemptSchema.salonId, salonId));

describe('dark switch and catalogue gates — reject before any write or provider call', () => {
  it('rejects with BILLING_DISABLED while the switch is unset, consuming nothing', async () => {
    envHolder.BILLING_SUBSCRIPTIONS_ENABLED = undefined;
    await seedSalon('s_dark');
    const response = await post({ salonId: 's_dark', billingOfferKey: 'pro_2026_08_monthly' });

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('BILLING_DISABLED');
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(await attemptRows('s_dark')).toHaveLength(0);
  });

  it('rejects placeholder Stripe mappings with PRICE_UNCONFIGURED before any write', async () => {
    priceMapHolder.priceId = null;
    await seedSalon('s_ph');
    const response = await post({ salonId: 's_ph', billingOfferKey: 'pro_2026_08_monthly' });

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('PRICE_UNCONFIGURED');
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(await attemptRows('s_ph')).toHaveLength(0);
  });

  it('rejects an unknown offer', async () => {
    await seedSalon('s_uo');
    const response = await post({ salonId: 's_uo', billingOfferKey: 'elite_1999_lifetime' });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('UNKNOWN_OFFER');
  });

  it('rejects a client-supplied Stripe price id structurally (strict schema)', async () => {
    await seedSalon('s_strict');
    const response = await post({
      salonId: 's_strict',
      billingOfferKey: 'pro_2026_08_monthly',
      priceId: 'price_attacker',
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_INPUT');
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied amount the same way', async () => {
    await seedSalon('s_amt');
    const response = await post({
      salonId: 's_amt',
      billingOfferKey: 'pro_2026_08_monthly',
      amountCents: 1,
    });

    expect(response.status).toBe(400);
  });
});

describe('attempt lifecycle', () => {
  it('creates the session under the attempt-derived idempotency key and records it', async () => {
    await seedSalon('s_ok');
    const response = await post({ salonId: 's_ok', billingOfferKey: 'pro_2026_08_monthly' });

    expect(response.status).toBe(200);

    const body = await response.json();

    expect(body.data.url).toBe('https://checkout.stripe.test/session');
    expect(body.data.reused).toBe(false);
    // Renewal disclosure: no promotion means first term and renewal agree.
    expect(body.data.disclosure).toMatchObject({
      billingOfferKey: 'pro_2026_08_monthly',
      cadence: 'monthly',
      firstTermCents: 2499,
      renewalCents: 2499,
    });

    const attempts = await attemptRows('s_ok');

    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.status).toBe('checkout_created');
    expect(attempts[0]!.stripeCheckoutSessionId).toBe(body.data.sessionId);
    // The Stripe idempotency key derives from the persisted attempt id and
    // was passed to the provider call.
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.checkout.sessions.create.mock.calls[0]![1])
      .toEqual({ idempotencyKey: `billing-attempt:${attempts[0]!.id}` });

    // Server-built redirect URLs; expiry set inside the claim TTL.
    const params = stripeMock.checkout.sessions.create.mock.calls[0]![0];

    expect(params.success_url).toBe('https://app.test/admin?billing=success');
    expect(params.line_items).toEqual([{ price: 'price_test_resolved', quantity: 1 }]);
    expect(params.metadata.purpose).toBe('plan_subscription');
  });

  it('a browser retry reuses the active attempt and its session — no second create', async () => {
    await seedSalon('s_retry');
    const first = await post({ salonId: 's_retry', billingOfferKey: 'pro_2026_08_monthly' });
    const firstBody = await first.json();
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({
      id: firstBody.data.sessionId,
      url: 'https://checkout.stripe.test/session',
    });

    const second = await post({ salonId: 's_retry', billingOfferKey: 'pro_2026_08_monthly' });
    const secondBody = await second.json();

    expect(secondBody.data.reused).toBe(true);
    expect(secondBody.data.sessionId).toBe(firstBody.data.sessionId);
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.checkout.sessions.retrieve).toHaveBeenCalledTimes(1);
    expect(await attemptRows('s_retry')).toHaveLength(1);
  });

  it('a live subscription blocks new subscription checkout with ACTIVE_SUBSCRIPTION_EXISTS', async () => {
    await seedSalon('s_live');
    await db.insert(schema.billingSubscriptionSchema).values({
      id: 'sub_live',
      salonId: 's_live',
      stripeSubscriptionId: 'sub_stripe_live',
      stripeCustomerId: 'cus_live',
      planDefinitionKey: 'pro_2026_08',
      billingOfferKey: 'pro_2026_08_monthly',
      billingCadence: 'monthly',
      status: 'active',
      paidThrough: new Date('2027-01-01T00:00:00.000Z'),
      creditCycleAnchor: new Date('2026-01-01T00:00:00.000Z'),
    });
    const response = await post({ salonId: 's_live', billingOfferKey: 'elite_2026_08_monthly' });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('ACTIVE_SUBSCRIPTION_EXISTS');
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('refuses a scheduled-cancellation subscription with a Portal-directing typed error (§2.3)', async () => {
    await seedSalon('s_sched');
    await db.insert(schema.billingSubscriptionSchema).values({
      id: 'sub_sched',
      salonId: 's_sched',
      stripeSubscriptionId: 'sub_stripe_sched',
      stripeCustomerId: 'cus_sched',
      planDefinitionKey: 'pro_2026_08',
      billingOfferKey: 'pro_2026_08_monthly',
      billingCadence: 'monthly',
      status: 'active',
      cancelAtPeriodEnd: true,
      paidThrough: new Date('2027-01-01T00:00:00.000Z'),
      creditCycleAnchor: new Date('2026-08-01T00:00:00.000Z'),
    });
    const response = await post({ salonId: 's_sched', billingOfferKey: 'elite_2026_08_monthly' });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('CANCELLATION_SCHEDULED');
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('refuses canceled-but-prepaid with the entitlement date, allows checkout after it ends (§2.3)', async () => {
    await seedSalon('s_prepaid');
    await db.insert(schema.billingSubscriptionSchema).values({
      id: 'sub_prepaid',
      salonId: 's_prepaid',
      stripeSubscriptionId: 'sub_stripe_prepaid',
      stripeCustomerId: 'cus_prepaid',
      planDefinitionKey: 'pro_2026_08',
      billingOfferKey: 'pro_2026_08_monthly',
      billingCadence: 'monthly',
      status: 'canceled',
      paidThrough: new Date(Date.now() + 7 * 24 * 3600_000),
      creditCycleAnchor: new Date('2026-08-01T00:00:00.000Z'),
    });
    const refused = await post({ salonId: 's_prepaid', billingOfferKey: 'pro_2026_08_monthly' });

    expect(refused.status).toBe(409);

    const refusedBody = await refused.json();

    expect(refusedBody.error.code).toBe('PREPAID_ENTITLEMENT_REMAINS');
    expect(typeof refusedBody.error.paidThrough).toBe('string');

    // Entitlement lapses: a new checkout proceeds.
    await db.update(schema.billingSubscriptionSchema)
      .set({ paidThrough: new Date(Date.now() - 1000) })
      .where(eq(schema.billingSubscriptionSchema.id, 'sub_prepaid'));
    const allowed = await post({ salonId: 's_prepaid', billingOfferKey: 'pro_2026_08_monthly' });

    expect(allowed.status).toBe(200);
  });

  it('a provider failure fails the attempt so the slot is not wedged', async () => {
    await seedSalon('s_fail');
    stripeMock.checkout.sessions.create.mockRejectedValueOnce(new Error('stripe down'));
    const response = await post({ salonId: 's_fail', billingOfferKey: 'pro_2026_08_monthly' });

    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('CHECKOUT_CREATE_FAILED');

    const attempts = await attemptRows('s_fail');

    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.status).toBe('failed');

    // The slot is free again: a fresh request succeeds with a NEW attempt.
    const retry = await post({ salonId: 's_fail', billingOfferKey: 'pro_2026_08_monthly' });

    expect(retry.status).toBe(200);
  });
});

describe('founding promotion — claim-before-Checkout (§7.3)', () => {
  it('reserves the claim before the session exists and records the session on it', async () => {
    adminHolder.clerkUserId = 'user_promo';
    await seedSalon('s_promo');
    const response = await post({
      salonId: 's_promo',
      billingOfferKey: 'pro_2026_08_annual',
      promotionKey: 'founding_annual_2026',
    });

    expect(response.status).toBe(200);

    const body = await response.json();

    // §3.4 founding math: first term = 60% of the standard annual price,
    // renewal = the standard annual price, protection window disclosed —
    // three DISTINCT numbers.
    expect(body.data.disclosure).toMatchObject({
      firstTermCents: 14994,
      renewalCents: 24990,
      rateProtectionMonths: 24,
    });
    // Forbidden 50%-off vector can never appear.
    expect(body.data.disclosure.firstTermCents).not.toBe(12495);

    const claims = await db.select().from(schema.billingPromotionClaimSchema);

    expect(claims).toHaveLength(1);
    expect(claims[0]!.status).toBe('reserved');
    expect(claims[0]!.stripeCheckoutSessionId).toBe(body.data.sessionId);

    // The coupon rides the session as a discount; promo-code entry is off.
    const params = stripeMock.checkout.sessions.create.mock.calls[0]![0];

    expect(params.discounts).toEqual([{ coupon: 'coupon_test_resolved' }]);
    expect(params.allow_promotion_codes).toBeUndefined();
  });

  it('refuses the promotion on a monthly offer before any durable write', async () => {
    adminHolder.clerkUserId = 'user_promo_m';
    await seedSalon('s_promo_m');
    const response = await post({
      salonId: 's_promo_m',
      billingOfferKey: 'pro_2026_08_monthly',
      promotionKey: 'founding_annual_2026',
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('PROMOTION_NOT_ELIGIBLE');
    expect(await attemptRows('s_promo_m')).toHaveLength(0);

    const claims = await db.select().from(schema.billingPromotionClaimSchema);

    expect(claims.filter(claim => claim.salonId === 's_promo_m')).toHaveLength(0);
  });

  it('the COMMITTED null/null promotion window refuses with PROMOTION_CLOSED (dark posture)', async () => {
    promotionHolder.startsAt = null;
    promotionHolder.endsAt = null;
    adminHolder.clerkUserId = 'user_promo_c';
    await seedSalon('s_promo_c');
    const response = await post({
      salonId: 's_promo_c',
      billingOfferKey: 'pro_2026_08_annual',
      promotionKey: 'founding_annual_2026',
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('PROMOTION_CLOSED');
    expect(await attemptRows('s_promo_c')).toHaveLength(0);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('releases the claim when the provider refuses the session', async () => {
    await seedSalon('s_promo_f');
    stripeMock.checkout.sessions.create.mockRejectedValueOnce(new Error('stripe down'));
    const response = await post({
      salonId: 's_promo_f',
      billingOfferKey: 'elite_2026_08_annual',
      promotionKey: 'founding_annual_2026',
    });

    expect(response.status).toBe(502);

    const claims = await db
      .select()
      .from(schema.billingPromotionClaimSchema);
    const released = claims.filter(claim => claim.salonId === 's_promo_f');

    expect(released).toHaveLength(1);
    expect(released[0]!.status).toBe('released');
  });
});
