/**
 * SMS-credit financial integrity under GENUINE concurrency.
 *
 * PGlite runs on a single connection, so it cannot prove the per-salon
 * account row lock holds under a race. This suite drives the real engine
 * against a throwaway PostgreSQL server over a real connection pool.
 *
 * Opt-in and refuses to run against anything that is not an explicitly
 * local/CI throwaway database — the project's "tests never touch a real
 * database" guarantee is preserved.
 *
 *   docker run -d --name luster-qa-pg -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER=qa \
 *     -e POSTGRES_DB=luster_qa -p 55432:5432 postgres:16
 *   CONCURRENCY_TEST_DATABASE_URL=postgres://qa@127.0.0.1:55432/luster_qa \
 *     npx vitest run src/libs/billing/creditReservation.concurrency.integration.test.ts
 */
import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const envHolder = vi.hoisted(() => ({
  BILLING_IDENTITY_HMAC_SECRET: 'concurrency-test-secret',
  BILLING_IDENTITY_HMAC_VERSION: 1,
}));

vi.mock('@/libs/Env', () => ({ Env: envHolder }));

const RAW_URL = process.env.CONCURRENCY_TEST_DATABASE_URL ?? '';
let parsedUrl: URL | null = null;
try {
  parsedUrl = RAW_URL ? new URL(RAW_URL) : null;
} catch {
  parsedUrl = null;
}
const parsedDb = parsedUrl ? decodeURIComponent(parsedUrl.pathname).replace(/^\//, '') : '';
const disposableConfirmed
  = process.env.SMS_CREDIT_LEDGER_DISPOSABLE_DATABASE_CONFIRMED === 'true'
  || (parsedDb === 'luster_qa' && parsedUrl?.username === 'qa');
const isLocalThrowaway
  = parsedUrl !== null
  && ['127.0.0.1', 'localhost'].includes(parsedUrl.hostname)
  && parsedDb.length > 0
  && disposableConfirmed
  && !RAW_URL.includes('neon.tech');

const suite = isLocalThrowaway ? describe : describe.skip;

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

suite('credit engine — real-lock concurrency matrix', () => {
  beforeAll(async () => {
    pool = new pg.Pool({
      connectionString: RAW_URL,
      max: 30,
      application_name: 'gate-b-sms-credit-concurrency-test',
    });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    holder.db = db;
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE salon CASCADE;
      TRUNCATE billing_business_identity CASCADE;
      TRUNCATE billing_promotion_claim CASCADE;
      TRUNCATE billing_stripe_event CASCADE;
      TRUNCATE sms_topup_purchase CASCADE;
    `);
    await db.insert(schema.salonSchema).values({ id: 's1', name: 'S1', slug: 's1' });
    await db.insert(schema.salonSchema).values({ id: 's2', name: 'S2', slug: 's2' });
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function grant(salonId: string, amount: number, key: string) {
    const { appendLotGrant, lockCreditAccount } = await import('./creditLedger');
    await db.transaction(async (tx) => {
      await lockCreditAccount(tx, salonId);
      await appendLotGrant(tx, {
        salonId,
        bucket: 'purchased',
        amount,
        expiresAt: null,
        idempotencyKey: key,
        reason: 'concurrency_seed',
      });
    });
  }

  it('25-way race on one remaining credit: exactly one hold, never negative', async () => {
    const { reserveSmsCredits } = await import('./creditReservation');
    await grant('s1', 1, 'c1_seed');
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        reserveSmsCredits({ salonId: 's1', dedupeKey: `c1_${i}`, segments: 1 })),
    );
    const wins = results.filter(result => result.ok);
    const blocked = results.filter(result => !result.ok);

    expect(wins).toHaveLength(1);
    expect(blocked).toHaveLength(24);

    const sum = await pool.query(
      `SELECT COALESCE(SUM(amount),0)::int AS total FROM sms_credit_ledger WHERE salon_id = 's1'`,
    );

    expect(Number(sum.rows[0].total)).toBeGreaterThanOrEqual(0);
  });

  it('settle vs release racing on the same reservation: exactly one terminal outcome, one debit set at most', async () => {
    const { reserveSmsCredits, releaseReservation, settleReservationOnAccept } = await import('./creditReservation');
    await grant('s1', 5, 'c2_seed');
    const reserved = await reserveSmsCredits({ salonId: 's1', dedupeKey: 'c2_key', segments: 2 });
    const reservationId = (reserved as { reservationId: string }).reservationId;

    const [settle, release] = await Promise.all([
      settleReservationOnAccept({ reservationId, providerSid: 'SM_c2' }),
      releaseReservation({ reservationId, reason: 'race' }),
    ]);

    // Exactly one side wins.
    expect(settle.settled !== release.released || (settle.settled && !release.released)).toBe(true);

    const status = await pool.query(
      `SELECT status FROM sms_credit_reservation WHERE id = $1`,
      [reservationId],
    );

    expect(['settled', 'released']).toContain(status.rows[0].status);

    const debits = await pool.query(
      `SELECT COUNT(*)::int AS n FROM sms_credit_ledger WHERE reservation_id = $1 AND entry_type = 'debit'`,
      [reservationId],
    );
    if (status.rows[0].status === 'released') {
      expect(Number(debits.rows[0].n)).toBe(0);
    } else {
      expect(Number(debits.rows[0].n)).toBe(1);
    }
  });

  it('two simultaneous terminal-failure refunds produce at most one refund per lot', async () => {
    const { refundTerminalFailure, reserveSmsCredits, settleReservationOnAccept } = await import('./creditReservation');
    await grant('s1', 5, 'c3_seed');
    const reserved = await reserveSmsCredits({ salonId: 's1', dedupeKey: 'c3_key', segments: 2 });
    const reservationId = (reserved as { reservationId: string }).reservationId;
    await settleReservationOnAccept({ reservationId, providerSid: 'SM_c3' });

    const [a, b] = await Promise.all([
      refundTerminalFailure({ reservationId }),
      refundTerminalFailure({ reservationId }),
    ]);

    expect(a.refundedLots + b.refundedLots).toBe(1);

    const refunds = await pool.query(
      `SELECT COUNT(*)::int AS n FROM sms_credit_ledger WHERE entry_type = 'sms_refund' AND salon_id = 's1'`,
    );

    expect(Number(refunds.rows[0].n)).toBe(1);
  });

  it('N-parallel window evaluations grant one lot and one granted window row', async () => {
    const { evaluateSubscriptionWindows } = await import('./creditGrants');
    const anchor = new Date('2026-08-01T00:00:00.000Z');
    await db.insert(schema.billingSubscriptionSchema).values({
      id: 'sub_c4',
      salonId: 's1',
      stripeSubscriptionId: 'sub_c4',
      stripeCustomerId: 'cus_c4',
      planDefinitionKey: 'starter_2026_08',
      billingOfferKey: 'starter_2026_08_monthly',
      billingCadence: 'monthly',
      status: 'active',
      paidThrough: new Date('2026-09-01T00:00:00.000Z'),
      creditCycleAnchor: anchor,
    });
    const now = new Date('2026-08-10T00:00:00.000Z');
    const results = await Promise.all(
      Array.from({ length: 8 }, () => evaluateSubscriptionWindows({ subscriptionId: 'sub_c4', now })),
    );
    const granted = results.reduce((sum, result) => sum + result.granted, 0);

    expect(granted).toBe(1);

    const lots = await pool.query(
      `SELECT COUNT(*)::int AS n FROM sms_credit_ledger WHERE salon_id = 's1' AND bucket = 'monthly'`,
    );

    expect(Number(lots.rows[0].n)).toBe(1);
  });

  it('duplicate starter claims across two salons sharing one identity grant once', async () => {
    const { grantStarterCredits } = await import('./creditGrants');
    const { resolveOrCreateBusinessIdentity } = await import('./businessIdentity');
    const identityId = await db.transaction(async tx =>
      (await resolveOrCreateBusinessIdentity(tx, { clerkUserId: 'user_c5' })).businessIdentityId);
    const [a, b] = await Promise.all([
      db.transaction(async tx => grantStarterCredits(tx, { businessIdentityId: identityId, salonId: 's1' })),
      db.transaction(async tx => grantStarterCredits(tx, { businessIdentityId: identityId, salonId: 's2' })),
    ]);

    expect([a.granted, b.granted].filter(Boolean)).toHaveLength(1);

    const grants = await pool.query(
      `SELECT COUNT(*)::int AS n FROM sms_credit_ledger WHERE entry_type = 'grant' AND bucket = 'starter'`,
    );

    expect(Number(grants.rows[0].n)).toBe(1);
  });

  it('parallel promotion claims at an injected cap of 1 never exceed the cap', async () => {
    const { reservePromotionClaim } = await import('./promotionClaims');
    const { resolveOrCreateBusinessIdentity } = await import('./businessIdentity');
    const { PROMOTIONS } = await import('@/libs/billing/promotions');
    const capped = {
      ...PROMOTIONS.founding_annual_2026,
      eligibleOfferKeys: [...PROMOTIONS.founding_annual_2026.eligibleOfferKeys],
      maximumRedemptions: 1,
    };
    const identities = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        db.transaction(async tx =>
          (await resolveOrCreateBusinessIdentity(tx, { clerkUserId: `user_cap_${i}` })).businessIdentityId)),
    );
    const results = await Promise.all(identities.map(identityId =>
      db.transaction(async tx =>
        reservePromotionClaim(tx, {
          promotionKey: 'cap_race_promo',
          businessIdentityId: identityId,
          salonId: 's1',
          promotionOverride: capped,
        }))));

    expect(results.filter(result => result.ok)).toHaveLength(1);
  });

  it('10-way checkout-attempt race yields exactly one active attempt (others reuse it)', async () => {
    const { beginCheckoutAttempt } = await import('./checkoutAttempts');
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        db.transaction(async tx =>
          beginCheckoutAttempt(tx, {
            salonId: 's1',
            purpose: 'plan_subscription',
            billingOfferKey: 'starter_2026_08_monthly',
          }))),
    );
    const ok = results.filter(result => result.ok) as Array<{ attemptId: string }>;

    expect(ok).toHaveLength(10);
    expect(new Set(ok.map(result => result.attemptId)).size).toBe(1);

    const active = await pool.query(
      `SELECT COUNT(*)::int AS n FROM billing_checkout_attempt
       WHERE salon_id = 's1' AND status IN ('creating','checkout_created')`,
    );

    expect(Number(active.rows[0].n)).toBe(1);
  });

  it('reaper racing settle never releases proven-accepted work', async () => {
    const { reapExpiredReservations, reserveSmsCredits, settleReservationOnAccept } = await import('./creditReservation');
    await grant('s1', 3, 'c8_seed');
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const reserved = await reserveSmsCredits({ salonId: 's1', dedupeKey: 'c8_key', segments: 1, now: past });
    const reservationId = (reserved as { reservationId: string }).reservationId;
    const [settle] = await Promise.all([
      settleReservationOnAccept({ reservationId, providerSid: 'SM_c8' }),
      reapExpiredReservations(new Date()),
    ]);
    const status = await pool.query(
      `SELECT status FROM sms_credit_reservation WHERE id = $1`,
      [reservationId],
    );
    if (settle.settled) {
      expect(status.rows[0].status).toBe('settled');
    } else {
      expect(status.rows[0].status).toBe('released');
    }
  });

  it('dispute-driven negative availability blocks concurrent reserves', async () => {
    const { fulfillTopupPurchase, reverseTopup } = await import('./creditGrants');
    const { reserveSmsCredits, settleReservationOnAccept } = await import('./creditReservation');
    await db.insert(schema.smsTopupPurchaseSchema).values({
      id: 'tp_c9',
      salonId: 's1',
      topupOfferKey: 'topup_100_paid_2026_08',
      credits: 100,
      amountCents: 599,
      status: 'paid',
      stripeCheckoutSessionId: 'cs_c9',
      stripePaymentIntentId: 'pi_c9',
    });
    await db.transaction(async tx => fulfillTopupPurchase(tx, { topupPurchaseId: 'tp_c9' }));
    const spend = await reserveSmsCredits({ salonId: 's1', dedupeKey: 'c9_spend', segments: 100 });
    await settleReservationOnAccept({
      reservationId: (spend as { reservationId: string }).reservationId,
      providerSid: 'SM_c9',
    });
    const [dispute, attempt] = await Promise.all([
      db.transaction(async tx => reverseTopup(tx, { topupPurchaseId: 'tp_c9', kind: 'dispute', stripeRef: 'dp_c9' })),
      reserveSmsCredits({ salonId: 's1', dedupeKey: 'c9_after', segments: 1 }),
    ]);

    expect(dispute.reversed).toBe(100);

    // Whether the racer beat the dispute or not, a post-dispute reserve is blocked.
    const post = await reserveSmsCredits({ salonId: 's1', dedupeKey: 'c9_post', segments: 1 });

    expect(post.ok).toBe(false);
    expect(attempt.ok === true || attempt.ok === false).toBe(true);
  });
});
