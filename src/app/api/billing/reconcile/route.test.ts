/**
 * Reconciliation + scheduler route proofs — §8.6/§8.8. Both are
 * CRON_SECRET-gated and cron-unregistered; the reconciler additionally
 * fails closed while billing is dark, repairs only via the idempotent
 * projection, and ALERTS duplicate remote subscriptions instead of choosing.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
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
  BILLING_IDENTITY_HMAC_SECRET: undefined,
  BILLING_IDENTITY_HMAC_VERSION: undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

const stripeMock = vi.hoisted(() => ({
  subscriptions: {
    retrieve: vi.fn(),
  },
}));
vi.mock('@/libs/stripe', () => ({ stripe: stripeMock }));
const sentryMessage = vi.hoisted(() => vi.fn());
vi.mock('@sentry/nextjs', () => ({ captureMessage: sentryMessage, captureException: vi.fn() }));

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
  process.env.CRON_SECRET = 'cron_test_secret';
});

beforeEach(() => {
  envHolder.BILLING_SUBSCRIPTIONS_ENABLED = 'true';
  stripeMock.subscriptions.retrieve.mockReset();
});

const call = async (module: string, secret = 'cron_test_secret') => {
  const { POST } = await import(module);
  return POST(new Request('http://localhost/api/billing/x', {
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : {},
  }));
};

async function seedSubscription(salonId: string, subId: string, status = 'active') {
  await db.insert(schema.salonSchema).values({ id: salonId, name: salonId, slug: salonId });
  const anchor = new Date(Date.now() - 5 * 24 * 3600_000);
  await db.insert(schema.billingSubscriptionSchema).values({
    id: `bsub_${subId}`,
    salonId,
    stripeSubscriptionId: subId,
    stripeCustomerId: `cus_${subId}`,
    planDefinitionKey: 'pro_2026_08',
    billingOfferKey: 'pro_2026_08_monthly',
    billingCadence: 'monthly',
    status: status as never,
    paidThrough: new Date(Date.now() + 30 * 24 * 3600_000),
    creditCycleAnchor: anchor,
  });
  return anchor;
}

describe('window scheduler route (§8.8)', () => {
  it('rejects without the cron secret', async () => {
    const response = await call('../windows/evaluate/route', '');

    expect(response.status).toBe(401);
  });

  it('evaluates due subscriptions and grants covered windows via the engine', async () => {
    await seedSubscription('s_sched1', 'sub_sched1');
    const response = await call('../windows/evaluate/route');
    const body = await response.json();

    expect(body.summary.evaluated).toBeGreaterThanOrEqual(1);
    expect(body.summary.granted).toBeGreaterThanOrEqual(1);
  });
});

describe('reconciliation route (§8.6)', () => {
  it('fails closed while billing is dark — zero provider traffic', async () => {
    envHolder.BILLING_SUBSCRIPTIONS_ENABLED = undefined;
    const response = await call('./route');

    expect(response.status).toBe(503);
    expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it('reports drift and repairs ONLY via the idempotent projection', async () => {
    const anchor = await seedSubscription('s_rec1', 'sub_rec1');
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_rec1',
      customer: 'cus_sub_rec1',
      status: 'past_due', // remote moved; local says active
      cancel_at_period_end: false,
      current_period_start: Math.floor(anchor.getTime() / 1000),
      metadata: { purpose: 'plan_subscription', salonId: 's_rec1', billingOfferKey: 'pro_2026_08_monthly' },
    });
    const response = await call('./route');
    const body = await response.json();
    const entry = body.summary.drift.find((item: { stripeSubscriptionId: string }) => item.stripeSubscriptionId === 'sub_rec1');

    expect(entry).toMatchObject({ field: 'status', local: 'active', remote: 'past_due', repaired: true });

    const [row] = await db.select().from(schema.billingSubscriptionSchema)
      .where(eq(schema.billingSubscriptionSchema.stripeSubscriptionId, 'sub_rec1'));

    expect(row!.status).toBe('past_due');
  });

  it('an unretrievable remote subscription is reported, never repaired blindly', async () => {
    await seedSubscription('s_rec2', 'sub_rec2');
    stripeMock.subscriptions.retrieve.mockRejectedValue(new Error('No such subscription'));
    const response = await call('./route');
    const body = await response.json();
    const entry = body.summary.drift.find((item: { stripeSubscriptionId: string }) => item.stripeSubscriptionId === 'sub_rec2');

    expect(entry).toMatchObject({ field: 'existence', remote: 'UNRETRIEVABLE', repaired: false });
  });
});
