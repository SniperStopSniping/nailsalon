/**
 * C3 top-up proofs — §9.7. The reversal ARITHMETIC is pinned in
 * creditGrants.test.ts (#118); this suite proves the wiring: the dark
 * switch consumes nothing, audience is server-resolved, fulfillment happens
 * only on verified paid evidence through the webhook (replay-safe), expiry
 * parks the purchase, refunds ride the cumulative charge figure, disputes
 * reverse the residual, and a non-top-up charge stays held for a human.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
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
  BILLING_TOPUPS_ENABLED: undefined as string | undefined,
  BILLING_TAX_COLLECTION_ENABLED: undefined as string | undefined,
  STRIPE_BILLING_WEBHOOK_SECRET: 'whsec_test' as string | undefined,
  NEXT_PUBLIC_APP_URL: 'https://app.test',
  BILLING_IDENTITY_HMAC_SECRET: undefined,
  BILLING_IDENTITY_HMAC_VERSION: undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

// `deniedSalonIds` simulates requireAdmin's real per-salon membership check
// (adminAuth.ts:443-454): an admin authenticated for one salon is refused a
// FOREIGN salonId, distinct from the blanket `allowed=false` case below.
const adminHolder = vi.hoisted(() => ({ allowed: true, deniedSalonIds: new Set<string>() }));
vi.mock('@/libs/adminAuth', () => ({
  requireAdmin: vi.fn(async (salonId: string) => (adminHolder.allowed && !adminHolder.deniedSalonIds.has(salonId))
    ? { ok: true, admin: { clerkUserId: 'user_topup' } }
    : { ok: false, response: new Response('forbidden', { status: 403 }) }),
}));
vi.mock('@/libs/rateLimit', () => ({
  checkEndpointRateLimit: () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
  rateLimitResponse: () => new Response('rate limited', { status: 429 }),
}));

const stripeMock = vi.hoisted(() => ({
  checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } },
  webhooks: {
    constructEvent: vi.fn((rawBody: string, signature: string) => {
      if (signature !== 'sig_valid') {
        throw new Error('bad signature');
      }
      return JSON.parse(rawBody);
    }),
  },
  subscriptions: { retrieve: vi.fn() },
  // G01/refund.updated: the webhook route fetches the charge to learn its
  // CUMULATIVE amount_refunded — the Refund object alone never carries it.
  charges: { retrieve: vi.fn() },
  invoices: { retrieve: vi.fn() },
}));
vi.mock('@/libs/stripe', () => ({ stripe: stripeMock }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

const priceMapHolder = vi.hoisted(() => ({ priceId: 'price_topup_resolved' as string | null }));
vi.mock('@/libs/billing/stripePriceMap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/billing/stripePriceMap')>();
  return {
    ...actual,
    resolveStripePriceIdForTopup: (key: string) => {
      if (priceMapHolder.priceId === null) {
        throw new actual.BillingCatalogError('PRICE_UNCONFIGURED', `unconfigured: ${key}`);
      }
      return priceMapHolder.priceId;
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
  envHolder.BILLING_TOPUPS_ENABLED = 'true';
  envHolder.BILLING_TAX_COLLECTION_ENABLED = undefined;
  priceMapHolder.priceId = 'price_topup_resolved';
  stripeMock.checkout.sessions.create.mockReset();
  stripeMock.checkout.sessions.retrieve.mockReset();
  stripeMock.charges.retrieve.mockReset();
  stripeMock.invoices.retrieve.mockReset();
  stripeMock.checkout.sessions.create.mockImplementation(async () => ({
    id: `cs_topup_${Math.random().toString(36).slice(2, 8)}`,
    url: 'https://checkout.stripe.test/topup',
  }));
  adminHolder.allowed = true;
  adminHolder.deniedSalonIds = new Set();
});

const postCheckout = async (body: unknown) => {
  const { POST } = await import('./route');
  return POST(new (await import('next/server')).NextRequest('http://localhost/api/billing/checkout/topup', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }));
};

const postWebhook = async (event: unknown) => {
  const { POST } = await import('../../../webhooks/stripe-billing/route');
  return POST(new Request('http://localhost/api/webhooks/stripe-billing', {
    method: 'POST',
    body: JSON.stringify(event),
    headers: { 'stripe-signature': 'sig_valid' },
  }));
};

let eventCounter = 100;
const webhookEvent = (type: string, object: Record<string, unknown>) => {
  eventCounter += 1;
  return { id: `evt_topup_${eventCounter}`, type, livemode: false, created: 1_780_000_000 + eventCounter, data: { object } };
};

async function seedSalon(id: string, plan: string | null = 'single_salon') {
  await db.insert(schema.salonSchema).values({ id, name: id, slug: id, plan });
}

const purchaseRows = (salonId: string) =>
  db.select().from(schema.smsTopupPurchaseSchema)
    .where(eq(schema.smsTopupPurchaseSchema.salonId, salonId));

const attemptRows = (salonId: string) =>
  db.select().from(schema.billingCheckoutAttemptSchema)
    .where(eq(schema.billingCheckoutAttemptSchema.salonId, salonId));

const retrievedTopupSession = (input: {
  id: string;
  salonId: string;
  topupOfferKey: string;
  attemptId?: string;
  purchaseId?: string;
  status?: string;
  url?: string | null;
}) => ({
  id: input.id,
  mode: 'payment',
  status: input.status ?? 'open',
  url: input.url ?? 'https://checkout.stripe.test/topup',
  metadata: {
    purpose: 'sms_topup',
    salonId: input.salonId,
    topupOfferKey: input.topupOfferKey,
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    ...(input.purchaseId ? { purchaseId: input.purchaseId } : {}),
  },
});

const purchasedBalance = async (salonId: string) => {
  const rows = await db.execute(sql`
    SELECT COALESCE(SUM(amount), 0)::int AS total FROM sms_credit_ledger
    WHERE salon_id = ${salonId} AND bucket = 'purchased'
  `);
  return Number((rows.rows[0] as Record<string, unknown>).total);
};

describe('top-up checkout (§9.2)', () => {
  it('the dark switch rejects before any write or provider call', async () => {
    envHolder.BILLING_TOPUPS_ENABLED = undefined;
    await seedSalon('s_t_dark');
    const response = await postCheckout({ salonId: 's_t_dark', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('TOPUPS_DISABLED');
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(await purchaseRows('s_t_dark')).toHaveLength(0);
  });

  it('rejects a wrong-audience offer server-side', async () => {
    await seedSalon('s_t_aud', 'free'); // free plan buying paid-audience pricing
    const response = await postCheckout({ salonId: 's_t_aud', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('OFFER_AUDIENCE_MISMATCH');
  });

  it('rejects client-supplied amounts structurally', async () => {
    await seedSalon('s_t_amt');
    const response = await postCheckout({ salonId: 's_t_amt', topupOfferKey: 'topup_100_paid_2026_08', amountCents: 1 });

    expect(response.status).toBe(400);
  });

  it('rejects an unconfigured price before reserving a purchase or calling Stripe', async () => {
    priceMapHolder.priceId = null;
    await seedSalon('s_t_mapping');

    const response = await postCheckout({ salonId: 's_t_mapping', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('PRICE_UNCONFIGURED');
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(await attemptRows('s_t_mapping')).toHaveLength(0);
    expect(await purchaseRows('s_t_mapping')).toHaveLength(0);
  });

  it('rejects an unauthorized request before reserving a purchase or calling Stripe', async () => {
    adminHolder.allowed = false;
    await seedSalon('s_t_forbidden');

    const response = await postCheckout({ salonId: 's_t_forbidden', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(response.status).toBe(403);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(await attemptRows('s_t_forbidden')).toHaveLength(0);
    expect(await purchaseRows('s_t_forbidden')).toHaveLength(0);
  });

  it('an admin of a DIFFERENT salon is refused a foreign salonId before reserving a purchase or calling Stripe (§17 cross-salon isolation)', async () => {
    // Approach: this file already stubs @/libs/adminAuth globally. It is
    // extended here (see `deniedSalonIds` above) to key off the requested
    // salonId, mirroring requireAdmin's real per-salon membership check
    // (adminAuth.ts:443-454) rather than the blanket allow/deny used by the
    // generic unauthorized case above.
    await seedSalon('s_t_cross_owner');
    await seedSalon('s_t_cross_target');
    adminHolder.deniedSalonIds.add('s_t_cross_target');

    const response = await postCheckout({ salonId: 's_t_cross_target', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(response.status).toBe(403);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(await attemptRows('s_t_cross_target')).toHaveLength(0);
    expect(await purchaseRows('s_t_cross_target')).toHaveLength(0);

    // The admin's own salon remains unaffected.
    const own = await postCheckout({ salonId: 's_t_cross_owner', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(own.status).toBe(200);
  });

  it('precreates the durable purchase and creates the session under the attempt key', async () => {
    await seedSalon('s_t_ok');
    const response = await postCheckout({ salonId: 's_t_ok', topupOfferKey: 'topup_250_paid_2026_08' });

    expect(response.status).toBe(200);

    const body = await response.json();

    expect(body.data.offer).toEqual({ key: 'topup_250_paid_2026_08', credits: 250, priceCents: 1399, currency: 'cad' });

    const purchases = await purchaseRows('s_t_ok');

    expect(purchases).toHaveLength(1);
    expect(purchases[0]).toMatchObject({
      status: 'checkout_created',
      credits: 250,
      amountCents: 1399,
      stripeCheckoutSessionId: body.data.sessionId,
    });

    const params = stripeMock.checkout.sessions.create.mock.calls[0]![0];

    expect(params.mode).toBe('payment');
    expect(params.metadata.purpose).toBe('sms_topup');
    // D8: card-only — delayed-notification payment methods stay excluded.
    expect(params.payment_method_types).toEqual(['card']);
  });

  it('reuses one bound, verified open session for a retry of the same offer', async () => {
    await seedSalon('s_t_retry');
    const first = await postCheckout({ salonId: 's_t_retry', topupOfferKey: 'topup_100_paid_2026_08' });
    const firstBody = await first.json();
    const [attempt] = await attemptRows('s_t_retry');
    const [purchase] = await purchaseRows('s_t_retry');
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(retrievedTopupSession({
      id: firstBody.data.sessionId,
      salonId: 's_t_retry',
      topupOfferKey: 'topup_100_paid_2026_08',
      attemptId: attempt!.id,
      purchaseId: purchase!.id,
    }));

    const second = await postCheckout({ salonId: 's_t_retry', topupOfferKey: 'topup_100_paid_2026_08' });
    const body = await second.json();

    expect(second.status).toBe(200);
    expect(body.data).toMatchObject({ sessionId: firstBody.data.sessionId, reused: true });
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.checkout.sessions.retrieve).toHaveBeenCalledTimes(1);
    expect(await attemptRows('s_t_retry')).toHaveLength(1);
    expect(await purchaseRows('s_t_retry')).toHaveLength(1);
  });

  it('holds a different offer behind an unresolved top-up without calling Stripe again', async () => {
    await seedSalon('s_t_conflict');
    await postCheckout({ salonId: 's_t_conflict', topupOfferKey: 'topup_100_paid_2026_08' });

    const response = await postCheckout({ salonId: 's_t_conflict', topupOfferKey: 'topup_250_paid_2026_08' });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('CHECKOUT_IN_PROGRESS');
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(await purchaseRows('s_t_conflict')).toHaveLength(1);
  });

  it('reports multiple pre-existing unresolved attempts as an anomaly without selecting one', async () => {
    await seedSalon('s_t_multiple');
    const expiresAt = new Date('2020-01-01T00:00:00.000Z');
    await db.insert(schema.billingCheckoutAttemptSchema).values([
      {
        id: 'bca_multiple_1',
        salonId: 's_t_multiple',
        purpose: 'sms_topup',
        topupOfferKey: 'topup_100_paid_2026_08',
        status: 'creating',
        stripeIdempotencyKey: 'billing-attempt:bca_multiple_1',
        expiresAt,
      },
      {
        id: 'bca_multiple_2',
        salonId: 's_t_multiple',
        purpose: 'sms_topup',
        topupOfferKey: 'topup_100_paid_2026_08',
        status: 'checkout_created',
        stripeIdempotencyKey: 'billing-attempt:bca_multiple_2',
        expiresAt,
      },
    ]);

    const response = await postCheckout({ salonId: 's_t_multiple', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('CHECKOUT_PENDING_RECONCILIATION');
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(await attemptRows('s_t_multiple')).toHaveLength(2);
  });

  it('holds an uncertain provider-create outcome for reconciliation and never creates a replacement', async () => {
    await seedSalon('s_t_create_unknown');
    stripeMock.checkout.sessions.create.mockRejectedValueOnce(new Error('connection dropped after submit'));

    const first = await postCheckout({ salonId: 's_t_create_unknown', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(first.status).toBe(409);
    expect((await first.json()).error.code).toBe('CHECKOUT_PENDING_RECONCILIATION');
    expect(await attemptRows('s_t_create_unknown')).toHaveLength(1);
    expect(await purchaseRows('s_t_create_unknown')).toHaveLength(1);

    const retry = await postCheckout({ salonId: 's_t_create_unknown', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(retry.status).toBe(409);
    expect((await retry.json()).error.code).toBe('CHECKOUT_PENDING_RECONCILIATION');
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  it('holds a remotely-created session when the local binding transaction fails', async () => {
    await seedSalon('s_t_bind_unknown');
    const attempts = await import('@/libs/billing/checkoutAttempts');
    const binding = vi.spyOn(attempts, 'markAttemptCheckoutCreated')
      .mockRejectedValueOnce(new Error('local binding unavailable'));

    try {
      const first = await postCheckout({ salonId: 's_t_bind_unknown', topupOfferKey: 'topup_100_paid_2026_08' });

      expect(first.status).toBe(409);
      expect((await first.json()).error.code).toBe('CHECKOUT_PENDING_RECONCILIATION');

      const [attempt] = await attemptRows('s_t_bind_unknown');
      const [purchase] = await purchaseRows('s_t_bind_unknown');

      expect(attempt).toMatchObject({ status: 'creating', stripeCheckoutSessionId: null });
      expect(purchase).toMatchObject({ status: 'checkout_created', stripeCheckoutSessionId: null });

      const retry = await postCheckout({ salonId: 's_t_bind_unknown', topupOfferKey: 'topup_100_paid_2026_08' });

      expect(retry.status).toBe(409);
      expect((await retry.json()).error.code).toBe('CHECKOUT_PENDING_RECONCILIATION');
      expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
      expect(await purchaseRows('s_t_bind_unknown')).toHaveLength(1);
    } finally {
      binding.mockRestore();
    }
  });

  it('holds a bound checkout when its Stripe retrieval fails or its evidence is invalid', async () => {
    await seedSalon('s_t_retrieve_unknown');
    const first = await postCheckout({ salonId: 's_t_retrieve_unknown', topupOfferKey: 'topup_100_paid_2026_08' });
    const { data } = await first.json();
    const [purchase] = await purchaseRows('s_t_retrieve_unknown');
    stripeMock.checkout.sessions.retrieve.mockRejectedValueOnce(new Error('Stripe unavailable'));

    const retrievalFailure = await postCheckout({ salonId: 's_t_retrieve_unknown', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(retrievalFailure.status).toBe(409);
    expect((await retrievalFailure.json()).error.code).toBe('CHECKOUT_PENDING_RECONCILIATION');

    stripeMock.checkout.sessions.retrieve.mockResolvedValueOnce(retrievedTopupSession({
      id: data.sessionId,
      salonId: 's_t_retrieve_unknown',
      topupOfferKey: 'topup_100_paid_2026_08',
      attemptId: 'bca_wrong_attempt',
      purchaseId: purchase!.id,
    }));
    const invalidEvidence = await postCheckout({ salonId: 's_t_retrieve_unknown', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(invalidEvidence.status).toBe(409);
    expect((await invalidEvidence.json()).error.code).toBe('CHECKOUT_PENDING_RECONCILIATION');
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(await purchaseRows('s_t_retrieve_unknown')).toHaveLength(1);
  });

  it('permits a new checkout only after Stripe verifies the prior session expired', async () => {
    await seedSalon('s_t_verified_expiry');
    const first = await postCheckout({ salonId: 's_t_verified_expiry', topupOfferKey: 'topup_100_paid_2026_08' });
    const firstBody = await first.json();
    const [attempt] = await attemptRows('s_t_verified_expiry');
    const [purchase] = await purchaseRows('s_t_verified_expiry');
    stripeMock.checkout.sessions.retrieve.mockResolvedValueOnce(retrievedTopupSession({
      id: firstBody.data.sessionId,
      salonId: 's_t_verified_expiry',
      topupOfferKey: 'topup_100_paid_2026_08',
      attemptId: attempt!.id,
      purchaseId: purchase!.id,
      status: 'expired',
      url: null,
    }));

    const expiryObservation = await postCheckout({ salonId: 's_t_verified_expiry', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(expiryObservation.status).toBe(409);
    expect((await expiryObservation.json()).error.code).toBe('CHECKOUT_IN_PROGRESS');

    const replacement = await postCheckout({ salonId: 's_t_verified_expiry', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(replacement.status).toBe(200);
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(2);
    expect(await purchaseRows('s_t_verified_expiry')).toHaveLength(2);
  });

  it('never lets subscription-attempt TTL cleanup release an unresolved top-up', async () => {
    await seedSalon('s_t_ttl_isolated');
    const first = await postCheckout({ salonId: 's_t_ttl_isolated', topupOfferKey: 'topup_100_paid_2026_08' });
    const firstBody = await first.json();
    const [topupAttempt] = await attemptRows('s_t_ttl_isolated');
    const [purchase] = await purchaseRows('s_t_ttl_isolated');
    await db.update(schema.billingCheckoutAttemptSchema)
      .set({ expiresAt: new Date('2020-01-01T00:00:00.000Z') })
      .where(eq(schema.billingCheckoutAttemptSchema.id, topupAttempt!.id));

    const { beginCheckoutAttempt } = await import('@/libs/billing/checkoutAttempts');
    await db.transaction(tx => beginCheckoutAttempt(tx, {
      salonId: 's_t_ttl_isolated',
      purpose: 'plan_subscription',
      billingOfferKey: 'pro_2026_08_monthly',
      now: new Date('2027-01-01T00:00:00.000Z'),
    }));

    const [afterSubscriptionCleanup] = (await attemptRows('s_t_ttl_isolated'))
      .filter(row => row.id === topupAttempt!.id);

    expect(afterSubscriptionCleanup).toMatchObject({ status: 'checkout_created' });

    const { applyCheckoutSessionExpired } = await import('@/libs/billing/billingSubscriptionProjection');
    const subscriptionExpiry = await applyCheckoutSessionExpired({ sessionId: firstBody.data.sessionId });

    expect(subscriptionExpiry).toMatchObject({ attemptExpired: false, claimReleased: false });

    const [afterSubscriptionExpiry] = (await attemptRows('s_t_ttl_isolated'))
      .filter(row => row.id === topupAttempt!.id);

    expect(afterSubscriptionExpiry).toMatchObject({ status: 'checkout_created' });

    stripeMock.checkout.sessions.retrieve.mockResolvedValueOnce(retrievedTopupSession({
      id: firstBody.data.sessionId,
      salonId: 's_t_ttl_isolated',
      topupOfferKey: 'topup_100_paid_2026_08',
      attemptId: topupAttempt!.id,
      purchaseId: purchase!.id,
    }));
    const retry = await postCheckout({ salonId: 's_t_ttl_isolated', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(retry.status).toBe(200);
    expect((await retry.json()).data.reused).toBe(true);
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  it('keeps an expiry webhook retryable when it arrives before checkout binding', async () => {
    await seedSalon('s_t_early_expiry');
    const earlyExpiry = webhookEvent('checkout.session.expired', {
      id: 'cs_t_early_expiry',
      metadata: { purpose: 'sms_topup', salonId: 's_t_early_expiry' },
    });
    let earlyResponse: Response | undefined;
    stripeMock.checkout.sessions.create.mockImplementationOnce(async () => {
      earlyResponse = await postWebhook(earlyExpiry);
      return { id: 'cs_t_early_expiry', url: 'https://checkout.stripe.test/topup' };
    });

    const checkout = await postCheckout({ salonId: 's_t_early_expiry', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(checkout.status).toBe(200);
    expect(earlyResponse!.status).toBe(500);

    // The webhook worker deliberately backs off failed delivery. Make the
    // existing event eligible so this unit proof can exercise redelivery.
    await db.update(schema.billingStripeEventSchema)
      .set({ availableAt: new Date(0) })
      .where(eq(schema.billingStripeEventSchema.eventId, earlyExpiry.id));
    const replay = await postWebhook(earlyExpiry);

    expect(replay.status).toBe(200);

    const [purchase] = await purchaseRows('s_t_early_expiry');

    expect(purchase!.status).toBe('expired');
  });
});

describe('top-up fulfillment through the webhook (§9.3-§9.5)', () => {
  // G02: the webhook retrieves the session (line items + payment intent)
  // whenever it is about to fulfil — queue the verified evidence the route
  // expects to see for a genuine, unmodified purchase.
  async function mockVerifiedTopupEvidence(input: {
    sessionId: string;
    salonId: string;
    priceId?: string | null;
  }) {
    const [purchase] = await purchaseRows(input.salonId);
    const [attempt] = await attemptRows(input.salonId);

    stripeMock.checkout.sessions.retrieve.mockResolvedValueOnce({
      id: input.sessionId,
      amount_total: purchase!.amountCents,
      currency: 'cad',
      metadata: {
        purpose: 'sms_topup',
        salonId: input.salonId,
        topupOfferKey: purchase!.topupOfferKey,
        purchaseId: purchase!.id,
        attemptId: attempt?.id,
      },
      line_items: { data: input.priceId ? [{ price: { id: input.priceId } }] : [] },
      payment_intent: `pi_${input.salonId}`,
    });
    return { purchase, attempt };
  }

  async function buyAndPay(salonId: string, sessionOverride?: string) {
    await seedSalon(salonId);
    const checkout = await postCheckout({ salonId, topupOfferKey: 'topup_100_paid_2026_08' });
    const { data } = await checkout.json();
    const sessionId = sessionOverride ?? data.sessionId;
    await mockVerifiedTopupEvidence({ sessionId, salonId });
    const completed = webhookEvent('checkout.session.completed', {
      id: sessionId,
      payment_status: 'paid',
      payment_intent: `pi_${salonId}`,
      metadata: { purpose: 'sms_topup', salonId },
    });
    await postWebhook(completed);
    return { sessionId, completed };
  }

  it('grants exactly once on verified paid evidence, replay-safe', async () => {
    const { completed } = await buyAndPay('s_t_fulfill');

    expect(await purchasedBalance('s_t_fulfill')).toBe(100);

    const [purchase] = await purchaseRows('s_t_fulfill');

    expect(purchase!.status).toBe('fulfilled');
    expect(purchase!.grantLedgerId).not.toBeNull();

    await postWebhook(completed); // full replay

    expect(await purchasedBalance('s_t_fulfill')).toBe(100);
  });

  it('an unpaid async completion records the intent and grants nothing', async () => {
    await seedSalon('s_t_unpaid');
    const checkout = await postCheckout({ salonId: 's_t_unpaid', topupOfferKey: 'topup_100_paid_2026_08' });
    const { data } = await checkout.json();
    await postWebhook(webhookEvent('checkout.session.completed', {
      id: data.sessionId,
      payment_status: 'unpaid',
      payment_intent: 'pi_unpaid',
      metadata: { purpose: 'sms_topup', salonId: 's_t_unpaid' },
    }));

    expect(await purchasedBalance('s_t_unpaid')).toBe(0);

    const [purchase] = await purchaseRows('s_t_unpaid');

    expect(purchase!.status).toBe('checkout_created');
    expect(purchase!.stripePaymentIntentId).toBe('pi_unpaid');
  });

  it('keeps an unpaid completion pending and does not create a replacement checkout', async () => {
    await seedSalon('s_t_unpaid_retry');
    const checkout = await postCheckout({ salonId: 's_t_unpaid_retry', topupOfferKey: 'topup_100_paid_2026_08' });
    const { data } = await checkout.json();
    await postWebhook(webhookEvent('checkout.session.completed', {
      id: data.sessionId,
      payment_status: 'unpaid',
      payment_intent: 'pi_unpaid_retry',
      metadata: { purpose: 'sms_topup', salonId: 's_t_unpaid_retry' },
    }));

    const [attemptBefore] = await attemptRows('s_t_unpaid_retry');
    const [purchaseBefore] = await purchaseRows('s_t_unpaid_retry');
    const creditAccountBefore = await db.select().from(schema.smsCreditAccountSchema)
      .where(eq(schema.smsCreditAccountSchema.salonId, 's_t_unpaid_retry'));
    const creditLedgerBefore = await db.select().from(schema.smsCreditLedgerSchema)
      .where(eq(schema.smsCreditLedgerSchema.salonId, 's_t_unpaid_retry'));
    const sentry = await import('@sentry/nextjs');
    const captureCountBefore = vi.mocked(sentry.captureException).mock.calls.length;

    stripeMock.checkout.sessions.retrieve.mockResolvedValue(retrievedTopupSession({
      id: data.sessionId,
      salonId: 's_t_unpaid_retry',
      topupOfferKey: 'topup_100_paid_2026_08',
      attemptId: attemptBefore!.id,
      purchaseId: purchaseBefore!.id,
      status: 'complete',
    }));

    const retry = await postCheckout({ salonId: 's_t_unpaid_retry', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(retry.status).toBe(409);
    expect((await retry.json()).error.code).toBe('CHECKOUT_PENDING_RECONCILIATION');
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.checkout.sessions.retrieve).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sentry.captureException)).toHaveBeenCalledTimes(captureCountBefore);
    expect(await attemptRows('s_t_unpaid_retry')).toEqual([attemptBefore]);
    expect(await purchaseRows('s_t_unpaid_retry')).toEqual([purchaseBefore]);
    expect(await db.select().from(schema.smsCreditAccountSchema)
      .where(eq(schema.smsCreditAccountSchema.salonId, 's_t_unpaid_retry'))).toEqual(creditAccountBefore);
    expect(await db.select().from(schema.smsCreditLedgerSchema)
      .where(eq(schema.smsCreditLedgerSchema.salonId, 's_t_unpaid_retry'))).toEqual(creditLedgerBefore);
    expect(creditLedgerBefore).toHaveLength(0);
  });

  it('allows a later top-up after verified fulfillment', async () => {
    await buyAndPay('s_t_fulfilled_retry');

    const next = await postCheckout({ salonId: 's_t_fulfilled_retry', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(next.status).toBe(200);
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(2);
    expect(await purchaseRows('s_t_fulfilled_retry')).toHaveLength(2);
  });

  it('does not undo fulfilled credits when a signed expiry webhook arrives late', async () => {
    const { sessionId } = await buyAndPay('s_t_late_expiry');

    const lateExpiry = await postWebhook(webhookEvent('checkout.session.expired', {
      id: sessionId,
      metadata: { purpose: 'sms_topup', salonId: 's_t_late_expiry' },
    }));

    expect(lateExpiry.status).toBe(200);
    expect(await purchasedBalance('s_t_late_expiry')).toBe(100);

    const [purchase] = await purchaseRows('s_t_late_expiry');
    const [attempt] = await attemptRows('s_t_late_expiry');

    expect(purchase).toMatchObject({ status: 'fulfilled' });
    expect(attempt).toMatchObject({ status: 'completed' });
  });

  it('an expired session parks the purchase', async () => {
    await seedSalon('s_t_exp');
    const checkout = await postCheckout({ salonId: 's_t_exp', topupOfferKey: 'topup_100_paid_2026_08' });
    const { data } = await checkout.json();
    await postWebhook(webhookEvent('checkout.session.expired', {
      id: data.sessionId,
      metadata: { purpose: 'sms_topup', salonId: 's_t_exp' },
    }));
    const [purchase] = await purchaseRows('s_t_exp');

    expect(purchase!.status).toBe('expired');
  });

  it('a partial refund reverses by the CUMULATIVE charge figure (#118 arithmetic)', async () => {
    await buyAndPay('s_t_refund');
    // 100cr / $5.99: cumulative 300¢ → T = floor(100·300/599) = 50.
    await postWebhook(webhookEvent('charge.refunded', {
      id: 'ch_t_refund',
      payment_intent: 'pi_s_t_refund',
      amount_refunded: 300,
      refunds: { data: [{ id: 're_t_1' }] },
    }));

    expect(await purchasedBalance('s_t_refund')).toBe(50);

    const [purchase] = await purchaseRows('s_t_refund');

    expect(purchase!.status).toBe('partially_reversed');
  });

  it('a dispute reverses the residual and can drive availability negative', async () => {
    await buyAndPay('s_t_dispute');
    await postWebhook(webhookEvent('charge.dispute.created', {
      id: 'dp_t_1',
      payment_intent: 'pi_s_t_dispute',
    }));

    expect(await purchasedBalance('s_t_dispute')).toBe(0);

    const [purchase] = await purchaseRows('s_t_dispute');

    expect(purchase!.status).toBe('disputed');
  });

  it('a charge event matching no top-up purchase and no local subscription is ignored as foreign, never held for a human (G42)', async () => {
    const event = webhookEvent('charge.refunded', {
      id: 'ch_foreign',
      payment_intent: 'pi_subscription_charge',
      amount_refunded: 100,
    });
    await postWebhook(event);
    const [row] = (await db.select().from(schema.billingStripeEventSchema))
      .filter(entry => entry.eventId === event.id);

    expect(row!.status).toBe('ignored_foreign');
    expect(row!.lastError).toBe('FOREIGN_CHARGE');

    const sentry = await import('@sentry/nextjs');

    // No billing-webhook alert for THIS event (other tests in this file may
    // have alerted for unrelated reasons; this file has no per-test Sentry reset).
    expect(vi.mocked(sentry.captureMessage)).not.toHaveBeenCalledWith('billing.charge_event_held', expect.anything());
    expect(vi.mocked(sentry.captureMessage)).not.toHaveBeenCalledWith('billing.event_held_anomaly', expect.anything());
  });

  // G01 — refund.updated joins charge.refunded on the same cumulative-evidence path.
  describe('G01 — refund.updated (charge-level cumulative evidence)', () => {
    it('a lone refund.updated reverses by the charge-fetched CUMULATIVE figure, at most once on replay', async () => {
      await buyAndPay('s_t_refund_updated');
      stripeMock.charges.retrieve.mockResolvedValueOnce({
        id: 'ch_t_ru',
        amount: 599,
        amount_refunded: 300, // cumulative, from the CHARGE — the refund object itself never carries this
        invoice: null,
        payment_intent: 'pi_s_t_refund_updated',
      });
      const event = webhookEvent('refund.updated', {
        id: 're_t_ru_1',
        charge: 'ch_t_ru',
        payment_intent: 'pi_s_t_refund_updated',
        amount: 300,
      });
      await postWebhook(event);

      // 100cr / 599¢: T = floor(100·300/599) = 50.
      expect(await purchasedBalance('s_t_refund_updated')).toBe(50);

      // Exact replay of the SAME event id — claimBillingEvent dedups it
      // before handleEvent (and therefore charges.retrieve) ever runs again.
      await postWebhook(event);

      expect(await purchasedBalance('s_t_refund_updated')).toBe(50);
    });

    it('charge.refunded then refund.updated for ONE refund reverse the topup at most once', async () => {
      await buyAndPay('s_t_dedup');
      await postWebhook(webhookEvent('charge.refunded', {
        id: 'ch_t_dedup',
        payment_intent: 'pi_s_t_dedup',
        amount: 599,
        amount_refunded: 599, // full
        refunds: { data: [{ id: 're_t_dedup' }] },
      }));

      expect(await purchasedBalance('s_t_dedup')).toBe(0);

      stripeMock.charges.retrieve.mockResolvedValueOnce({
        id: 'ch_t_dedup',
        amount: 599,
        amount_refunded: 599,
        invoice: null,
        payment_intent: 'pi_s_t_dedup',
      });
      await postWebhook(webhookEvent('refund.updated', {
        id: 're_t_dedup', // the SAME refund id charge.refunded already reported
        charge: 'ch_t_dedup',
        payment_intent: 'pi_s_t_dedup',
        amount: 599,
      }));

      // Still fully (and only once) reversed — never double-reversed negative.
      expect(await purchasedBalance('s_t_dedup')).toBe(0);

      const [purchase] = await purchaseRows('s_t_dedup');

      expect(purchase!.status).toBe('refunded');
    });
  });

  // G02 — top-up verified-evidence cross-check.
  describe('G02 — verified evidence before fulfilment', () => {
    it('an amount mismatch between the retrieved session and the persisted purchase holds the event and grants nothing', async () => {
      await seedSalon('s_t_evidence_mismatch');
      const checkout = await postCheckout({ salonId: 's_t_evidence_mismatch', topupOfferKey: 'topup_100_paid_2026_08' });
      const { data } = await checkout.json();
      const [purchase] = await purchaseRows('s_t_evidence_mismatch');
      const [attempt] = await attemptRows('s_t_evidence_mismatch');

      // The retrieved session reports a DIFFERENT amount than the persisted
      // purchase (599¢) — tampering, or a session/purchase mismatch race.
      stripeMock.checkout.sessions.retrieve.mockResolvedValueOnce({
        id: data.sessionId,
        amount_total: 1,
        currency: 'cad',
        metadata: {
          purpose: 'sms_topup',
          salonId: 's_t_evidence_mismatch',
          topupOfferKey: purchase!.topupOfferKey,
          purchaseId: purchase!.id,
          attemptId: attempt!.id,
        },
        line_items: { data: [] },
        payment_intent: 'pi_evidence_mismatch',
      });
      const event = webhookEvent('checkout.session.completed', {
        id: data.sessionId,
        payment_status: 'paid',
        payment_intent: 'pi_evidence_mismatch',
        metadata: { purpose: 'sms_topup', salonId: 's_t_evidence_mismatch' },
      });
      const response = await postWebhook(event);

      expect(response.status).toBe(200);

      const [row] = (await db.select().from(schema.billingStripeEventSchema))
        .filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('held_anomaly');
      expect(row!.lastError).toBe('TOPUP_AMOUNT_MISMATCH');
      expect(await purchasedBalance('s_t_evidence_mismatch')).toBe(0);

      const [purchaseAfter] = await purchaseRows('s_t_evidence_mismatch');

      expect(purchaseAfter!.status).toBe('checkout_created'); // never touched

      const sentry = await import('@sentry/nextjs');

      expect(vi.mocked(sentry.captureMessage)).toHaveBeenCalledWith('billing.event_held_anomaly', expect.objectContaining({
        extra: expect.objectContaining({ detail: 'TOPUP_AMOUNT_MISMATCH' }),
      }));
    });
  });

  // G05 — delayed-settlement (async) payment methods.
  describe('G05 — async payment events', () => {
    it('async_payment_succeeded fulfils exactly once, even when an unpaid completed arrived first', async () => {
      await seedSalon('s_t_async_success');
      const checkout = await postCheckout({ salonId: 's_t_async_success', topupOfferKey: 'topup_100_paid_2026_08' });
      const { data } = await checkout.json();
      await postWebhook(webhookEvent('checkout.session.completed', {
        id: data.sessionId,
        payment_status: 'unpaid',
        payment_intent: 'pi_async_success',
        metadata: { purpose: 'sms_topup', salonId: 's_t_async_success' },
      }));

      expect(await purchasedBalance('s_t_async_success')).toBe(0);

      await mockVerifiedTopupEvidence({ sessionId: data.sessionId, salonId: 's_t_async_success' });
      const asyncSucceeded = webhookEvent('checkout.session.async_payment_succeeded', {
        id: data.sessionId,
        payment_status: 'paid',
        payment_intent: 'pi_async_success',
        metadata: { purpose: 'sms_topup', salonId: 's_t_async_success' },
      });
      await postWebhook(asyncSucceeded);

      expect(await purchasedBalance('s_t_async_success')).toBe(100);

      // Replay: exactly once.
      await postWebhook(asyncSucceeded);

      expect(await purchasedBalance('s_t_async_success')).toBe(100);
    });

    it('async_payment_failed expires the purchase and its attempt atomically, using the same locked transition as checkout.session.expired', async () => {
      await seedSalon('s_t_async_failed');
      const checkout = await postCheckout({ salonId: 's_t_async_failed', topupOfferKey: 'topup_100_paid_2026_08' });
      const { data } = await checkout.json();

      await postWebhook(webhookEvent('checkout.session.async_payment_failed', {
        id: data.sessionId,
        metadata: { purpose: 'sms_topup', salonId: 's_t_async_failed' },
      }));

      const [purchase] = await purchaseRows('s_t_async_failed');
      const [attempt] = await attemptRows('s_t_async_failed');

      expect(purchase!.status).toBe('expired');
      expect(attempt!.status).toBe('expired');
    });
  });

  // P1 follow-up — the top-up-refund held_anomaly branch now alerts too.
  it('a refund total that REGRESSES (moves backward) is held for a human and alerts exactly once', async () => {
    await buyAndPay('s_t_regressed');
    await postWebhook(webhookEvent('charge.refunded', {
      id: 'ch_t_regressed',
      payment_intent: 'pi_s_t_regressed',
      amount: 599,
      amount_refunded: 300,
      refunds: { data: [{ id: 're_t_regressed' }] },
    }));

    expect(await purchasedBalance('s_t_regressed')).toBe(50);

    const sentry = await import('@sentry/nextjs');
    const before = vi.mocked(sentry.captureMessage).mock.calls.length;
    const event = webhookEvent('charge.refunded', {
      id: 'ch_t_regressed',
      payment_intent: 'pi_s_t_regressed',
      amount: 599,
      amount_refunded: 100, // moved BACKWARD — a failed refund
      refunds: { data: [{ id: 're_t_regressed_2' }] },
    });
    await postWebhook(event);

    const [row] = (await db.select().from(schema.billingStripeEventSchema))
      .filter(entry => entry.eventId === event.id);

    expect(row!.status).toBe('held_anomaly');
    expect(row!.lastError).toBe('REFUND_TOTAL_REGRESSED');
    expect(vi.mocked(sentry.captureMessage).mock.calls.length).toBe(before + 1);
    expect(vi.mocked(sentry.captureMessage)).toHaveBeenLastCalledWith('billing.event_held_anomaly', expect.objectContaining({
      extra: expect.objectContaining({ detail: 'REFUND_TOTAL_REGRESSED' }),
    }));
    // The balance is UNCHANGED — no automatic claw-forward on a failed refund.
    expect(await purchasedBalance('s_t_regressed')).toBe(50);
  });
});

// G14 — automatic-tax architecture (§3.7). Collection stays off in every
// environment; this pins the ARCHITECTURE (the Checkout Session params),
// never a live-collection assertion.
describe('G14 — automatic-tax architecture (§3.7)', () => {
  it('BILLING_TAX_COLLECTION_ENABLED unset ⇒ automatic_tax.enabled is false, address collection still required', async () => {
    await seedSalon('s_t_tax_off');
    const response = await postCheckout({ salonId: 's_t_tax_off', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(response.status).toBe(200);

    const params = stripeMock.checkout.sessions.create.mock.calls[0]![0];

    expect(params.automatic_tax).toEqual({ enabled: false });
    expect(params.billing_address_collection).toBe('required');
  });

  it('BILLING_TAX_COLLECTION_ENABLED=\'true\' ⇒ automatic_tax.enabled is true', async () => {
    envHolder.BILLING_TAX_COLLECTION_ENABLED = 'true';
    await seedSalon('s_t_tax_on');
    const response = await postCheckout({ salonId: 's_t_tax_on', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(response.status).toBe(200);

    const params = stripeMock.checkout.sessions.create.mock.calls[0]![0];

    expect(params.automatic_tax).toEqual({ enabled: true });
  });

  it('the customer branch (a known Stripe customer) carries customer_update; the customer_email branch does not', async () => {
    await db.insert(schema.salonSchema).values({
      id: 's_t_tax_customer',
      name: 's_t_tax_customer',
      slug: 's_t_tax_customer',
      plan: 'single_salon',
      stripeCustomerId: 'cus_existing_topup_123',
    });
    const withCustomer = await postCheckout({ salonId: 's_t_tax_customer', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(withCustomer.status).toBe(200);

    const paramsWithCustomer = stripeMock.checkout.sessions.create.mock.calls[0]![0];

    expect(paramsWithCustomer.customer).toBe('cus_existing_topup_123');
    expect(paramsWithCustomer.customer_update).toEqual({ address: 'auto' });

    stripeMock.checkout.sessions.create.mockClear();
    await seedSalon('s_t_tax_no_customer');
    const withoutCustomer = await postCheckout({ salonId: 's_t_tax_no_customer', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(withoutCustomer.status).toBe(200);

    const paramsWithoutCustomer = stripeMock.checkout.sessions.create.mock.calls[0]![0];

    expect(paramsWithoutCustomer.customer).toBeUndefined();
    expect(paramsWithoutCustomer.customer_update).toBeUndefined();
  });
});
