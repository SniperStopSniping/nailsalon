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
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

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
    const diff = await db.transaction(async tx =>
      (await grants()).applyUpgradeDiff === undefined
        ? { granted: -1 }
        : applyUpgradeDiff(tx, { subscriptionId: 'sub_up', fromPlanKey: 'starter_2026_08', toPlanKey: 'pro_2026_08', now }));

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
      reverseTopup(tx, { topupPurchaseId: 'tp_1', kind: 'refund', stripeRef: 're_tp1' }));

    expect(refund.reversed).toBe(70);

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
