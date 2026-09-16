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
import Stripe from 'stripe';
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
  // PR-2 / D19c §2.1: unset means "no deployment check", i.e. exactly the
  // behaviour every test in this suite asserted before the variable existed.
  BILLING_DEPLOYMENT_MARKER: undefined as string | undefined,
  BILLING_IDENTITY_HMAC_SECRET: undefined,
  BILLING_IDENTITY_HMAC_VERSION: undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

/**
 * Y12: the livemode expectation is now the programme's two-leg producer. The
 * REAL function is the default here (under vitest it resolves to the `test`
 * runtime with a test-mode key ⇒ `{ ok: true, livemode: false }`, the same
 * expectation this suite has always asserted against); a test that needs the
 * mismatch or indeterminate legs sets `expected` explicitly.
 */
const livemodeHolder = vi.hoisted(() => ({
  expected: null as null | { ok: true; livemode: boolean } | { ok: false; code: 'MODE_INDETERMINATE' },
}));
vi.mock('@/libs/environmentIsolation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/environmentIsolation')>();
  return {
    ...actual,
    computeExpectedLivemode: (environment: Record<string, string | undefined>) =>
      livemodeHolder.expected ?? actual.computeExpectedLivemode(environment),
  };
});

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
  // R-6: `retrieve` returns the invoice with an embedded (possibly
  // truncated) line page; `listLineItems` is the paging escape hatch the
  // route takes ONLY when that page says `has_more`.
  invoices: { retrieve: vi.fn(), listLineItems: vi.fn() },
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
  // The route keeps ONE piece of module-level state — the Y12 alert's
  // rate-limit timestamp — and the rate-limit test below deliberately pins
  // `Date.now()` far in the future to exercise the window. Without a reset
  // that timestamp would outlive the test and silently suppress every later
  // mismatch alert in this file. `vi.resetModules()` is this repo's
  // convention for per-test module state (stripePriceMap.test.ts,
  // stripePriceCarrier.test.ts, DB.testIsolation.test.ts); the route is
  // re-imported per `post()` anyway, and the alternative — exporting a reset
  // helper — is not available here, because a Next.js route file may export
  // only its handlers and route config.
  vi.resetModules();
  envHolder.STRIPE_BILLING_WEBHOOK_SECRET = 'whsec_test';
  envHolder.BILLING_PLAN_ENV = 'test';
  envHolder.BILLING_DEPLOYMENT_MARKER = undefined;
  livemodeHolder.expected = null;
  sentryHolder.captureMessage.mockClear();
  sentryHolder.captureException.mockClear();
  stripeMock.charges.retrieve.mockReset();
  stripeMock.invoices.retrieve.mockReset();
  stripeMock.invoices.listLineItems.mockReset();
  stripeMock.subscriptions.retrieve.mockReset();
  stripeMock.subscriptions.retrieve.mockImplementation(async () => {
    throw new Error('NO_REFETCH_IN_TEST');
  });
  stripeMock.checkout.sessions.retrieve.mockReset();
  priceMapHolder.resolvedOfferKey = null;
});

/**
 * A realistic Stripe subscription line item. R-6 filters on `type` and
 * `proration`, so a bare `{ period }` stub is no longer coverage — exactly
 * as in production, where a renewal's proration line must not be mistaken
 * for the period the invoice actually paid for.
 */
function subLine(start: number, end: number, over: Record<string, unknown> = {}) {
  return { type: 'subscription', proration: false, subscription: null, period: { start, end }, ...over };
}

/** A proration line — never subscription coverage (R-6). */
function prorationLine(start: number, end: number) {
  return { type: 'subscription', proration: true, subscription: null, period: { start, end } };
}

const auditRowsFor = async (entityId: string) =>
  (await db.select().from(schema.auditLogSchema)).filter(row => row.entityId === entityId);

/**
 * §8.3: the subscription branch re-fetches the charge for `charge.refunded`
 * rather than trusting the event body, which is a snapshot at event time and
 * may be delivered out of order. Every `charge.refunded` test that reaches a
 * LOCAL subscription must therefore say what the charge looks like NOW.
 */
function freshCharge(over: { amount: number; amountRefunded: number; id?: string; invoice?: string }) {
  return {
    id: over.id ?? 'ch_fresh',
    invoice: over.invoice,
    amount: over.amount,
    amount_refunded: over.amountRefunded,
  };
}

const post = async (body: unknown, signature = 'sig_valid') => {
  const { POST } = await import('./route');
  return POST(new Request('http://localhost/api/webhooks/stripe-billing', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'stripe-signature': signature },
  }));
};

const eventRows = () => db.select().from(schema.billingStripeEventSchema);

/**
 * PR-2: the ONE Stripe failure that is evidence rather than an outage — a
 * decoded invalid-request saying the object is not on this account. Every
 * other failure class must stay retryable, which the negative cases below
 * (5xx, authentication) pin explicitly.
 */
