/**
 * stripe-billing webhook glue — §8.2 route proofs on PGlite. The financial
 * semantics have their own suite (billingSubscriptionProjection.test.ts);
 * THIS suite pins the pipeline: fail-closed without a secret, zero mutation
 * on invalid signatures, exactly-once claim with replay dedup, the livemode
 * gate, end-to-end invoice processing through the window engine, and the
 * retryable-500 → reclaim → poison ladder.
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
  STRIPE_BILLING_WEBHOOK_SECRET: undefined as string | undefined,
  BILLING_IDENTITY_HMAC_SECRET: undefined,
  BILLING_IDENTITY_HMAC_VERSION: undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

// constructEvent parses our JSON "signature-valid" test bodies; a literal
// 'invalid' signature throws, exactly like the real SDK.
const stripeMock = vi.hoisted(() => ({
  webhooks: {
    constructEvent: vi.fn((rawBody: string, signature: string) => {
      if (signature !== 'sig_valid') {
        throw new Error('signature verification failed');
      }
      return JSON.parse(rawBody);
    }),
  },
  subscriptions: {
    retrieve: vi.fn(async (): Promise<{ id: string; metadata: Record<string, string | undefined> }> => {
      throw new Error('NO_REFETCH_IN_TEST');
    }),
  },
  // G01/G10/G42: refund.updated and dispute events resolve their charge (and
  // an invoice's own subscription) through these — unset by default; each
  // test that needs them supplies its own resolved value.
  charges: { retrieve: vi.fn() },
  invoices: { retrieve: vi.fn() },
  checkout: { sessions: { retrieve: vi.fn() } },
}));
vi.mock('@/libs/stripe', () => ({ stripe: stripeMock }));
const sentryHolder = vi.hoisted(() => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => sentryHolder);

// G02: default to the REAL (all-placeholder ⇒ always-null) reverse lookup;
// individual tests override `resolvedOfferKey` to simulate a CONFIGURED map.
const priceMapHolder = vi.hoisted(() => ({ resolvedOfferKey: null as string | null }));
vi.mock('@/libs/billing/stripePriceMap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/billing/stripePriceMap')>();
  return {
    ...actual,
    resolveBillingOfferFromStripePriceId: (_priceId: string) => priceMapHolder.resolvedOfferKey,
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
  envHolder.STRIPE_BILLING_WEBHOOK_SECRET = 'whsec_test';
  envHolder.BILLING_PLAN_ENV = 'test';
  sentryHolder.captureMessage.mockClear();
  sentryHolder.captureException.mockClear();
  stripeMock.charges.retrieve.mockReset();
  stripeMock.invoices.retrieve.mockReset();
  stripeMock.checkout.sessions.retrieve.mockReset();
  priceMapHolder.resolvedOfferKey = null;
});

const post = async (body: unknown, signature = 'sig_valid') => {
  const { POST } = await import('./route');
  return POST(new Request('http://localhost/api/webhooks/stripe-billing', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'stripe-signature': signature },
  }));
};

const eventRows = () => db.select().from(schema.billingStripeEventSchema);

let eventCounter = 0;
function stripeEvent(type: string, object: Record<string, unknown>, over?: Partial<{ id: string; livemode: boolean; created: number }>) {
  eventCounter += 1;
  return {
    id: over?.id ?? `evt_route_${eventCounter}`,
    type,
    livemode: over?.livemode ?? false,
    created: over?.created ?? 1_780_000_000,
    data: { object },
  };
}

describe('stripe-billing webhook pipeline', () => {
  it('fails closed with 503 while the dedicated secret is unset (dark posture)', async () => {
    envHolder.STRIPE_BILLING_WEBHOOK_SECRET = undefined;
    const response = await post(stripeEvent('invoice.payment_succeeded', {}));

    expect(response.status).toBe(503);
    expect(await eventRows()).toHaveLength(0);
  });

  it('an invalid signature mutates nothing, not even an event row', async () => {
    const response = await post(stripeEvent('invoice.payment_succeeded', {}), 'sig_wrong');

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_SIGNATURE');
    expect(await eventRows()).toHaveLength(0);
  });

  it('claims exactly once: the replayed delivery deduplicates', async () => {
    const event = stripeEvent('customer.subscription.created', {
      id: 'sub_route_dedup',
      customer: 'cus_r1',
      status: 'active',
      cancel_at_period_end: false,
      current_period_start: 1_780_000_000,
      metadata: {}, // foreign: no purpose — classified, not processed
    });
    const first = await post(event);

    expect(first.status).toBe(200);

    const second = await post(event);

    expect((await second.json()).deduplicated).toBe(true);

    const rows = await eventRows();
    const mine = rows.filter(row => row.eventId === event.id);

    expect(mine).toHaveLength(1);
    expect(mine[0]!.status).toBe('ignored_foreign');
  });

  it('records and ignores a livemode mismatch without processing (§8.2 order: verify → livemode → claim)', async () => {
    await db.insert(schema.salonSchema).values({ id: 's_route_livemode', name: 's', slug: 's-route-livemode' });
    // test-mode deployment receiving a LIVE event — and one that WOULD create
    // a billing_subscription row if handleEvent ever ran, so a passing
    // assertion that no row exists is proof handleEvent was never reached,
    // not just an absence of a thrown error.
    const event = stripeEvent('customer.subscription.created', {
      id: 'sub_live_mismatch',
      customer: 'cus_live_mismatch',
      status: 'active',
      cancel_at_period_end: false,
      current_period_start: 1_780_000_000,
      metadata: { purpose: 'plan_subscription', salonId: 's_route_livemode', billingOfferKey: 'starter_2026_08_monthly' },
    }, { livemode: true });
    const response = await post(event);

    expect((await response.json()).ignored).toBe('livemode_mismatch');

    // The status is recorded DIRECTLY in its terminal form — assert it right
    // after the request, exactly as it stands, never having passed through
    // 'processing'.
    const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

    expect(row!.status).toBe('ignored_livemode_mismatch');
    expect(row!.attempts).toBe(0);

    const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_live_mismatch'));

    expect(subscription).toBeUndefined();

    // A replay of the SAME mismatched event stays a no-op: still 200,
    // still ignored, still exactly one durable row, never claimed.
    const replay = await post(event);

    expect(replay.status).toBe(200);
    expect((await replay.json()).ignored).toBe('livemode_mismatch');

    const rowsAfterReplay = (await eventRows()).filter(entry => entry.eventId === event.id);

    expect(rowsAfterReplay).toHaveLength(1);
    expect(rowsAfterReplay[0]!.status).toBe('ignored_livemode_mismatch');
  });

  it('processes a subscription create + paid invoice end-to-end: projection, paid_through, ENGINE grant', async () => {
    await db.insert(schema.salonSchema).values({ id: 's_route1', name: 's', slug: 's-route1' });
    // The route runs on the REAL clock, and the engine grants only the
    // ACTIVE fully-covered window — so anchor five days ago and pay 35 days
    // forward: the current window is covered whenever this suite runs.
    const createdAt = Math.floor((Date.now() - 5 * 24 * 3600_000) / 1000);
    const subscriptionEvent = stripeEvent('customer.subscription.created', {
      id: 'sub_route_full',
      customer: 'cus_full',
      status: 'active',
      cancel_at_period_end: false,
      current_period_start: createdAt,
      metadata: { purpose: 'plan_subscription', salonId: 's_route1', billingOfferKey: 'pro_2026_08_monthly' },
    }, { created: createdAt });

    expect((await post(subscriptionEvent)).status).toBe(200);

    const invoiceEvent = stripeEvent('invoice.payment_succeeded', {
      id: 'in_route_full',
      subscription: 'sub_route_full',
      lines: { data: [{ period: { end: createdAt + 35 * 24 * 3600 } }] },
    }, { created: createdAt + 60 });

    expect((await post(invoiceEvent)).status).toBe(200);

    const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_route_full'));

    expect(subscription!.status).toBe('active');
    expect(subscription!.paidThrough.getTime()).toBe((createdAt + 35 * 24 * 3600) * 1000);

    const granted = await db.execute(sql`
      SELECT COALESCE(SUM(amount), 0)::int AS total FROM sms_credit_ledger
      WHERE salon_id = 's_route1' AND bucket = 'monthly'
    `);

    expect(Number((granted.rows[0] as Record<string, unknown>).total)).toBe(400);

    // Full replay of BOTH events: dedup, no double grant.
    await post(subscriptionEvent);
    await post(invoiceEvent);
    const regranted = await db.execute(sql`
      SELECT COALESCE(SUM(amount), 0)::int AS total FROM sms_credit_ledger
      WHERE salon_id = 's_route1' AND bucket = 'monthly'
    `);

    expect(Number((regranted.rows[0] as Record<string, unknown>).total)).toBe(400);
  });

  it('a handler failure returns 500 retryable, then Stripe redelivery reclaims and succeeds', async () => {
    await db.insert(schema.salonSchema).values({ id: 's_route2', name: 's', slug: 's-route2' });
    const createdAt = Math.floor(new Date('2026-09-02T10:00:00.000Z').getTime() / 1000);
    // Invoice BEFORE its subscription is projected: retryable failure.
    const invoiceEvent = stripeEvent('invoice.payment_succeeded', {
      id: 'in_route_early',
      subscription: 'sub_route_late',
      lines: { data: [{ period: { end: createdAt + 30 * 24 * 3600 } }] },
    }, { created: createdAt });
    const early = await post(invoiceEvent);

    expect(early.status).toBe(500);

    let [row] = (await eventRows()).filter(entry => entry.eventId === invoiceEvent.id);

    expect(row!.status).toBe('failed_retryable');

    // The subscription event lands...
    await post(stripeEvent('customer.subscription.created', {
      id: 'sub_route_late',
      customer: 'cus_late',
      status: 'active',
      cancel_at_period_end: false,
      current_period_start: createdAt,
      metadata: { purpose: 'plan_subscription', salonId: 's_route2', billingOfferKey: 'starter_2026_08_monthly' },
    }, { created: createdAt }));

    // ...but redelivery BEFORE the backoff elapses stays deduplicated (the
    // reclaim honors available_at), which is §8.2's backoff in action.
    const tooSoon = await post(invoiceEvent);

    expect((await tooSoon.json()).deduplicated).toBe(true);

    // Force the backoff window past, as Stripe's next retry would find it.
    await db.update(schema.billingStripeEventSchema)
      .set({ availableAt: new Date(Date.now() - 1000) })
      .where(eq(schema.billingStripeEventSchema.eventId, invoiceEvent.id));
    const retried = await post(invoiceEvent);

    expect(retried.status).toBe(200);

    [row] = (await eventRows()).filter(entry => entry.eventId === invoiceEvent.id);

    expect(row!.status).toBe('processed');
    expect(row!.attempts).toBe(2);
  });

  // G42 — foreign-event classification: matches neither a top-up purchase
  // nor a local subscription invoice/charge.
  describe('G42 — foreign platform events are ignored, never held or thrown', () => {
    it('a charge.refunded matching no top-up purchase and no local subscription is ignored as foreign, not held', async () => {
      const event = stripeEvent('charge.refunded', { id: 'ch_route_1', payment_intent: 'pi_route_1' });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('ignored_foreign');
      expect(row!.lastError).toBe('FOREIGN_CHARGE');
      expect(sentryHolder.captureMessage).not.toHaveBeenCalled();
    });

    it('an invoice.payment_succeeded for a subscription this billing track never created (no purpose=plan_subscription metadata) is ignored as foreign, never thrown or retried', async () => {
      stripeMock.subscriptions.retrieve.mockResolvedValueOnce({
        id: 'sub_legacy_flow',
        metadata: {}, // no purpose='plan_subscription' stamp — not ours
      });
      const event = stripeEvent('invoice.payment_succeeded', {
        id: 'in_legacy_flow',
        subscription: 'sub_legacy_flow',
        lines: { data: [{ period: { start: 1_780_000_000, end: 1_780_000_000 + 30 * 24 * 3600 } }] },
      });
      const response = await post(event);

      expect(response.status).toBe(200); // never a 500 — no throw, no retry

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('ignored_foreign');
      expect(row!.lastError).toBe('FOREIGN_INVOICE');
      expect(row!.attempts).toBe(1); // claimed once, resolved once — never poisoned
      expect(sentryHolder.captureMessage).not.toHaveBeenCalled();
      expect(sentryHolder.captureException).not.toHaveBeenCalled();
    });

    it('an invoice.payment_failed for a subscription with no local projection is ignored as foreign', async () => {
      const event = stripeEvent('invoice.payment_failed', {
        id: 'in_legacy_failed',
        subscription: 'sub_legacy_failed_flow',
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('ignored_foreign');
      expect(row!.lastError).toBe('FOREIGN_INVOICE');
      expect(sentryHolder.captureMessage).not.toHaveBeenCalled();
    });
  });

  // G02 — Stripe Price ↔ offer-metadata cross-check, exercised end-to-end
  // through the route (unit-level coverage lives in billingSubscriptionProjection.test.ts).
  describe('G02 — price cross-check (pipeline)', () => {
    it('a CONFIGURED map resolving a DIFFERENT offer than metadata holds the event and writes no subscription row', async () => {
      priceMapHolder.resolvedOfferKey = 'elite_2026_08_monthly';
      await db.insert(schema.salonSchema).values({ id: 's_route_price_mismatch', name: 's', slug: 's-route-price-mismatch' });
      const event = stripeEvent('customer.subscription.created', {
        id: 'sub_route_price_mismatch',
        customer: 'cus_price_mismatch',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: 1_780_000_000,
        metadata: { purpose: 'plan_subscription', salonId: 's_route_price_mismatch', billingOfferKey: 'pro_2026_08_monthly' },
        items: { data: [{ price: { id: 'price_configured_elite' } }] },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('held_anomaly');
      expect(row!.lastError).toBe('PRICE_OFFER_MISMATCH');
      // G02: the price id is populated on the claimed row even though the
      // cross-check ultimately holds the event.
      expect(row!.priceId).toBe('price_configured_elite');
      expect(sentryHolder.captureMessage).toHaveBeenCalledWith('billing.event_held_anomaly', {
        level: 'warning',
        extra: { eventId: event.id, eventType: 'customer.subscription.created', detail: 'PRICE_OFFER_MISMATCH' },
      });

      const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_route_price_mismatch'));

      expect(subscription).toBeUndefined();
    });
  });

  // G10 — subscription refunds/disputes (§6.7, §6.8 vectors).
  describe('G10 — subscription refunds and disputes (§6.7/§6.8)', () => {
    async function seedLocalSubscription(salonId: string, stripeSubscriptionId: string, over: Partial<typeof schema.billingSubscriptionSchema.$inferInsert> = {}) {
      await db.insert(schema.salonSchema).values({ id: salonId, name: salonId, slug: salonId });
      await db.insert(schema.billingSubscriptionSchema).values({
        id: `bsub_${salonId}`,
        salonId,
        stripeSubscriptionId,
        stripeCustomerId: `cus_${salonId}`,
        planDefinitionKey: 'pro_2026_08',
        billingOfferKey: 'pro_2026_08_annual',
        billingCadence: 'annual',
        status: 'active',
        paidThrough: new Date('2027-09-01T10:00:00.000Z'),
        creditCycleAnchor: new Date('2026-09-01T10:00:00.000Z'),
        ...over,
      });
    }

    it('a PARTIAL subscription refund is held for a human, never automated (§6.8: partial stays held)', async () => {
      await seedLocalSubscription('s_route_partial', 'sub_route_partial');
      stripeMock.invoices.retrieve.mockResolvedValueOnce({
        id: 'in_route_partial',
        subscription: 'sub_route_partial',
        lines: { data: [{ period: { start: 1_780_000_000, end: 1_780_000_000 + 30 * 24 * 3600 } }] },
      });
      const event = stripeEvent('charge.refunded', {
        id: 'ch_route_partial',
        payment_intent: 'pi_route_partial',
        invoice: 'in_route_partial',
        amount: 10000,
        amount_refunded: 3000, // partial — not full
        refunds: { data: [{ id: 're_route_partial' }] },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('held_anomaly');
      expect(row!.lastError).toBe('SUBSCRIPTION_CHARGE_PARTIAL_REFUND');
      expect(sentryHolder.captureMessage).toHaveBeenCalled();

      const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_route_partial'));

      expect(subscription!.paidThrough.toISOString()).toBe('2027-09-01T10:00:00.000Z'); // untouched
    });

    it('a dispute during a prepaid annual term is held for a human; grants stay untouched (§6.8)', async () => {
      await seedLocalSubscription('s_route_dispute', 'sub_route_dispute');
      stripeMock.charges.retrieve.mockResolvedValueOnce({
        id: 'ch_route_dispute_charge',
        invoice: 'in_route_dispute',
        amount: 10000,
        amount_refunded: 0,
        payment_intent: 'pi_route_dispute',
      });
      stripeMock.invoices.retrieve.mockResolvedValueOnce({
        id: 'in_route_dispute',
        subscription: 'sub_route_dispute',
        lines: { data: [{ period: { start: 1_780_000_000, end: 1_780_000_000 + 365 * 24 * 3600 } }] },
      });
      const event = stripeEvent('charge.dispute.created', {
        id: 'dp_route_annual',
        payment_intent: 'pi_route_dispute',
        charge: 'ch_route_dispute_charge',
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('held_anomaly');
      expect(row!.lastError).toBe('CHARGE_EVENT_HELD_FOR_REVIEW');
      expect(sentryHolder.captureMessage).toHaveBeenCalled();

      const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_route_dispute'));

      expect(subscription!.paidThrough.toISOString()).toBe('2027-09-01T10:00:00.000Z'); // grants unchanged
    });

    it('charge.refunded then refund.updated for the SAME full refund lower paid_through only ONCE (single Sentry alert, G01 dedup)', async () => {
      await seedLocalSubscription('s_route_full_refund', 'sub_route_full_refund');
      const periodStart = 1_780_000_000;
      const periodEnd = periodStart + 365 * 24 * 3600;
      stripeMock.invoices.retrieve.mockResolvedValue({
        id: 'in_route_full',
        subscription: 'sub_route_full_refund',
        lines: { data: [{ period: { start: periodStart, end: periodEnd } }] },
      });
      const chargeEvent = stripeEvent('charge.refunded', {
        id: 'ch_route_full',
        payment_intent: 'pi_route_full',
        invoice: 'in_route_full',
        amount: 10000,
        amount_refunded: 10000, // full
        refunds: { data: [{ id: 're_route_full' }] },
      });
      const chargeResponse = await post(chargeEvent);

      expect(chargeResponse.status).toBe(200);

      let [row] = (await eventRows()).filter(entry => entry.eventId === chargeEvent.id);

      expect(row!.status).toBe('processed');
      expect(sentryHolder.captureMessage).toHaveBeenCalledTimes(1);
      expect(sentryHolder.captureMessage).toHaveBeenCalledWith('billing.subscription_refunded', expect.objectContaining({
        extra: expect.objectContaining({ stripeSubscriptionId: 'sub_route_full_refund' }),
      }));

      let [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_route_full_refund'));

      expect(subscription!.paidThrough.getTime()).toBe(periodStart * 1000);

      // The refund.updated event for the SAME underlying refund arrives next.
      stripeMock.charges.retrieve.mockResolvedValueOnce({
        id: 'ch_route_full',
        invoice: 'in_route_full',
        amount: 10000,
        amount_refunded: 10000,
        payment_intent: 'pi_route_full',
      });
      const refundUpdatedEvent = stripeEvent('refund.updated', {
        id: 're_route_full',
        charge: 'ch_route_full',
        payment_intent: 'pi_route_full',
        amount: 10000,
      });
      const refundResponse = await post(refundUpdatedEvent);

      expect(refundResponse.status).toBe(200);

      [row] = (await eventRows()).filter(entry => entry.eventId === refundUpdatedEvent.id);

      expect(row!.status).toBe('processed');
      // No SECOND alert — applySubscriptionFullRefund's MIN semantics make
      // this a pure no-op regardless of delivery order.
      expect(sentryHolder.captureMessage).toHaveBeenCalledTimes(1);

      [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_route_full_refund'));

      expect(subscription!.paidThrough.getTime()).toBe(periodStart * 1000); // unchanged
    });
  });

  // G03 — every held_anomaly outcome alerts exactly once.
  describe('G03 — Sentry on every held_anomaly outcome', () => {
    it('alerts exactly once for a subscription-projection anomaly (UNKNOWN_OFFER_OR_SALON_METADATA)', async () => {
      // purpose='plan_subscription' but no salonId/billingOfferKey metadata.
      const event = stripeEvent('customer.subscription.created', {
        id: 'sub_route_anomaly',
        customer: 'cus_route_anomaly',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: 1_780_000_000,
        metadata: { purpose: 'plan_subscription' },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('held_anomaly');
      expect(row!.lastError).toBe('UNKNOWN_OFFER_OR_SALON_METADATA');
      expect(sentryHolder.captureMessage).toHaveBeenCalledTimes(1);
      expect(sentryHolder.captureMessage).toHaveBeenCalledWith('billing.event_held_anomaly', {
        level: 'warning',
        extra: { eventId: event.id, eventType: 'customer.subscription.created', detail: 'UNKNOWN_OFFER_OR_SALON_METADATA' },
      });
    });

    it('alerts exactly once for an invoice with no line-item periods', async () => {
      const event = stripeEvent('invoice.payment_succeeded', {
        id: 'in_route_no_periods',
        subscription: 'sub_route_no_periods',
        lines: { data: [] },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('held_anomaly');
      expect(row!.lastError).toBe('INVOICE_WITHOUT_LINE_PERIODS');
      expect(sentryHolder.captureMessage).toHaveBeenCalledTimes(1);
      expect(sentryHolder.captureMessage).toHaveBeenCalledWith('billing.event_held_anomaly', {
        level: 'warning',
        extra: { eventId: event.id, eventType: 'invoice.payment_succeeded', detail: 'INVOICE_WITHOUT_LINE_PERIODS' },
      });
    });

    it('never includes the raw payload or PII in the Sentry extra', async () => {
      const event = stripeEvent('customer.subscription.created', {
        id: 'sub_route_anomaly_pii',
        customer: 'cus_route_anomaly_pii',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: 1_780_000_000,
        metadata: { purpose: 'plan_subscription' },
      });
      await post(event);

      const [, options] = sentryHolder.captureMessage.mock.calls[0]! as [string, { extra: Record<string, unknown> }];

      expect(Object.keys(options.extra).sort()).toEqual(['detail', 'eventId', 'eventType']);
    });
  });

  // G14/§3.7 — the architecture MUST support invoice-failure states,
  // including tax-related ones (automatic tax stays OFF; this proves the
  // generic invoice.payment_failed handling needs no special-casing for a
  // tax-shaped failure body).
  describe('§3.7 — invoice-failure states (tax-related failure shape)', () => {
    it('an invoice.payment_failed carrying a tax-related last_finalization_error still projects past_due, paid_through unchanged', async () => {
      const salonId = 's_route_tax_failed';
      const stripeSubscriptionId = 'sub_route_tax_failed';
      const paidThrough = new Date('2027-09-01T10:00:00.000Z');
      await db.insert(schema.salonSchema).values({ id: salonId, name: salonId, slug: salonId });
      await db.insert(schema.billingSubscriptionSchema).values({
        id: `bsub_${salonId}`,
        salonId,
        stripeSubscriptionId,
        stripeCustomerId: `cus_${salonId}`,
        planDefinitionKey: 'pro_2026_08',
        billingOfferKey: 'pro_2026_08_annual',
        billingCadence: 'annual',
        status: 'active',
        paidThrough,
        creditCycleAnchor: new Date('2026-09-01T10:00:00.000Z'),
      });

      const event = stripeEvent('invoice.payment_failed', {
        id: 'in_route_tax_failed',
        subscription: stripeSubscriptionId,
        last_finalization_error: { code: 'tax_id_invalid', type: 'invoice_error' },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('processed');

      const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, stripeSubscriptionId));

      expect(subscription!.status).toBe('past_due');
      expect(subscription!.paidThrough.getTime()).toBe(paidThrough.getTime());
    });
  });

  // P3b — processing lease + CAS-fenced terminal writes, re-derived from PR
  // #176's ideas on top of #195's state machine.
  describe('P3b — processing lease and CAS-fenced terminal writes', () => {
    it('a concurrent delivery of the SAME event, still within another claim\'s lease, gets 503 with Retry-After and never runs the handler (no double effect)', async () => {
      await db.insert(schema.salonSchema).values({ id: 's_route_inflight', name: 's', slug: 's-route-inflight' });
      const event = stripeEvent('customer.subscription.created', {
        id: 'sub_route_inflight',
        customer: 'cus_inflight',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: 1_780_000_000,
        metadata: { purpose: 'plan_subscription', salonId: 's_route_inflight', billingOfferKey: 'starter_2026_08_monthly' },
      });
      // Simulate a DIFFERENT delivery already claimed and mid-flight, well
      // within its lease — this IS the two-simultaneous-deliveries scenario,
      // driven through the same DB row a real second worker would hold.
      await db.insert(schema.billingStripeEventSchema).values({
        id: 'bse_route_inflight_sim',
        eventId: event.id,
        eventType: event.type,
        livemode: false,
        apiCreatedAt: new Date(event.created * 1000),
        status: 'processing',
        attempts: 1,
      });

      const response = await post(event);

      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe('BILLING_EVENT_PENDING');

      const retryAfter = Number(response.headers.get('Retry-After'));

      expect(retryAfter).toBeGreaterThanOrEqual(5);
      expect(retryAfter).toBeLessThanOrEqual(300);

      const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_route_inflight'));

      expect(subscription).toBeUndefined(); // handleEvent never ran for this delivery — no double effect

      const rows = (await eventRows()).filter(row => row.eventId === event.id);

      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe('processing'); // untouched — still owned by the simulated in-flight claimer
      expect(rows[0]!.attempts).toBe(1);
    });

    it('a lapsed processing lease is reclaimed exactly once, with attempts incremented, and the event completes normally', async () => {
      await db.insert(schema.salonSchema).values({ id: 's_route_lease', name: 's', slug: 's-route-lease' });
      const event = stripeEvent('customer.subscription.created', {
        id: 'sub_route_lease',
        customer: 'cus_lease',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: 1_780_000_000,
        metadata: { purpose: 'plan_subscription', salonId: 's_route_lease', billingOfferKey: 'starter_2026_08_monthly' },
      });
      const staleLease = new Date(Date.now() - 6 * 60 * 1000); // past the 5-minute lease
      await db.insert(schema.billingStripeEventSchema).values({
        id: 'bse_route_lease_stale',
        eventId: event.id,
        eventType: event.type,
        livemode: false,
        apiCreatedAt: new Date(event.created * 1000),
        status: 'processing',
        attempts: 1,
        updatedAt: staleLease,
      });

      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('processed');
      expect(row!.attempts).toBe(2); // bumped by the lapsed-lease reclaim, then resolved by THIS delivery

      const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_route_lease'));

      expect(subscription).toBeDefined();
    });

    it('a lost CAS on the terminal write never overwrites the newer owner\'s outcome, and alerts exactly once', async () => {
      await db.insert(schema.salonSchema).values({ id: 's_route_cas', name: 's', slug: 's-route-cas' });
      const event = stripeEvent('customer.subscription.updated', {
        id: 'sub_route_cas',
        customer: 'cus_cas',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: 1_780_000_000,
        metadata: { purpose: 'plan_subscription', salonId: 's_route_cas', billingOfferKey: 'starter_2026_08_monthly' },
      });

      stripeMock.subscriptions.retrieve.mockImplementationOnce(async () => {
        // Simulate a DIFFERENT worker reclaiming this event id's LAPSED
        // lease and reaching its OWN terminal outcome WHILE this delivery's
        // handler is still mid-flight (blocked on this very Stripe call).
        await db.update(schema.billingStripeEventSchema)
          .set({ attempts: 2, status: 'processed', processedAt: new Date(), lastError: 'other_owner' })
          .where(eq(schema.billingStripeEventSchema.eventId, event.id));
        return {
          id: 'sub_route_cas',
          customer: 'cus_cas',
          status: 'active',
          cancel_at_period_end: false,
          current_period_start: 1_780_000_000,
          metadata: { purpose: 'plan_subscription', salonId: 's_route_cas', billingOfferKey: 'starter_2026_08_monthly' },
          items: { data: [] },
        };
      });

      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      // The other owner's outcome stands, byte for byte — our write never landed.
      expect(row!.status).toBe('processed');
      expect(row!.attempts).toBe(2);
      expect(row!.lastError).toBe('other_owner');

      const casLostCalls = sentryHolder.captureMessage.mock.calls
        .filter(([message]) => message === 'billing.event_cas_lost');

      expect(casLostCalls).toHaveLength(1);
      expect(casLostCalls[0]![1]).toMatchObject({
        extra: { eventId: event.id, eventType: 'customer.subscription.updated' },
      });
    });

    it('the 8th failed attempt still poisons the event and alerts, unaffected by the CAS/lease changes', async () => {
      const event = stripeEvent('invoice.payment_succeeded', {
        id: 'in_route_poison',
        subscription: 'sub_route_poison_missing',
        lines: { data: [{ period: { end: 1_780_000_000 + 30 * 24 * 3600 } }] },
      });
      // Seed the row at attempt 7, past backoff — the reclaim on this
      // delivery bumps it to 8, the poison threshold.
      await db.insert(schema.billingStripeEventSchema).values({
        id: 'bse_route_poison',
        eventId: event.id,
        eventType: event.type,
        livemode: false,
        apiCreatedAt: new Date(event.created * 1000),
        status: 'failed_retryable',
        attempts: 7,
        availableAt: new Date(Date.now() - 1000),
        lastError: 'prior failure',
      });

      const response = await post(event);

      expect(response.status).toBe(200);
      expect((await response.json()).poisoned).toBe(true);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('poisoned');
      expect(row!.attempts).toBe(8);
      expect(sentryHolder.captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
        extra: expect.objectContaining({ eventId: event.id, poisoned: true }),
      }));
    });

    it('a terminal replay after successful processing still deduplicates as 200, not the 503 given to an in-flight delivery', async () => {
      await db.insert(schema.salonSchema).values({ id: 's_route_terminal_replay', name: 's', slug: 's-route-terminal-replay' });
      const event = stripeEvent('customer.subscription.created', {
        id: 'sub_route_terminal_replay',
        customer: 'cus_terminal_replay',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: 1_780_000_000,
        metadata: { purpose: 'plan_subscription', salonId: 's_route_terminal_replay', billingOfferKey: 'starter_2026_08_monthly' },
      });

      const first = await post(event);

      expect(first.status).toBe(200);

      const replay = await post(event);

      expect(replay.status).toBe(200);
      expect((await replay.json()).deduplicated).toBe(true);
      expect(replay.headers.get('Retry-After')).toBeNull();
    });
  });
});
