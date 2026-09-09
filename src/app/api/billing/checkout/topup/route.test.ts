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
  STRIPE_BILLING_WEBHOOK_SECRET: 'whsec_test' as string | undefined,
  NEXT_PUBLIC_APP_URL: 'https://app.test',
  BILLING_IDENTITY_HMAC_SECRET: undefined,
  BILLING_IDENTITY_HMAC_VERSION: undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

vi.mock('@/libs/adminAuth', () => ({
  requireAdmin: vi.fn(async () => ({ ok: true, admin: { clerkUserId: 'user_topup' } })),
}));
vi.mock('@/libs/rateLimit', () => ({
  checkEndpointRateLimit: () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
  rateLimitResponse: () => new Response('rate limited', { status: 429 }),
}));

const stripeMock = vi.hoisted(() => ({
  prices: { retrieve: vi.fn() },
  paymentIntents: { retrieve: vi.fn() },
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

const sessions = new Map<string, Record<string, any>>();
const fixedPrice = (overrides: Record<string, unknown> = {}) => ({
  id: 'price_topup_resolved',
  active: true,
  type: 'one_time',
  recurring: null,
  currency: 'cad',
  unit_amount: 599,
  billing_scheme: 'per_unit',
  custom_unit_amount: null,
  transform_quantity: null,
  livemode: false,
  ...overrides,
});

beforeEach(() => {
  envHolder.BILLING_TOPUPS_ENABLED = 'true';
  envHolder.STRIPE_BILLING_WEBHOOK_SECRET = 'whsec_test';
  priceMapHolder.priceId = 'price_topup_resolved';
  sessions.clear();
  stripeMock.paymentIntents.retrieve.mockReset();
  stripeMock.paymentIntents.retrieve.mockImplementation(async (id: string) => {
    const session = [...sessions.values()].find(entry => entry.payment_intent.id === id);
    return session?.payment_intent ?? { id, metadata: {} };
  });
  stripeMock.prices.retrieve.mockReset();
  stripeMock.prices.retrieve.mockResolvedValue(fixedPrice());
  stripeMock.checkout.sessions.retrieve.mockReset();
  stripeMock.checkout.sessions.retrieve.mockImplementation(async (id: string) => sessions.get(id));
  stripeMock.checkout.sessions.create.mockReset();
  stripeMock.checkout.sessions.create.mockImplementation(async (params) => {
    const id = `cs_topup_${crypto.randomUUID()}`;
    const price = await stripeMock.prices.retrieve();
    const session = {
      id,
      url: 'https://checkout.stripe.test/topup',
      mode: 'payment',
      status: 'complete',
      livemode: false,
      currency: 'cad',
      amount_total: price.unit_amount,
      amount_subtotal: price.unit_amount,
      payment_status: 'paid',
      payment_method_types: ['card'],
      metadata: params.metadata,
      payment_intent: {
        metadata: { ...params.payment_intent_data.metadata },
        id: `pi_${params.metadata.salonId}`,
        status: 'succeeded',
        livemode: false,
        currency: 'cad',
        amount: price.unit_amount,
        amount_received: price.unit_amount,
        payment_method_types: ['card'],
        latest_charge: {
          id: `ch_${params.metadata.salonId}`,
          paid: true,
          captured: true,
          livemode: false,
          currency: 'cad',
          amount: price.unit_amount,
          amount_captured: price.unit_amount,
          amount_refunded: 0,
          disputed: false,
        },
      },
      line_items: { has_more: false, data: [{
        quantity: 1,
        currency: 'cad',
        amount_total: price.unit_amount,
        amount_subtotal: price.unit_amount,
        price,
      }] },
    };
    sessions.set(id, session);
    return session;
  });
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

  it('precreates the durable purchase and creates the session under the attempt key', async () => {
    await seedSalon('s_t_ok');
    stripeMock.prices.retrieve.mockResolvedValue(fixedPrice({ unit_amount: 1399 }));
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
    expect(params.payment_method_types).toEqual(['card']);
    expect(params.metadata.purpose).toBe('sms_topup');
  });
});

describe('top-up launch safety', () => {
  it.each([undefined, '   '])('rejects checkout without a configured fulfillment webhook (%s) before writes or Stripe calls', async (secret) => {
    envHolder.STRIPE_BILLING_WEBHOOK_SECRET = secret;
    const salonId = `s_t_no_webhook_${String(secret)}`;
    await seedSalon(salonId);
    const response = await postCheckout({ salonId, topupOfferKey: 'topup_100_paid_2026_08' });

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('TOPUPS_UNAVAILABLE');
    expect(stripeMock.prices.retrieve).not.toHaveBeenCalled();
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(await purchaseRows(salonId)).toHaveLength(0);
  });

  it('reuses one purchase and session across retries and rejects a different offer', async () => {
    await seedSalon('s_t_retry');
    const first = await postCheckout({ salonId: 's_t_retry', topupOfferKey: 'topup_100_paid_2026_08' });
    const firstData = (await first.json()).data;
    const retry = await postCheckout({ salonId: 's_t_retry', topupOfferKey: 'topup_100_paid_2026_08' });

    expect((await retry.json()).data).toMatchObject({ sessionId: firstData.sessionId, reused: true });
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(await purchaseRows('s_t_retry')).toHaveLength(1);

    stripeMock.prices.retrieve.mockResolvedValue(fixedPrice({ unit_amount: 1399 }));
    const different = await postCheckout({ salonId: 's_t_retry', topupOfferKey: 'topup_250_paid_2026_08' });

    expect(different.status).toBe(409);
    expect(await purchaseRows('s_t_retry')).toHaveLength(1);
  });

  it('reuses the committed creating attempt while the sole provider call is pending', async () => {
    await seedSalon('s_t_parallel');
    const createSession = stripeMock.checkout.sessions.create.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    stripeMock.checkout.sessions.create.mockImplementation(async (...args) => {
      started();
      await gate;
      return createSession(...args);
    });
    const first = postCheckout({ salonId: 's_t_parallel', topupOfferKey: 'topup_100_paid_2026_08' });
    await providerStarted;
    const retry = await postCheckout({ salonId: 's_t_parallel', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(retry.status).toBe(409);
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(await purchaseRows('s_t_parallel')).toHaveLength(1);

    release();

    expect((await first).status).toBe(200);
  });

  it('keeps an unknown provider outcome reserved until its fixed expiry', async () => {
    await seedSalon('s_t_unknown');
    stripeMock.checkout.sessions.create.mockRejectedValue(new Error('connection lost'));
    const first = await postCheckout({ salonId: 's_t_unknown', topupOfferKey: 'topup_100_paid_2026_08' });
    const retry = await postCheckout({ salonId: 's_t_unknown', topupOfferKey: 'topup_100_paid_2026_08' });
    const [attempt] = await db.select().from(schema.billingCheckoutAttemptSchema)
      .where(eq(schema.billingCheckoutAttemptSchema.salonId, 's_t_unknown'));

    expect(first.status).toBe(502);
    expect(retry.status).toBe(409);
    expect(attempt!.status).toBe('creating');
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(await purchaseRows('s_t_unknown')).toHaveLength(1);

    await db.update(schema.billingCheckoutAttemptSchema).set({ expiresAt: new Date(0) })
      .where(eq(schema.billingCheckoutAttemptSchema.id, attempt!.id));
    await postCheckout({ salonId: 's_t_unknown', topupOfferKey: 'topup_100_paid_2026_08' });

    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(2);
    expect(await purchaseRows('s_t_unknown')).toHaveLength(2);
  });

  it.each([
    ['inactive', { active: false }],
    ['recurring', { type: 'recurring' }],
    ['currency', { currency: 'usd' }],
    ['amount', { unit_amount: 1 }],
    ['environment', { livemode: true }],
    ['variable quantity', { transform_quantity: { divide_by: 2 } }],
  ])('rejects an invalid configured price (%s) before durable writes', async (label, overrides) => {
    const salonId = `s_price_${label}`;
    await seedSalon(salonId);
    stripeMock.prices.retrieve.mockResolvedValue(fixedPrice(overrides));
    const response = await postCheckout({ salonId, topupOfferKey: 'topup_100_paid_2026_08' });

    expect(response.status).toBe(503);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(await purchaseRows(salonId)).toHaveLength(0);
  });

  it('fulfills before TX2 and completes the attempt without being downgraded by TX2', async () => {
    await seedSalon('s_t_early');
    const createSession = stripeMock.checkout.sessions.create.getMockImplementation()!;
    stripeMock.checkout.sessions.create.mockImplementation(async (...args) => {
      const session = await createSession(...args);
      const result = await postWebhook(webhookEvent('checkout.session.completed', session));

      expect(result.status).toBe(200);
      expect(await purchasedBalance('s_t_early')).toBe(100);

      return session;
    });
    const response = await postCheckout({ salonId: 's_t_early', topupOfferKey: 'topup_100_paid_2026_08' });
    const [attempt] = await db.select().from(schema.billingCheckoutAttemptSchema)
      .where(eq(schema.billingCheckoutAttemptSchema.salonId, 's_t_early'));

    expect(response.status).toBe(200);
    expect(attempt!.status).toBe('completed');
    expect((await purchaseRows('s_t_early'))[0]!.status).toBe('fulfilled');
  });

  it('recovers a remotely created session after a lost response and fulfills only once across distinct events', async () => {
    await seedSalon('s_t_lost');
    const createSession = stripeMock.checkout.sessions.create.getMockImplementation()!;
    stripeMock.checkout.sessions.create.mockImplementation(async (...args) => {
      await createSession(...args);
      throw new Error('response lost');
    });
    const response = await postCheckout({ salonId: 's_t_lost', topupOfferKey: 'topup_100_paid_2026_08' });
    const session = [...sessions.values()][0]!;

    expect(response.status).toBe(502);
    expect((await purchaseRows('s_t_lost'))[0]!.stripeCheckoutSessionId).toBeNull();

    await postWebhook(webhookEvent('checkout.session.completed', session));
    await postWebhook(webhookEvent('checkout.session.completed', session));

    expect(await purchasedBalance('s_t_lost')).toBe(100);
    expect((await purchaseRows('s_t_lost'))[0]!.stripeCheckoutSessionId).toBe(session.id);
  });

  it.each(['charge.refunded', 'charge.dispute.created'])('retries an early %s until completion binds the purchase', async (eventType) => {
    const salonId = `s_early_${eventType}`;
    await seedSalon(salonId);
    const createSession = stripeMock.checkout.sessions.create.getMockImplementation()!;
    let reversal: ReturnType<typeof webhookEvent>;
    stripeMock.checkout.sessions.create.mockImplementation(async (...args) => {
      const session = await createSession(...args);
      // Provider session exists, but checkout TX2 has not bound it. Simulate
      // a reversal arriving after completion fetched a clean charge snapshot.
      const cleanSnapshot = structuredClone(session);
      reversal = webhookEvent(eventType, {
        id: `reversal_${salonId}`,
        payment_intent: session.payment_intent.id,
        amount_refunded: 599,
        refunds: { data: [{ id: `refund_${salonId}` }] },
      });
      const early = await postWebhook(reversal);

      expect(early.status).toBe(500);
      expect((await early.json()).error.message).toBe('TOPUP_REVERSAL_AWAITING_PURCHASE_BINDING');

      const tooSoon = await postWebhook(reversal);
      const [pending] = await db.select().from(schema.billingStripeEventSchema)
        .where(eq(schema.billingStripeEventSchema.eventId, reversal.id));

      expect(tooSoon.status).toBe(503);
      expect((await tooSoon.json()).error.code).toBe('BILLING_EVENT_PENDING');
      expect(pending!.status).toBe('failed_retryable');
      expect(pending!.attempts).toBe(1);

      stripeMock.checkout.sessions.retrieve.mockResolvedValueOnce(cleanSnapshot);
      await postWebhook(webhookEvent('checkout.session.completed', session));

      expect(await purchasedBalance(salonId)).toBe(100);

      return session;
    });
    const response = await postCheckout({ salonId, topupOfferKey: 'topup_100_paid_2026_08' });

    expect(response.status).toBe(200);

    await db.update(schema.billingStripeEventSchema).set({ availableAt: new Date(0) })
      .where(eq(schema.billingStripeEventSchema.eventId, reversal!.id));
    const retried = await postWebhook(reversal!);

    expect(retried.status).toBe(200);
    expect(await purchasedBalance(salonId)).toBe(0);

    await postWebhook(reversal!);

    expect(await purchasedBalance(salonId)).toBe(0);
  });

  it.each([
    'tenant',
    'purchase',
    'attempt',
    'offer',
    'environment',
    'amount',
    'currency',
    'price',
    'quantity',
    'payment mode',
    'intent amount',
    'intent currency',
    'intent environment',
    'delayed method',
    'already refunded',
    'already disputed',
    'intent metadata',
  ])('holds mismatched authoritative payment evidence (%s) without granting', async (mismatch) => {
    const salonId = `s_mismatch_${mismatch}`;
    await seedSalon(salonId);
    const response = await postCheckout({ salonId, topupOfferKey: 'topup_100_paid_2026_08' });
    const { data } = await response.json();
    const session = sessions.get(data.sessionId)!;
    switch (mismatch) {
      case 'tenant': session.metadata.salonId = 'different-tenant';
        break;
      case 'purchase': session.metadata.purchaseId = 'different-purchase';
        break;
      case 'attempt': session.metadata.attemptId = 'different-attempt';
        break;
      case 'offer': session.metadata.topupOfferKey = 'topup_250_paid_2026_08';
        break;
      case 'environment': session.metadata.billingEnv = 'prod';
        break;
      case 'amount': session.amount_total = 1;
        break;
      case 'currency': session.currency = 'usd';
        break;
      case 'price': session.line_items.data[0].price.id = 'price_foreign';
        break;
      case 'quantity': session.line_items.data[0].quantity = 2;
        break;
      case 'payment mode': session.mode = 'subscription';
        break;
      case 'intent amount': session.payment_intent.amount = 1;
        break;
      case 'intent currency': session.payment_intent.currency = 'usd';
        break;
      case 'intent environment': session.payment_intent.livemode = true;
        break;
      case 'delayed method': session.payment_method_types = ['us_bank_account'];
        break;
    }
    if (mismatch === 'intent metadata') {
      session.payment_intent.metadata = { ...session.metadata, purchaseId: 'other-purchase' };
    }
    if (mismatch === 'already refunded') {
      session.payment_intent.latest_charge.amount_refunded = 599;
    }
    if (mismatch === 'already disputed') {
      session.payment_intent.latest_charge.disputed = true;
    }
    const event = webhookEvent('checkout.session.completed', session);
    await postWebhook(event);
    const [record] = await db.select().from(schema.billingStripeEventSchema)
      .where(eq(schema.billingStripeEventSchema.eventId, event.id));

    expect(record!.status).toBe('held_anomaly');
    expect(await purchasedBalance(salonId)).toBe(0);
    expect((await purchaseRows(salonId))[0]!.stripePaymentIntentId).toBeNull();
  });
});

describe('top-up fulfillment through the webhook (§9.3-§9.5)', () => {
  async function buyAndPay(salonId: string, sessionOverride?: string) {
    await seedSalon(salonId);
    const checkout = await postCheckout({ salonId, topupOfferKey: 'topup_100_paid_2026_08' });
    const { data } = await checkout.json();
    const sessionId = sessionOverride ?? data.sessionId;
    const completed = webhookEvent('checkout.session.completed', {
      id: sessionId,
      ...sessions.get(sessionId),
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

  it('reclaims an abandoned event after its grant committed without granting again', async () => {
    const { completed } = await buyAndPay('s_t_abandoned');

    expect(await purchasedBalance('s_t_abandoned')).toBe(100);

    // Model a worker dying between financial commit and terminal event write.
    await db.update(schema.billingStripeEventSchema)
      .set({ status: 'processing', availableAt: new Date(0), processedAt: null })
      .where(eq(schema.billingStripeEventSchema.eventId, completed.id));
    const replay = await postWebhook(completed);
    const [record] = await db.select().from(schema.billingStripeEventSchema)
      .where(eq(schema.billingStripeEventSchema.eventId, completed.id));

    expect(replay.status).toBe(200);
    expect(record!.status).toBe('processed');
    expect(record!.attempts).toBe(2);
    expect(await purchasedBalance('s_t_abandoned')).toBe(100);
  });

  it('an unpaid completion is held without binding or granting credits', async () => {
    await seedSalon('s_t_unpaid');
    const checkout = await postCheckout({ salonId: 's_t_unpaid', topupOfferKey: 'topup_100_paid_2026_08' });
    const { data } = await checkout.json();
    const session = sessions.get(data.sessionId)!;
    session.payment_status = 'unpaid';
    session.payment_intent.status = 'processing';
    session.payment_intent.amount_received = 0;
    await postWebhook(webhookEvent('checkout.session.completed', session));

    expect(await purchasedBalance('s_t_unpaid')).toBe(0);

    const [purchase] = await purchaseRows('s_t_unpaid');

    expect(purchase!.status).toBe('checkout_created');
    expect(purchase!.stripePaymentIntentId).toBeNull();
  });

  it('an expired session parks the purchase', async () => {
    await seedSalon('s_t_exp');
    const checkout = await postCheckout({ salonId: 's_t_exp', topupOfferKey: 'topup_100_paid_2026_08' });
    const { data } = await checkout.json();
    await postWebhook(webhookEvent('checkout.session.expired', { id: data.sessionId }));
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

  it('a charge event with no matching top-up purchase stays held for a human', async () => {
    const event = webhookEvent('charge.refunded', {
      id: 'ch_foreign',
      payment_intent: 'pi_subscription_charge',
      amount_refunded: 100,
    });
    await postWebhook(event);
    const [row] = (await db.select().from(schema.billingStripeEventSchema))
      .filter(entry => entry.eventId === event.id);

    expect(row!.status).toBe('held_anomaly');
  });
});
