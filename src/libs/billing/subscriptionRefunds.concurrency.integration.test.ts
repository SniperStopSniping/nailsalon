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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));

const envHolder = vi.hoisted(() => ({
  BILLING_PLAN_ENV: 'test',
  BILLING_SUBSCRIPTIONS_ENABLED: 'true' as string | undefined,
  BILLING_TOPUPS_ENABLED: undefined as string | undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

const stripeMock = vi.hoisted(() => ({ subscriptions: { retrieve: vi.fn() }, checkout: { sessions: { retrieve: vi.fn() } } }));
vi.mock('@/libs/stripe', () => ({ stripe: stripeMock }));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

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
  });

  beforeEach(async () => {
    stripeMock.subscriptions.retrieve.mockReset();
    stripeMock.checkout.sessions.retrieve.mockReset();
    envHolder.BILLING_SUBSCRIPTIONS_ENABLED = 'true';
    await pool.query('TRUNCATE salon CASCADE');
  });

  afterAll(async () => {
    await pool?.end();
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
        lines: { data: [{ period: { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) } }] },
      },
    };
  }

  async function reconcile() {
    const { POST } = await import('@/app/api/billing/reconcile/route');
    return POST(new Request('http://localhost/api/billing/reconcile', { method: 'POST', headers: { 'x-cron-secret': 'refund-regression-cron-secret' } }));
  }

  async function row(subscriptionId: string) {
    const [result] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, subscriptionId));
    return result!;
  }

  it('payment → full refund → actual reconciliation cannot restore entitlement or grant the refunded window', async () => {
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
    const subscriptionId = 'sub_refund_delayed';
    await seed('refund_delayed', subscriptionId);
    await refund(subscriptionId);
    const result = await payment(subscriptionId);

    expect(result).toEqual({ applied: false, anomaly: 'SUBSCRIPTION_PERIOD_REFUNDED' });
    expect((await row(subscriptionId)).paidThrough).toEqual(anchor);
  });

  it('refund-before-payment races converge to no entitlement and no grant', async () => {
    const subscriptionId = 'sub_refund_race';
    const bsubId = await seed('refund_race', subscriptionId);
    await Promise.all([payment(subscriptionId), refund(subscriptionId)]);

    expect((await row(subscriptionId)).paidThrough).toEqual(anchor);

    const { evaluateSubscriptionWindows } = await import('./creditGrants');

    expect((await evaluateSubscriptionWindows({ subscriptionId: bsubId, now: new Date(anchor.getTime() + day) })).granted).toBe(0);
  });

  it('concurrent refund and reconciliation cannot restore the refunded invoice coverage', async () => {
    const subscriptionId = 'sub_refund_reconcile_race';
    await seed('refund_reconcile_race', subscriptionId);
    await payment(subscriptionId);
    stripeMock.subscriptions.retrieve.mockResolvedValue(remote(subscriptionId));
    const [response] = await Promise.all([reconcile(), refund(subscriptionId)]);

    expect(response.status).toBe(200);
    expect((await row(subscriptionId)).paidThrough).toEqual(anchor);
  });

  it('a first out-of-order refund after a later disjoint renewal excludes only the old window', async () => {
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
    const subscriptionA = 'sub_refund_tenant_a';
    const subscriptionB = 'sub_refund_tenant_b';
    await seed('refund_tenant_a', subscriptionA);
    await seed('refund_tenant_b', subscriptionB);
    await refund(subscriptionA, 'in_shared');

    expect(await payment(subscriptionB, 'in_shared')).toEqual({ applied: true });
    expect((await row(subscriptionB)).paidThrough).toEqual(periodEnd);
  });

  it('a refunded window cannot receive an upgrade diff', async () => {
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
});
