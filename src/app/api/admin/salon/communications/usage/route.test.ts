/**
 * Owner usage API — G18 (§6.5a) proofs. Before P5a this route had no test
 * of its own: the subscription lookup filtered to
 * active/past_due/canceled, so unpaid/incomplete/incomplete_expired/paused
 * silently rendered as "No subscription". This suite proves every status
 * renders the plain-English §6.5a truth, that "several rows" resolution
 * prefers the live row (falling back to the most recently updated one),
 * and that the fields the route already returned are untouched.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
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
  BILLING_SUBSCRIPTIONS_ENABLED: undefined as string | undefined,
  PUBLIC_PRICING_ENABLED: undefined as string | undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

const adminSalonHolder = vi.hoisted(() => ({
  salon: null as { id: string; plan: string | null } | null,
  error: null as Response | null,
}));
vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon: vi.fn(async () => ({ error: adminSalonHolder.error, salon: adminSalonHolder.salon })),
}));
vi.mock('@/libs/rateLimit', () => ({
  checkEndpointRateLimit: () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
  rateLimitResponse: () => new Response('rate limited', { status: 429 }),
}));

// P7: the founding promotion window is null/null (closed) in the committed
// module (§7 — it MUST stay that way). To prove the route's "open ⇒ public
// projection" branch without touching that committed default, only
// `isPromotionWindowOpen` is overridden here; everything else (including the
// promotion math) stays the real module.
const promotionsHolder = vi.hoisted(() => ({ windowOpenOverride: null as boolean | null }));
vi.mock('@/libs/billing/promotions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/billing/promotions')>();
  return {
    ...actual,
    isPromotionWindowOpen: (promotion: Parameters<typeof actual.isPromotionWindowOpen>[0], now: Date) =>
      promotionsHolder.windowOpenOverride ?? actual.isPromotionWindowOpen(promotion, now),
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
  envHolder.BILLING_TOPUPS_ENABLED = undefined;
  envHolder.BILLING_SUBSCRIPTIONS_ENABLED = undefined;
  envHolder.PUBLIC_PRICING_ENABLED = undefined;
  promotionsHolder.windowOpenOverride = null;
  adminSalonHolder.error = null;
  adminSalonHolder.salon = null;
});

let salonCounter = 0;
async function seedSalon(plan: string | null = 'single_salon'): Promise<string> {
  salonCounter += 1;
  const id = `sal_usage_${salonCounter}`;
  await db.insert(schema.salonSchema).values({ id, name: id, slug: id, plan });
  adminSalonHolder.salon = { id, plan };
  return id;
}

let subCounter = 0;
async function seedSubscription(salonId: string, overrides: Partial<{
  status: schema.BillingSubscriptionStatus;
  paidThrough: Date;
  updatedAt: Date;
  cancelAtPeriodEnd: boolean;
  rateProtectedThrough: Date | null;
}> = {}): Promise<string> {
  subCounter += 1;
  const id = `bsub_${subCounter}`;
  const now = new Date();
  await db.insert(schema.billingSubscriptionSchema).values({
    id,
    salonId,
    stripeSubscriptionId: `sub_${id}`,
    stripeCustomerId: `cus_${id}`,
    planDefinitionKey: 'pro_2026_08',
    billingOfferKey: 'pro_2026_08_monthly',
    billingCadence: 'monthly',
    status: overrides.status ?? 'active',
    cancelAtPeriodEnd: overrides.cancelAtPeriodEnd ?? false,
    paidThrough: overrides.paidThrough ?? new Date('2026-10-01T00:00:00.000Z'),
    rateProtectedThrough: overrides.rateProtectedThrough ?? null,
    creditCycleAnchor: now,
    createdAt: now,
    updatedAt: overrides.updatedAt ?? now,
  });
  return id;
}

async function getUsage(salonSlug = 'slug-ignored-by-mock') {
  const { GET } = await import('./route');
  return GET(new (await import('next/server')).NextRequest(
    `http://localhost/api/admin/salon/communications/usage?salonSlug=${salonSlug}`,
  ));
}

describe('no subscription', () => {
  it('renders plan: null when the salon has no billing_subscription row', async () => {
    await seedSalon('free');
    const response = await getUsage();

    expect(response.status).toBe(200);

    const body = await response.json();

    expect(body.data.usage.plan).toBeNull();
  });
});

describe('subscription status truth (G18/§6.5a)', () => {
  const cases: Array<{
    status: schema.BillingSubscriptionStatus;
    paidThrough: Date;
    grantsEligible: boolean;
    label: string;
  }> = [
    { status: 'active', paidThrough: new Date('2026-10-01T00:00:00.000Z'), grantsEligible: true, label: 'Active' },
    {
      status: 'past_due',
      paidThrough: new Date('2026-10-01T00:00:00.000Z'),
      grantsEligible: true,
      label: 'Payment past due — prepaid credits continue until Oct 1, 2026',
    },
    {
      status: 'unpaid',
      paidThrough: new Date('2026-09-01T00:00:00.000Z'),
      grantsEligible: false,
      label: 'Payment failed — no new monthly credits',
    },
    {
      status: 'incomplete',
      paidThrough: new Date('2026-09-01T00:00:00.000Z'),
      grantsEligible: false,
      label: 'Setup not finished — no monthly credits yet',
    },
    {
      status: 'incomplete_expired',
      paidThrough: new Date('2026-09-01T00:00:00.000Z'),
      grantsEligible: false,
      label: 'Setup expired — no subscription',
    },
    {
      status: 'paused',
      paidThrough: new Date('2026-09-01T00:00:00.000Z'),
      grantsEligible: false,
      label: 'Paused — no new monthly credits',
    },
    {
      status: 'canceled',
      paidThrough: new Date('2099-01-01T00:00:00.000Z'),
      grantsEligible: true,
      label: 'Cancelled — credits continue until Jan 1, 2099',
    },
    {
      // grantsEligible mirrors GRANT_ELIGIBLE_STATUSES verbatim (a coarse
      // status-only gate) — 'canceled' is always in that set, whatever
      // paidThrough says. The label carries the "already ended" nuance.
      status: 'canceled',
      paidThrough: new Date('2020-01-01T00:00:00.000Z'),
      grantsEligible: true,
      label: 'Cancelled',
    },
    {
      status: 'trialing',
      paidThrough: new Date('2026-09-01T00:00:00.000Z'),
      grantsEligible: false,
      label: 'Needs review',
    },
  ];

  it.each(cases)('renders status=$status (paidThrough=$paidThrough) truthfully, never "No subscription"', async ({ status, paidThrough, grantsEligible, label }) => {
    const salonId = await seedSalon('single_salon');
    await seedSubscription(salonId, { status, paidThrough });

    const response = await getUsage();

    expect(response.status).toBe(200);

    const body = await response.json();

    expect(body.data.usage.plan).not.toBeNull();
    expect(body.data.usage.plan.status).toBe(status);
    expect(body.data.usage.plan.entitlement).toEqual({
      status,
      paidThrough: paidThrough.toISOString(),
      grantsEligible,
      label,
    });
    // No Stripe vocabulary anywhere in the entitlement/plan payload.
    expect(JSON.stringify(body.data.usage.plan)).not.toMatch(/stripe|sub_|cus_/i);
  });
});

describe('several billing_subscription rows for one salon', () => {
  it('prefers the live row even when a canceled row was updated more recently', async () => {
    const salonId = await seedSalon();
    const recentlyTouched = new Date();
    const staleUpdate = new Date(Date.now() - 60_000);
    await seedSubscription(salonId, {
      status: 'canceled',
      paidThrough: new Date('2020-01-01T00:00:00.000Z'),
      updatedAt: recentlyTouched,
    });
    await seedSubscription(salonId, {
      status: 'active',
      paidThrough: new Date('2026-10-01T00:00:00.000Z'),
      updatedAt: staleUpdate,
    });

    const response = await getUsage();
    const body = await response.json();

    expect(body.data.usage.plan.status).toBe('active');
  });

  it('falls back to the most recently updated row when none are live', async () => {
    const salonId = await seedSalon();
    const older = new Date(Date.now() - 120_000);
    const newer = new Date(Date.now() - 1_000);
    await seedSubscription(salonId, {
      status: 'incomplete_expired',
      paidThrough: new Date('2020-01-01T00:00:00.000Z'),
      updatedAt: older,
    });
    await seedSubscription(salonId, {
      status: 'canceled',
      paidThrough: new Date('2020-06-01T00:00:00.000Z'),
      updatedAt: newer,
    });

    const response = await getUsage();
    const body = await response.json();

    expect(body.data.usage.plan.status).toBe('canceled');
    expect(body.data.usage.plan.paidThrough).toBe('2020-06-01T00:00:00.000Z');
  });
});

describe('existing fields are preserved', () => {
  it('keeps cadence/paidThrough/cancelAtPeriodEnd/rateProtectedThrough alongside the new entitlement', async () => {
    const salonId = await seedSalon();
    await seedSubscription(salonId, {
      status: 'active',
      paidThrough: new Date('2026-10-01T00:00:00.000Z'),
      cancelAtPeriodEnd: true,
      rateProtectedThrough: new Date('2027-01-01T00:00:00.000Z'),
    });

    const response = await getUsage();
    const body = await response.json();

    expect(body.data.usage.plan).toMatchObject({
      key: 'pro_2026_08',
      displayName: 'Pro',
      cadence: 'monthly',
      status: 'active',
      paidThrough: '2026-10-01T00:00:00.000Z',
      cancelAtPeriodEnd: true,
      rateProtectedThrough: '2027-01-01T00:00:00.000Z',
    });
    expect(body.data.usage.monthlyAllowance).toBe(400);
  });
});

describe('admin guard passthrough', () => {
  it('returns the guard error unchanged when the salon is not found', async () => {
    adminSalonHolder.error = new Response(JSON.stringify({ error: { code: 'SALON_NOT_FOUND' } }), { status: 404 });
    adminSalonHolder.salon = null;

    const response = await getUsage();

    expect(response.status).toBe(404);
  });
});

describe('capabilities + catalog (P7, ChoosePlanPanel)', () => {
  it('capabilities default to false when every dark switch is unset', async () => {
    await seedSalon('free');

    const response = await getUsage();
    const body = await response.json();

    expect(body.data.capabilities).toEqual({ subscriptions: false, topups: false, pricingPublic: false });
  });

  it('capabilities booleans reflect the dark switches exactly', async () => {
    await seedSalon('free');
    envHolder.BILLING_SUBSCRIPTIONS_ENABLED = 'true';
    envHolder.BILLING_TOPUPS_ENABLED = 'true';
    envHolder.PUBLIC_PRICING_ENABLED = 'true';

    const response = await getUsage();
    const body = await response.json();

    expect(body.data.capabilities).toEqual({ subscriptions: true, topups: true, pricingPublic: true });
  });

  it('catalog.plans and catalog.offers match the canonical public projections exactly', async () => {
    await seedSalon('free');
    const { getPublicPlanCatalog } = await import('@/libs/billing/planDefinitions');
    const { getPublicBillingOffers } = await import('@/libs/billing/billingOffers');

    const response = await getUsage();
    const body = await response.json();

    expect(body.data.catalog.plans).toEqual(JSON.parse(JSON.stringify(getPublicPlanCatalog())));
    expect(body.data.catalog.offers).toEqual(JSON.parse(JSON.stringify(getPublicBillingOffers())));
  });

  it('catalog.founding is null while the promotion window is closed (the committed default)', async () => {
    await seedSalon('free');

    const response = await getUsage();
    const body = await response.json();

    expect(body.data.catalog.founding).toBeNull();
  });

  it('catalog.founding is a public, ID-free projection when the window is open', async () => {
    await seedSalon('free');
    promotionsHolder.windowOpenOverride = true;

    const response = await getUsage();
    const body = await response.json();

    expect(body.data.catalog.founding).toEqual({
      key: 'founding_annual_2026',
      percentOff: 40,
      rateProtectionMonths: 24,
      eligibleOfferKeys: ['starter_2026_08_annual', 'pro_2026_08_annual', 'elite_2026_08_annual'],
      endsAt: null,
    });
  });

  it('never leaks a Stripe Price/Coupon/Promotion Code id anywhere in the response', async () => {
    const salonId = await seedSalon('single_salon');
    await seedSubscription(salonId);
    envHolder.BILLING_SUBSCRIPTIONS_ENABLED = 'true';
    envHolder.BILLING_TOPUPS_ENABLED = 'true';
    promotionsHolder.windowOpenOverride = true;

    const response = await getUsage();
    const body = await response.json();

    expect(JSON.stringify(body)).not.toMatch(/\b(price_|coupon_|promo_)\w+/i);
  });
});
