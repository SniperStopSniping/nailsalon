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

beforeEach(() => {
  envHolder.BILLING_TOPUPS_ENABLED = 'true';
  priceMapHolder.priceId = 'price_topup_resolved';
  stripeMock.checkout.sessions.create.mockReset();
  stripeMock.checkout.sessions.create.mockImplementation(async () => ({
    id: `cs_topup_${Math.random().toString(36).slice(2, 8)}`,
    url: 'https://checkout.stripe.test/topup',
  }));
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
