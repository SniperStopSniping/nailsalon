/**
 * Reconciliation route proofs — §8.6/G08/G06/G13 (plan P4). CRON_SECRET-gated
 * and registered in `vercel.json` (P4b, D3); the unconditional payload purge
 * runs before either dark switch; subscription drift repairs only via the idempotent
 * projection functions the webhook itself uses; the held top-up resolver
 * reuses the SAME idempotent transitions; duplicate remote subscriptions are
 * ALERTED, never silently resolved. (The window scheduler route has its own
 * dedicated suite: `src/app/api/billing/windows/evaluate/route.test.ts`.)
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
  BILLING_PLAN_ENV: 'test',
  BILLING_SUBSCRIPTIONS_ENABLED: undefined as string | undefined,
  BILLING_TOPUPS_ENABLED: undefined as string | undefined,
  BILLING_IDENTITY_HMAC_SECRET: undefined,
  BILLING_IDENTITY_HMAC_VERSION: undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

const stripeMock = vi.hoisted(() => ({
  subscriptions: {
    retrieve: vi.fn(),
  },
  // R-2 writer 3 re-checks every invoice whose EFFECTIVE evidence still says
  // "refunded" against its own charge.
  invoices: {
    retrieve: vi.fn(),
  },
  checkout: {
    sessions: { retrieve: vi.fn() },
  },
}));
vi.mock('@/libs/stripe', () => ({ stripe: stripeMock }));
const sentryMessage = vi.hoisted(() => vi.fn());
vi.mock('@sentry/nextjs', () => ({ captureMessage: sentryMessage, captureException: vi.fn() }));

// G02/G08(c): default to the REAL (all-placeholder ⇒ always-null) reverse
// lookup; individual tests override `resolvedOfferKey` to simulate a
// CONFIGURED map. `resolveTopupOfferFromStripePriceId` stays real (also
// always-null pre-activation) — the held-topup tests don't need it configured.
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
  process.env.CRON_SECRET = 'cron_test_secret';
});

beforeEach(async () => {
  envHolder.BILLING_SUBSCRIPTIONS_ENABLED = 'true';
  envHolder.BILLING_TOPUPS_ENABLED = undefined;
  stripeMock.subscriptions.retrieve.mockReset();
  stripeMock.invoices.retrieve.mockReset();
  stripeMock.checkout.sessions.retrieve.mockReset();
  sentryMessage.mockClear();
  priceMapHolder.resolvedOfferKey = null;
  // Full isolation between tests — several of these assert on the ENTIRE
  // table (pagination counts, purge selectivity), so leftover rows from an
  // earlier test would silently corrupt those assertions. `audit_log` is
  // named explicitly: refund EVIDENCE lives there, and a leaked row would
  // change another test's effective state.
  await db.execute(sql`TRUNCATE billing_subscription, salon, billing_checkout_attempt, sms_topup_purchase, sms_credit_ledger, sms_credit_account, billing_stripe_event, audit_log CASCADE`);
});

/**
 * One §6.7 exclusion in its v2 shape, written straight to `audit_log` — the
 * same row `applySubscriptionFullRefund` produces.
 */
async function seedRefundEvidence(input: {
  salonId: string;
  subscriptionRowId: string;
  invoiceId: string;
  start: Date;
  end: Date;
}) {
  await db.insert(schema.auditLogSchema).values({
    id: `al_${input.invoiceId}_${Math.random().toString(36).slice(2)}`,
    salonId: input.salonId,
    actorType: 'webhook',
    actorId: 'stripe-billing',
    action: 'billing_subscription_refund_applied',
    entityType: 'billing_subscription',
    entityId: input.subscriptionRowId,
    metadata: {
      evidenceVersion: 2,
      seq: 1,
      invoiceId: input.invoiceId,
      refundIds: ['re_seeded'],
      eventId: 'evt_seeded',
      refundedPeriodStart: input.start.toISOString(),
      refundedPeriodEnd: input.end.toISOString(),
    },
  });
}

