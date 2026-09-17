/**
 * Owner-facing billing display helper — LG-6 (Rev 2.3 §5 companion, D19c).
 *
 * Real PGlite + the shipped migrations, because the whole point of the helper
 * is a SQL predicate that must not drift from the usage route's
 * (`admin/salon/communications/usage/route.ts`) or from the partial unique
 * index `billing_subscription_live_salon_uniq`. A mocked query builder would
 * assert nothing about either.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { resolveSalonBillingDisplay } from './salonBillingDisplay';

vi.mock('server-only', () => ({}));

let db: ReturnType<typeof drizzle<typeof schema>>;

type SalonColumns = {
  id: string;
  billingMode: string | null;
  stripeSubscriptionStatus: string | null;
};

async function seedSalon(
  id: string,
  billingMode: string | null,
  stripeSubscriptionStatus: string | null = null,
): Promise<SalonColumns> {
  await db.insert(schema.salonSchema).values({
    id,
    name: `Salon ${id}`,
    slug: `salon-${id}`,
    billingMode,
    stripeSubscriptionStatus,
  });
  return { id, billingMode, stripeSubscriptionStatus };
}

async function seedSubscription(options: {
  salonId: string;
  suffix: string;
  status: schema.BillingSubscriptionStatus;
  updatedAt: Date;
}) {
  await db.insert(schema.billingSubscriptionSchema).values({
    id: `bsub_${options.salonId}_${options.suffix}`,
    salonId: options.salonId,
    stripeSubscriptionId: `sub_${options.salonId}_${options.suffix}`,
    stripeCustomerId: `cus_${options.salonId}`,
    planDefinitionKey: 'starter_2026_08',
    billingOfferKey: 'starter_2026_08_monthly',
    billingCadence: 'monthly',
    status: options.status,
    paidThrough: new Date('2026-10-16T00:00:00Z'),
    creditCycleAnchor: new Date('2026-09-16T00:00:00Z'),
    updatedAt: options.updatedAt,
  });
}

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
});

describe('LG-6 — a live billing_subscription row wins for display', () => {
  it('derives STRIPE and the row status for a salon whose legacy column still says NONE', async () => {
    const salon = await seedSalon('d_live', 'NONE');
    await seedSubscription({
      salonId: 'd_live',
      suffix: 'a',
      status: 'active',
      updatedAt: new Date('2026-09-01T00:00:00Z'),
    });

    await expect(resolveSalonBillingDisplay(db, salon)).resolves.toEqual({
      billingMode: 'STRIPE',
      subscriptionStatus: 'active',
      billingSource: 'billing_subscription',
    });
  });

  it.each<schema.BillingSubscriptionStatus>([
    'trialing',
    'past_due',
    'unpaid',
    'incomplete',
    'paused',
  ])('treats %s as live, exactly like the usage route does', async (status) => {
    const salon = await seedSalon(`d_status_${status}`, 'NONE');
    await seedSubscription({
      salonId: `d_status_${status}`,
      suffix: 'a',
      status,
      updatedAt: new Date('2026-09-01T00:00:00Z'),
    });

    await expect(resolveSalonBillingDisplay(db, salon)).resolves.toEqual({
      billingMode: 'STRIPE',
      subscriptionStatus: status,
      billingSource: 'billing_subscription',
    });
  });

  it('prefers the live row over a MORE RECENTLY updated history row', async () => {
    // Live-ness is the primary sort key; recency only breaks ties within it.
    // Insertion order is deliberately history-first here and live-first below.
    const salon = await seedSalon('d_order_a', 'NONE');
    await seedSubscription({
      salonId: 'd_order_a',
      suffix: 'old',
      status: 'canceled',
      updatedAt: new Date('2026-09-15T00:00:00Z'),
    });
    await seedSubscription({
      salonId: 'd_order_a',
      suffix: 'new',
      status: 'active',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await expect(resolveSalonBillingDisplay(db, salon)).resolves.toEqual({
      billingMode: 'STRIPE',
      subscriptionStatus: 'active',
      billingSource: 'billing_subscription',
    });
  });

  it('finds the live row when it was inserted FIRST as well', async () => {
    const salon = await seedSalon('d_order_b', 'NONE');
    await seedSubscription({
      salonId: 'd_order_b',
      suffix: 'live',
      status: 'past_due',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await seedSubscription({
      salonId: 'd_order_b',
      suffix: 'history',
      status: 'incomplete_expired',
      updatedAt: new Date('2026-09-15T00:00:00Z'),
    });

    await expect(resolveSalonBillingDisplay(db, salon)).resolves.toEqual({
      billingMode: 'STRIPE',
      subscriptionStatus: 'past_due',
      billingSource: 'billing_subscription',
    });
  });
});

describe('LG-6 — everything else falls back to the legacy columns, unchanged', () => {
  it('returns the legacy values when the salon has no billing_subscription row at all', async () => {
    const salon = await seedSalon('d_none', 'NONE');

    await expect(resolveSalonBillingDisplay(db, salon)).resolves.toEqual({
      billingMode: 'NONE',
      subscriptionStatus: null,
      billingSource: 'legacy',
    });
  });

  it('keeps a genuine legacy Stripe subscriber on the legacy columns', async () => {
    const salon = await seedSalon('d_legacy_stripe', 'STRIPE', 'active');

    await expect(resolveSalonBillingDisplay(db, salon)).resolves.toEqual({
      billingMode: 'STRIPE',
      subscriptionStatus: 'active',
      billingSource: 'legacy',
    });
  });

  it('suppresses the legacy status when the legacy mode is not STRIPE, exactly as today', async () => {
    // A stale `stripeSubscriptionStatus` left behind on a cash salon must stay
    // invisible — this is today's `billingMode === 'STRIPE' ? … : null`.
    const salon = await seedSalon('d_legacy_stale', 'NONE', 'canceled');

    await expect(resolveSalonBillingDisplay(db, salon)).resolves.toEqual({
      billingMode: 'NONE',
      subscriptionStatus: null,
      billingSource: 'legacy',
    });
  });

  it('treats a canceled-only history row as legacy, not as a live subscription', async () => {
    const salon = await seedSalon('d_canceled', 'NONE');
    await seedSubscription({
      salonId: 'd_canceled',
      suffix: 'a',
      status: 'canceled',
      updatedAt: new Date('2026-09-15T00:00:00Z'),
    });

    await expect(resolveSalonBillingDisplay(db, salon)).resolves.toEqual({
      billingMode: 'NONE',
      subscriptionStatus: null,
      billingSource: 'legacy',
    });
  });

  it('stays legacy across SEVERAL history rows, resolving the tie by recency without promoting it', async () => {
    // Both rows are history, so the recency tiebreak picks the newest and the
    // liveness test still rejects it. (Two LIVE rows cannot coexist: the
    // partial unique index `billing_subscription_live_salon_uniq` forbids it.)
    const salon = await seedSalon('d_history_pair', 'NONE');
    await seedSubscription({
      salonId: 'd_history_pair',
      suffix: 'older',
      status: 'incomplete_expired',
      updatedAt: new Date('2026-02-01T00:00:00Z'),
    });
    await seedSubscription({
      salonId: 'd_history_pair',
      suffix: 'newer',
      status: 'canceled',
      updatedAt: new Date('2026-09-15T00:00:00Z'),
    });

    await expect(resolveSalonBillingDisplay(db, salon)).resolves.toEqual({
      billingMode: 'NONE',
      subscriptionStatus: null,
      billingSource: 'legacy',
    });
  });

  it('never reads another salon\'s subscription', async () => {
    const neighbour = await seedSalon('d_tenant_a', 'NONE');
    await seedSalon('d_tenant_b', 'NONE');
    await seedSubscription({
      salonId: 'd_tenant_b',
      suffix: 'a',
      status: 'active',
      updatedAt: new Date('2026-09-01T00:00:00Z'),
    });

    await expect(resolveSalonBillingDisplay(db, neighbour)).resolves.toEqual({
      billingMode: 'NONE',
      subscriptionStatus: null,
      billingSource: 'legacy',
    });
  });
});
