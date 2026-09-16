/**
 * Subscription refund exclusions under a real PostgreSQL transaction pool.
 *
 * This suite is deliberately opt-in: it needs a disposable local database.
 * It verifies the refund evidence that prevents reconciliation from reviving
 * paid entitlement, rather than merely asserting a mocked projection call.
 */
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

/** Real secret for a real signature: the route verifies it with real stripe-node. */
const WEBHOOK_SECRET = vi.hoisted(() => 'whsec_billing_refund_concurrency');

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));

const envHolder = vi.hoisted(() => ({
  BILLING_PLAN_ENV: 'test',
  BILLING_SUBSCRIPTIONS_ENABLED: 'true' as string | undefined,
  BILLING_TOPUPS_ENABLED: undefined as string | undefined,
  STRIPE_BILLING_WEBHOOK_SECRET: WEBHOOK_SECRET as string | undefined,
  BILLING_IDENTITY_HMAC_SECRET: undefined,
  BILLING_IDENTITY_HMAC_VERSION: undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

// The webhook and reconcile routes are driven for real in this suite, so the
// Stripe seam carries every call they make: `webhooks.constructEvent` is
// delegated to the REAL stripe-node verifier in beforeAll (see `signedPost`),
// so webhook tests here cross a genuine HMAC boundary rather than a stub.
const stripeMock = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn() },
  invoices: { retrieve: vi.fn(), listLineItems: vi.fn() },
  charges: { retrieve: vi.fn() },
  checkout: { sessions: { retrieve: vi.fn() } },
  webhooks: { constructEvent: vi.fn() },
}));
vi.mock('@/libs/stripe', () => ({ stripe: stripeMock }));
const sentryHolder = vi.hoisted(() => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => sentryHolder);