const call = async (secret = 'cron_test_secret') => {
  const { POST } = await import('./route');
  return POST(new Request('http://localhost/api/billing/reconcile', {
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : {},
  }));
};

let counter = 0;
function nextIds() {
  counter += 1;
  return { salonId: `s_rec_${counter}`, subId: `sub_rec_${counter}` };
}

async function seedSubscription(
  salonId: string,
  subId: string,
  overrides: Partial<{
    status: string;
    billingOfferKey: string;
    planDefinitionKey: string;
    pendingOfferKey: string | null;
    paidThrough: Date;
    anchor: Date;
  }> = {},
) {
  await db.insert(schema.salonSchema).values({ id: salonId, name: salonId, slug: salonId });
  const anchor = overrides.anchor ?? new Date(Date.now() - 5 * 24 * 3600_000);
  await db.insert(schema.billingSubscriptionSchema).values({
    id: `bsub_${subId}`,
    salonId,
    stripeSubscriptionId: subId,
    stripeCustomerId: `cus_${subId}`,
    planDefinitionKey: overrides.planDefinitionKey ?? 'pro_2026_08',
    billingOfferKey: overrides.billingOfferKey ?? 'pro_2026_08_monthly',
    pendingOfferKey: overrides.pendingOfferKey ?? null,
    billingCadence: 'monthly',
    status: (overrides.status ?? 'active') as never,
    paidThrough: overrides.paidThrough ?? new Date(Date.now() + 30 * 24 * 3600_000),
    creditCycleAnchor: anchor,
  });
  return anchor;
}

/**
 * A realistic Stripe subscription line item. R-6 filters on `type` and
 * `proration`, so a bare `{ period }` stub is no longer coverage — a
 * renewal's proration line must never be mistaken for the period the
 * invoice actually paid for.
 */
function subLine(start: number, end: number) {
  return { type: 'subscription', proration: false, subscription: null, period: { start, end } };
}

function remoteSubscription(over: {
  id: string;
  customer?: string;
  status?: string;
  cancelAtPeriodEnd?: boolean;
  anchor: Date;
  salonId: string;
  billingOfferKey?: string;
  priceId?: string | null;
  latestInvoice?: {
    id?: string;
    status: string;
    paid?: boolean;
    periodStartUnix?: number;
    periodEndUnix: number;
    hasMore?: boolean;
  } | null;
}) {
  const invoice = over.latestInvoice;
  return {
    id: over.id,
    customer: over.customer ?? `cus_${over.id}`,
    status: over.status ?? 'active',
    cancel_at_period_end: over.cancelAtPeriodEnd ?? false,
    current_period_start: Math.floor(over.anchor.getTime() / 1000),
    metadata: { purpose: 'plan_subscription', salonId: over.salonId, billingOfferKey: over.billingOfferKey ?? 'pro_2026_08_monthly' },
    items: over.priceId !== undefined ? { data: over.priceId === null ? [] : [{ price: { id: over.priceId } }] } : undefined,
    latest_invoice: invoice
      ? {
          id: invoice.id ?? `in_${over.id}`,
          status: invoice.status,
          paid: invoice.paid ?? (invoice.status === 'paid'),
          lines: {
            has_more: invoice.hasMore ?? false,
            data: [subLine(
              invoice.periodStartUnix ?? invoice.periodEndUnix - 30 * 24 * 3600,
              invoice.periodEndUnix,
            )],
          },
        }
      : null,
  };
}

