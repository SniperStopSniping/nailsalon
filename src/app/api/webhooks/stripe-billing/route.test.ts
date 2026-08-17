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
    retrieve: vi.fn(async () => {
      throw new Error('NO_REFETCH_IN_TEST');
    }),
  },
}));
vi.mock('@/libs/stripe', () => ({ stripe: stripeMock }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

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

  it('records and ignores a livemode mismatch without processing', async () => {
    // test-mode deployment receiving a LIVE event.
    const event = stripeEvent('invoice.payment_succeeded', { id: 'in_live' }, { livemode: true });
    const response = await post(event);

    expect((await response.json()).ignored).toBe('livemode_mismatch');

    const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

    expect(row!.status).toBe('ignored_livemode_mismatch');
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

  it('holds subscription-charge refunds and disputes for a human, never guessing at money', async () => {
    const event = stripeEvent('charge.refunded', { id: 'ch_route_1', payment_intent: 'pi_route_1' });
    const response = await post(event);

    expect(response.status).toBe(200);

    const [row] = (await eventRows()).filter(entry => entry.eventId === event.id);

    expect(row!.status).toBe('held_anomaly');
  });
});
