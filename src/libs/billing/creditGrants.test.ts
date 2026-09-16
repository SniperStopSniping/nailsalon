/**
 * B1 grants engine — PGlite proofs for credit windows (§6), starter
 * once-per-business (§7.3), identity/HMAC rotation, promotion claims,
 * checkout attempts and top-up fulfillment/reversal.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { computeCreditWindow } from './creditWindows';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const envHolder = vi.hoisted(() => ({
  BILLING_IDENTITY_HMAC_SECRET: undefined as string | undefined,
  BILLING_IDENTITY_HMAC_VERSION: undefined as number | undefined,
}));

vi.mock('@/libs/Env', () => ({ Env: envHolder }));

// OP-5: the window engine's anomalies must reach Sentry, not only the cron's
// unread response body.
const sentryHolder = vi.hoisted(() => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => sentryHolder);

let db: ReturnType<typeof drizzle<typeof schema>>;

const grants = () => import('./creditGrants');
const identity = () => import('./businessIdentity');
const claims = () => import('./promotionClaims');
const attempts = () => import('./checkoutAttempts');

async function seedSalon(id: string) {
  await db.insert(schema.salonSchema).values({ id, name: `Salon ${id}`, slug: `salon-${id}` });
}

async function seedSubscription(input: {
  id: string;
  salonId: string;
  planKey?: string;
  cadence?: 'monthly' | 'annual';
  status?: schema.BillingSubscriptionStatus;
  cancelAtPeriodEnd?: boolean;
  anchor: Date;
  paidThrough: Date;
}) {
  await db.insert(schema.billingSubscriptionSchema).values({
    id: input.id,
    salonId: input.salonId,
    stripeSubscriptionId: `sub_${input.id}`,
    stripeCustomerId: `cus_${input.id}`,
    planDefinitionKey: input.planKey ?? 'starter_2026_08',
    billingOfferKey: `${input.planKey ?? 'starter_2026_08'}_${input.cadence ?? 'monthly'}`,
    billingCadence: input.cadence ?? 'monthly',
    status: input.status ?? 'active',
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
    paidThrough: input.paidThrough,
    creditCycleAnchor: input.anchor,
  });
}

async function monthlyBalance(salonId: string): Promise<number> {
  const rows = await db.execute(sql`
    SELECT COALESCE(SUM(amount), 0)::int AS total FROM sms_credit_ledger
    WHERE salon_id = ${salonId} AND bucket = 'monthly'
  `);
  return Number((rows.rows[0] as Record<string, unknown>).total);
}

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

beforeEach(() => {
  sentryHolder.captureMessage.mockClear();
  sentryHolder.captureException.mockClear();
});

describe('credit windows — §6 grant semantics', () => {
  const anchor = new Date('2026-01-31T10:00:00.000Z');

  it('grants only windows FULLY covered by paid_through (boundary vectors)', async () => {
    const { evaluateSubscriptionWindows } = await grants();
    await seedSalon('s_win1');
    const w0End = new Date('2026-02-28T10:00:00.000Z');
    // paid exactly to window END covers window 0.
    await seedSubscription({ id: 'sub_w1', salonId: 's_win1', anchor, paidThrough: w0End });
    const during = new Date('2026-02-10T00:00:00.000Z');
    const summary = await evaluateSubscriptionWindows({ subscriptionId: 'sub_w1', now: during });

    expect(summary.granted).toBe(1);
    expect(await monthlyBalance('s_win1')).toBe(200);

    // Replay: exactly-once.
    const replay = await evaluateSubscriptionWindows({ subscriptionId: 'sub_w1', now: during });

    expect(replay.granted).toBe(0);
    expect(await monthlyBalance('s_win1')).toBe(200);
  });

  it('paid_through == window_start (or end − 1s) grants NOTHING; late payment upgrades the active window', async () => {
    const { evaluateSubscriptionWindows } = await grants();
    await seedSalon('s_win2');
    const w0End = new Date('2026-02-28T10:00:00.000Z');
    const oneSecondShort = new Date(w0End.getTime() - 1000);
    await seedSubscription({ id: 'sub_w2', salonId: 's_win2', anchor, paidThrough: oneSecondShort });
    const during = new Date('2026-02-10T00:00:00.000Z');

    const unpaid = await evaluateSubscriptionWindows({ subscriptionId: 'sub_w2', now: during });

    expect(unpaid).toMatchObject({ granted: 0, skippedUnpaid: 1 });
    expect(await monthlyBalance('s_win2')).toBe(0);

    // Payment lands while the window is STILL active → the same window
    // upgrades to granted, exactly once.
    await db.update(schema.billingSubscriptionSchema)
      .set({ paidThrough: w0End })
      .where(eq(schema.billingSubscriptionSchema.id, 'sub_w2'));
    const late = await evaluateSubscriptionWindows({ subscriptionId: 'sub_w2', now: during });

    expect(late.granted).toBe(1);
    expect(await monthlyBalance('s_win2')).toBe(200);
  });

  it('paid_through EXACTLY == window_start grants nothing at the grant level (engine-level boundary pinned separately in creditWindows.test.ts:99-107)', async () => {
    const { evaluateSubscriptionWindows } = await grants();
    await seedSalon('s_win_start');
    // paid_through equals the window's START instant precisely — the Rev 2
    // rule this would have satisfied is void; Rev 2.2 requires paid_through
    // >= window_end.
    await seedSubscription({ id: 'sub_win_start', salonId: 's_win_start', anchor, paidThrough: anchor });
    const during = new Date('2026-02-10T00:00:00.000Z');
    const summary = await evaluateSubscriptionWindows({ subscriptionId: 'sub_win_start', now: during });

    expect(summary).toMatchObject({ granted: 0, skippedUnpaid: 1 });
    expect(await monthlyBalance('s_win_start')).toBe(0);

    const windows = await db.execute(sql`
      SELECT status FROM billing_credit_window WHERE billing_subscription_id = 'sub_win_start'
    `);

    expect(windows.rows.map(row => (row as Record<string, unknown>).status)).toEqual(['skipped_unpaid']);
  });

  it.each(['unpaid', 'incomplete', 'incomplete_expired', 'paused'] as const)(
    '§6.5a status=%s grants nothing and writes NO durable billing_credit_window row (not even skipped) even when paid_through covers the window forever',
    async (status) => {
      const { evaluateSubscriptionWindows } = await grants();
      const salonId = `s_status_${status}`;
      const subscriptionId = `sub_status_${status}`;
      await seedSalon(salonId);
      // paid_through is set far in the future — fully covering every window —
      // to prove the refusal comes from GRANT_ELIGIBLE_STATUSES, not from an
      // unpaid boundary.
      await seedSubscription({
        id: subscriptionId,
        salonId,
        status,
        anchor,
        paidThrough: new Date('2030-01-01T00:00:00.000Z'),
      });
      const now = new Date('2026-02-10T00:00:00.000Z'); // inside window 0

      const summary = await evaluateSubscriptionWindows({ subscriptionId, now });

      expect(summary).toEqual({ granted: 0, skippedUnpaid: 0, skippedMissed: 0, anomalies: [] });
      expect(await monthlyBalance(salonId)).toBe(0);

      const windowRows = await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM billing_credit_window WHERE billing_subscription_id = ${subscriptionId}
      `);

      expect(Number((windowRows.rows[0] as Record<string, unknown>).n)).toBe(0);
    },
  );

  it('canceled with paid_through already in the past (relative to now, inside the still-active window) grants nothing and records skipped_unpaid', async () => {
    const { evaluateSubscriptionWindows } = await grants();
    await seedSalon('s_canc_past');
    const anchor6 = new Date('2026-01-01T00:00:00.000Z');
    // Entitlement lapsed partway through window 0 (Jan 1 - Feb 1): paid only
    // through Jan 15, but `now` is already past that.
    const paidThrough = new Date('2026-01-15T00:00:00.000Z');
    await seedSubscription({ id: 'sub_canc_past', salonId: 's_canc_past', status: 'canceled', anchor: anchor6, paidThrough });
    const now = new Date('2026-01-20T00:00:00.000Z'); // past paid_through, window 0 still active

    const summary = await evaluateSubscriptionWindows({ subscriptionId: 'sub_canc_past', now });

    expect(summary).toMatchObject({ granted: 0, skippedUnpaid: 1 });
    expect(await monthlyBalance('s_canc_past')).toBe(0);

    const windows = await db.execute(sql`
      SELECT status FROM billing_credit_window WHERE billing_subscription_id = 'sub_canc_past'
    `);

    expect(windows.rows.map(row => (row as Record<string, unknown>).status)).toEqual(['skipped_unpaid']);
  });

  it('explicit past_due fixture: window granted only when paid_through >= window_end, refused otherwise', async () => {
    const { evaluateSubscriptionWindows } = await grants();
    await seedSalon('s_pd1');
    await seedSalon('s_pd2');
    const anchor7 = new Date('2026-05-01T00:00:00.000Z');
    const windowEnd = new Date('2026-06-01T00:00:00.000Z');
    const now = new Date('2026-05-15T00:00:00.000Z');

    // Fully covered: paid_through == window_end.
    await seedSubscription({ id: 'sub_pd_covered', salonId: 's_pd1', status: 'past_due', anchor: anchor7, paidThrough: windowEnd });
    const covered = await evaluateSubscriptionWindows({ subscriptionId: 'sub_pd_covered', now });

    expect(covered).toMatchObject({ granted: 1, skippedUnpaid: 0 });
    expect(await monthlyBalance('s_pd1')).toBe(200);

    // Short by one second: refused, recorded skipped_unpaid.
    await seedSubscription({
      id: 'sub_pd_short',
      salonId: 's_pd2',
      status: 'past_due',
      anchor: anchor7,
      paidThrough: new Date(windowEnd.getTime() - 1000),
    });
    const refused = await evaluateSubscriptionWindows({ subscriptionId: 'sub_pd_short', now });

    expect(refused).toMatchObject({ granted: 0, skippedUnpaid: 1 });
    expect(await monthlyBalance('s_pd2')).toBe(0);
  });

  it('annual-cadence parity: exactly 12 windows granted across 12 simulated monthly evaluations', async () => {
    const { evaluateSubscriptionWindows } = await grants();
    await seedSalon('s_annual_parity');
    const anchor8 = new Date('2026-01-15T00:00:00.000Z');
    const paidThrough = new Date('2027-01-15T00:00:00.000Z'); // one full year prepaid
    await seedSubscription({
      id: 'sub_annual_parity',
      salonId: 's_annual_parity',
      cadence: 'annual',
      planKey: 'pro_2026_08', // 400 credits/month
      status: 'active',
      anchor: anchor8,
      paidThrough,
    });

    let totalGranted = 0;
    for (let index = 0; index < 12; index += 1) {
      const window = computeCreditWindow(anchor8, index);
      const now = new Date(window.start.getTime() + 60_000); // simulated monthly cron tick
      // Sequential on purpose: each simulated monthly tick depends on the
      // previous window's committed state (creditCycleIndex cursor).
      const summary = await evaluateSubscriptionWindows({ subscriptionId: 'sub_annual_parity', now });
      totalGranted += summary.granted;
    }

    expect(totalGranted).toBe(12);
    expect(await monthlyBalance('s_annual_parity')).toBe(12 * 400);

    const grantedWindows = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM billing_credit_window
      WHERE billing_subscription_id = 'sub_annual_parity' AND status = 'granted'
    `);

    expect(Number((grantedWindows.rows[0] as Record<string, unknown>).n)).toBe(12);
  });

  it('annual cancel_at_period_end keeps granting through paid_through across prepaid windows, then stops', async () => {
    const { evaluateSubscriptionWindows } = await grants();
    await seedSalon('s_annual_cape');
    const anchor9 = new Date('2026-02-01T00:00:00.000Z');
    const paidThrough = new Date('2026-04-01T00:00:00.000Z'); // two full prepaid monthly windows
    await seedSubscription({
      id: 'sub_annual_cape',
      salonId: 's_annual_cape',
      cadence: 'annual',
      status: 'active',
      cancelAtPeriodEnd: true,
      anchor: anchor9,
      paidThrough,
    });

    const inWindow0 = new Date('2026-02-10T00:00:00.000Z');

    expect((await evaluateSubscriptionWindows({ subscriptionId: 'sub_annual_cape', now: inWindow0 })).granted).toBe(1);

    const inWindow1 = new Date('2026-03-10T00:00:00.000Z');

    expect((await evaluateSubscriptionWindows({ subscriptionId: 'sub_annual_cape', now: inWindow1 })).granted).toBe(1);

    // Window 2 starts exactly at paid_through: not fully covered → stops.
    const inWindow2 = new Date('2026-04-10T00:00:00.000Z');
    const after = await evaluateSubscriptionWindows({ subscriptionId: 'sub_annual_cape', now: inWindow2 });

    expect(after.granted).toBe(0);
    expect(await monthlyBalance('s_annual_cape')).toBe(400);
  });

  it('annual subscription canceled (status) with prepaid windows remaining keeps granting through paid_through, then stops', async () => {
    const { evaluateSubscriptionWindows } = await grants();
    await seedSalon('s_annual_canceled');
    const anchor10 = new Date('2026-06-01T00:00:00.000Z');
    const paidThrough = new Date('2026-08-01T00:00:00.000Z'); // two full prepaid monthly windows
    await seedSubscription({
      id: 'sub_annual_canceled',
      salonId: 's_annual_canceled',
      cadence: 'annual',
      status: 'canceled',
      anchor: anchor10,
      paidThrough,
    });

    const inWindow0 = new Date('2026-06-10T00:00:00.000Z');

    expect((await evaluateSubscriptionWindows({ subscriptionId: 'sub_annual_canceled', now: inWindow0 })).granted).toBe(1);

    const inWindow1 = new Date('2026-07-10T00:00:00.000Z');

    expect((await evaluateSubscriptionWindows({ subscriptionId: 'sub_annual_canceled', now: inWindow1 })).granted).toBe(1);

    const inWindow2 = new Date('2026-08-10T00:00:00.000Z');
    const after = await evaluateSubscriptionWindows({ subscriptionId: 'sub_annual_canceled', now: inWindow2 });

    expect(after.granted).toBe(0);
    expect(await monthlyBalance('s_annual_canceled')).toBe(400);
  });

  it('a scheduler outage never backfills fully missed windows (annual subscriber, multiple windows)', async () => {
    const { evaluateSubscriptionWindows } = await grants();
    await seedSalon('s_win3');
    const paidThrough = new Date('2027-01-31T10:00:00.000Z'); // annual: fully paid year
    await seedSubscription({
      id: 'sub_w3',
      salonId: 's_win3',
      cadence: 'annual',
      planKey: 'pro_2026_08',
      anchor,
      paidThrough,
    });
    // First evaluation happens in window 2 (Mar 31 → Apr 30): windows 0-1
    // fully elapsed unevaluated ⇒ skipped_missed; window 2 grants.
    const now = new Date('2026-04-10T00:00:00.000Z');
    const summary = await evaluateSubscriptionWindows({ subscriptionId: 'sub_w3', now });

    expect(summary).toMatchObject({ granted: 1, skippedMissed: 2 });
    expect(await monthlyBalance('s_win3')).toBe(400);

    const windows = await db.execute(sql`
      SELECT credit_cycle_index, status FROM billing_credit_window
      WHERE billing_subscription_id = 'sub_w3' ORDER BY credit_cycle_index
    `);

    expect(windows.rows.map(row => (row as Record<string, unknown>).status))
      .toEqual(['skipped_missed', 'skipped_missed', 'granted']);
  });

  it('trialing is anomalous and unpaid statuses grant nothing new', async () => {
    const { evaluateSubscriptionWindows } = await grants();
    await seedSalon('s_win4');
    await seedSubscription({
      id: 'sub_w4',
      salonId: 's_win4',
      status: 'trialing',
      anchor,
      paidThrough: new Date('2030-01-01T00:00:00.000Z'),
    });
    const trial = await evaluateSubscriptionWindows({ subscriptionId: 'sub_w4', now: new Date('2026-02-10T00:00:00.000Z') });

    expect(trial.anomalies).toContain('TRIALING_SUBSCRIPTION_ANOMALY');
    expect(await monthlyBalance('s_win4')).toBe(0);
    // OP-5: the summary is unchanged AND the anomaly alerts.
    expect(sentryHolder.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentryHolder.captureMessage).toHaveBeenCalledWith('billing.window_engine_anomaly', {
      level: 'warning',
      extra: { anomaly: 'TRIALING_SUBSCRIPTION_ANOMALY', subscriptionId: 'sub_w4', salonId: 's_win4' },
    });

    await db.update(schema.billingSubscriptionSchema)
      .set({ status: 'unpaid' })
      .where(eq(schema.billingSubscriptionSchema.id, 'sub_w4'));
    const unpaid = await evaluateSubscriptionWindows({ subscriptionId: 'sub_w4', now: new Date('2026-02-10T00:00:00.000Z') });

    expect(unpaid.granted).toBe(0);
  });

  it('cancellation with prepaid time keeps granting through paid_through, then stops', async () => {
    const { evaluateSubscriptionWindows } = await grants();
    await seedSalon('s_win5');
    const anchor5 = new Date('2026-08-16T10:00:00.000Z');
    const paidThrough = new Date('2026-10-16T10:00:00.000Z'); // two full windows
    await seedSubscription({ id: 'sub_w5', salonId: 's_win5', status: 'canceled', anchor: anchor5, paidThrough });

    const inWindow0 = new Date('2026-08-20T00:00:00.000Z');

    expect((await evaluateSubscriptionWindows({ subscriptionId: 'sub_w5', now: inWindow0 })).granted).toBe(1);

    const inWindow1 = new Date('2026-09-20T00:00:00.000Z');

    expect((await evaluateSubscriptionWindows({ subscriptionId: 'sub_w5', now: inWindow1 })).granted).toBe(1);

    // Window 2 starts at paid_through: not covered → nothing granted.
    const inWindow2 = new Date('2026-10-20T00:00:00.000Z');
    const after = await evaluateSubscriptionWindows({ subscriptionId: 'sub_w5', now: inWindow2 });

    expect(after.granted).toBe(0);
    expect(await monthlyBalance('s_win5')).toBe(400);
  });

  it('upgrade mid-window grants only the allowance difference, once', async () => {
    const { applyUpgradeDiff } = await grants();
    await seedSalon('s_up');
    const anchorUp = new Date('2026-08-01T00:00:00.000Z');
    await seedSubscription({
      id: 'sub_up',
      salonId: 's_up',
      anchor: anchorUp,
      paidThrough: new Date('2026-09-01T00:00:00.000Z'),
    });
    const now = new Date('2026-08-10T00:00:00.000Z');
    // §6.4: the upgrade diff tops up an already-GRANTED window. Grant window 0
    // (200 starter credits) first — an ungranted window is the engine's job.
    const { evaluateSubscriptionWindows } = await grants();
    await evaluateSubscriptionWindows({ subscriptionId: 'sub_up', now });
    const diff = await db.transaction(async tx =>
      applyUpgradeDiff(tx, { subscriptionId: 'sub_up', fromPlanKey: 'starter_2026_08', toPlanKey: 'pro_2026_08', now }));

    expect(diff.granted).toBe(200); // 400 − 200

    const replay = await db.transaction(async tx =>
      applyUpgradeDiff(tx, { subscriptionId: 'sub_up', fromPlanKey: 'starter_2026_08', toPlanKey: 'pro_2026_08', now }));

    expect(replay.granted).toBe(0);

    const downgrade = await db.transaction(async tx =>
      applyUpgradeDiff(tx, { subscriptionId: 'sub_up', fromPlanKey: 'pro_2026_08', toPlanKey: 'starter_2026_08', now }));

    expect(downgrade.granted).toBe(0);
  });
});

describe('business identity + starter grant — once per business, forever', () => {
  it('grants once, then never again across salon recreation under the same identity', async () => {
    const { grantStarterCredits } = await grants();
    const { resolveOrCreateBusinessIdentity } = await identity();
    await seedSalon('s_id1');

    const identityId = await db.transaction(async (tx) => {
      const resolved = await resolveOrCreateBusinessIdentity(tx, { clerkUserId: 'user_alpha', salonId: 's_id1' });
      return resolved.businessIdentityId;
    });
    const first = await db.transaction(async tx =>
      grantStarterCredits(tx, { businessIdentityId: identityId, salonId: 's_id1' }));

    expect(first.granted).toBe(true);

    const replay = await db.transaction(async tx =>
      grantStarterCredits(tx, { businessIdentityId: identityId, salonId: 's_id1' }));

    expect(replay.granted).toBe(false);

    // Salon purged and recreated under the same Clerk identity: the durable
    // evidence row (salon SET NULL) still blocks a second grant.
    await db.execute(sql`UPDATE billing_starter_grant SET salon_id = NULL WHERE business_identity_id = ${identityId}`);
    await seedSalon('s_id1b');
    const recreated = await db.transaction(async (tx) => {
      const resolved = await resolveOrCreateBusinessIdentity(tx, { clerkUserId: 'user_alpha', salonId: 's_id1b' });
      return grantStarterCredits(tx, { businessIdentityId: resolved.businessIdentityId, salonId: 's_id1b' });
    });

    expect(recreated.granted).toBe(false);
  });

  it('HMAC rotation attaches a new versioned link to the SAME identity (fail-closed without a secret)', async () => {
    const { computeEmailFingerprint, resolveOrCreateBusinessIdentity } = await identity();
    envHolder.BILLING_IDENTITY_HMAC_SECRET = undefined;
    envHolder.BILLING_IDENTITY_HMAC_VERSION = undefined;

    expect(computeEmailFingerprint('owner@example.com')).toBeNull();

    envHolder.BILLING_IDENTITY_HMAC_SECRET = 'test-secret-v1';
    envHolder.BILLING_IDENTITY_HMAC_VERSION = 1;
    await seedSalon('s_id2');
    const v1 = await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { verifiedEmail: 'Owner+tag@Example.COM', salonId: 's_id2' }));

    // Rotation = a NEW secret under a NEW version (the version names which
    // secret is in use; same secret would yield the same digest).
    envHolder.BILLING_IDENTITY_HMAC_SECRET = 'test-secret-v2';
    envHolder.BILLING_IDENTITY_HMAC_VERSION = 2;
    const v2 = await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { verifiedEmail: 'Owner+tag@Example.COM', salonId: 's_id2' }));

    expect(v2.businessIdentityId).toBe(v1.businessIdentityId);
    expect(v2.created).toBe(false);

    const links = await db.execute(sql`
      SELECT link_type, hmac_key_version FROM billing_business_identity_link
      WHERE business_identity_id = ${v1.businessIdentityId} AND link_type = 'email_hmac'
      ORDER BY hmac_key_version
    `);

    expect(links.rows.map(row => Number((row as Record<string, unknown>).hmac_key_version))).toEqual([1, 2]);
  });

  it('normalization preserves +tags and local-part case, lowercases only the domain', async () => {
    const { normalizeEmailForHmac } = await identity();

    expect(normalizeEmailForHmac('  Name+foo@EXAMPLE.com ')).toBe('Name+foo@example.com');
    expect(normalizeEmailForHmac('Name.Dot@Example.Com')).toBe('Name.Dot@example.com');
    expect(normalizeEmailForHmac('not-an-email')).toBeNull();
  });

  it('owner transfer (Clerk user id change) preserves starter eligibility — same durable identity, no second grant', async () => {
    const { grantStarterCredits } = await grants();
    const { resolveOrCreateBusinessIdentity } = await identity();
    await seedSalon('s_transfer');

    // Original owner (Clerk user A) resolves and claims the starter grant.
    const beforeTransfer = await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { clerkUserId: 'user_owner_a', salonId: 's_transfer' }));
    const firstGrant = await db.transaction(async tx =>
      grantStarterCredits(tx, { businessIdentityId: beforeTransfer.businessIdentityId, salonId: 's_transfer' }));

    expect(firstGrant.granted).toBe(true);

    // Ownership transfers to Clerk user B. Resolution is re-run with the NEW
    // owner id but the SAME salon link — the durable salon link is what
    // carries eligibility across the transfer, not the (now-stale) Clerk id.
    const afterTransfer = await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { clerkUserId: 'user_owner_b', salonId: 's_transfer' }));

    expect(afterTransfer.businessIdentityId).toBe(beforeTransfer.businessIdentityId);
    expect(afterTransfer.created).toBe(false);

    // The transfer must not reset eligibility: a second starter grant attempt
    // under the (same) identity is refused.
    const secondGrant = await db.transaction(async tx =>
      grantStarterCredits(tx, { businessIdentityId: afterTransfer.businessIdentityId, salonId: 's_transfer' }));

    expect(secondGrant.granted).toBe(false);

    // Both the old and the new owner's Clerk ids now resolve to the SAME
    // identity (the new owner link was attached, the old one retained).
    const viaOldOwner = await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { clerkUserId: 'user_owner_a' }));
    const viaNewOwner = await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { clerkUserId: 'user_owner_b' }));

    expect(viaOldOwner.businessIdentityId).toBe(beforeTransfer.businessIdentityId);
    expect(viaNewOwner.businessIdentityId).toBe(beforeTransfer.businessIdentityId);
  });

  it('+tag and dot-local-part addresses resolve to DISTINCT identities (both may starter-grant); only the DOMAIN is case-normalized to the SAME identity (§7.3)', async () => {
    const { grantStarterCredits } = await grants();
    const { resolveOrCreateBusinessIdentity } = await identity();
    envHolder.BILLING_IDENTITY_HMAC_SECRET = 'test-secret-tag';
    envHolder.BILLING_IDENTITY_HMAC_VERSION = 1;
    await seedSalon('s_tag_base');
    await seedSalon('s_tag_plus');
    await seedSalon('s_tag_dot');
    await seedSalon('s_tag_domain_case');

    const base = await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { verifiedEmail: 'a@ex.com', salonId: 's_tag_base' }));
    const plusTagged = await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { verifiedEmail: 'a+x@ex.com', salonId: 's_tag_plus' }));
    const dotted = await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { verifiedEmail: 'a.b@ex.com', salonId: 's_tag_dot' }));

    // Never strip +tag, never remove local-part dots (§7.3) ⇒ three DISTINCT
    // businesses by the identity resolver's own logic.
    expect(plusTagged.businessIdentityId).not.toBe(base.businessIdentityId);
    expect(dotted.businessIdentityId).not.toBe(base.businessIdentityId);
    expect(dotted.businessIdentityId).not.toBe(plusTagged.businessIdentityId);

    // Each of the distinct identities may independently receive its own
    // once-per-business starter grant.
    const grantBase = await db.transaction(async tx =>
      grantStarterCredits(tx, { businessIdentityId: base.businessIdentityId, salonId: 's_tag_base' }));
    const grantPlus = await db.transaction(async tx =>
      grantStarterCredits(tx, { businessIdentityId: plusTagged.businessIdentityId, salonId: 's_tag_plus' }));
    const grantDot = await db.transaction(async tx =>
      grantStarterCredits(tx, { businessIdentityId: dotted.businessIdentityId, salonId: 's_tag_dot' }));

    expect(grantBase.granted).toBe(true);
    expect(grantPlus.granted).toBe(true);
    expect(grantDot.granted).toBe(true);

    // The SAME address with a different-CASE DOMAIN ONLY resolves to the SAME
    // identity as `base` (local part case is untouched, but is identical here
    // so only domain-casing is under test).
    const domainCased = await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { verifiedEmail: 'a@EX.COM', salonId: 's_tag_domain_case' }));

    expect(domainCased.businessIdentityId).toBe(base.businessIdentityId);
    expect(domainCased.created).toBe(false);

    // Same identity ⇒ the once-per-business fence still holds: no second grant.
    const grantDomainCased = await db.transaction(async tx =>
      grantStarterCredits(tx, { businessIdentityId: domainCased.businessIdentityId, salonId: 's_tag_domain_case' }));

    expect(grantDomainCased.granted).toBe(false);
  });
});

describe('promotion claims + checkout attempts', () => {
  it('reserve → redeem lifecycle; a redeemed claim never re-reserves; released frees the slot', async () => {
    const { redeemPromotionClaim, releasePromotionClaim, reservePromotionClaim } = await claims();
    const { resolveOrCreateBusinessIdentity } = await identity();
    await seedSalon('s_pc1');
    const identityId = (await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { clerkUserId: 'user_pc1' }))).businessIdentityId;

    const reserved = await db.transaction(async tx =>
      reservePromotionClaim(tx, { promotionKey: 'founding_annual_2026', businessIdentityId: identityId, salonId: 's_pc1' }));

    expect(reserved.ok).toBe(true);

    const claimId = (reserved as { claimId: string }).claimId;

    const reuse = await db.transaction(async tx =>
      reservePromotionClaim(tx, { promotionKey: 'founding_annual_2026', businessIdentityId: identityId, salonId: 's_pc1' }));

    expect(reuse).toMatchObject({ ok: true, reused: true });

    await db.transaction(async tx => redeemPromotionClaim(tx, { claimId, stripeCheckoutSessionId: 'cs_pc1' }));
    const afterRedeem = await db.transaction(async tx =>
      reservePromotionClaim(tx, { promotionKey: 'founding_annual_2026', businessIdentityId: identityId, salonId: 's_pc1' }));

    expect(afterRedeem).toMatchObject({ ok: false, reason: 'ALREADY_CLAIMED' });

    // A different business releasing frees ITS slot only.
    const otherId = (await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { clerkUserId: 'user_pc2' }))).businessIdentityId;
    const otherClaim = await db.transaction(async tx =>
      reservePromotionClaim(tx, { promotionKey: 'founding_annual_2026', businessIdentityId: otherId, salonId: 's_pc1' }));
    await db.transaction(async tx =>
      releasePromotionClaim(tx, { claimId: (otherClaim as { claimId: string }).claimId }));
    const again = await db.transaction(async tx =>
      reservePromotionClaim(tx, { promotionKey: 'founding_annual_2026', businessIdentityId: otherId, salonId: 's_pc1' }));

    expect(again).toMatchObject({ ok: true, reused: false });
  });

  it('enforces a finite redemption cap transactionally (injected cap)', async () => {
    const { reservePromotionClaim } = await claims();
    const { resolveOrCreateBusinessIdentity } = await identity();
    const { PROMOTIONS } = await import('@/libs/billing/promotions');
    const capped = {
      ...PROMOTIONS.founding_annual_2026,
      key: 'founding_annual_2026' as const,
      eligibleOfferKeys: [...PROMOTIONS.founding_annual_2026.eligibleOfferKeys],
      maximumRedemptions: 1,
    };
    await seedSalon('s_pc2');
    const idA = (await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { clerkUserId: 'user_cap_a' }))).businessIdentityId;
    const idB = (await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { clerkUserId: 'user_cap_b' }))).businessIdentityId;

    const first = await db.transaction(async tx =>
      reservePromotionClaim(tx, {
        promotionKey: 'cap_test_promo',
        businessIdentityId: idA,
        salonId: 's_pc2',
        promotionOverride: capped,
      }));

    expect(first.ok).toBe(true);

    const second = await db.transaction(async tx =>
      reservePromotionClaim(tx, {
        promotionKey: 'cap_test_promo',
        businessIdentityId: idB,
        salonId: 's_pc2',
        promotionOverride: capped,
      }));

    expect(second).toMatchObject({ ok: false, reason: 'REDEMPTION_CAP_REACHED' });
  });

  it('serializes subscription checkout attempts and blocks new ones under a live subscription', async () => {
    const { beginCheckoutAttempt } = await attempts();
    await seedSalon('s_ca1');
    const first = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, { salonId: 's_ca1', purpose: 'plan_subscription', billingOfferKey: 'starter_2026_08_monthly' }));

    expect(first).toMatchObject({ ok: true, reused: false });

    const reuse = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, { salonId: 's_ca1', purpose: 'plan_subscription', billingOfferKey: 'starter_2026_08_monthly' }));

    expect(reuse).toMatchObject({ ok: true, reused: true });
    expect((reuse as { attemptId: string }).attemptId).toBe((first as { attemptId: string }).attemptId);
    // The Stripe idempotency key derives from the persisted attempt id.
    expect((first as { stripeIdempotencyKey: string }).stripeIdempotencyKey)
      .toBe(`billing-attempt:${(first as { attemptId: string }).attemptId}`);

    // A pending SUBSCRIPTION attempt must never block top-ups.
    const topup = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, { salonId: 's_ca1', purpose: 'sms_topup', topupOfferKey: 'topup_100_paid_2026_08' }));

    expect(topup.ok).toBe(true);

    // A LIVE subscription blocks new subscription attempts outright.
    await seedSalon('s_ca2');
    await seedSubscription({
      id: 'sub_ca2',
      salonId: 's_ca2',
      anchor: new Date('2026-08-01T00:00:00.000Z'),
      paidThrough: new Date('2026-09-01T00:00:00.000Z'),
    });
    const blocked = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, { salonId: 's_ca2', purpose: 'plan_subscription', billingOfferKey: 'pro_2026_08_monthly' }));

    expect(blocked).toEqual({ ok: false, reason: 'ACTIVE_SUBSCRIPTION_EXISTS' });
  });
});

describe('top-up fulfillment and reversals', () => {
  it('fulfills a PAID purchase exactly once; refund reverses only unused; dispute reverses fully (may go negative)', async () => {
    const { fulfillTopupPurchase, reverseTopup } = await grants();
    const { reserveSmsCredits, settleReservationOnAccept } = await import('./creditReservation');
    await seedSalon('s_tp1');
    await db.insert(schema.smsTopupPurchaseSchema).values({
      id: 'tp_1',
      salonId: 's_tp1',
      topupOfferKey: 'topup_100_paid_2026_08',
      credits: 100,
      amountCents: 599,
      status: 'paid',
      stripeCheckoutSessionId: 'cs_tp1',
      stripePaymentIntentId: 'pi_tp1',
    });

    expect((await db.transaction(async tx => fulfillTopupPurchase(tx, { topupPurchaseId: 'tp_1' }))).fulfilled).toBe(true);
    // Replay: still fulfilled, no second lot.
    expect((await db.transaction(async tx => fulfillTopupPurchase(tx, { topupPurchaseId: 'tp_1' }))).fulfilled).toBe(true);

    const lots = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM sms_credit_ledger WHERE salon_id = 's_tp1' AND entry_type = 'grant'
    `);

    expect(Number((lots.rows[0] as Record<string, unknown>).n)).toBe(1);

    // Spend 30 of the 100, then refund: reversal caps at the 70 unused.
    const reserved = await reserveSmsCredits({ salonId: 's_tp1', dedupeKey: 'tp_res', segments: 30 });
    await settleReservationOnAccept({
      reservationId: (reserved as { reservationId: string }).reservationId,
      providerSid: 'SM_tp',
    });
    const refund = await db.transaction(async tx =>
      reverseTopup(tx, { topupPurchaseId: 'tp_1', kind: 'refund', stripeRef: 're_tp1', cumulativeRefundedCents: 599 }));

    // Full 599¢ refund targets all 100 credits; 30 were consumed as sent
    // messages and are never fabricated back — reversal caps at the 70
    // unused, the 30-credit shortfall is audited.
    expect(refund.reversed).toBe(70);
    expect(refund.shortfall).toBe(30);

    // Dispute on a second, fully spent purchase drives availability negative
    // and a subsequent reserve is blocked — never authorized below zero.
    await db.insert(schema.smsTopupPurchaseSchema).values({
      id: 'tp_2',
      salonId: 's_tp1',
      topupOfferKey: 'topup_100_paid_2026_08',
      credits: 100,
      amountCents: 599,
      status: 'paid',
      stripeCheckoutSessionId: 'cs_tp2',
      stripePaymentIntentId: 'pi_tp2',
    });
    await db.transaction(async tx => fulfillTopupPurchase(tx, { topupPurchaseId: 'tp_2' }));
    const spend = await reserveSmsCredits({ salonId: 's_tp1', dedupeKey: 'tp_res2', segments: 100 });
    await settleReservationOnAccept({
      reservationId: (spend as { reservationId: string }).reservationId,
      providerSid: 'SM_tp2',
    });
    const dispute = await db.transaction(async tx =>
      reverseTopup(tx, { topupPurchaseId: 'tp_2', kind: 'dispute', stripeRef: 'dp_tp2' }));

    expect(dispute.reversed).toBe(100);

    const blocked = await reserveSmsCredits({ salonId: 's_tp1', dedupeKey: 'tp_res3', segments: 1 });

    expect(blocked.ok).toBe(false);
  });
});

describe('top-up reversal — cumulative partial-refund arithmetic (§7.8)', () => {
  async function seedPurchase(input: {
    salonId: string;
    purchaseId: string;
    credits: number;
    amountCents: number;
    offerKey?: string;
  }) {
    const { fulfillTopupPurchase } = await grants();
    await seedSalon(input.salonId);
    await db.insert(schema.smsTopupPurchaseSchema).values({
      id: input.purchaseId,
      salonId: input.salonId,
      topupOfferKey: input.offerKey ?? 'topup_100_paid_2026_08',
      credits: input.credits,
      amountCents: input.amountCents,
      status: 'paid',
      stripeCheckoutSessionId: `cs_${input.purchaseId}`,
      stripePaymentIntentId: `pi_${input.purchaseId}`,
    });
    await db.transaction(async tx => fulfillTopupPurchase(tx, { topupPurchaseId: input.purchaseId }));
  }

  async function consume(salonId: string, dedupeKey: string, segments: number) {
    const { reserveSmsCredits, settleReservationOnAccept } = await import('./creditReservation');
    const reserved = await reserveSmsCredits({ salonId, dedupeKey, segments });
    await settleReservationOnAccept({
      reservationId: (reserved as { reservationId: string }).reservationId,
      providerSid: `SM_${dedupeKey}`,
    });
  }

  const refund = async (purchaseId: string, stripeRef: string, cumulativeRefundedCents: number) =>
    db.transaction(async tx =>
      (await grants()).reverseTopup(tx, { topupPurchaseId: purchaseId, kind: 'refund', stripeRef, cumulativeRefundedCents }));

  it('converges two sequential partials on the cumulative target, not summed per-refund floors', async () => {
    // G=250, A=1399¢. T(400)=floor(100000/1399)=71; T(800)=floor(200000/1399)=142.
    // Per-refund floors would also give 71+71 here, but only cumulative
    // targeting GUARANTEES total = T(cumulative) for every partition of the
    // same refunded cents — pin the invariant, not the coincidence.
    await seedPurchase({ salonId: 's_rv1', purchaseId: 'tp_rv1', credits: 250, amountCents: 1399, offerKey: 'topup_250_paid_2026_08' });

    expect((await refund('tp_rv1', 're_rv1a', 400)).reversed).toBe(71);
    expect((await refund('tp_rv1', 're_rv1b', 800)).reversed).toBe(71);

    const total = await db.execute(sql`
      SELECT COALESCE(-SUM(amount), 0)::int AS reversed FROM sms_credit_ledger
      WHERE salon_id = 's_rv1' AND entry_type = 'purchase_reversal'
    `);

    expect(Number((total.rows[0] as Record<string, unknown>).reversed)).toBe(142);
  });

  it('reverses proportionally after partial consumption', async () => {
    // G=100, A=599¢, 40 consumed. T(300)=floor(30000/599)=50 ≤ U=60 → 50.
    await seedPurchase({ salonId: 's_rv2', purchaseId: 'tp_rv2', credits: 100, amountCents: 599 });
    await consume('s_rv2', 'rv2_spend', 40);
    const result = await refund('tp_rv2', 're_rv2', 300);

    expect(result).toEqual({ reversed: 50, shortfall: 0, anomaly: null });
  });

  it('caps at unused value and audits the consumed shortfall', async () => {
    // G=100, A=599¢, 70 consumed. T(300)=50, U=30 → reverse 30, shortfall 20.
    await seedPurchase({ salonId: 's_rv3', purchaseId: 'tp_rv3', credits: 100, amountCents: 599 });
    await consume('s_rv3', 'rv3_spend', 70);
    const result = await refund('tp_rv3', 're_rv3', 300);

    expect(result).toEqual({ reversed: 30, shortfall: 20, anomaly: null });

    const note = await db.execute(sql`
      SELECT note FROM sms_credit_ledger
      WHERE salon_id = 's_rv3' AND entry_type = 'purchase_reversal'
    `);

    expect(String((note.rows[0] as Record<string, unknown>).note)).toContain('consumed_shortfall=20');
  });

  it('is exact at full refund arriving after a partial', async () => {
    // G=100, A=599¢. T(220)=floor(22000/599)=36, then T(599)=100 → +64 = 100.
    await seedPurchase({ salonId: 's_rv4', purchaseId: 'tp_rv4', credits: 100, amountCents: 599 });

    expect((await refund('tp_rv4', 're_rv4a', 220)).reversed).toBe(36);
    expect((await refund('tp_rv4', 're_rv4b', 599)).reversed).toBe(64);

    const purchase = await db
      .select({ status: schema.smsTopupPurchaseSchema.status })
      .from(schema.smsTopupPurchaseSchema)
      .where(eq(schema.smsTopupPurchaseSchema.id, 'tp_rv4'));

    expect(purchase[0]!.status).toBe('refunded');
  });

  it('dispute after a partial refund reverses only the residual G − C', async () => {
    // Prior partial reversed 36; dispute reverses 100 − 36 = 64, never 100 —
    // total reversal can never exceed the grant.
    await seedPurchase({ salonId: 's_rv5', purchaseId: 'tp_rv5', credits: 100, amountCents: 599 });

    expect((await refund('tp_rv5', 're_rv5', 220)).reversed).toBe(36);

    const dispute = await db.transaction(async tx =>
      (await grants()).reverseTopup(tx, { topupPurchaseId: 'tp_rv5', kind: 'dispute', stripeRef: 'dp_rv5' }));

    expect(dispute.reversed).toBe(64);

    const total = await db.execute(sql`
      SELECT COALESCE(-SUM(amount), 0)::int AS reversed FROM sms_credit_ledger
      WHERE salon_id = 's_rv5' AND entry_type = 'purchase_reversal'
    `);

    expect(Number((total.rows[0] as Record<string, unknown>).reversed)).toBe(100);
  });

  it('replayed and reordered refund events are no-ops', async () => {
    await seedPurchase({ salonId: 's_rv6', purchaseId: 'tp_rv6', credits: 100, amountCents: 599 });

    expect((await refund('tp_rv6', 're_rv6', 400)).reversed).toBe(66);
    // Same event redelivered: same cumulative figure ⇒ T = C ⇒ 0.
    expect((await refund('tp_rv6', 're_rv6', 400)).reversed).toBe(0);
  });

  it('a cumulative figure that moved backward writes nothing and flags the anomaly', async () => {
    // Stripe refunds can FAIL after creation, shrinking amount_refunded. The
    // append-only ledger never auto-claws-forward — manual audited adjustment.
    await seedPurchase({ salonId: 's_rv7', purchaseId: 'tp_rv7', credits: 100, amountCents: 599 });

    expect((await refund('tp_rv7', 're_rv7a', 400)).reversed).toBe(66);
    expect(await refund('tp_rv7', 're_rv7b', 300))
      .toEqual({ reversed: 0, shortfall: 0, anomaly: 'REFUND_TOTAL_REGRESSED' });
  });

  it('a refund without cumulative evidence fails closed', async () => {
    await seedPurchase({ salonId: 's_rv8', purchaseId: 'tp_rv8', credits: 100, amountCents: 599 });
    const result = await db.transaction(async tx =>
      (await grants()).reverseTopup(tx, { topupPurchaseId: 'tp_rv8', kind: 'refund', stripeRef: 're_rv8' }));

    expect(result).toEqual({ reversed: 0, shortfall: 0, anomaly: 'REFUND_EVIDENCE_MISSING' });
  });
});

describe('upgrade diff — window-cumulative, not plan-pair (§6.4)', () => {
  it('a downgrade-then-upgrade sequence cannot farm credits past the highest allowance', async () => {
    const { applyUpgradeDiff, evaluateSubscriptionWindows } = await grants();
    await seedSalon('s_farm');
    await seedSubscription({
      id: 'sub_farm',
      salonId: 's_farm',
      anchor: new Date('2026-08-01T00:00:00.000Z'),
      paidThrough: new Date('2026-09-01T00:00:00.000Z'),
    });
    const now = new Date('2026-08-10T00:00:00.000Z');
    await evaluateSubscriptionWindows({ subscriptionId: 'sub_farm', now });

    expect(await monthlyBalance('s_farm')).toBe(200); // starter window grant

    // Starter→Elite tops the window up to Elite's 800.
    const up1 = await db.transaction(async tx =>
      applyUpgradeDiff(tx, { subscriptionId: 'sub_farm', fromPlanKey: 'starter_2026_08', toPlanKey: 'elite_2026_08', now }));

    expect(up1.granted).toBe(600);

    // Downgrade (pending, no clawback), then Starter→Pro: a plan-PAIR diff
    // would mint +200 under a fresh pair key; cumulative evidence sees 800
    // already granted ≥ Pro's 400 and mints nothing.
    const up2 = await db.transaction(async tx =>
      applyUpgradeDiff(tx, { subscriptionId: 'sub_farm', fromPlanKey: 'starter_2026_08', toPlanKey: 'pro_2026_08', now }));

    expect(up2.granted).toBe(0);
    expect(await monthlyBalance('s_farm')).toBe(800);
  });

  it('grants nothing for a window the engine has not granted', async () => {
    const { applyUpgradeDiff } = await grants();
    await seedSalon('s_ungr');
    await seedSubscription({
      id: 'sub_ungr',
      salonId: 's_ungr',
      anchor: new Date('2026-08-01T00:00:00.000Z'),
      paidThrough: new Date('2026-09-01T00:00:00.000Z'),
    });
    // No evaluateSubscriptionWindows call: window 0 has no granted row, so the
    // engine owns it entirely — it will grant the NEW plan's full allowance
    // when it runs, and an upgrade diff here would double-grant.
    const result = await db.transaction(async tx =>
      applyUpgradeDiff(tx, {
        subscriptionId: 'sub_ungr',
        fromPlanKey: 'starter_2026_08',
        toPlanKey: 'elite_2026_08',
        now: new Date('2026-08-10T00:00:00.000Z'),
      }));

    expect(result.granted).toBe(0);
    expect(await monthlyBalance('s_ungr')).toBe(0);
  });
});

describe('OP-5 — window-engine anomalies reach Sentry', () => {
  it('an unknown plan key grants nothing, keeps the summary shape AND alerts', async () => {
    const { evaluateSubscriptionWindows } = await grants();
    await seedSalon('s_anom_plan');
    await seedSubscription({
      id: 'sub_anom_plan',
      salonId: 's_anom_plan',
      planKey: 'retired_plan_1999_01',
      anchor: new Date('2026-08-01T00:00:00.000Z'),
      paidThrough: new Date('2026-09-01T00:00:00.000Z'),
    });

    const summary = await evaluateSubscriptionWindows({
      subscriptionId: 'sub_anom_plan',
      now: new Date('2026-08-10T00:00:00.000Z'),
    });

    expect(summary).toEqual({ granted: 0, skippedUnpaid: 0, skippedMissed: 0, anomalies: ['UNKNOWN_PLAN_DEFINITION'] });
    expect(sentryHolder.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentryHolder.captureMessage).toHaveBeenCalledWith('billing.window_engine_anomaly', {
      level: 'warning',
      extra: { anomaly: 'UNKNOWN_PLAN_DEFINITION', subscriptionId: 'sub_anom_plan', salonId: 's_anom_plan' },
    });
  });

  it('an ordinary grant alerts nothing', async () => {
    const { evaluateSubscriptionWindows } = await grants();
    await seedSalon('s_anom_none');
    await seedSubscription({
      id: 'sub_anom_none',
      salonId: 's_anom_none',
      anchor: new Date('2026-08-01T00:00:00.000Z'),
      paidThrough: new Date('2026-09-01T00:00:00.000Z'),
    });

    const summary = await evaluateSubscriptionWindows({
      subscriptionId: 'sub_anom_none',
      now: new Date('2026-08-10T00:00:00.000Z'),
    });

    expect(summary).toMatchObject({ granted: 1, anomalies: [] });
    expect(sentryHolder.captureMessage).not.toHaveBeenCalled();
  });

  it('applyUpgradeDiff alerts on the same code at its own silent-return site', async () => {
    const { applyUpgradeDiff } = await grants();
    await seedSalon('s_anom_diff');
    await seedSubscription({
      id: 'sub_anom_diff',
      salonId: 's_anom_diff',
      anchor: new Date('2026-08-01T00:00:00.000Z'),
      paidThrough: new Date('2026-09-01T00:00:00.000Z'),
    });

    const diff = await db.transaction(async tx =>
      applyUpgradeDiff(tx, {
        subscriptionId: 'sub_anom_diff',
        fromPlanKey: 'starter_2026_08',
        toPlanKey: 'retired_plan_1999_01',
        now: new Date('2026-08-10T00:00:00.000Z'),
      }));

    // The return shape is untouched — only the alert is new.
    expect(diff).toEqual({ granted: 0 });
    expect(sentryHolder.captureMessage).toHaveBeenCalledWith('billing.window_engine_anomaly', {
      level: 'warning',
      extra: { anomaly: 'UNKNOWN_PLAN_DEFINITION', subscriptionId: 'sub_anom_diff', salonId: 's_anom_diff' },
    });
  });
});

describe('P3c — transactional audit trail (§8.5, §17)', () => {
  const auditRowsFor = (entityId: string) =>
    db.select().from(schema.auditLogSchema).where(eq(schema.auditLogSchema.entityId, entityId));

  it('reservePromotionClaim writes ONE billing_promotion_claim_reserved row; reuse writes none', async () => {
    const { reservePromotionClaim } = await claims();
    const { resolveOrCreateBusinessIdentity } = await identity();
    await seedSalon('s_audit_pc1');
    const identityId = (await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { clerkUserId: 'user_audit_pc1' }))).businessIdentityId;

    const reserved = await db.transaction(async tx =>
      reservePromotionClaim(tx, { promotionKey: 'founding_annual_2026', businessIdentityId: identityId, salonId: 's_audit_pc1' }));
    const claimId = (reserved as { claimId: string }).claimId;

    const rows = await auditRowsFor(claimId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      salonId: 's_audit_pc1',
      actorType: 'webhook',
      actorId: 'stripe-billing',
      action: 'billing_promotion_claim_reserved',
      entityType: 'billing_promotion_claim',
    });
    expect(rows[0]!.metadata).toMatchObject({ promotionKey: 'founding_annual_2026', businessIdentityId: identityId });

    // Reuse (same salon, still reserved) is NOT a new transition.
    await db.transaction(async tx =>
      reservePromotionClaim(tx, { promotionKey: 'founding_annual_2026', businessIdentityId: identityId, salonId: 's_audit_pc1' }));

    expect(await auditRowsFor(claimId)).toHaveLength(1);
  });

  it('redeemPromotionClaim and releasePromotionClaim each write exactly one row on the real transition, none on replay', async () => {
    const { redeemPromotionClaim, releasePromotionClaim, reservePromotionClaim } = await claims();
    const { resolveOrCreateBusinessIdentity } = await identity();
    await seedSalon('s_audit_pc2');
    const identityId = (await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { clerkUserId: 'user_audit_pc2' }))).businessIdentityId;
    const reserved = await db.transaction(async tx =>
      reservePromotionClaim(tx, { promotionKey: 'founding_annual_2026', businessIdentityId: identityId, salonId: 's_audit_pc2' }));
    const claimId = (reserved as { claimId: string }).claimId;

    await db.transaction(async tx => redeemPromotionClaim(tx, { claimId, stripeCheckoutSessionId: 'cs_audit_pc2' }));
    // Replay of an already-redeemed claim must not double-log.
    await db.transaction(async tx => redeemPromotionClaim(tx, { claimId, stripeCheckoutSessionId: 'cs_audit_pc2' }));

    const redeemedRows = await db.select().from(schema.auditLogSchema)
      .where(eq(schema.auditLogSchema.action, 'billing_promotion_claim_redeemed'));
    const redeemedForClaim = redeemedRows.filter(row => row.entityId === claimId);

    expect(redeemedForClaim).toHaveLength(1);
    expect(redeemedForClaim[0]!.salonId).toBe('s_audit_pc2');

    // A second, separate claim exercises release.
    const otherId = (await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { clerkUserId: 'user_audit_pc2b' }))).businessIdentityId;
    const secondReserved = await db.transaction(async tx =>
      reservePromotionClaim(tx, { promotionKey: 'founding_annual_2026', businessIdentityId: otherId, salonId: 's_audit_pc2' }));
    const secondClaimId = (secondReserved as { claimId: string }).claimId;

    await db.transaction(async tx => releasePromotionClaim(tx, { claimId: secondClaimId }));
    // Replay (already released, no longer 'reserved') must not double-log.
    await db.transaction(async tx => releasePromotionClaim(tx, { claimId: secondClaimId }));

    const releasedRows = (await auditRowsFor(secondClaimId))
      .filter(row => row.action === 'billing_promotion_claim_released');

    expect(releasedRows).toHaveLength(1);
  });

  it('completeAttempt and expireAttempt each write exactly one attempt-lifecycle row', async () => {
    const { beginCheckoutAttempt, completeAttempt, expireAttempt, markAttemptCheckoutCreated } = await attempts();
    await seedSalon('s_audit_ca1');
    const begun = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, { salonId: 's_audit_ca1', purpose: 'plan_subscription', billingOfferKey: 'starter_2026_08_monthly' }));
    const attemptId = (begun as { attemptId: string }).attemptId;
    await db.transaction(async tx =>
      markAttemptCheckoutCreated(tx, { attemptId, stripeCheckoutSessionId: 'cs_audit_ca1' }));

    await db.transaction(async tx => completeAttempt(tx, { stripeCheckoutSessionId: 'cs_audit_ca1' }));
    // Replay: already 'completed', no matching row to update, no double-log.
    await db.transaction(async tx => completeAttempt(tx, { stripeCheckoutSessionId: 'cs_audit_ca1' }));

    const completedRows = (await auditRowsFor(attemptId))
      .filter(row => row.action === 'billing_checkout_attempt_completed');

    expect(completedRows).toHaveLength(1);
    expect(completedRows[0]).toMatchObject({ salonId: 's_audit_ca1', actorType: 'webhook', actorId: 'stripe-billing' });

    // A second attempt exercises expiry.
    const begun2 = await db.transaction(async tx =>
      beginCheckoutAttempt(tx, { salonId: 's_audit_ca1', purpose: 'sms_topup', topupOfferKey: 'topup_100_paid_2026_08' }));
    const attemptId2 = (begun2 as { attemptId: string }).attemptId;
    await db.transaction(async tx =>
      markAttemptCheckoutCreated(tx, { attemptId: attemptId2, stripeCheckoutSessionId: 'cs_audit_ca1_expire' }));

    await db.transaction(async tx =>
      expireAttempt(tx, { stripeCheckoutSessionId: 'cs_audit_ca1_expire', purpose: 'sms_topup' }));
    await db.transaction(async tx =>
      expireAttempt(tx, { stripeCheckoutSessionId: 'cs_audit_ca1_expire', purpose: 'sms_topup' }));

    const expiredRows = (await auditRowsFor(attemptId2))
      .filter(row => row.action === 'billing_checkout_attempt_expired');

    expect(expiredRows).toHaveLength(1);
  });

  it('a forced rollback after reservePromotionClaim leaves NO audit row (and no claim row)', async () => {
    const { reservePromotionClaim } = await claims();
    const { resolveOrCreateBusinessIdentity } = await identity();
    await seedSalon('s_audit_rollback');
    const identityId = (await db.transaction(async tx =>
      resolveOrCreateBusinessIdentity(tx, { clerkUserId: 'user_audit_rollback' }))).businessIdentityId;

    let claimIdForCheck: string | undefined;

    await expect(db.transaction(async (tx) => {
      const reserved = await reservePromotionClaim(tx, {
        promotionKey: 'founding_annual_2026',
        businessIdentityId: identityId,
        salonId: 's_audit_rollback',
      });
      claimIdForCheck = (reserved as { claimId: string }).claimId;
      throw new Error('forced rollback');
    })).rejects.toThrow('forced rollback');

    expect(await auditRowsFor(claimIdForCheck!)).toHaveLength(0);

    const claimRows = await db.select().from(schema.billingPromotionClaimSchema)
      .where(eq(schema.billingPromotionClaimSchema.id, claimIdForCheck!));

    expect(claimRows).toHaveLength(0);
  });
});