describe('reconciliation route (§8.6, P4)', () => {
  it('rejects without the cron secret', async () => {
    const response = await call('');

    expect(response.status).toBe(401);
  });

  it('both switches unset ⇒ 200 skipped, no Stripe call, and the purge still runs', async () => {
    envHolder.BILLING_SUBSCRIPTIONS_ENABLED = undefined;
    envHolder.BILLING_TOPUPS_ENABLED = undefined;
    await db.insert(schema.billingStripeEventSchema).values([
      {
        id: 'bse_dark_past',
        eventId: 'evt_dark_past',
        eventType: 'invoice.payment_succeeded',
        livemode: false,
        apiCreatedAt: new Date(),
        status: 'processed',
        rawPayload: { a: 1 },
        payloadPurgeAfter: new Date(Date.now() - 1000),
      },
      {
        id: 'bse_dark_future',
        eventId: 'evt_dark_future',
        eventType: 'invoice.payment_succeeded',
        livemode: false,
        apiCreatedAt: new Date(),
        status: 'processed',
        rawPayload: { a: 2 },
        payloadPurgeAfter: new Date(Date.now() + 100_000),
      },
    ]);

    const response = await call();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ skipped: 'BILLING_DISABLED', purged: 1 });
    expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });

  it('purges only rows past payload_purge_after', async () => {
    envHolder.BILLING_SUBSCRIPTIONS_ENABLED = undefined;
    envHolder.BILLING_TOPUPS_ENABLED = undefined;
    await db.insert(schema.billingStripeEventSchema).values([
      {
        id: 'bse_purge_past',
        eventId: 'evt_purge_past',
        eventType: 'invoice.payment_succeeded',
        livemode: false,
        apiCreatedAt: new Date(),
        status: 'processed',
        rawPayload: { a: 1 },
        payloadPurgeAfter: new Date(Date.now() - 1000),
      },
      {
        id: 'bse_purge_future',
        eventId: 'evt_purge_future',
        eventType: 'invoice.payment_succeeded',
        livemode: false,
        apiCreatedAt: new Date(),
        status: 'processed',
        rawPayload: { a: 2 },
        payloadPurgeAfter: new Date(Date.now() + 100_000),
      },
    ]);

    await call();

    const [past] = await db.select().from(schema.billingStripeEventSchema)
      .where(eq(schema.billingStripeEventSchema.id, 'bse_purge_past'));
    const [future] = await db.select().from(schema.billingStripeEventSchema)
      .where(eq(schema.billingStripeEventSchema.id, 'bse_purge_future'));

    expect(past!.rawPayload).toBeNull();
    expect(future!.rawPayload).toEqual({ a: 2 });
  });

  it('reports drift and repairs ONLY via the idempotent projection', async () => {
    const { salonId, subId } = nextIds();
    const anchor = await seedSubscription(salonId, subId);
    stripeMock.subscriptions.retrieve.mockResolvedValue(
      remoteSubscription({ id: subId, salonId, anchor, status: 'past_due' }), // remote moved; local says active
    );
    const response = await call();
    const body = await response.json();
    const entry = body.summary.drift.find((item: { stripeSubscriptionId: string }) => item.stripeSubscriptionId === subId);

    expect(entry).toMatchObject({ field: 'status', local: 'active', remote: 'past_due', repaired: true });

    const [row] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

    expect(row!.status).toBe('past_due');
  });

  it('an unretrievable remote subscription is reported, never repaired blindly', async () => {
    const { salonId, subId } = nextIds();
    await seedSubscription(salonId, subId);
    stripeMock.subscriptions.retrieve.mockRejectedValue(new Error('No such subscription'));
    const response = await call();
    const body = await response.json();
    const entry = body.summary.drift.find((item: { stripeSubscriptionId: string }) => item.stripeSubscriptionId === subId);

    expect(entry).toMatchObject({ field: 'existence', remote: 'UNRETRIEVABLE', repaired: false });
  });

  it('paid_through lag is detected and repaired via applyInvoicePaymentSucceeded', async () => {
    const { salonId, subId } = nextIds();
    const anchor = await seedSubscription(salonId, subId, { paidThrough: new Date() });
    const remotePeriodEndUnix = Math.floor((Date.now() + 40 * 24 * 3600_000) / 1000);
    stripeMock.subscriptions.retrieve.mockResolvedValue(remoteSubscription({
      id: subId,
      salonId,
      anchor,
      latestInvoice: { status: 'paid', periodEndUnix: remotePeriodEndUnix },
    }));

    const response = await call();
    const body = await response.json();
    const entry = body.summary.drift.find((item: { field: string }) => item.field === 'paid_through_behind');

    expect(entry).toMatchObject({ stripeSubscriptionId: subId, repaired: true });

    const [row] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

    expect(row!.paidThrough.getTime()).toBe(remotePeriodEndUnix * 1000);
  });

  it('paid_through ahead of the remote paid invoice is reported only, never lowered', async () => {
    const { salonId, subId } = nextIds();
    const localPaidThrough = new Date(Date.now() + 60 * 24 * 3600_000);
    const anchor = await seedSubscription(salonId, subId, { paidThrough: localPaidThrough });
    const remotePeriodEndUnix = Math.floor((Date.now() + 10 * 24 * 3600_000) / 1000);
    stripeMock.subscriptions.retrieve.mockResolvedValue(remoteSubscription({
      id: subId,
      salonId,
      anchor,
      latestInvoice: { status: 'paid', periodEndUnix: remotePeriodEndUnix },
    }));

    const response = await call();
    const body = await response.json();
    const entry = body.summary.drift.find((item: { field: string }) => item.field === 'paid_through_ahead');

    expect(entry).toMatchObject({ stripeSubscriptionId: subId, repaired: false });

    const [row] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

    expect(row!.paidThrough.getTime()).toBe(localPaidThrough.getTime());
  });

  it('a stuck pending downgrade whose price Stripe already bills is detected and repaired', async () => {
    const { salonId, subId } = nextIds();
    const anchor = await seedSubscription(salonId, subId, {
      billingOfferKey: 'pro_2026_08_monthly',
      planDefinitionKey: 'pro_2026_08',
      pendingOfferKey: 'starter_2026_08_monthly',
    });
    priceMapHolder.resolvedOfferKey = 'starter_2026_08_monthly';
    stripeMock.subscriptions.retrieve.mockResolvedValue(remoteSubscription({
      id: subId,
      salonId,
      anchor,
      billingOfferKey: 'pro_2026_08_monthly',
      priceId: 'price_starter_stub',
    }));

    const response = await call();
    const body = await response.json();
    const entry = body.summary.drift.find((item: { field: string }) => item.field === 'pending_offer_applied_remotely');

    expect(entry).toMatchObject({
      stripeSubscriptionId: subId,
      local: 'starter_2026_08_monthly',
      remote: 'starter_2026_08_monthly',
      repaired: true,
    });
    expect(body.summary.drift.some((item: { field: string }) => item.field === 'offer_mismatch')).toBe(false);

    const [row] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

    expect(row!.billingOfferKey).toBe('starter_2026_08_monthly');
    expect(row!.planDefinitionKey).toBe('starter_2026_08');
    expect(row!.pendingOfferKey).toBeNull();
  });

  it('offer mismatch is reported when the reverse lookup is configured and disagrees', async () => {
    const { salonId, subId } = nextIds();
    const anchor = await seedSubscription(salonId, subId, { billingOfferKey: 'pro_2026_08_monthly' });
    priceMapHolder.resolvedOfferKey = 'elite_2026_08_monthly';
    stripeMock.subscriptions.retrieve.mockResolvedValue(remoteSubscription({
      id: subId,
      salonId,
      anchor,
      billingOfferKey: 'pro_2026_08_monthly',
      priceId: 'price_elite_stub',
    }));

    const response = await call();
    const body = await response.json();
    const entry = body.summary.drift.find((item: { field: string }) => item.field === 'offer_mismatch');

    expect(entry).toMatchObject({
      stripeSubscriptionId: subId,
      local: 'pro_2026_08_monthly',
      remote: 'elite_2026_08_monthly',
      repaired: false,
    });
  });

  it('offer mismatch is skipped silently when the reverse lookup is unconfigured', async () => {
    const { salonId, subId } = nextIds();
    const anchor = await seedSubscription(salonId, subId, { billingOfferKey: 'pro_2026_08_monthly' });
    priceMapHolder.resolvedOfferKey = null; // unconfigured (the real default pre-activation)
    stripeMock.subscriptions.retrieve.mockResolvedValue(remoteSubscription({
      id: subId,
      salonId,
      anchor,
      billingOfferKey: 'pro_2026_08_monthly',
      priceId: 'price_unrecognized_stub',
    }));

    const response = await call();
    const body = await response.json();

    expect(body.summary.drift.some((item: { field: string }) => item.field === 'offer_mismatch')).toBe(false);
  });

  it('alerts on duplicate remote subscriptions instead of choosing one', async () => {
    const first = nextIds();
    const second = nextIds();
    const sharedCustomer = 'cus_shared_duplicate';
    const anchor1 = await seedSubscription(first.salonId, first.subId);
    const anchor2 = await seedSubscription(second.salonId, second.subId);
    stripeMock.subscriptions.retrieve.mockImplementation(async (id: string) => remoteSubscription({
      id,
      salonId: id === first.subId ? first.salonId : second.salonId,
      anchor: id === first.subId ? anchor1 : anchor2,
      customer: sharedCustomer,
    }));

    const response = await call();
    const body = await response.json();

    expect(body.summary.duplicateRemoteCustomers).toBeGreaterThanOrEqual(1);
    expect(sentryMessage).toHaveBeenCalledWith('billing.duplicate_remote_subscriptions', expect.objectContaining({
      level: 'error',
      extra: expect.objectContaining({ customers: expect.arrayContaining([sharedCustomer]) }),
    }));
  });

  it('cursor-paginates by id ascending in batches of 100 until drained (seeds 250)', async () => {
    const total = 250;
    const anchor = new Date(Date.now() - 5 * 24 * 3600_000);
    const paidThrough = new Date(Date.now() + 30 * 24 * 3600_000);
    const salons: (typeof schema.salonSchema.$inferInsert)[] = [];
    const subs: (typeof schema.billingSubscriptionSchema.$inferInsert)[] = [];
    for (let i = 0; i < total; i += 1) {
      const { salonId, subId } = nextIds();
      salons.push({ id: salonId, name: salonId, slug: salonId });
      subs.push({
        id: `bsub_${subId}`,
        salonId,
        stripeSubscriptionId: subId,
        stripeCustomerId: `cus_${subId}`,
        planDefinitionKey: 'pro_2026_08',
        billingOfferKey: 'pro_2026_08_monthly',
        billingCadence: 'monthly',
        status: 'active',
        paidThrough,
        creditCycleAnchor: anchor,
      });
    }
    await db.insert(schema.salonSchema).values(salons);
    await db.insert(schema.billingSubscriptionSchema).values(subs);
    stripeMock.subscriptions.retrieve.mockImplementation(async (id: string) => {
      const salonId = subs.find(s => s.stripeSubscriptionId === id)!.salonId;
      return remoteSubscription({ id, salonId, anchor });
    });

    const response = await call();
    const body = await response.json();

    expect(stripeMock.subscriptions.retrieve).toHaveBeenCalledTimes(total);
    expect(body.summary.checked).toBe(total);
  }, 30_000);

  it('topups-only configuration (subscriptions unset, topups set) still resolves a held purchase', async () => {
    envHolder.BILLING_SUBSCRIPTIONS_ENABLED = undefined;
    envHolder.BILLING_TOPUPS_ENABLED = 'true';
    const salonId = 's_rec_topup_only';
    await db.insert(schema.salonSchema).values({ id: salonId, name: salonId, slug: salonId });
    await db.insert(schema.billingCheckoutAttemptSchema).values({
      id: 'bca_rec_topup_only',
      salonId,
      purpose: 'sms_topup',
      topupOfferKey: 'topup_100_paid_2026_08',
      status: 'checkout_created',
      stripeIdempotencyKey: 'billing-attempt:bca_rec_topup_only',
      stripeCheckoutSessionId: 'cs_rec_topup_only',
      expiresAt: new Date(Date.now() - 60_000),
    });
    await db.insert(schema.smsTopupPurchaseSchema).values({
      id: 'stp_rec_topup_only',
      salonId,
      topupOfferKey: 'topup_100_paid_2026_08',
      credits: 100,
      amountCents: 599,
      currency: 'cad',
      status: 'checkout_created',
      stripeCheckoutSessionId: 'cs_rec_topup_only',
    });
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_rec_topup_only',
      payment_status: 'paid',
      status: 'complete',
      amount_total: 599,
      currency: 'cad',
      metadata: { salonId, purchaseId: 'stp_rec_topup_only', attemptId: 'bca_rec_topup_only' },
      payment_intent: 'pi_rec_topup_only',
      line_items: { data: [] },
    });

    const response = await call();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.topups).toMatchObject({ examined: 1, fulfilled: 1 });
    expect(body.summary).toBeUndefined();
    expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();

    const [purchase] = await db.select().from(schema.smsTopupPurchaseSchema)
      .where(eq(schema.smsTopupPurchaseSchema.id, 'stp_rec_topup_only'));

    expect(purchase!.status).toBe('fulfilled');
  });

  // RT-14 (reconcile half) — R-5: a paid invoice ahead of local coverage
  // extends paid_through, but must NEVER flap a terminated subscription back
  // to 'active'. Reconcile runs hourly, so a status flap here would be a
  // permanently self-reviving cancellation.
  it('extends paid_through for a CANCELED subscription without resurrecting it', async () => {
    const { salonId, subId } = nextIds();
    const localPaidThrough = new Date();
    const anchor = await seedSubscription(salonId, subId, {
      status: 'canceled',
      paidThrough: localPaidThrough,
    });
    const remotePeriodEndUnix = Math.floor((Date.now() + 40 * 24 * 3600_000) / 1000);
    stripeMock.subscriptions.retrieve.mockResolvedValue(remoteSubscription({
      id: subId,
      salonId,
      anchor,
      status: 'canceled',
      latestInvoice: { status: 'paid', periodEndUnix: remotePeriodEndUnix },
    }));

    const response = await call();
    const body = await response.json();

    expect(body.summary.drift.some((item: { field: string }) => item.field === 'status')).toBe(false);
    expect(body.summary.drift.find((item: { field: string }) => item.field === 'paid_through_behind'))
      .toMatchObject({ stripeSubscriptionId: subId, repaired: true });

    const [row] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

    expect(row!.status).toBe('canceled');
    expect(row!.paidThrough.getTime()).toBe(remotePeriodEndUnix * 1000);
  });

  // RT-15 — the two comparisons reconcile must DECLINE to make, reported as
  // notes so they are visible without polluting the drift budget.
  it('reports a refunded latest invoice as a NOTE, never as paid_through drift', async () => {
    const { salonId, subId } = nextIds();
    const localPaidThrough = new Date(Date.now() - 10 * 24 * 3600_000);
    const anchor = await seedSubscription(salonId, subId, { paidThrough: localPaidThrough });
    const periodStartUnix = Math.floor((Date.now() - 10 * 24 * 3600_000) / 1000);
    const periodEndUnix = Math.floor((Date.now() + 20 * 24 * 3600_000) / 1000);
    await seedRefundEvidence({
      salonId,
      subscriptionRowId: `bsub_${subId}`,
      invoiceId: `in_${subId}`,
      start: new Date(periodStartUnix * 1000),
      end: new Date(periodEndUnix * 1000),
    });
    stripeMock.subscriptions.retrieve.mockResolvedValue(remoteSubscription({
      id: subId,
      salonId,
      anchor,
      latestInvoice: { status: 'paid', periodStartUnix, periodEndUnix },
    }));
    // The safety net re-checks the charge: still fully refunded ⇒ no void.
    stripeMock.invoices.retrieve.mockResolvedValue({
      id: `in_${subId}`,
      charge: { amount: 10000, amount_refunded: 10000 },
    });

    const response = await call();
    const body = await response.json();

    expect(body.summary.drift.some((item: { field: string }) => item.field === 'paid_through_behind')).toBe(false);
    expect(body.summary.notes.find((item: { field: string }) => item.field === 'paid_through_refunded_invoice'))
      .toMatchObject({ stripeSubscriptionId: subId, repaired: false });

    const [row] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

    expect(row!.paidThrough.getTime()).toBe(localPaidThrough.getTime());
  });

  it('reports a truncated invoice line set as paid_through_uncomparable instead of inventing drift', async () => {
    const { salonId, subId } = nextIds();
    const localPaidThrough = new Date();
    const anchor = await seedSubscription(salonId, subId, { paidThrough: localPaidThrough });
    stripeMock.subscriptions.retrieve.mockResolvedValue(remoteSubscription({
      id: subId,
      salonId,
      anchor,
      latestInvoice: {
        status: 'paid',
        periodEndUnix: Math.floor((Date.now() + 40 * 24 * 3600_000) / 1000),
        hasMore: true,
      },
    }));

    const response = await call();
    const body = await response.json();

    expect(body.summary.notes.find((item: { field: string }) => item.field === 'paid_through_uncomparable'))
      .toMatchObject({ stripeSubscriptionId: subId, remote: 'LINES_TRUNCATED', repaired: false });
    expect(body.summary.drift.some((item: { field: string }) => ['paid_through_behind', 'paid_through_ahead'].includes(item.field))).toBe(false);

    const [row] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

    expect(row!.paidThrough.getTime()).toBe(localPaidThrough.getTime());
  });

  // RT-16 (Y7) — a parked downgrade applies on the REMOTE PRICE as evidence.
  // It used to be forced through a no-advancing applyInvoicePaymentSucceeded,
  // which made the repair depend on the latest invoice's status and periods:
  // an open invoice whose line starts AFTER local paid_through produced
  // INVALID_PAID_PERIOD and the parked offer stayed stuck forever.
  it('clears a parked downgrade even when the latest invoice is open/unpaid, leaving paid_through untouched', async () => {
    const { salonId, subId } = nextIds();
    const localPaidThrough = new Date(Date.now() + 10 * 24 * 3600_000);
    const anchor = await seedSubscription(salonId, subId, {
      billingOfferKey: 'pro_2026_08_monthly',
      planDefinitionKey: 'pro_2026_08',
      pendingOfferKey: 'starter_2026_08_monthly',
      paidThrough: localPaidThrough,
    });
    priceMapHolder.resolvedOfferKey = 'starter_2026_08_monthly';
    stripeMock.subscriptions.retrieve.mockResolvedValue(remoteSubscription({
      id: subId,
      salonId,
      anchor,
      billingOfferKey: 'pro_2026_08_monthly',
      priceId: 'price_starter_stub',
      latestInvoice: {
        status: 'open',
        paid: false,
        // Starts AFTER local paid_through — the exact shape that used to
        // abort the repair with INVALID_PAID_PERIOD.
        periodStartUnix: Math.floor((localPaidThrough.getTime() + 24 * 3600_000) / 1000),
        periodEndUnix: Math.floor((localPaidThrough.getTime() + 31 * 24 * 3600_000) / 1000),
      },
    }));

    const response = await call();
    const body = await response.json();

    expect(body.summary.drift.find((item: { field: string }) => item.field === 'pending_offer_applied_remotely'))
      .toMatchObject({ stripeSubscriptionId: subId, repaired: true });

    const [row] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

    expect(row!.billingOfferKey).toBe('starter_2026_08_monthly');
    expect(row!.planDefinitionKey).toBe('starter_2026_08');
    expect(row!.pendingOfferKey).toBeNull();
    expect(row!.paidThrough.getTime()).toBe(localPaidThrough.getTime());
  });

  // RT-6c — R-2 writer 3. The webhook may never deliver the reversal (the
  // endpoint could have been down, or dark); the hourly pass is the backstop
  // that stops retracted evidence from suppressing a paying salon forever.
  it('voids refund evidence whose charge is no longer fully refunded, and restores coverage', async () => {
    const { salonId, subId } = nextIds();
    const periodStart = new Date(Date.now() - 20 * 24 * 3600_000);
    const periodEnd = new Date(Date.now() + 20 * 24 * 3600_000);
    const anchor = await seedSubscription(salonId, subId, { paidThrough: periodStart });
    await seedRefundEvidence({
      salonId,
      subscriptionRowId: `bsub_${subId}`,
      invoiceId: 'in_rt6c',
      start: periodStart,
      end: periodEnd,
    });
    stripeMock.subscriptions.retrieve.mockResolvedValue(
      remoteSubscription({ id: subId, salonId, anchor, latestInvoice: null }),
    );
    stripeMock.invoices.retrieve.mockResolvedValue({
      id: 'in_rt6c',
      charge: { amount: 10000, amount_refunded: 0 }, // the refund failed
    });

    const response = await call();
    const body = await response.json();

    expect(stripeMock.invoices.retrieve).toHaveBeenCalledWith('in_rt6c', { expand: ['charge'] });
    expect(body.summary.notes.find((item: { field: string }) => item.field === 'refund_evidence_voided'))
      .toMatchObject({ stripeSubscriptionId: subId, local: 'in_rt6c', remote: '0/10000', repaired: true });
    expect(sentryMessage).toHaveBeenCalledWith('billing.subscription_refund_voided', expect.objectContaining({
      level: 'warning',
      extra: expect.objectContaining({
        source: 'reconcile',
        stripeSubscriptionId: subId,
        invoiceId: 'in_rt6c',
        observedAmountRefunded: 0,
        observedAmount: 10000,
        reapplied: true,
      }),
    }));

    const [row] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subId));

    expect(row!.paidThrough.getTime()).toBe(periodEnd.getTime());

    const resolutions = (await db.select().from(schema.auditLogSchema))
      .filter(auditRow => auditRow.action === 'billing_subscription_refund_evidence_resolved');

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toMatchObject({ actorType: 'system', actorId: 'billing-reconcile' });
    expect(resolutions[0]!.metadata).toMatchObject({ invoiceId: 'in_rt6c', resolution: 'void', reason: 'refund_reversed:reconcile' });
  });

  it('records an unverifiable invoice as a note and keeps reconciling the rest of the estate', async () => {
    const first = nextIds();
    const second = nextIds();
    const paidThrough = new Date(Date.now() + 30 * 24 * 3600_000);
    const anchor1 = await seedSubscription(first.salonId, first.subId, { paidThrough });
    const anchor2 = await seedSubscription(second.salonId, second.subId, { paidThrough });
    await seedRefundEvidence({
      salonId: first.salonId,
      subscriptionRowId: `bsub_${first.subId}`,
      invoiceId: 'in_unverifiable',
      start: new Date(Date.now() - 40 * 24 * 3600_000),
      end: new Date(Date.now() - 10 * 24 * 3600_000),
    });
    stripeMock.subscriptions.retrieve.mockImplementation(async (id: string) => remoteSubscription({
      id,
      salonId: id === first.subId ? first.salonId : second.salonId,
      anchor: id === first.subId ? anchor1 : anchor2,
      latestInvoice: null,
    }));
    stripeMock.invoices.retrieve.mockRejectedValue(new Error('No such invoice'));

    const response = await call();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary.checked).toBe(2);
    expect(body.summary.notes.find((item: { field: string }) => item.field === 'refund_evidence_unverifiable'))
      .toMatchObject({ stripeSubscriptionId: first.subId, local: 'in_unverifiable', remote: 'UNRETRIEVABLE', repaired: false });

    const resolutions = (await db.select().from(schema.auditLogSchema))
      .filter(auditRow => auditRow.action === 'billing_subscription_refund_evidence_resolved');

    expect(resolutions).toHaveLength(0);
  });
});