function resourceMissing(message: string): Stripe.errors.StripeInvalidRequestError {
  return new Stripe.errors.StripeInvalidRequestError({
    type: 'invalid_request_error',
    code: 'resource_missing',
    message,
  });
}

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
      lines: { data: [subLine(createdAt, createdAt + 35 * 24 * 3600)] },
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
      lines: { data: [subLine(createdAt, createdAt + 30 * 24 * 3600)] },
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
        lines: { data: [subLine(1_780_000_000, 1_780_000_000 + 30 * 24 * 3600)] },
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
        lines: { data: [subLine(1_780_000_000, 1_780_000_000 + 30 * 24 * 3600)] },
      });
      stripeMock.charges.retrieve.mockResolvedValue(freshCharge({ id: 'ch_route_partial', amount: 10000, amountRefunded: 3000 }));
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
        lines: { data: [subLine(1_780_000_000, 1_780_000_000 + 365 * 24 * 3600)] },
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

    // RT-7: unusable coverage now holds the event with ZERO writes. The old
    // code wrote a null-bound `refund_applied` row here, which permanently
    // poisoned every later evidence read (incomplete ⇒ fail closed forever);
    // grants stopping was the SYMPTOM, not the contract. The contract is:
    // nothing is written at all, and `paid_through` is untouched.
    it.each([
      {
        name: 'no subscription lines at all',
        lines: { has_more: false, data: [] },
        detail: 'SUBSCRIPTION_REFUND_PRORATION_ONLY',
      },
      {
        // Structurally unreadable — a fact about the object, not a transient
        // failure, so no retry could ever change it.
        name: 'no readable line set',
        lines: undefined,
        detail: 'SUBSCRIPTION_REFUND_COVERAGE_UNKNOWN',
      },
    ])('holds a full refund with unusable invoice coverage and writes NOTHING ($name)', async ({ lines, detail }) => {
      const salonId = `s_refund_unknown_${detail}`;
      const subId = `sub_refund_unknown_${detail}`;
      await seedLocalSubscription(salonId, subId);
      stripeMock.invoices.retrieve.mockResolvedValueOnce({
        id: `in_refund_unknown_${detail}`,
        subscription: subId,
        ...(lines !== undefined ? { lines } : {}),
      });
      stripeMock.charges.retrieve.mockResolvedValue(freshCharge({
        id: `ch_refund_unknown_${detail}`,
        amount: 10000,
        amountRefunded: 10000,
      }));
      const event = stripeEvent('charge.refunded', {
        id: `ch_refund_unknown_${detail}`,
        invoice: `in_refund_unknown_${detail}`,
        amount: 10000,
        amount_refunded: 10000,
      });
      const response = await post(event);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ outcome: 'held_anomaly' });

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.lastError).toBe(detail);
      expect(sentryHolder.captureMessage).toHaveBeenCalledWith('billing.event_held_anomaly', {
        level: 'warning',
        extra: { eventId: event.id, eventType: 'charge.refunded', detail },
      });

      const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

      // ZERO writes: no evidence row, and paid_through exactly as seeded.
      expect(await auditRowsFor(subscription!.id)).toHaveLength(0);
      expect(subscription!.paidThrough.toISOString()).toBe('2027-09-01T10:00:00.000Z');

      // INVERTED (R-1): grants used to be blocked here, but only because the
      // route wrote a NULL-BOUND refund row that made every later evidence
      // read `incomplete` and fail closed — permanently, with no automated
      // way back. That was the defect, not the protection. With zero writes
      // the salon keeps exactly the entitlement it paid for, and the HELD
      // event is what stops the refund from being silently ignored.
      const { evaluateSubscriptionWindows } = await import('@/libs/billing/creditGrants');
      const result = await evaluateSubscriptionWindows({
        subscriptionId: subscription!.id,
        now: new Date('2026-10-15T10:00:00.000Z'),
      });

      expect(result.granted).toBe(1);

      const grants = await db.select().from(schema.smsCreditLedgerSchema).where(eq(schema.smsCreditLedgerSchema.salonId, salonId));

      expect(grants).toHaveLength(1);
    });

    // INVERTED: a Stripe paging failure used to be swallowed into a TERMINAL
    // hold. It is a transient infrastructure problem, not a fact about the
    // invoice — so it is now retryable (and poisons after 8 attempts like any
    // other handler error). Scenario kept: still ZERO writes.
    it('retries (500) instead of holding when a truncated refund invoice cannot be paged', async () => {
      const salonId = 's_refund_paging_failure';
      const subId = 'sub_refund_paging_failure';
      await seedLocalSubscription(salonId, subId);
      stripeMock.invoices.retrieve.mockResolvedValueOnce({
        id: 'in_refund_paging_failure',
        subscription: subId,
        lines: { has_more: true, data: [subLine(1780000000, 1811536000)] },
      });
      stripeMock.invoices.listLineItems.mockImplementation(() => {
        throw new Error('STRIPE_UNAVAILABLE');
      });
      stripeMock.charges.retrieve.mockResolvedValue(freshCharge({
        id: 'ch_refund_paging_failure',
        amount: 10000,
        amountRefunded: 10000,
      }));
      const event = stripeEvent('charge.refunded', {
        id: 'ch_refund_paging_failure',
        invoice: 'in_refund_paging_failure',
        amount: 10000,
        amount_refunded: 10000,
      });
      const response = await post(event);

      expect(response.status).toBe(500);
      expect((await response.json()).error.code).toBe('HANDLER_RETRYABLE');

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('failed_retryable');

      const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

      expect(await auditRowsFor(subscription!.id)).toHaveLength(0);
      expect(subscription!.paidThrough.toISOString()).toBe('2027-09-01T10:00:00.000Z');
    });

    // RT-7b: the paging escape hatch actually works — a truncated page that
    // CAN be paged yields ordinary evidence, not a hold.
    it('pages a truncated line set through listLineItems and records normal refund evidence', async () => {
      const salonId = 's_refund_paged';
      const subId = 'sub_refund_paged';
      const periodStart = 1_780_000_000;
      const periodEnd = new Date('2027-09-01T10:00:00.000Z').getTime() / 1000;
      await seedLocalSubscription(salonId, subId);
      stripeMock.invoices.retrieve.mockResolvedValueOnce({
        id: 'in_refund_paged',
        subscription: subId,
        // The embedded page shows only the LAST slice of the coverage.
        lines: { has_more: true, data: [subLine(periodEnd - 24 * 3600, periodEnd)] },
      });
      stripeMock.invoices.listLineItems.mockReturnValue({
        autoPagingToArray: async () => [
          subLine(periodStart, periodEnd - 24 * 3600),
          subLine(periodEnd - 24 * 3600, periodEnd),
        ],
      });
      stripeMock.charges.retrieve.mockResolvedValue(freshCharge({ id: 'ch_refund_paged', amount: 10000, amountRefunded: 10000 }));
      const event = stripeEvent('charge.refunded', {
        id: 'ch_refund_paged',
        invoice: 'in_refund_paged',
        amount: 10000,
        amount_refunded: 10000,
        refunds: { data: [{ id: 're_refund_paged' }] },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('processed');
      expect(stripeMock.invoices.listLineItems).toHaveBeenCalledWith('in_refund_paged', { limit: 100 });

      const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));
      const evidence = (await auditRowsFor(subscription!.id))
        .filter(auditRow => auditRow.action === 'billing_subscription_refund_applied');

      expect(evidence).toHaveLength(1);
      // The FULL paged span, not the visible slice.
      expect(evidence[0]!.metadata).toMatchObject({
        evidenceVersion: 2,
        invoiceId: 'in_refund_paged',
        refundIds: ['re_refund_paged'],
        refundedPeriodStart: new Date(periodStart * 1000).toISOString(),
        refundedPeriodEnd: new Date(periodEnd * 1000).toISOString(),
      });
      expect(subscription!.paidThrough.getTime()).toBe(periodStart * 1000);
    });

    // A full refund of an invoice that bills only prorations has no
    // subscription coverage to exclude — held, never guessed at.
    it('holds a full refund of a proration-only invoice (SUBSCRIPTION_REFUND_PRORATION_ONLY), zero writes', async () => {
      const salonId = 's_refund_proration_only';
      const subId = 'sub_refund_proration_only';
      await seedLocalSubscription(salonId, subId);
      stripeMock.invoices.retrieve.mockResolvedValueOnce({
        id: 'in_refund_proration_only',
        subscription: subId,
        lines: { has_more: false, data: [prorationLine(1_780_000_000, 1_782_000_000)] },
      });
      stripeMock.charges.retrieve.mockResolvedValue(freshCharge({ id: 'ch_refund_proration_only', amount: 10000, amountRefunded: 10000 }));
      const event = stripeEvent('charge.refunded', {
        id: 'ch_refund_proration_only',
        invoice: 'in_refund_proration_only',
        amount: 10000,
        amount_refunded: 10000,
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('held_anomaly');
      expect(row!.lastError).toBe('SUBSCRIPTION_REFUND_PRORATION_ONLY');

      const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

      expect(await auditRowsFor(subscription!.id)).toHaveLength(0);
      expect(subscription!.paidThrough.toISOString()).toBe('2027-09-01T10:00:00.000Z');
    });

    it('retries an owned subscription refund that arrives before subscription projection', async () => {
      stripeMock.invoices.retrieve.mockResolvedValueOnce({
        id: 'in_early_refund',
        subscription: 'sub_early_refund',
        lines: { data: [{ period: { start: 1780000000, end: 1811536000 } }] },
      });
      stripeMock.subscriptions.retrieve.mockResolvedValueOnce({ id: 'sub_early_refund', metadata: { purpose: 'plan_subscription' } });
      const event = stripeEvent('charge.refunded', {
        id: 'ch_early_refund',
        invoice: 'in_early_refund',
        amount: 10000,
        amount_refunded: 10000,
      });
      const response = await post(event);

      expect(response.status).toBe(500);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).not.toBe('ignored_foreign');
      expect(row!.lastError).toBe('SUBSCRIPTION_NOT_PROJECTED');
    });

    it('charge.refunded then refund.updated for the SAME full refund lower paid_through only ONCE (single Sentry alert, G01 dedup)', async () => {
      await seedLocalSubscription('s_route_full_refund', 'sub_route_full_refund');
      const periodStart = 1_780_000_000;
      const periodEnd = new Date('2027-09-01T10:00:00.000Z').getTime() / 1000;
      stripeMock.invoices.retrieve.mockResolvedValue({
        id: 'in_route_full',
        subscription: 'sub_route_full_refund',
        lines: { data: [subLine(periodStart, periodEnd)] },
      });
      stripeMock.charges.retrieve.mockResolvedValue(freshCharge({ id: 'ch_route_full', invoice: 'in_route_full', amount: 10000, amountRefunded: 10000 }));
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
      // The invoice exclusion deduplicates both refund event types.
      // No SECOND alert — applySubscriptionFullRefund's MIN semantics make
      // this a pure no-op regardless of delivery order.
      expect(sentryHolder.captureMessage).toHaveBeenCalledTimes(1);

      [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_route_full_refund'));

      expect(subscription!.paidThrough.getTime()).toBe(periodStart * 1000); // unchanged

      const delayedPaid = stripeEvent('invoice.payment_succeeded', {
        id: 'in_route_full',
        subscription: 'sub_route_full_refund',
        lines: { data: [subLine(periodStart, periodEnd)] },
      });
      const delayedResponse = await post(delayedPaid);

      expect(delayedResponse.status).toBe(200);
      expect(await delayedResponse.json()).toMatchObject({ outcome: 'held_anomaly' });

      const [delayedRow] = (await eventRows()).filter(entry => entry.eventId === delayedPaid.id);

      expect(delayedRow!.lastError).toBe('SUBSCRIPTION_PERIOD_REFUNDED');
      expect(delayedRow!.attempts).toBe(1);
    });

    // RT-17 (route half): a renewal invoice routinely carries a proration
    // line for the PREVIOUS — here refunded — cycle. The old min/max over
    // ALL lines dragged paidPeriodStart back into that refunded window and
    // turned a legitimate renewal into a permanent SUBSCRIPTION_PERIOD_REFUNDED
    // hold. Coverage is the SUBSCRIPTION line's span only.
    it('applies a renewal invoice that also carries a proration line from the refunded previous cycle', async () => {
      const salonId = 's_route_rt17';
      const subId = 'sub_route_rt17';
      const w0Start = Math.floor(new Date('2026-09-01T10:00:00.000Z').getTime() / 1000);
      const w0End = Math.floor(new Date('2026-10-01T10:00:00.000Z').getTime() / 1000);
      const w1End = Math.floor(new Date('2026-11-01T10:00:00.000Z').getTime() / 1000);
      await seedLocalSubscription(salonId, subId, {
        paidThrough: new Date(w0End * 1000),
        creditCycleAnchor: new Date(w0Start * 1000),
      });

      // First: the previous cycle's invoice is fully refunded.
      stripeMock.invoices.retrieve.mockResolvedValueOnce({
        id: 'in_rt17_first',
        subscription: subId,
        lines: { has_more: false, data: [subLine(w0Start, w0End)] },
      });
      stripeMock.charges.retrieve.mockResolvedValue(freshCharge({ id: 'ch_rt17', amount: 10000, amountRefunded: 10000 }));
      const refund = await post(stripeEvent('charge.refunded', {
        id: 'ch_rt17',
        invoice: 'in_rt17_first',
        amount: 10000,
        amount_refunded: 10000,
        refunds: { data: [{ id: 're_rt17' }] },
      }));

      expect(refund.status).toBe(200);

      // Then the renewal lands, carrying BOTH a proration for [w0mid, w0End)
      // and the real subscription line for [w0End, w1End).
      const renewal = stripeEvent('invoice.payment_succeeded', {
        id: 'in_rt17_renewal',
        subscription: subId,
        lines: {
          has_more: false,
          data: [
            prorationLine(w0Start + 15 * 24 * 3600, w0End),
            subLine(w0End, w1End),
          ],
        },
      });
      const response = await post(renewal);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === renewal.id);

      expect(row!.status).toBe('processed');

      const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

      expect(subscription!.paidThrough.getTime()).toBe(w1End * 1000);
    });

    // RT-6 (webhook half) — Owner decision O2: a charge that is no longer
    // fully refunded automatically VOIDS the §6.7 exclusion recorded for its
    // invoice, restores coverage, and pages a human.
    it('voids live refund evidence when refund.updated shows the cumulative refund below the charge amount', async () => {
      const salonId = 's_route_void';
      const subId = 'sub_route_void';
      const periodStart = Math.floor(new Date('2026-09-01T10:00:00.000Z').getTime() / 1000);
      const periodEnd = Math.floor(new Date('2027-09-01T10:00:00.000Z').getTime() / 1000);
      await seedLocalSubscription(salonId, subId, { paidThrough: new Date(periodEnd * 1000) });
      stripeMock.invoices.retrieve.mockResolvedValue({
        id: 'in_route_void',
        subscription: subId,
        lines: { has_more: false, data: [subLine(periodStart, periodEnd)] },
      });

      stripeMock.charges.retrieve.mockResolvedValue(freshCharge({ id: 'ch_route_void', invoice: 'in_route_void', amount: 10000, amountRefunded: 10000 }));
      const refunded = await post(stripeEvent('charge.refunded', {
        id: 'ch_route_void',
        invoice: 'in_route_void',
        amount: 10000,
        amount_refunded: 10000,
        refunds: { data: [{ id: 're_route_void' }] },
      }));

      expect(refunded.status).toBe(200);

      let [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

      expect(subscription!.paidThrough.getTime()).toBe(periodStart * 1000);

      sentryHolder.captureMessage.mockClear();

      // The refund FAILED at the bank: cumulative drops back to zero.
      stripeMock.charges.retrieve.mockResolvedValueOnce({
        id: 'ch_route_void',
        invoice: 'in_route_void',
        amount: 10000,
        amount_refunded: 0,
      });
      const reversal = stripeEvent('refund.updated', {
        id: 're_route_void',
        charge: 'ch_route_void',
        status: 'failed',
        amount: 10000,
      });
      const response = await post(reversal);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === reversal.id);

      expect(row!.status).toBe('processed');
      expect(row!.lastError).toBe('REFUND_EVIDENCE_VOIDED');

      const voidAlerts = sentryHolder.captureMessage.mock.calls
        .filter(([message]) => message === 'billing.subscription_refund_voided');

      expect(voidAlerts).toHaveLength(1);
      expect(voidAlerts[0]![1]).toMatchObject({
        level: 'warning',
        extra: {
          eventId: reversal.id,
          stripeSubscriptionId: subId,
          invoiceId: 'in_route_void',
          observedAmountRefunded: 0,
          observedAmount: 10000,
          reapplied: true,
        },
      });

      [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

      // Coverage restored through the ORDINARY payment transition.
      expect(subscription!.paidThrough.getTime()).toBe(periodEnd * 1000);

      const resolutions = (await auditRowsFor(subscription!.id))
        .filter(auditRow => auditRow.action === 'billing_subscription_refund_evidence_resolved');

      expect(resolutions).toHaveLength(1);
      expect(resolutions[0]!.metadata).toMatchObject({
        evidenceVersion: 2,
        invoiceId: 'in_route_void',
        resolution: 'void',
        reason: 'refund_reversed:failed',
        observedAmountRefunded: 0,
        observedAmount: 10000,
      });
    });

    // RT-6b — the void is keyed on the INVOICE, never on a refund id. A
    // partial `re_1` that later fails after a successful full `re_2` must
    // still resolve the invoice's evidence, whichever refund identity (if
    // any) the event happens to carry.
    it.each([
      { name: 'charge.refunds lists the newest refund first', refunds: { data: [{ id: 're_2' }, { id: 're_1' }] }, expectedIds: ['re_2', 're_1'] },
      { name: 'charge.refunds is absent entirely', refunds: undefined, expectedIds: [] },
    ])('voids partial-then-full refund evidence by invoice identity ($name)', async ({ refunds, expectedIds }) => {
      const suffix = expectedIds.length > 0 ? 'listed' : 'absent';
      const salonId = `s_route_rt6b_${suffix}`;
      const subId = `sub_route_rt6b_${suffix}`;
      const invoiceId = `in_route_rt6b_${suffix}`;
      const periodStart = Math.floor(new Date('2026-09-01T10:00:00.000Z').getTime() / 1000);
      const periodEnd = Math.floor(new Date('2027-09-01T10:00:00.000Z').getTime() / 1000);
      await seedLocalSubscription(salonId, subId, { paidThrough: new Date(periodEnd * 1000) });
      stripeMock.invoices.retrieve.mockResolvedValue({
        id: invoiceId,
        subscription: subId,
        lines: { has_more: false, data: [subLine(periodStart, periodEnd)] },
      });

      // 1. `re_1` refunds 3000 of 10000 — partial, held, nothing written.
      stripeMock.charges.retrieve.mockResolvedValue(freshCharge({
        id: `ch_route_rt6b_${suffix}`,
        invoice: invoiceId,
        amount: 10000,
        amountRefunded: 3000,
      }));
      const partial = await post(stripeEvent('charge.refunded', {
        id: `ch_route_rt6b_${suffix}`,
        invoice: invoiceId,
        amount: 10000,
        amount_refunded: 3000,
        refunds: { data: [{ id: 're_1' }] },
      }));

      expect(await partial.json()).toMatchObject({ outcome: 'held_anomaly' });

      // 2. `re_2` takes the cumulative to the full amount.
      stripeMock.charges.retrieve.mockResolvedValue(freshCharge({
        id: `ch_route_rt6b_${suffix}`,
        invoice: invoiceId,
        amount: 10000,
        amountRefunded: 10000,
      }));
      const full = await post(stripeEvent('charge.refunded', {
        id: `ch_route_rt6b_${suffix}`,
        invoice: invoiceId,
        amount: 10000,
        amount_refunded: 10000,
        ...(refunds !== undefined ? { refunds } : {}),
      }));

      expect(full.status).toBe(200);

      let [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

      expect(subscription!.paidThrough.getTime()).toBe(periodStart * 1000);

      const applied = (await auditRowsFor(subscription!.id))
        .filter(auditRow => auditRow.action === 'billing_subscription_refund_applied');

      expect(applied).toHaveLength(1);
      expect(applied[0]!.metadata).toMatchObject({ invoiceId, refundIds: expectedIds });

      // 3. `re_1` is reversed: cumulative falls to 7000 — no longer full.
      stripeMock.charges.retrieve.mockResolvedValueOnce({
        id: `ch_route_rt6b_${suffix}`,
        invoice: invoiceId,
        amount: 10000,
        amount_refunded: 7000,
      });
      const reversalEvent = stripeEvent('refund.updated', {
        id: 're_1',
        charge: `ch_route_rt6b_${suffix}`,
        status: 'failed',
        amount: 3000,
      });
      const reversal = await post(reversalEvent);

      expect(reversal.status).toBe(200);

      const [reversalRow] = (await eventRows()).filter(entry => entry.eventId === reversalEvent.id);

      expect(reversalRow!.status).toBe('processed');
      expect(reversalRow!.lastError).toBe('REFUND_EVIDENCE_VOIDED');

      [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

      expect(subscription!.paidThrough.getTime()).toBe(periodEnd * 1000);
    });

    // RT-20: a charge.refunded whose `refunds` list is absent still records
    // evidence — keyed by INVOICE, with an empty (informational) id list.
    it('records refund evidence keyed by invoice when charge.refunds is absent', async () => {
      const salonId = 's_route_rt20';
      const subId = 'sub_route_rt20';
      const periodStart = Math.floor(new Date('2026-09-01T10:00:00.000Z').getTime() / 1000);
      const periodEnd = Math.floor(new Date('2027-09-01T10:00:00.000Z').getTime() / 1000);
      await seedLocalSubscription(salonId, subId, { paidThrough: new Date(periodEnd * 1000) });
      stripeMock.invoices.retrieve.mockResolvedValueOnce({
        id: 'in_route_rt20',
        subscription: subId,
        lines: { has_more: false, data: [subLine(periodStart, periodEnd)] },
      });

      stripeMock.charges.retrieve.mockResolvedValue(freshCharge({ id: 'ch_route_rt20', amount: 10000, amountRefunded: 10000 }));
      const response = await post(stripeEvent('charge.refunded', {
        id: 'ch_route_rt20',
        invoice: 'in_route_rt20',
        amount: 10000,
        amount_refunded: 10000,
      }));

      expect(response.status).toBe(200);

      const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));
      const applied = (await auditRowsFor(subscription!.id))
        .filter(auditRow => auditRow.action === 'billing_subscription_refund_applied');

      expect(applied).toHaveLength(1);
      expect(applied[0]!.metadata).toMatchObject({
        evidenceVersion: 2,
        invoiceId: 'in_route_rt20',
        refundIds: [],
        observedAmountRefunded: 10000,
        observedAmount: 10000,
      });
    });

    // §8.3 — a charge.refunded body is the charge AS IT WAS at event time and
    // Stripe guarantees no delivery order, so the decision is made from an
    // authoritative re-fetch. Both directions of the ordering hazard:
    describe('§8.3 — the charge is re-fetched, never decided from a stale event body', () => {
      it('does NOT void evidence when a stale PARTIAL body arrives for a charge that is still fully refunded', async () => {
        const salonId = 's_route_stale_partial';
        const subId = 'sub_route_stale_partial';
        const periodStart = Math.floor(new Date('2026-09-01T10:00:00.000Z').getTime() / 1000);
        const periodEnd = Math.floor(new Date('2027-09-01T10:00:00.000Z').getTime() / 1000);
        await seedLocalSubscription(salonId, subId, { paidThrough: new Date(periodEnd * 1000) });
        stripeMock.invoices.retrieve.mockResolvedValue({
          id: 'in_route_stale_partial',
          subscription: subId,
          lines: { has_more: false, data: [subLine(periodStart, periodEnd)] },
        });
        // The charge IS fully refunded now (re_2 already landed).
        stripeMock.charges.retrieve.mockResolvedValue(freshCharge({
          id: 'ch_route_stale_partial',
          invoice: 'in_route_stale_partial',
          amount: 10000,
          amountRefunded: 10000,
        }));

        // re_2's event lands first and records the exclusion.
        expect((await post(stripeEvent('charge.refunded', {
          id: 'ch_route_stale_partial',
          invoice: 'in_route_stale_partial',
          amount: 10000,
          amount_refunded: 10000,
          refunds: { data: [{ id: 're_2' }] },
        }))).status).toBe(200);

        // re_1's OLDER event now arrives, its body still saying 4000.
        const stale = stripeEvent('charge.refunded', {
          id: 'ch_route_stale_partial',
          invoice: 'in_route_stale_partial',
          amount: 10000,
          amount_refunded: 4000, // stale snapshot
          refunds: { data: [{ id: 're_1' }] },
        });

        expect((await post(stale)).status).toBe(200);

        const [row] = (await eventRows()).filter(entry => entry.eventId === stale.id);

        expect(row!.status).toBe('processed');
        expect(row!.lastError).not.toBe('REFUND_EVIDENCE_VOIDED');

        const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
          .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));
        const evidence = await auditRowsFor(subscription!.id);

        // Exactly one applied row, and NO void: the refund stands.
        expect(evidence.filter(entry => entry.action === 'billing_subscription_refund_applied')).toHaveLength(1);
        expect(evidence.filter(entry => entry.action === 'billing_subscription_refund_evidence_resolved')).toHaveLength(0);
        expect(subscription!.paidThrough.getTime()).toBe(periodStart * 1000);
      });

      it('does NOT write evidence when a stale FULL body arrives for a charge that is no longer fully refunded', async () => {
        const salonId = 's_route_stale_full';
        const subId = 'sub_route_stale_full';
        const periodStart = Math.floor(new Date('2026-09-01T10:00:00.000Z').getTime() / 1000);
        const periodEnd = Math.floor(new Date('2027-09-01T10:00:00.000Z').getTime() / 1000);
        await seedLocalSubscription(salonId, subId, { paidThrough: new Date(periodEnd * 1000) });
        stripeMock.invoices.retrieve.mockResolvedValue({
          id: 'in_route_stale_full',
          subscription: subId,
          lines: { has_more: false, data: [subLine(periodStart, periodEnd)] },
        });
        // A full refund is already on record...
        stripeMock.charges.retrieve.mockResolvedValue(freshCharge({
          id: 'ch_route_stale_full',
          invoice: 'in_route_stale_full',
          amount: 10000,
          amountRefunded: 10000,
        }));

        expect((await post(stripeEvent('charge.refunded', {
          id: 'ch_route_stale_full',
          invoice: 'in_route_stale_full',
          amount: 10000,
          amount_refunded: 10000,
        }))).status).toBe(200);

        // ...but the refund has since been reversed at the bank. A DELAYED
        // full-refund body must not re-assert it.
        stripeMock.charges.retrieve.mockResolvedValue(freshCharge({
          id: 'ch_route_stale_full',
          invoice: 'in_route_stale_full',
          amount: 10000,
          amountRefunded: 2000,
        }));
        const stale = stripeEvent('charge.refunded', {
          id: 'ch_route_stale_full',
          invoice: 'in_route_stale_full',
          amount: 10000,
          amount_refunded: 10000, // stale snapshot
        });

        expect((await post(stale)).status).toBe(200);

        const [row] = (await eventRows()).filter(entry => entry.eventId === stale.id);

        expect(row!.lastError).toBe('REFUND_EVIDENCE_VOIDED');

        const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
          .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));
        const evidence = await auditRowsFor(subscription!.id);

        // One applied row from the first event, ONE void from the stale one —
        // never a second applied row — and coverage is restored.
        expect(evidence.filter(entry => entry.action === 'billing_subscription_refund_applied')).toHaveLength(1);
        expect(evidence.filter(entry => entry.action === 'billing_subscription_refund_evidence_resolved')).toHaveLength(1);
        expect(subscription!.paidThrough.getTime()).toBe(periodEnd * 1000);
      });

      it('is RETRYABLE (never decided from the body) when the charge re-fetch fails', async () => {
        const salonId = 's_route_refetch_fails';
        const subId = 'sub_route_refetch_fails';
        await seedLocalSubscription(salonId, subId);
        stripeMock.invoices.retrieve.mockResolvedValueOnce({
          id: 'in_route_refetch_fails',
          subscription: subId,
          lines: { has_more: false, data: [subLine(1_780_000_000, 1_811_536_000)] },
        });
        stripeMock.charges.retrieve.mockRejectedValue(new Error('STRIPE_UNAVAILABLE'));
        const event = stripeEvent('charge.refunded', {
          id: 'ch_route_refetch_fails',
          invoice: 'in_route_refetch_fails',
          amount: 10000,
          amount_refunded: 10000,
        });
        const response = await post(event);

        expect(response.status).toBe(500);
        expect((await response.json()).error.code).toBe('HANDLER_RETRYABLE');

        const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

        expect(row!.status).toBe('failed_retryable');

        const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
          .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

        expect(await auditRowsFor(subscription!.id)).toHaveLength(0);
        expect(subscription!.paidThrough.toISOString()).toBe('2027-09-01T10:00:00.000Z');
      });

      it('makes exactly ONE charges.retrieve on the refund.updated path — the enrichment IS the re-fetch', async () => {
        const salonId = 's_route_single_fetch';
        const subId = 'sub_route_single_fetch';
        const periodStart = Math.floor(new Date('2026-09-01T10:00:00.000Z').getTime() / 1000);
        const periodEnd = Math.floor(new Date('2027-09-01T10:00:00.000Z').getTime() / 1000);
        await seedLocalSubscription(salonId, subId, { paidThrough: new Date(periodEnd * 1000) });
        stripeMock.invoices.retrieve.mockResolvedValue({
          id: 'in_route_single_fetch',
          subscription: subId,
          lines: { has_more: false, data: [subLine(periodStart, periodEnd)] },
        });
        stripeMock.charges.retrieve.mockResolvedValue(freshCharge({
          id: 'ch_route_single_fetch',
          invoice: 'in_route_single_fetch',
          amount: 10000,
          amountRefunded: 10000,
        }));

        const response = await post(stripeEvent('refund.updated', {
          id: 're_route_single_fetch',
          charge: 'ch_route_single_fetch',
          status: 'succeeded',
          amount: 10000,
        }));

        expect(response.status).toBe(200);
        expect(stripeMock.charges.retrieve).toHaveBeenCalledTimes(1);
        expect(stripeMock.charges.retrieve).toHaveBeenCalledWith('ch_route_single_fetch');
      });
    });

    it('still holds a partial subscription refund with NO live evidence as SUBSCRIPTION_CHARGE_PARTIAL_REFUND', async () => {
      const salonId = 's_route_partial_no_evidence';
      const subId = 'sub_route_partial_no_evidence';
      await seedLocalSubscription(salonId, subId);
      stripeMock.invoices.retrieve.mockResolvedValueOnce({
        id: 'in_route_partial_no_evidence',
        subscription: subId,
        lines: { has_more: false, data: [subLine(1_780_000_000, 1_811_536_000)] },
      });

      stripeMock.charges.retrieve.mockResolvedValue(freshCharge({ id: 'ch_route_partial_no_evidence', amount: 10000, amountRefunded: 2500 }));
      const event = stripeEvent('charge.refunded', {
        id: 'ch_route_partial_no_evidence',
        invoice: 'in_route_partial_no_evidence',
        amount: 10000,
        amount_refunded: 2500,
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('held_anomaly');
      expect(row!.lastError).toBe('SUBSCRIPTION_CHARGE_PARTIAL_REFUND');

      const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

      // A void that finds nothing live writes NOTHING.
      expect(await auditRowsFor(subscription!.id)).toHaveLength(0);
      expect(subscription!.paidThrough.toISOString()).toBe('2027-09-01T10:00:00.000Z');
    });
  });

  // RT-14 (route half) — R-5: invoice events are fenced by STATUS, and they
  // never touch the SUBSCRIPTION event watermark.
  describe('RT-14 — invoice events never resurrect a canceled subscription or move the watermark', () => {
    it('leaves a canceled subscription canceled, keeps last_event_created, and still fences an older update', async () => {
      const salonId = 's_route_rt14';
      const subId = 'sub_route_rt14';
      await db.insert(schema.salonSchema).values({ id: salonId, name: salonId, slug: salonId });
      const t0 = 1_780_000_000;
      const body = (status: string) => ({
        id: subId,
        customer: `cus_${subId}`,
        status,
        cancel_at_period_end: false,
        current_period_start: t0,
        metadata: { purpose: 'plan_subscription', salonId, billingOfferKey: 'pro_2026_08_monthly' },
      });

      expect((await post(stripeEvent('customer.subscription.created', body('active'), { created: t0 }))).status).toBe(200);
      expect((await post(stripeEvent('customer.subscription.deleted', body('canceled'), { created: t0 + 200 }))).status).toBe(200);

      let [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

      expect(subscription!.status).toBe('canceled');
      expect(subscription!.lastEventCreated!.getTime()).toBe((t0 + 200) * 1000);

      // A paid invoice for the terminated subscription: paid_through may
      // advance, the STATUS may not (R-5), and the watermark may not move.
      const paid = stripeEvent('invoice.payment_succeeded', {
        id: 'in_route_rt14',
        subscription: subId,
        lines: { has_more: false, data: [subLine(t0, t0 + 30 * 24 * 3600)] },
      }, { created: t0 + 300 });

      expect((await post(paid)).status).toBe(200);

      [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

      expect(subscription!.status).toBe('canceled');
      expect(subscription!.paidThrough.getTime()).toBe((t0 + 30 * 24 * 3600) * 1000);
      expect(subscription!.lastEventCreated!.getTime()).toBe((t0 + 200) * 1000);

      // A failed invoice for a canceled subscription changes nothing at all.
      const failed = stripeEvent('invoice.payment_failed', {
        id: 'in_route_rt14_failed',
        subscription: subId,
      }, { created: t0 + 400 });

      expect((await post(failed)).status).toBe(200);

      [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

      expect(subscription!.status).toBe('canceled');
      expect(subscription!.lastEventCreated!.getTime()).toBe((t0 + 200) * 1000);

      // And a genuinely OLDER customer.subscription.updated is still stale —
      // the invoice events never raised the fence it is compared against.
      stripeMock.subscriptions.retrieve.mockResolvedValueOnce({ ...body('active') });
      const stale = stripeEvent('customer.subscription.updated', body('active'), { created: t0 + 100 });

      expect((await post(stale)).status).toBe(200);

      [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

      expect(subscription!.status).toBe('canceled');
      expect(subscription!.lastEventCreated!.getTime()).toBe((t0 + 200) * 1000);
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

    // R-6 split this single detail in two. A READABLE line set that simply
    // bills no subscription coverage is a different operational situation
    // from a line set we could not read at all, and the runbook's response
    // differs, so the scenario is kept and the assertion inverted.
    it('alerts exactly once for an invoice whose (readable) lines bill no subscription coverage', async () => {
      const event = stripeEvent('invoice.payment_succeeded', {
        id: 'in_route_no_periods',
        subscription: 'sub_route_no_periods',
        lines: { data: [] },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('held_anomaly');
      expect(row!.lastError).toBe('INVOICE_WITHOUT_SUBSCRIPTION_LINES');
      expect(sentryHolder.captureMessage).toHaveBeenCalledTimes(1);
      expect(sentryHolder.captureMessage).toHaveBeenCalledWith('billing.event_held_anomaly', {
        level: 'warning',
        extra: { eventId: event.id, eventType: 'invoice.payment_succeeded', detail: 'INVOICE_WITHOUT_SUBSCRIPTION_LINES' },
      });
    });

    it('alerts exactly once with INVOICE_WITHOUT_LINE_PERIODS when the line set cannot be read at all', async () => {
      const event = stripeEvent('invoice.payment_succeeded', {
        id: 'in_route_unreadable_lines',
        subscription: 'sub_route_unreadable_lines',
        // No `lines` at all — coverage is UNKNOWN, never assumed empty.
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

    // INVERTED for the same reason as the refund path: a paid invoice whose
    // lines cannot be paged must be RETRIED, not held terminally. Holding it
    // stranded a real payment on one rate-limited minute, with no operator
    // exit on the payment path at all.
    it('retries (500) instead of holding when a truncated PAID invoice cannot be paged', async () => {
      stripeMock.invoices.listLineItems.mockImplementation(() => {
        throw new Error('STRIPE_UNAVAILABLE');
      });
      const event = stripeEvent('invoice.payment_succeeded', {
        id: 'in_route_truncated_paid',
        subscription: 'sub_route_truncated_paid',
        lines: { has_more: true, data: [subLine(1_780_000_000, 1_782_000_000)] },
      });
      const response = await post(event);

      expect(response.status).toBe(500);
      expect((await response.json()).error.code).toBe('HANDLER_RETRYABLE');

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('failed_retryable');
      expect(sentryHolder.captureMessage).not.toHaveBeenCalled();
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

    // Top-up refund reversal anomalies (reverseTopup, §7.8). The route holds
    // the event without touching the ledger and MUST page with the same
    // payload shape as every other held_anomaly outcome — this branch used
    // to return silently.
    async function seedFulfilledTopup(salonId: string, paymentIntentId: string) {
      const { fulfillTopupPurchase } = await import('@/libs/billing/creditGrants');
      await db.insert(schema.salonSchema).values({ id: salonId, name: salonId, slug: salonId });
      await db.insert(schema.smsTopupPurchaseSchema).values({
        id: `tp_${salonId}`,
        salonId,
        topupOfferKey: 'topup_100_paid_2026_08',
        credits: 100,
        amountCents: 599,
        status: 'paid',
        stripeCheckoutSessionId: `cs_${salonId}`,
        stripePaymentIntentId: paymentIntentId,
      });
      await db.transaction(async tx => fulfillTopupPurchase(tx, { topupPurchaseId: `tp_${salonId}` }));
    }

    it('alerts exactly once for a top-up refund whose cumulative total REGRESSED (REFUND_TOTAL_REGRESSED)', async () => {
      await seedFulfilledTopup('s_route_topup_regressed', 'pi_route_topup_regressed');
      // A clean partial refund first: reverses floor(100 · 300 / 599) = 50 credits.
      const first = stripeEvent('charge.refunded', {
        id: 'ch_route_topup_regressed',
        payment_intent: 'pi_route_topup_regressed',
        amount: 599,
        amount_refunded: 300,
        refunds: { data: [{ id: 're_route_topup_regressed_1' }] },
      });
      const firstResponse = await post(first);

      expect(firstResponse.status).toBe(200);
      expect(sentryHolder.captureMessage).not.toHaveBeenCalled(); // a processed reversal never pages

      const event = stripeEvent('charge.refunded', {
        id: 'ch_route_topup_regressed',
        payment_intent: 'pi_route_topup_regressed',
        amount: 599,
        amount_refunded: 100, // moved BACKWARD — a failed refund
        refunds: { data: [{ id: 're_route_topup_regressed_2' }] },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('held_anomaly');
      expect(row!.lastError).toBe('REFUND_TOTAL_REGRESSED');
      expect(sentryHolder.captureMessage).toHaveBeenCalledTimes(1);
      expect(sentryHolder.captureMessage).toHaveBeenCalledWith('billing.event_held_anomaly', {
        level: 'warning',
        extra: { eventId: event.id, eventType: 'charge.refunded', detail: 'REFUND_TOTAL_REGRESSED' },
      });
    });

    it.each([-1, undefined])('alerts exactly once for unusable cumulative refund evidence: %s', async (amountRefunded) => {
      const suffix = String(amountRefunded);
      await seedFulfilledTopup(`s_route_topup_no_evidence_${suffix}`, `pi_route_topup_no_evidence_${suffix}`);
      const event = stripeEvent('charge.refunded', {
        id: 'ch_route_topup_no_evidence',
        payment_intent: `pi_route_topup_no_evidence_${suffix}`,
        amount: 599,
        amount_refunded: amountRefunded, // missing or malformed figure — never guess a refund magnitude
        refunds: { data: [{ id: 're_route_topup_no_evidence' }] },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('held_anomaly');
      expect(row!.lastError).toBe('REFUND_EVIDENCE_MISSING');
      expect(sentryHolder.captureMessage).toHaveBeenCalledTimes(1);
      expect(sentryHolder.captureMessage).toHaveBeenCalledWith('billing.event_held_anomaly', {
        level: 'warning',
        extra: { eventId: event.id, eventType: 'charge.refunded', detail: 'REFUND_EVIDENCE_MISSING' },
      });
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
        lines: { data: [subLine(1_780_000_000, 1_780_000_000 + 30 * 24 * 3600)] },
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

  /**
   * PR-2 / D19c §2.1 — FOREIGN-EVENT ISOLATION.
   *
   * This platform account is shared with the legacy flow and with every other
   * deployment of this codebase, so "I received it" is not "it is mine". Each
   * test below pins one leg of the ownership rule: marked AND local, decided
   * from the cheapest evidence available, failing toward "not mine", and
   * never spending the retry ladder on an object that will never be ours.
   */
  describe('FE-1 — top-up sessions for a salon that does not exist here', () => {
    it('a completed sms_topup session whose salonId is not a local salon is terminally foreign', async () => {
      // Mocked, and asserted NEVER CALLED: classification happens before any
      // Stripe call, so a foreign session costs nothing and writes nothing.
      stripeMock.checkout.sessions.retrieve.mockResolvedValue({
        id: 'cs_fe1_foreign',
        amount_total: 599,
        currency: 'cad',
        metadata: { salonId: 's_fe1_not_local', purchaseId: 'stp_elsewhere', attemptId: 'att_elsewhere' },
        line_items: { data: [{ price: { id: 'price_topup_elsewhere' } }] },
      });
      const event = stripeEvent('checkout.session.completed', {
        id: 'cs_fe1_foreign',
        payment_status: 'paid',
        payment_intent: 'pi_fe1_foreign',
        metadata: { purpose: 'sms_topup', salonId: 's_fe1_not_local' },
      });
      const response = await post(event);

      expect(response.status).toBe(200); // never a 500, never a retry

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('ignored_foreign');
      expect(row!.lastError).toBe('FOREIGN_SALON');
      expect(row!.attempts).toBe(1);
      expect(row!.salonId).toBeNull(); // §2.3 item 4: foreign rows are never attributed
      expect(row!.priceId).toBeNull(); // no evidence write for somebody else's session
      expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
      expect(sentryHolder.captureMessage).not.toHaveBeenCalled();
      expect(sentryHolder.captureException).not.toHaveBeenCalled();
    });

    it('an EXPIRED sms_topup session for a non-local salon is terminally foreign too', async () => {
      const event = stripeEvent('checkout.session.expired', {
        id: 'cs_fe1_foreign_expired',
        metadata: { purpose: 'sms_topup', salonId: 's_fe1_not_local' },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('ignored_foreign');
      expect(row!.lastError).toBe('FOREIGN_SALON');
      expect(sentryHolder.captureMessage).not.toHaveBeenCalled();
    });

    it('the genuine TX2 race is UNCHANGED: a LOCAL salon with no purchase row still retries (500)', async () => {
      await db.insert(schema.salonSchema).values({ id: 's_fe1_local', name: 's', slug: 's-fe1-local' });
      stripeMock.checkout.sessions.retrieve.mockResolvedValue({
        id: 'cs_fe1_local',
        amount_total: 599,
        currency: 'cad',
        metadata: { salonId: 's_fe1_local' },
        line_items: { data: [] },
      });
      const completed = await post(stripeEvent('checkout.session.completed', {
        id: 'cs_fe1_local',
        payment_status: 'paid',
        payment_intent: 'pi_fe1_local',
        metadata: { purpose: 'sms_topup', salonId: 's_fe1_local' },
      }, { id: 'evt_fe1_local_completed' }));

      expect(completed.status).toBe(500);

      const [completedRow] = (await eventRows()).filter(entry => entry.eventId === 'evt_fe1_local_completed');

      expect(completedRow!.status).toBe('failed_retryable');
      expect(completedRow!.lastError).toBe('TOPUP_PURCHASE_NOT_FOUND');

      const expired = await post(stripeEvent('checkout.session.expired', {
        id: 'cs_fe1_local_expired',
        metadata: { purpose: 'sms_topup', salonId: 's_fe1_local' },
      }, { id: 'evt_fe1_local_expired' }));

      expect(expired.status).toBe(500);

      const [expiredRow] = (await eventRows()).filter(entry => entry.eventId === 'evt_fe1_local_expired');

      expect(expiredRow!.status).toBe('failed_retryable');
      expect(expiredRow!.lastError).toBe('TOPUP_PURCHASE_NOT_FOUND');
    });
  });

  describe('FE-2 — invoices and refunds classify before they retry', () => {
    it('an invoice whose subscription_details snapshot names a NON-LOCAL salon is foreign, with ZERO Stripe calls', async () => {
      const event = stripeEvent('invoice.payment_succeeded', {
        id: 'in_fe2_foreign_salon',
        subscription: 'sub_fe2_foreign_salon',
        subscription_details: {
          metadata: { purpose: 'plan_subscription', salonId: 's_fe2_another_deployment', billingOfferKey: 'starter_2026_08_monthly' },
        },
        lines: { data: [subLine(1_780_000_000, 1_780_000_000 + 30 * 24 * 3600)] },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('ignored_foreign');
      expect(row!.lastError).toBe('FOREIGN_SALON');
      expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(stripeMock.invoices.listLineItems).not.toHaveBeenCalled();
      expect(sentryHolder.captureMessage).not.toHaveBeenCalled();
    });

    it('an invoice snapshot with a foreign PURPOSE is foreign with zero Stripe calls', async () => {
      const event = stripeEvent('invoice.payment_succeeded', {
        id: 'in_fe2_foreign_purpose',
        subscription: 'sub_fe2_foreign_purpose',
        subscription_details: { metadata: { some: 'legacy-flow-subscription' } },
        lines: { data: [subLine(1_780_000_000, 1_780_000_000 + 30 * 24 * 3600)] },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('ignored_foreign');
      expect(row!.lastError).toBe('FOREIGN_INVOICE');
      expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();
    });

    it('invoice.payment_failed applies the same snapshot pre-check', async () => {
      const event = stripeEvent('invoice.payment_failed', {
        id: 'in_fe2_failed_foreign',
        subscription: 'sub_fe2_failed_foreign',
        subscription_details: { metadata: { purpose: 'something_else' } },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('ignored_foreign');
      expect(row!.lastError).toBe('FOREIGN_INVOICE');
      expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();
    });

    it('without a snapshot, a subscription Stripe reports MISSING is foreign — one fetch, no retry', async () => {
      stripeMock.subscriptions.retrieve.mockRejectedValueOnce(resourceMissing('No such subscription: sub_fe2_missing'));
      const event = stripeEvent('invoice.payment_succeeded', {
        id: 'in_fe2_missing',
        subscription: 'sub_fe2_missing',
        lines: { data: [subLine(1_780_000_000, 1_780_000_000 + 30 * 24 * 3600)] },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('ignored_foreign');
      expect(row!.lastError).toBe('FOREIGN_INVOICE');
      expect(stripeMock.subscriptions.retrieve).toHaveBeenCalledTimes(1);
    });

    it('a 5xx on that same fetch is RETRYABLE — a Stripe outage never means "not mine"', async () => {
      stripeMock.subscriptions.retrieve.mockRejectedValueOnce(
        new Stripe.errors.StripeAPIError({ type: 'api_error', message: 'Stripe is temporarily unavailable' }),
      );
      const event = stripeEvent('invoice.payment_succeeded', {
        id: 'in_fe2_outage',
        subscription: 'sub_fe2_outage',
        lines: { data: [subLine(1_780_000_000, 1_780_000_000 + 30 * 24 * 3600)] },
      });
      const response = await post(event);

      expect(response.status).toBe(500);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('failed_retryable');
      expect(row!.lastError).toBe('Stripe is temporarily unavailable');
    });

    it('an AUTHENTICATION failure on that fetch is retryable too — a bad key must never read as foreign', async () => {
      stripeMock.subscriptions.retrieve.mockRejectedValueOnce(
        new Stripe.errors.StripeAuthenticationError({ type: 'authentication_error', message: 'Invalid API Key provided' }),
      );
      const event = stripeEvent('invoice.payment_succeeded', {
        id: 'in_fe2_badkey',
        subscription: 'sub_fe2_badkey',
        lines: { data: [subLine(1_780_000_000, 1_780_000_000 + 30 * 24 * 3600)] },
      });
      const response = await post(event);

      expect(response.status).toBe(500);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('failed_retryable');
      expect(row!.status).not.toBe('ignored_foreign');
    });

    it('a subscription that IS ours but is not projected yet still retries (500)', async () => {
      await db.insert(schema.salonSchema).values({ id: 's_fe2_ours', name: 's', slug: 's-fe2-ours' });
      stripeMock.subscriptions.retrieve.mockResolvedValueOnce({
        id: 'sub_fe2_ours',
        metadata: { purpose: 'plan_subscription', salonId: 's_fe2_ours' },
      });
      const event = stripeEvent('invoice.payment_succeeded', {
        id: 'in_fe2_ours',
        subscription: 'sub_fe2_ours',
        lines: { data: [subLine(1_780_000_000, 1_780_000_000 + 30 * 24 * 3600)] },
      });
      const response = await post(event);

      expect(response.status).toBe(500);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('failed_retryable');
      expect(row!.lastError).toBe('SUBSCRIPTION_NOT_PROJECTED');
    });

    it('ours-but-unprojected WITH the snapshot present retries, and makes ZERO Stripe calls', async () => {
      await db.insert(schema.salonSchema).values({ id: 's_fe2_hint_ours', name: 's', slug: 's-fe2-hint-ours' });
      const event = stripeEvent('invoice.payment_succeeded', {
        id: 'in_fe2_hint_ours',
        subscription: 'sub_fe2_hint_ours',
        subscription_details: {
          metadata: { purpose: 'plan_subscription', salonId: 's_fe2_hint_ours', billingOfferKey: 'starter_2026_08_monthly' },
        },
        lines: { data: [subLine(1_780_000_000, 1_780_000_000 + 30 * 24 * 3600)] },
      });
      const response = await post(event);

      expect(response.status).toBe(500);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('failed_retryable');
      expect(row!.lastError).toBe('SUBSCRIPTION_NOT_PROJECTED');
      // The snapshot Stripe already put in the event body IS the answer — the
      // classification fetch is never made.
      expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();
    });

    it('a marked subscription whose salon is ANOTHER deployment\'s is foreign, not a retry to poison (X2)', async () => {
      stripeMock.subscriptions.retrieve.mockResolvedValueOnce({
        id: 'sub_fe2_other_estate',
        // Stamped by this very same code, in another deployment sharing the
        // Stripe account: `purpose` alone cannot separate the two.
        metadata: { purpose: 'plan_subscription', salonId: 's_fe2_other_estate' },
      });
      const event = stripeEvent('invoice.payment_succeeded', {
        id: 'in_fe2_other_estate',
        subscription: 'sub_fe2_other_estate',
        lines: { data: [subLine(1_780_000_000, 1_780_000_000 + 30 * 24 * 3600)] },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('ignored_foreign');
      expect(row!.lastError).toBe('FOREIGN_INVOICE');
      expect(stripeMock.subscriptions.retrieve).toHaveBeenCalledTimes(1);
    });

    it('a charge.refunded whose INVOICE Stripe reports missing is foreign, not a 500', async () => {
      stripeMock.invoices.retrieve.mockRejectedValueOnce(resourceMissing('No such invoice: in_fe2_refund_missing'));
      const event = stripeEvent('charge.refunded', {
        id: 'ch_fe2_refund_missing',
        invoice: 'in_fe2_refund_missing',
        amount: 10000,
        amount_refunded: 10000,
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('ignored_foreign');
      expect(row!.lastError).toBe('FOREIGN_CHARGE');
      expect(row!.salonId).toBeNull();
      expect(sentryHolder.captureMessage).not.toHaveBeenCalled();
    });

    it('a refund.updated whose CHARGE Stripe reports missing is foreign, not a 500', async () => {
      stripeMock.charges.retrieve.mockRejectedValueOnce(resourceMissing('No such charge: ch_fe2_refund_updated'));
      const event = stripeEvent('refund.updated', {
        id: 're_fe2_missing',
        charge: 'ch_fe2_refund_updated',
        status: 'succeeded',
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('ignored_foreign');
      expect(row!.lastError).toBe('FOREIGN_CHARGE');
    });
  });

  describe('FE-5 — the optional deployment marker (X2/X3)', () => {
    /** A subscription this deployment already projected, before any marker existed. */
    async function seedPriorSubscription(salonId: string, stripeSubscriptionId: string, paidThrough = new Date('2027-09-01T10:00:00.000Z')) {
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
    }

    it('a session with NO luster_deployment is foreign once a marker is configured — zero Stripe calls', async () => {
      envHolder.BILLING_DEPLOYMENT_MARKER = 'preview-a';
      const event = stripeEvent('checkout.session.completed', {
        id: 'cs_fe5_unstamped',
        payment_status: 'paid',
        metadata: { purpose: 'sms_topup', salonId: 's_fe5_local' },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('ignored_foreign');
      expect(row!.lastError).toBe('FOREIGN_DEPLOYMENT');
      expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
    });

    it('a subscription stamped for ANOTHER deployment is foreign, with zero Stripe calls and no row', async () => {
      envHolder.BILLING_DEPLOYMENT_MARKER = 'preview-a';
      await db.insert(schema.salonSchema).values({ id: 's_fe5_marker', name: 's', slug: 's-fe5-marker' });
      const event = stripeEvent('customer.subscription.created', {
        id: 'sub_fe5_other_deployment',
        customer: 'cus_fe5',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: 1_780_000_000,
        metadata: {
          purpose: 'plan_subscription',
          salonId: 's_fe5_marker',
          billingOfferKey: 'starter_2026_08_monthly',
          luster_deployment: 'preview-b',
        },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('ignored_foreign');
      expect(row!.lastError).toBe('FOREIGN_DEPLOYMENT');
      expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();

      const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_fe5_other_deployment'));

      expect(subscription).toBeUndefined();
    });

    it('an invoice snapshot stamped for another deployment is foreign, with zero Stripe calls', async () => {
      envHolder.BILLING_DEPLOYMENT_MARKER = 'preview-a';
      const event = stripeEvent('invoice.payment_succeeded', {
        id: 'in_fe5_other_deployment',
        subscription: 'sub_fe5_invoice',
        subscription_details: {
          metadata: { purpose: 'plan_subscription', salonId: 's_fe5_marker', luster_deployment: 'preview-b' },
        },
        lines: { data: [subLine(1_780_000_000, 1_780_000_000 + 30 * 24 * 3600)] },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('ignored_foreign');
      expect(row!.lastError).toBe('FOREIGN_DEPLOYMENT');
      expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();
    });

    /**
     * The marker is stamped at CREATION (PR-3), so on the day it is first
     * configured every object already in flight carries none. A locally
     * stored row is proof this deployment created and projected the object,
     * and must outrank the marker — otherwise setting the variable would
     * silently stop projecting existing paying subscribers' renewals.
     */
    it('a LOCAL subscription row outranks an ABSENT marker', async () => {
      envHolder.BILLING_DEPLOYMENT_MARKER = 'preview-a';
      await seedPriorSubscription('s_fe5_prior', 'sub_fe5_prior');
      const event = stripeEvent('customer.subscription.updated', {
        id: 'sub_fe5_prior',
        customer: 'cus_s_fe5_prior',
        status: 'past_due',
        cancel_at_period_end: false,
        current_period_start: 1_780_000_000,
        // Created before the marker existed: no luster_deployment at all.
        metadata: { purpose: 'plan_subscription', salonId: 's_fe5_prior', billingOfferKey: 'pro_2026_08_annual' },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('processed');
      expect(row!.salonId).toBe('s_fe5_prior');

      const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_fe5_prior'));

      expect(subscription!.status).toBe('past_due');
    });

    it('a LOCAL subscription row outranks a DIFFERENT marker on an invoice too', async () => {
      envHolder.BILLING_DEPLOYMENT_MARKER = 'preview-a';
      await seedPriorSubscription('s_fe5_prior_inv', 'sub_fe5_prior_inv', new Date('2026-09-01T10:00:00.000Z'));
      const periodEnd = Math.floor(new Date('2027-09-01T10:00:00.000Z').getTime() / 1000);
      const event = stripeEvent('invoice.payment_succeeded', {
        id: 'in_fe5_prior',
        subscription: 'sub_fe5_prior_inv',
        subscription_details: {
          metadata: { purpose: 'plan_subscription', salonId: 's_fe5_prior_inv', luster_deployment: 'preview-b' },
        },
        lines: { data: [subLine(1_780_000_000, periodEnd)] },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('processed');
      expect(row!.salonId).toBe('s_fe5_prior_inv');
    });

    it('with NO local row and an absent marker it is still FOREIGN_DEPLOYMENT (the rule only relaxes for rows we hold)', async () => {
      envHolder.BILLING_DEPLOYMENT_MARKER = 'preview-a';
      const event = stripeEvent('customer.subscription.updated', {
        id: 'sub_fe5_no_row',
        customer: 'cus_fe5_no_row',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: 1_780_000_000,
        metadata: { purpose: 'plan_subscription', salonId: 's_fe5_no_row', billingOfferKey: 'starter_2026_08_monthly' },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('ignored_foreign');
      expect(row!.lastError).toBe('FOREIGN_DEPLOYMENT');
      expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();
    });

    it('a bound checkout ATTEMPT outranks an absent marker on a session event', async () => {
      envHolder.BILLING_DEPLOYMENT_MARKER = 'preview-a';
      await db.insert(schema.salonSchema).values({ id: 's_fe5_attempt', name: 's', slug: 's-fe5-attempt' });
      await db.insert(schema.billingCheckoutAttemptSchema).values({
        id: 'att_fe5',
        salonId: 's_fe5_attempt',
        purpose: 'plan_subscription',
        billingOfferKey: 'starter_2026_08_monthly',
        status: 'checkout_created',
        stripeIdempotencyKey: 'idem_fe5',
        stripeCheckoutSessionId: 'cs_fe5_attempt',
        expiresAt: new Date(Date.now() + 3600_000),
      });
      const event = stripeEvent('checkout.session.completed', {
        id: 'cs_fe5_attempt',
        payment_status: 'paid',
        metadata: { purpose: 'plan_subscription', salonId: 's_fe5_attempt' },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('processed');
      expect(row!.salonId).toBe('s_fe5_attempt');
    });

    it('an EQUAL marker processes exactly as it does with the marker unset', async () => {
      envHolder.BILLING_DEPLOYMENT_MARKER = 'preview-a';
      await db.insert(schema.salonSchema).values({ id: 's_fe5_equal', name: 's', slug: 's-fe5-equal' });
      const event = stripeEvent('customer.subscription.created', {
        id: 'sub_fe5_equal',
        customer: 'cus_fe5_equal',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: 1_780_000_000,
        metadata: {
          purpose: 'plan_subscription',
          salonId: 's_fe5_equal',
          billingOfferKey: 'starter_2026_08_monthly',
          luster_deployment: 'preview-a',
        },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('processed');

      const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_fe5_equal'));

      expect(subscription!.salonId).toBe('s_fe5_equal');
    });
  });

  describe('FE-3 — a marked subscription for a salon that is not local', () => {
    it('is terminally foreign: no held_anomaly, no Sentry, no row, no FK error', async () => {
      const event = stripeEvent('customer.subscription.created', {
        id: 'sub_fe3_not_local',
        customer: 'cus_fe3',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: 1_780_000_000,
        metadata: {
          purpose: 'plan_subscription',
          salonId: 's_fe3_another_deployment',
          billingOfferKey: 'starter_2026_08_monthly',
        },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('ignored_foreign');
      expect(row!.lastError).toBe('FOREIGN_SALON');
      expect(row!.attempts).toBe(1);
      expect(row!.salonId).toBeNull();
      expect(sentryHolder.captureMessage).not.toHaveBeenCalled();

      const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_fe3_not_local'));

      expect(subscription).toBeUndefined();
    });
  });

  describe('FE-4 / Y12 — the livemode gate', () => {
    it('answers 503 MODE_INDETERMINATE and writes NOTHING when the two legs disagree', async () => {
      livemodeHolder.expected = { ok: false, code: 'MODE_INDETERMINATE' };
      const event = stripeEvent('customer.subscription.created', {
        id: 'sub_y12_indeterminate',
        customer: 'cus_y12',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: 1_780_000_000,
        metadata: { purpose: 'plan_subscription', salonId: 's_y12', billingOfferKey: 'starter_2026_08_monthly' },
      });
      const response = await post(event);

      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe('MODE_INDETERMINATE');
      expect((await eventRows()).filter(entry => entry.eventId === event.id)).toHaveLength(0);
      expect(sentryHolder.captureMessage).toHaveBeenCalledWith(
        'billing.livemode_indeterminate',
        expect.objectContaining({ level: 'error' }),
      );
    });

    it('alerts at most ONCE per ten-minute window, then again after it', async () => {
      const nowSpy = vi.spyOn(Date, 'now');
      try {
        // Far enough past any earlier alert in this file that the first call
        // here always opens a fresh window, whatever order the suite ran in.
        const t0 = 4_000_000_000_000;
        nowSpy.mockReturnValue(t0);
        await post(stripeEvent('invoice.payment_failed', { id: 'in_y12_a', subscription: 'sub_y12_a' }, { livemode: true }));

        expect(sentryHolder.captureMessage).toHaveBeenCalledTimes(1);
        expect(sentryHolder.captureMessage).toHaveBeenLastCalledWith(
          'billing.livemode_mismatch',
          expect.objectContaining({
            level: 'error',
            extra: expect.objectContaining({ eventLivemode: true, expectedLivemode: false }),
          }),
        );

        // A second mismatch five minutes later: the fault is standing, not
        // per-event, so it must not page again.
        nowSpy.mockReturnValue(t0 + 5 * 60 * 1000);
        await post(stripeEvent('invoice.payment_failed', { id: 'in_y12_b', subscription: 'sub_y12_b' }, { livemode: true }));

        expect(sentryHolder.captureMessage).toHaveBeenCalledTimes(1);

        // Past the window: the condition is still live, so it pages again.
        nowSpy.mockReturnValue(t0 + 11 * 60 * 1000);
        await post(stripeEvent('invoice.payment_failed', { id: 'in_y12_c', subscription: 'sub_y12_c' }, { livemode: true }));

        expect(sentryHolder.captureMessage).toHaveBeenCalledTimes(2);
      } finally {
        nowSpy.mockRestore();
      }

      // Every mismatched delivery is still parked terminally, alert or not.
      const parked = (await eventRows()).filter(entry => ['in_y12_a', 'in_y12_b', 'in_y12_c']
        .includes(entry.invoiceId ?? ''));

      expect(parked).toHaveLength(3);
      expect(parked.every(entry => entry.status === 'ignored_livemode_mismatch')).toBe(true);
    });

    it('once the configuration is corrected, the SAME event id is reclaimed and processes', async () => {
      await db.insert(schema.salonSchema).values({ id: 's_y12_reclaim', name: 's', slug: 's-y12-reclaim' });
      const event = stripeEvent('customer.subscription.created', {
        id: 'sub_y12_reclaim',
        customer: 'cus_y12_reclaim',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: 1_780_000_000,
        metadata: { purpose: 'plan_subscription', salonId: 's_y12_reclaim', billingOfferKey: 'starter_2026_08_monthly' },
      }, { livemode: true });

      // Delivery 1 — this deployment expects test mode; the event is live.
      const mismatched = await post(event);

      expect((await mismatched.json()).ignored).toBe('livemode_mismatch');

      // The rate-limit test above pinned Date.now() to the year 2096 and left
      // a timestamp behind in the route module. `vi.resetModules()` in
      // beforeEach clears it, so this mismatch alerts on its own merits — if
      // that isolation ever regresses, this assertion fails rather than the
      // suppression going unnoticed.
      expect(sentryHolder.captureMessage).toHaveBeenCalledWith(
        'billing.livemode_mismatch',
        expect.objectContaining({ level: 'error' }),
      );

      const [parked] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(parked!.status).toBe('ignored_livemode_mismatch');
      expect(parked!.attempts).toBe(0);

      // The operator fixes the endpoint secret / key pairing; Stripe
      // redelivers the very same event id.
      livemodeHolder.expected = { ok: true, livemode: true };
      const redelivery = await post(event);

      expect(redelivery.status).toBe(200);
      expect((await redelivery.json()).outcome).toBe('processed');

      const [reclaimed] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(reclaimed!.status).toBe('processed');
      expect(reclaimed!.attempts).toBe(1);
      expect(reclaimed!.salonId).toBe('s_y12_reclaim');

      const [subscription] = await db.select().from(schema.billingSubscriptionSchema)
        .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_y12_reclaim'));

      expect(subscription!.salonId).toBe('s_y12_reclaim');
    });
  });

  describe('§2.3 item 4 — salon attribution on processed event rows', () => {
    it('attributes the subscription and its paid invoice to the local salon', async () => {
      await db.insert(schema.salonSchema).values({ id: 's_attr_route', name: 's', slug: 's-attr-route' });
      const createdAt = Math.floor((Date.now() - 5 * 24 * 3600_000) / 1000);
      const subscriptionEvent = stripeEvent('customer.subscription.created', {
        id: 'sub_attr_route',
        customer: 'cus_attr_route',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: createdAt,
        metadata: { purpose: 'plan_subscription', salonId: 's_attr_route', billingOfferKey: 'starter_2026_08_monthly' },
      });
      await post(subscriptionEvent);

      const [subscriptionRow] = (await eventRows()).filter(entry => entry.eventId === subscriptionEvent.id);

      expect(subscriptionRow!.status).toBe('processed');
      expect(subscriptionRow!.salonId).toBe('s_attr_route');

      const invoiceEvent = stripeEvent('invoice.payment_succeeded', {
        id: 'in_attr_route',
        subscription: 'sub_attr_route',
        lines: { data: [subLine(createdAt, createdAt + 35 * 24 * 3600)] },
      });
      await post(invoiceEvent);

      const [invoiceRow] = (await eventRows()).filter(entry => entry.eventId === invoiceEvent.id);

      expect(invoiceRow!.status).toBe('processed');
      expect(invoiceRow!.salonId).toBe('s_attr_route');
    });

    it('attributes a fulfilled top-up to its purchase salon', async () => {
      await db.insert(schema.salonSchema).values({ id: 's_attr_topup', name: 's', slug: 's-attr-topup' });
      await db.insert(schema.smsCreditAccountSchema).values({ salonId: 's_attr_topup' });
      await db.insert(schema.smsTopupPurchaseSchema).values({
        id: 'stp_attr_topup',
        salonId: 's_attr_topup',
        topupOfferKey: 'topup_100_paid_2026_08',
        credits: 100,
        amountCents: 599,
        status: 'checkout_created',
        stripeCheckoutSessionId: 'cs_attr_topup',
      });
      stripeMock.checkout.sessions.retrieve.mockResolvedValue({
        id: 'cs_attr_topup',
        amount_total: 599,
        currency: 'cad',
        metadata: { salonId: 's_attr_topup', purchaseId: 'stp_attr_topup' },
        // No price id: the G02 reverse lookup is all-placeholder before
        // activation, and its once-per-process "unconfigured" notice is not
        // what this test is about.
        line_items: { data: [] },
      });
      const event = stripeEvent('checkout.session.completed', {
        id: 'cs_attr_topup',
        payment_status: 'paid',
        payment_intent: 'pi_attr_topup',
        metadata: { purpose: 'sms_topup', salonId: 's_attr_topup' },
      });
      const response = await post(event);

      expect(response.status).toBe(200);

      const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

      expect(row!.status).toBe('processed');
      expect(row!.salonId).toBe('s_attr_topup');
    });
  });
});
