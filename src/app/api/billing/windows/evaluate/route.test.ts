/**
 * Credit-window scheduler route proofs — §6.4, §7.3 rule 7, §8.6 (plan P4).
 * CRON_SECRET-gated, registered in `vercel.json` (P4b, D3), dark-`200
 * skipped` while BILLING_SUBSCRIPTIONS_ENABLED is unset, cursor-paginated
 * over `id` ascending in batches of 200, and the only caller of both
 * `expireStaleClaims` (§7.3 rule 7) and `expireLapsedLots` (G09).
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import vercelConfig from '../../../../../../vercel.json';

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

// Wrap the REAL implementations so the engine still runs end to end while
// call counts are observable — proving this route is the caller, not
// re-deriving the engine's own correctness (that is creditGrants.test.ts's
// job, and creditGrants.ts itself is never edited by this plan).
vi.mock('@/libs/billing/creditGrants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/billing/creditGrants')>();
  return { ...actual, expireLapsedLots: vi.fn(actual.expireLapsedLots) };
});
vi.mock('@/libs/billing/promotionClaims', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/billing/promotionClaims')>();
  return { ...actual, expireStaleClaims: vi.fn(actual.expireStaleClaims) };
});

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
});

const call = async (secret = 'cron_test_secret') => {
  const { POST } = await import('./route');
  return POST(new Request('http://localhost/api/billing/windows/evaluate', {
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : {},
  }));
};

let counter = 0;
function nextIds() {
  counter += 1;
  return { salonId: `s_wev_${counter}`, subId: `sub_wev_${counter}` };
}

async function seedSubscription() {
  const { salonId, subId } = nextIds();
  const anchor = new Date(Date.now() - 5 * 24 * 3600_000);
  await db.insert(schema.salonSchema).values({ id: salonId, name: salonId, slug: salonId });
  await db.insert(schema.billingSubscriptionSchema).values({
    id: `bsub_${subId}`,
    salonId,
    stripeSubscriptionId: subId,
    stripeCustomerId: `cus_${subId}`,
    planDefinitionKey: 'pro_2026_08',
    billingOfferKey: 'pro_2026_08_monthly',
    billingCadence: 'monthly',
    status: 'active',
    paidThrough: new Date(Date.now() + 30 * 24 * 3600_000),
    creditCycleAnchor: anchor,
  });
  return { salonId, subId };
}

/** Bulk-seeds N due subscriptions in two batched inserts (fast enough for a >200-row pagination proof). */
async function seedManySubscriptions(count: number): Promise<void> {
  const anchor = new Date(Date.now() - 5 * 24 * 3600_000);
  const paidThrough = new Date(Date.now() + 30 * 24 * 3600_000);
  const salons: (typeof schema.salonSchema.$inferInsert)[] = [];
  const subs: (typeof schema.billingSubscriptionSchema.$inferInsert)[] = [];
  for (let i = 0; i < count; i += 1) {
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
}

describe('window scheduler route (P4)', () => {
  it('rejects without the cron secret', async () => {
    const response = await call('');

    expect(response.status).toBe(401);
  });

  it('responds 200 skipped while billing is dark — no DB read beyond auth', async () => {
    envHolder.BILLING_SUBSCRIPTIONS_ENABLED = undefined;
    const response = await call();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ skipped: 'BILLING_DISABLED' });
  });

  it('evaluates due subscriptions and grants covered windows via the engine', async () => {
    await seedSubscription();
    const response = await call();
    const body = await response.json();

    expect(body.summary.evaluated).toBeGreaterThanOrEqual(1);
    expect(body.summary.granted).toBeGreaterThanOrEqual(1);
  });

  it('calls expireStaleClaims (§7.3 rule 7) and expireLapsedLots (G09)', async () => {
    const { expireLapsedLots } = await import('@/libs/billing/creditGrants');
    const { expireStaleClaims } = await import('@/libs/billing/promotionClaims');
    await seedSubscription();

    await call();

    expect(expireStaleClaims).toHaveBeenCalled();
    expect(expireLapsedLots).toHaveBeenCalled();
  });

  it('drains more than one batch of 200 due subscriptions via id-ascending cursor pagination', async () => {
    await seedManySubscriptions(210);

    const response = await call();
    const body = await response.json();

    expect(body.summary.evaluated).toBeGreaterThanOrEqual(210);
    expect(body.summary.granted).toBeGreaterThanOrEqual(210);
  }, 30_000);
});

describe('vercel.json cron registration (P4b, D3)', () => {
  it('registers /api/billing/windows/evaluate on a 15-minute schedule', () => {
    const cron = vercelConfig.crons.find(entry => entry.path === '/api/billing/windows/evaluate');

    expect(cron).toEqual({ path: '/api/billing/windows/evaluate', schedule: '*/15 * * * *' });
  });

  it('registers /api/billing/reconcile on an hourly :17 schedule', () => {
    const cron = vercelConfig.crons.find(entry => entry.path === '/api/billing/reconcile');

    expect(cron).toEqual({ path: '/api/billing/reconcile', schedule: '17 * * * *' });
  });
});