const rawUrl = process.env.CONCURRENCY_TEST_DATABASE_URL ?? '';
let parsed: URL | null = null;
try {
  parsed = rawUrl ? new URL(rawUrl) : null;
} catch {
  parsed = null;
}
const disposable = parsed !== null
  && ['localhost', '127.0.0.1'].includes(parsed.hostname)
  && decodeURIComponent(parsed.pathname).replace(/^\//, '').length > 0
  && !rawUrl.includes('neon.tech')
  && (process.env.SMS_CREDIT_LEDGER_DISPOSABLE_DATABASE_CONFIRMED === 'true'
    || process.env.BILLING_REFUND_DISPOSABLE_DATABASE_CONFIRMED === 'true');
const suite = disposable ? describe : describe.skip;

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
// Key is never used for a network call; only the webhook signer/verifier is.
const signingStripe = new Stripe('sk_test_billing_refund_concurrency', { apiVersion: '2024-06-20' });

/**
 * Zero-skip proof: this suite must never silently degrade to a skip in CI.
 * The count is asserted in afterAll and grepped for by the workflow step.
 */
const EXPECTED_EXECUTED_TESTS = 16;
let executedTests = 0;

const day = 86_400_000;
const anchor = new Date('2030-01-01T00:00:00.000Z');
const periodEnd = new Date('2030-02-01T00:00:00.000Z');

suite('subscription refund exclusions — real PostgreSQL', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: rawUrl, max: 12, application_name: 'billing-refund-regression' });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    holder.db = db;
    process.env.CRON_SECRET = 'refund-regression-cron-secret';
    // A genuine HMAC boundary: the route's constructEvent is the real one.
    stripeMock.webhooks.constructEvent.mockImplementation(
      (body: string, signature: string, secret: string) =>
        signingStripe.webhooks.constructEvent(body, signature, secret),
    );
  });

  beforeEach(async () => {
    stripeMock.subscriptions.retrieve.mockReset();
    stripeMock.checkout.sessions.retrieve.mockReset();
    stripeMock.invoices.retrieve.mockReset();
    stripeMock.invoices.listLineItems.mockReset();
    stripeMock.charges.retrieve.mockReset();
    sentryHolder.captureMessage.mockClear();
    sentryHolder.captureException.mockClear();
    envHolder.BILLING_SUBSCRIPTIONS_ENABLED = 'true';
    envHolder.BILLING_PLAN_ENV = 'test';
    envHolder.STRIPE_BILLING_WEBHOOK_SECRET = WEBHOOK_SECRET;
    // billing_stripe_event has no FK to salon, so the salon cascade below
    // cannot clear webhook claims: an un-truncated event id would dedupe a
    // later test's delivery into a silent no-op.
    await pool.query('TRUNCATE salon CASCADE');
    await pool.query('TRUNCATE billing_stripe_event CASCADE');
  });

  afterAll(async () => {
    await pool?.end();

    expect(executedTests).toBe(EXPECTED_EXECUTED_TESTS);

    process.stdout.write(
      `BILLING_REFUND_POSTGRES_TESTS_EXECUTED=${executedTests} BILLING_REFUND_POSTGRES_TESTS_SKIPPED=0\n`,
    );
  });

  async function seed(salonId = 'refund_s1', subscriptionId = 'sub_refund_s1') {
    await db.insert(schema.salonSchema).values({ id: salonId, name: salonId, slug: salonId });
    await db.insert(schema.billingSubscriptionSchema).values({
      id: `bsub_${subscriptionId}`,
      salonId,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: `cus_${subscriptionId}`,
      planDefinitionKey: 'starter_2026_08',
      billingOfferKey: 'starter_2026_08_monthly',
      billingCadence: 'monthly',
      status: 'active',
      paidThrough: anchor,
      creditCycleAnchor: anchor,
    });
    return `bsub_${subscriptionId}`;
  }

  async function payment(subscriptionId: string, invoiceId = 'in_refund_1', start = anchor, end = periodEnd) {
    const { applyInvoicePaymentSucceeded } = await import('./billingSubscriptionProjection');
    return applyInvoicePaymentSucceeded({
      stripeSubscriptionId: subscriptionId,
      invoiceId,
      paidPeriodStart: start,
      paidPeriodEnd: end,
      eventCreated: new Date('2029-12-01T00:00:00.000Z'),
      eventId: `evt_paid_${invoiceId}`,
      now: new Date('2029-12-01T00:00:00.000Z'),
    });
  }

  async function refund(subscriptionId: string, invoiceId = 'in_refund_1', start = anchor, end = periodEnd) {
    const { applySubscriptionFullRefund } = await import('./billingSubscriptionProjection');
    return applySubscriptionFullRefund({
      stripeSubscriptionId: subscriptionId,
      refundId: `re_${invoiceId}`,
      invoiceId,
      refundedPeriodStart: start,
      refundedPeriodEnd: end,
      eventCreated: new Date('2030-01-02T00:00:00.000Z'),
      eventId: `evt_refund_${invoiceId}`,
    });
  }

  function remote(subscriptionId: string, invoiceId = 'in_refund_1', start = anchor, end = periodEnd) {
    return {
      id: subscriptionId,
      customer: `cus_${subscriptionId}`,
      status: 'active',
      cancel_at_period_end: false,
      current_period_start: Math.floor(start.getTime() / 1000),
      metadata: { purpose: 'plan_subscription' },
      items: { data: [] },
      latest_invoice: {
        id: invoiceId,
        status: 'paid',
        paid: true,
        subscription: subscriptionId,
        // A real renewal invoice's coverage is its non-proration SUBSCRIPTION
        // lines; anything less makes the fixture agree with a reader that
        // cannot tell the two apart.
        lines: { has_more: false, data: [line(start, end, { subscription: subscriptionId })] },
      },
    };
  }

  async function reconcile() {
    const { POST } = await import('@/app/api/billing/reconcile/route');
    return POST(new Request('http://localhost/api/billing/reconcile', { method: 'POST', headers: { 'x-cron-secret': 'refund-regression-cron-secret' } }));
  }

  /**
   * A real Stripe-signed delivery: `generateTestHeaderString` produces a real
   * `t=…,v1=<HMAC-SHA256>` header over the exact raw body, and the route
   * verifies it with the real stripe-node verifier wired in beforeAll.
   */
  async function signedPost(event: Record<string, unknown>) {
    const { POST } = await import('@/app/api/webhooks/stripe-billing/route');
    const payload = JSON.stringify(event);
    const signature = signingStripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });
    return POST(new Request('http://localhost/api/webhooks/stripe-billing', {
      method: 'POST',
      body: payload,
      headers: { 'stripe-signature': signature },
    }));
  }

  let webhookEventOrdinal = 0;
  function webhookEvent(type: string, object: Record<string, unknown>, over?: { id?: string; created?: number }) {
    webhookEventOrdinal += 1;
    return {
      id: over?.id ?? `evt_refund_pg_${webhookEventOrdinal}`,
      type,
      livemode: false,
      created: over?.created ?? Math.floor(new Date('2030-01-02T00:00:00.000Z').getTime() / 1000),
      data: { object },
    };
  }

  function line(start: Date, end: Date, over?: Record<string, unknown>) {
    return {
      type: 'subscription',
      proration: false,
      period: { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) },
      ...over,
    };
  }

  /** Audit rows for one subscription, oldest first, with the parsed metadata. */
  async function evidenceRows(bsubId: string) {
    const rows = await db.select({
      id: schema.auditLogSchema.id,
      action: schema.auditLogSchema.action,
      metadata: schema.auditLogSchema.metadata,
      createdAt: schema.auditLogSchema.createdAt,
    })
      .from(schema.auditLogSchema)
      .where(eq(schema.auditLogSchema.entityId, bsubId));
    return rows
      .filter(entry => entry.action.startsWith('billing_subscription_refund_'))
      .map(entry => ({ ...entry, metadata: entry.metadata as Record<string, unknown> }))
      .sort((a, b) => Number(a.metadata.seq ?? 0) - Number(b.metadata.seq ?? 0));
  }

  /** Monthly grant lots for a salon — the money proof behind "granted once". */
  async function monthlyLots(salonId: string) {
    const rows = await db.select({
      amount: schema.smsCreditLedgerSchema.amount,
      key: schema.smsCreditLedgerSchema.idempotencyKey,
      reason: schema.smsCreditLedgerSchema.reason,
    })
      .from(schema.smsCreditLedgerSchema)
      .where(eq(schema.smsCreditLedgerSchema.salonId, salonId));
    return rows.filter(entry => entry.reason === 'monthly_window_grant');
  }

  async function windows(bsubId: string) {
    const rows = await db.select({ index: schema.billingCreditWindowSchema.creditCycleIndex, status: schema.billingCreditWindowSchema.status })
      .from(schema.billingCreditWindowSchema)
      .where(eq(schema.billingCreditWindowSchema.billingSubscriptionId, bsubId));
    return rows.sort((a, b) => a.index - b.index);
  }

  async function row(subscriptionId: string) {
    const [result] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subscriptionId));
    return result!;
  }

  it('payment → full refund → actual reconciliation cannot restore entitlement or grant the refunded window', async () => {
    executedTests += 1;
    const subscriptionId = 'sub_refund_s1';
    const bsubId = await seed();
    await payment(subscriptionId);
    await refund(subscriptionId);
    stripeMock.subscriptions.retrieve.mockResolvedValue(remote(subscriptionId));

    const response = await reconcile();

    expect(response.status).toBe(200);
    expect((await row(subscriptionId)).paidThrough).toEqual(anchor);

    const { evaluateSubscriptionWindows } = await import('./creditGrants');
    const result = await evaluateSubscriptionWindows({ subscriptionId: bsubId, now: new Date(anchor.getTime() + day) });

    expect(result.granted).toBe(0);

    const [window] = await db.select().from(schema.billingCreditWindowSchema)
      .where(eq(schema.billingCreditWindowSchema.billingSubscriptionId, bsubId));

    expect(window!.status).toBe('skipped_unpaid');
  });

  it('delayed invoice evidence for a refunded interval is rejected before it can advance paid_through', async () => {
    executedTests += 1;
    const subscriptionId = 'sub_refund_delayed';
    await seed('refund_delayed', subscriptionId);
    await refund(subscriptionId);
    const result = await payment(subscriptionId);

    expect(result).toEqual({ applied: false, anomaly: 'SUBSCRIPTION_PERIOD_REFUNDED' });
    expect((await row(subscriptionId)).paidThrough).toEqual(anchor);
  });

  it('refund-before-payment races converge to no entitlement and no grant', async () => {
    executedTests += 1;
    const subscriptionId = 'sub_refund_race';
    const bsubId = await seed('refund_race', subscriptionId);
    await Promise.all([payment(subscriptionId), refund(subscriptionId)]);

    expect((await row(subscriptionId)).paidThrough).toEqual(anchor);

    const { evaluateSubscriptionWindows } = await import('./creditGrants');

    expect((await evaluateSubscriptionWindows({ subscriptionId: bsubId, now: new Date(anchor.getTime() + day) })).granted).toBe(0);
  });

  it('concurrent refund and reconciliation cannot restore the refunded invoice coverage', async () => {
    executedTests += 1;
    const subscriptionId = 'sub_refund_reconcile_race';
    await seed('refund_reconcile_race', subscriptionId);
    await payment(subscriptionId);
    stripeMock.subscriptions.retrieve.mockResolvedValue(remote(subscriptionId));
    const [response] = await Promise.all([reconcile(), refund(subscriptionId)]);

    expect(response.status).toBe(200);
    expect((await row(subscriptionId)).paidThrough).toEqual(anchor);
  });

  it('a first out-of-order refund after a later disjoint renewal excludes only the old window', async () => {
    executedTests += 1;
    const subscriptionId = 'sub_refund_renewal';
    const bsubId = await seed('refund_renewal', subscriptionId);
    await payment(subscriptionId);
    const renewalEnd = new Date('2030-03-01T00:00:00.000Z');
    await payment(subscriptionId, 'in_refund_2', periodEnd, renewalEnd);
    await refund(subscriptionId); // invoice 1 refund arrives after invoice 2 paid evidence

    expect((await row(subscriptionId)).paidThrough).toEqual(renewalEnd);

    const { evaluateSubscriptionWindows } = await import('./creditGrants');
    const january = await evaluateSubscriptionWindows({ subscriptionId: bsubId, now: new Date(anchor.getTime() + day) });
    const february = await evaluateSubscriptionWindows({ subscriptionId: bsubId, now: new Date(periodEnd.getTime() + day) });

    expect(january.granted).toBe(0);
    expect(february.granted).toBe(1);

    const windows = await db.select({ index: schema.billingCreditWindowSchema.creditCycleIndex, status: schema.billingCreditWindowSchema.status })
      .from(schema.billingCreditWindowSchema)
      .where(eq(schema.billingCreditWindowSchema.billingSubscriptionId, bsubId));

    expect(windows).toEqual(expect.arrayContaining([
      { index: 0, status: 'skipped_missed' },
      { index: 1, status: 'granted' },
    ]));
    expect(await refund(subscriptionId)).toEqual({ applied: true, lowered: false });
    expect((await row(subscriptionId)).paidThrough).toEqual(renewalEnd);
  });

  it('wrong-tenant refund evidence cannot block another subscription with the same invoice id', async () => {
    executedTests += 1;
    const subscriptionA = 'sub_refund_tenant_a';
    const subscriptionB = 'sub_refund_tenant_b';
    await seed('refund_tenant_a', subscriptionA);
    await seed('refund_tenant_b', subscriptionB);
    await refund(subscriptionA, 'in_shared');

    expect(await payment(subscriptionB, 'in_shared')).toEqual({ applied: true });
    expect((await row(subscriptionB)).paidThrough).toEqual(periodEnd);
  });

  it('a refunded window cannot receive an upgrade diff', async () => {
    executedTests += 1;
    const subscriptionId = 'sub_refund_upgrade';
    const bsubId = await seed('refund_upgrade', subscriptionId);
    await payment(subscriptionId);
    const { evaluateSubscriptionWindows, applyUpgradeDiff } = await import('./creditGrants');

    // Establish the normal granted-window precondition for an upgrade diff.
    expect((await evaluateSubscriptionWindows({ subscriptionId: bsubId, now: new Date(anchor.getTime() + day) })).granted).toBe(1);

    await refund(subscriptionId);

    await expect(db.transaction(tx => applyUpgradeDiff(tx, {
      subscriptionId: bsubId,
      fromPlanKey: 'starter_2026_08',
      toPlanKey: 'pro_2026_08',
      now: new Date(anchor.getTime() + day),
    }))).resolves.toEqual({ granted: 0 });
  });

  it('malformed historical refund evidence fails closed even after webhook payload purge', async () => {
    executedTests += 1;
    const subscriptionId = 'sub_refund_malformed';
    const bsubId = await seed('refund_malformed', subscriptionId);
    await db.insert(schema.auditLogSchema).values({
      id: 'audit_refund_malformed',
      salonId: 'refund_malformed',
      actorType: 'system',
      action: 'billing_subscription_refund_applied',
      entityType: 'billing_subscription',
      entityId: bsubId,
      metadata: { invoiceId: 'in_bad' },
      createdAt: new Date(),
    });
    await db.insert(schema.billingStripeEventSchema).values({
      id: 'stripe_payload_expired',
      eventId: 'evt_payload_expired',
      eventType: 'charge.refunded',
      livemode: false,
      apiCreatedAt: new Date(),
      status: 'processed',
      rawPayload: { private: true },
      payloadPurgeAfter: new Date(0),
    });
    stripeMock.subscriptions.retrieve.mockResolvedValue(remote(subscriptionId));
    await reconcile();
    const raw = await pool.query('SELECT raw_payload FROM billing_stripe_event WHERE id = \'stripe_payload_expired\'');

    expect(raw.rows[0]!.raw_payload).toBeNull();
    expect((await row(subscriptionId)).paidThrough).toEqual(anchor);

    const { evaluateSubscriptionWindows } = await import('./creditGrants');

    expect((await evaluateSubscriptionWindows({ subscriptionId: bsubId, now: new Date(anchor.getTime() + day) })).granted).toBe(0);
  });

  // ───────────────────────── PR-1 §7.6 ─────────────────────────
  // Refund COMPLETION: evidence that can be corrected (void/set) without ever
  // deleting a row, proven against real row locks rather than a single-
  // connection PGlite that cannot serialize two writers at all.

  it('RT-4: a disjoint renewal after a refund applies, and only the refunded window is withheld', async () => {
    executedTests += 1;
    const subscriptionId = 'sub_rt4';
    const bsubId = await seed('refund_rt4', subscriptionId);
    const renewalEnd = new Date('2030-03-01T00:00:00.000Z');
    await refund(subscriptionId, 'in_1', anchor, periodEnd);

    // R-3: the refund is on record, so the renewal's own start is what decides
    // the overlap. The deleted epoch-min default made every renewal overlap.
    const renewal = await payment(subscriptionId, 'in_2', periodEnd, renewalEnd);

    expect(renewal).toEqual({ applied: true });
    expect((await row(subscriptionId)).paidThrough).toEqual(renewalEnd);

    const { evaluateSubscriptionWindows } = await import('./creditGrants');
    const january = await evaluateSubscriptionWindows({ subscriptionId: bsubId, now: new Date(anchor.getTime() + day) });

    expect(january.granted).toBe(0);
    // W0 is refunded, so while it is still the ACTIVE window it is withheld as
    // skipped_unpaid. §6.5's elapsed-window rule later re-labels any ungranted
    // elapsed window skipped_missed — it can never become granted.
    expect(await windows(bsubId)).toEqual([{ index: 0, status: 'skipped_unpaid' }]);

    const february = await evaluateSubscriptionWindows({ subscriptionId: bsubId, now: new Date(periodEnd.getTime() + day) });

    expect(february.granted).toBe(1);
    expect(await windows(bsubId)).toEqual([
      { index: 0, status: 'skipped_missed' },
      { index: 1, status: 'granted' },
    ]);
    expect(await monthlyLots('refund_rt4')).toEqual([
      { amount: 200, key: `monthly-grant:${subscriptionId}:1:starter_2026_08`, reason: 'monthly_window_grant' },
    ]);
  });

  it('RT-6: voiding reversed refund evidence restores coverage, and the window still grants exactly once', async () => {
    executedTests += 1;
    const subscriptionId = 'sub_rt6';
    const bsubId = await seed('refund_rt6', subscriptionId);
    await payment(subscriptionId, 'in_1', anchor, periodEnd);

    const { evaluateSubscriptionWindows } = await import('./creditGrants');

    expect((await evaluateSubscriptionWindows({ subscriptionId: bsubId, now: new Date(anchor.getTime() + day) })).granted).toBe(1);
    expect(await refund(subscriptionId, 'in_1', anchor, periodEnd)).toEqual({ applied: true, lowered: true });
    expect((await row(subscriptionId)).paidThrough).toEqual(anchor);

    const { applySubscriptionRefundVoid } = await import('./billingSubscriptionProjection');
    const reversal = {
      stripeSubscriptionId: subscriptionId,
      invoiceId: 'in_1',
      reason: 'refund_reversed:failed',
      eventId: 'evt_rt6_void',
      observedAmountRefunded: 400,
      observedAmount: 1000,
      now: new Date(anchor.getTime() + 2 * day),
    };
    const voided = await applySubscriptionRefundVoid(reversal);

    expect(voided).toEqual({ applied: true, voided: true, reapplied: true });
    expect((await row(subscriptionId)).paidThrough).toEqual(periodEnd);

    const rows = await evidenceRows(bsubId);

    expect(rows.map(entry => entry.action)).toEqual([
      'billing_subscription_refund_applied',
      'billing_subscription_refund_evidence_resolved',
    ]);
    expect(rows[0]!.metadata).toEqual({
      evidenceVersion: 2,
      seq: 1,
      invoiceId: 'in_1',
      refundIds: ['re_in_1'],
      eventId: 'evt_refund_in_1',
      refundedPeriodStart: anchor.toISOString(),
      refundedPeriodEnd: periodEnd.toISOString(),
    });
    expect(rows[1]!.metadata).toEqual({
      evidenceVersion: 2,
      seq: 2,
      invoiceId: 'in_1',
      resolution: 'void',
      reason: 'refund_reversed:failed',
      eventId: 'evt_rt6_void',
      observedAmountRefunded: 400,
      observedAmount: 1000,
    });

    // A redelivered reversal is a no-op, never an error and never a second row.
    expect(await applySubscriptionRefundVoid(reversal)).toEqual({ applied: true, voided: false, reapplied: false });
    expect(await evidenceRows(bsubId)).toHaveLength(2);
    expect(await monthlyLots('refund_rt6')).toHaveLength(1);
  });

  it('RT-6b: the void is keyed on the invoice, never on which refund identity failed', async () => {
    executedTests += 1;
    const { applySubscriptionFullRefund, applySubscriptionRefundVoid } = await import('./billingSubscriptionProjection');
    const reversalNow = new Date(anchor.getTime() + day);

    // (a) charge.refunds listed the LATER, full refund `re_2` first, so no
    //     single "the refund id" exists to key the correction on.
    const first = 'sub_rt6b_a';
    const firstRow = await seed('refund_rt6b_a', first);
    await payment(first, 'in_1', anchor, periodEnd);
    await applySubscriptionFullRefund({
      stripeSubscriptionId: first,
      invoiceId: 'in_1',
      refundIds: ['re_2', 're_1'],
      refundedPeriodStart: anchor,
      refundedPeriodEnd: periodEnd,
      eventCreated: new Date('2030-01-02T00:00:00.000Z'),
      eventId: 'evt_rt6b_a_full',
      observedAmountRefunded: 1000,
      observedAmount: 1000,
    });

    expect((await evidenceRows(firstRow))[0]!.metadata.refundIds).toEqual(['re_2', 're_1']);
    // The PARTIAL refund `re_1` is the one that later fails.
    expect(await applySubscriptionRefundVoid({
      stripeSubscriptionId: first,
      invoiceId: 'in_1',
      reason: 'refund_reversed:failed',
      eventId: 'evt_rt6b_a_reversal',
      observedAmountRefunded: 600,
      observedAmount: 1000,
      now: reversalNow,
    })).toEqual({ applied: true, voided: true, reapplied: true });
    expect((await row(first)).paidThrough).toEqual(periodEnd);

    // (b) charge.refunds was absent entirely, so the EVENT id stood in as the
    //     refund identity — the correction must still find the evidence.
    const second = 'sub_rt6b_b';
    const secondRow = await seed('refund_rt6b_b', second);
    await payment(second, 'in_1', anchor, periodEnd);
    await applySubscriptionFullRefund({
      stripeSubscriptionId: second,
      invoiceId: 'in_1',
      refundId: 'evt_rt6b_b_full',
      refundedPeriodStart: anchor,
      refundedPeriodEnd: periodEnd,
      eventCreated: new Date('2030-01-02T00:00:00.000Z'),
      eventId: 'evt_rt6b_b_full',
      observedAmountRefunded: 1000,
      observedAmount: 1000,
    });

    expect((await evidenceRows(secondRow))[0]!.metadata.refundIds).toEqual(['evt_rt6b_b_full']);
    expect(await applySubscriptionRefundVoid({
      stripeSubscriptionId: second,
      invoiceId: 'in_1',
      reason: 'refund_reversed:failed',
      observedAmountRefunded: 600,
      observedAmount: 1000,
      now: reversalNow,
    })).toEqual({ applied: true, voided: true, reapplied: true });
    expect((await row(second)).paidThrough).toEqual(periodEnd);
  });

  it('RT-6c: the hourly reconcile safety net voids evidence Stripe no longer backs, and restores coverage', async () => {
    executedTests += 1;
    const subscriptionId = 'sub_rt6c';
    const bsubId = await seed('refund_rt6c', subscriptionId);
    await payment(subscriptionId, 'in_1', anchor, periodEnd);
    await refund(subscriptionId, 'in_1', anchor, periodEnd);

    expect((await row(subscriptionId)).paidThrough).toEqual(anchor);

    stripeMock.subscriptions.retrieve.mockResolvedValue(remote(subscriptionId, 'in_1'));
    // The charge is only PARTIALLY refunded now: the §6.7 exclusion recorded
    // for its invoice must stop applying, even though no webhook ever arrived.
    stripeMock.invoices.retrieve.mockResolvedValue({
      id: 'in_1',
      charge: { id: 'ch_rt6c', amount: 1000, amount_refunded: 400 },
    });

    const response = await reconcile();
    const body = await response.json() as {
      summary: { drift: Array<{ field: string }>; notes: Array<{ field: string }> };
    };

    expect(response.status).toBe(200);
    expect(body.summary.notes.map(note => note.field)).toContain('refund_evidence_voided');
    // A note is informational: the refunded invoice never counts as drift.
    expect(body.summary.drift.map(entry => entry.field)).not.toContain('paid_through_behind');
    expect((await row(subscriptionId)).paidThrough).toEqual(periodEnd);

    const resolutions = (await evidenceRows(bsubId))
      .filter(entry => entry.action === 'billing_subscription_refund_evidence_resolved');

    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]!.metadata).toMatchObject({
      evidenceVersion: 2,
      invoiceId: 'in_1',
      resolution: 'void',
      reason: 'refund_reversed:reconcile',
      observedAmountRefunded: 400,
      observedAmount: 1000,
    });
    expect(sentryHolder.captureMessage).toHaveBeenCalledWith(
      'billing.subscription_refund_voided',
      expect.anything(),
    );
  });

  it('RT-11+: an operator `set` repairs malformed legacy evidence, and a later `void` resumes grants exactly once', async () => {
    executedTests += 1;
    const subscriptionId = 'sub_rt11';
    const salonId = 'refund_rt11';
    const bsubId = await seed(salonId, subscriptionId);
    await payment(subscriptionId, 'in_1', anchor, periodEnd);
    // Legacy v1 evidence: refunded, extent unknown — everything fails closed
    // and, before PR-1, nothing could ever reopen it.
    await db.insert(schema.auditLogSchema).values({
      id: 'audit_rt11_legacy',
      salonId,
      actorType: 'system',
      action: 'billing_subscription_refund_applied',
      entityType: 'billing_subscription',
      entityId: bsubId,
      metadata: { invoiceId: 'in_1' },
      createdAt: new Date('2030-01-02T00:00:00.000Z'),
    });

    const { evaluateSubscriptionWindows } = await import('./creditGrants');
    const { applySubscriptionRefundEvidenceResolution, planSubscriptionRefundEvidence } = await import('./billingSubscriptionProjection');
    const scope = { salonId, stripeSubscriptionId: subscriptionId };
    const actor = { actorType: 'super_admin' as const, actorId: 'admin_rt11' };

    expect((await evaluateSubscriptionWindows({ subscriptionId: bsubId, now: new Date(anchor.getTime() + day) })).granted).toBe(0);
    expect((await planSubscriptionRefundEvidence(db, scope))!.evidence.incomplete).toBe(true);

    const set = await applySubscriptionRefundEvidenceResolution({
      ...scope,
      invoiceId: 'in_1',
      resolution: 'set',
      periodStart: anchor,
      periodEnd,
      reason: 'INV-A10: authoritative coverage for legacy evidence',
      actor,
    });

    expect(set).toEqual({ applied: true, seq: 1, lowered: true });

    const repaired = (await planSubscriptionRefundEvidence(db, scope))!;

    expect(repaired.evidence.incomplete).toBe(false);
    expect(repaired.evidence.refunds).toEqual([{ invoiceId: 'in_1', start: anchor, end: periodEnd }]);
    expect(repaired.evidence.appliedInvoiceIds).toEqual(['in_1']);
    expect(repaired.paidThrough).toEqual(anchor);
    // Bounded evidence still excludes its own window — repair is not amnesty.
    expect((await evaluateSubscriptionWindows({ subscriptionId: bsubId, now: new Date(anchor.getTime() + day) })).granted).toBe(0);
    expect(await monthlyLots(salonId)).toHaveLength(0);

    const reversal = {
      ...scope,
      invoiceId: 'in_1',
      resolution: 'void' as const,
      reason: 'INV-A8: the charge was never refunded',
      actor,
      now: new Date(anchor.getTime() + 2 * day),
    };
    const voided = await applySubscriptionRefundEvidenceResolution(reversal);

    expect(voided).toEqual({ applied: true, reapplied: true });
    expect((await row(subscriptionId)).paidThrough).toEqual(periodEnd);
    expect(await monthlyLots(salonId)).toHaveLength(1);

    // Nothing left to void is not an error, and never grants a second time.
    expect(await applySubscriptionRefundEvidenceResolution(reversal)).toEqual({ applied: false, reapplied: false });
    expect(await monthlyLots(salonId)).toHaveLength(1);
    expect(await evidenceRows(bsubId)).toHaveLength(3);
  });

  it('RT-17: a renewal invoice carrying a proration line from the refunded cycle is applied on its subscription line only', async () => {
    executedTests += 1;
    const subscriptionId = 'sub_rt17';
    const bsubId = await seed('refund_rt17', subscriptionId);
    const midJanuary = new Date('2030-01-15T00:00:00.000Z');
    const renewalEnd = new Date('2030-03-01T00:00:00.000Z');
    await refund(subscriptionId, 'in_1', anchor, periodEnd);

    const response = await signedPost(webhookEvent('invoice.payment_succeeded', {
      id: 'in_2',
      subscription: subscriptionId,
      lines: {
        has_more: false,
        data: [
          // A proration credit for the REFUNDED cycle. Counting it as coverage
          // drags the paid period back into the refund and holds the renewal.
          line(midJanuary, periodEnd, { proration: true, subscription: subscriptionId }),
          line(periodEnd, renewalEnd, { subscription: subscriptionId }),
        ],
      },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, outcome: 'processed' });
    expect((await row(subscriptionId)).paidThrough).toEqual(renewalEnd);

    const { evaluateSubscriptionWindows } = await import('./creditGrants');

    expect((await evaluateSubscriptionWindows({ subscriptionId: bsubId, now: new Date(anchor.getTime() + day) })).granted).toBe(0);
    expect(await windows(bsubId)).toEqual([{ index: 0, status: 'skipped_unpaid' }]);
    expect((await evaluateSubscriptionWindows({ subscriptionId: bsubId, now: new Date(periodEnd.getTime() + day) })).granted).toBe(1);
    expect(await windows(bsubId)).toEqual([
      { index: 0, status: 'skipped_missed' },
      { index: 1, status: 'granted' },
    ]);
    expect(await monthlyLots('refund_rt17')).toHaveLength(1);
  });

  it('RT-18: a concurrent void and set for one invoice serialize into two rows, and the highest seq wins', async () => {
    executedTests += 1;
    const subscriptionId = 'sub_rt18';
    const salonId = 'refund_rt18';
    const bsubId = await seed(salonId, subscriptionId);
    await payment(subscriptionId, 'in_1', anchor, periodEnd);
    await refund(subscriptionId, 'in_1', anchor, periodEnd);

    const {
      applySubscriptionRefundEvidenceResolution,
      applySubscriptionRefundVoid,
      planSubscriptionRefundEvidence,
    } = await import('./billingSubscriptionProjection');
    const repairEnd = new Date('2030-01-20T00:00:00.000Z');
    const now = new Date(anchor.getTime() + 2 * day);

    await Promise.all([
      applySubscriptionRefundVoid({
        stripeSubscriptionId: subscriptionId,
        invoiceId: 'in_1',
        reason: 'refund_reversed:race',
        observedAmountRefunded: 400,
        observedAmount: 1000,
        now,
      }),
      applySubscriptionRefundEvidenceResolution({
        salonId,
        stripeSubscriptionId: subscriptionId,
        invoiceId: 'in_1',
        resolution: 'set',
        periodStart: anchor,
        periodEnd: repairEnd,
        reason: 'operator repair racing the reversal',
        actor: { actorType: 'super_admin', actorId: 'admin_rt18' },
        now,
      }),
    ]);

    const rows = await evidenceRows(bsubId);
    const resolutions = rows.filter(entry => entry.action === 'billing_subscription_refund_evidence_resolved');

    // Both corrections land — the lock serializes them, it never drops one.
    expect(rows).toHaveLength(3);
    expect(resolutions.map(entry => entry.metadata.seq)).toEqual([2, 3]);
    expect(new Set(resolutions.map(entry => entry.metadata.resolution))).toEqual(new Set(['void', 'set']));

    // Whichever order the lock granted, the EFFECTIVE state is the highest seq
    // — never the later clock, and never the later row id.
    const winner = resolutions[1]!;
    const plan = (await planSubscriptionRefundEvidence(db, { salonId, stripeSubscriptionId: subscriptionId }))!;

    expect(plan.evidence.incomplete).toBe(false);
    expect(plan.evidence.nextSeq).toBe(4);

    if (winner.metadata.resolution === 'void') {
      expect(plan.evidence.appliedInvoiceIds).toEqual([]);
      expect(plan.evidence.refunds).toEqual([]);
    } else {
      expect(plan.evidence.appliedInvoiceIds).toEqual(['in_1']);
      expect(plan.evidence.refunds).toEqual([{ invoiceId: 'in_1', start: anchor, end: repairEnd }]);
    }
  });

  it('RT-19: a void racing a replayed full-refund event converges on one consistent live state', async () => {
    executedTests += 1;
    const subscriptionId = 'sub_rt19';
    const salonId = 'refund_rt19';
    const bsubId = await seed(salonId, subscriptionId);
    await payment(subscriptionId, 'in_1', anchor, periodEnd);

    const { evaluateSubscriptionWindows } = await import('./creditGrants');

    expect((await evaluateSubscriptionWindows({ subscriptionId: bsubId, now: new Date(anchor.getTime() + day) })).granted).toBe(1);

    await refund(subscriptionId, 'in_1', anchor, periodEnd);

    const {
      applySubscriptionFullRefund,
      applySubscriptionRefundVoid,
      planSubscriptionRefundEvidence,
    } = await import('./billingSubscriptionProjection');
    const now = new Date(anchor.getTime() + 2 * day);

    // One delivery says the charge is no longer fully refunded; a redelivery
    // of the original event says it still is. Both arrive at once.
    await Promise.all([
      applySubscriptionRefundVoid({
        stripeSubscriptionId: subscriptionId,
        invoiceId: 'in_1',
        reason: 'refund_reversed:failed',
        eventId: 'evt_rt19_void',
        observedAmountRefunded: 400,
        observedAmount: 1000,
        now,
      }),
      applySubscriptionFullRefund({
        stripeSubscriptionId: subscriptionId,
        invoiceId: 'in_1',
        refundIds: ['re_2'],
        refundedPeriodStart: anchor,
        refundedPeriodEnd: periodEnd,
        eventCreated: new Date('2030-01-02T00:00:00.000Z'),
        eventId: 'evt_rt19_replay',
        observedAmountRefunded: 1000,
        observedAmount: 1000,
        now,
      }),
    ]);

    const rows = await evidenceRows(bsubId);
    const applied = rows.filter(entry => entry.action === 'billing_subscription_refund_applied');
    const resolutions = rows.filter(entry => entry.action === 'billing_subscription_refund_evidence_resolved');

    expect(resolutions).toHaveLength(1);
    expect(applied.length).toBeLessThanOrEqual(2);
    // seq is a total order taken under the row lock: no two rows can share one.
    expect(new Set(rows.map(entry => entry.metadata.seq)).size).toBe(rows.length);

    const winner = rows[rows.length - 1]!;
    const refundedNow = winner.action === 'billing_subscription_refund_applied';
    const plan = (await planSubscriptionRefundEvidence(db, { salonId, stripeSubscriptionId: subscriptionId }))!;

    expect(plan.evidence.incomplete).toBe(false);
    // At most ONE live applied row: the effective state is the max-seq row.
    expect(plan.evidence.appliedInvoiceIds).toEqual(refundedNow ? ['in_1'] : []);
    expect(plan.evidence.refunds).toHaveLength(refundedNow ? 1 : 0);
    // paid_through never disagrees with the live evidence, in either order.
    expect((await row(subscriptionId)).paidThrough).toEqual(refundedNow ? anchor : periodEnd);
    // And the money is untouched by the race: W0 was granted exactly once.
    expect(await monthlyLots(salonId)).toHaveLength(1);
  });
});
