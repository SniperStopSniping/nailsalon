/**
 * P8a — PGlite proofs for the read-only billing integrity check (G12, §19).
 *
 * Unlike ./creditGrants.test.ts, this module (and its only dependency,
 * ./creditLedger.ts) never imports `@/libs/Env` or `@/libs/DB` — only
 * `server-only` needs mocking here.
 *
 * Every anomaly test seeds its OWN dedicated salon and asserts against
 * violations FILTERED to that salon's id, so the tests never depend on
 * execution order or on what earlier tests in this file left behind.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

let db: ReturnType<typeof drizzle<typeof schema>>;

const integrity = () => import('./integrityCheck');

let salonCounter = 0;
async function seedSalon(): Promise<string> {
  salonCounter += 1;
  const id = `s_integrity_${salonCounter}`;
  await db.insert(schema.salonSchema).values({ id, name: `Salon ${id}`, slug: `integrity-${id}` });
  return id;
}

async function seedAccount(salonId: string, input: { cachedAvailable: number; cachedReserved: number }) {
  await db.insert(schema.smsCreditAccountSchema).values({
    salonId,
    cachedAvailable: input.cachedAvailable,
    cachedReserved: input.cachedReserved,
    cacheComputedAt: new Date(),
  });
}

let ledgerCounter = 0;
async function insertLedgerRow(input: {
  salonId: string;
  entryType: schema.SmsCreditEntryType;
  bucket: schema.SmsCreditBucket;
  amount: number;
  expiresAt?: Date | null;
  reason: string;
  idempotencyKey?: string;
  consumedFromLedgerId?: string | null;
  stripeRef?: string | null;
}): Promise<string> {
  ledgerCounter += 1;
  const id = `scl_integrity_${ledgerCounter}`;
  await db.insert(schema.smsCreditLedgerSchema).values({
    id,
    salonId: input.salonId,
    entryType: input.entryType,
    bucket: input.bucket,
    amount: input.amount,
    expiresAt: input.expiresAt ?? null,
    consumedFromLedgerId: input.consumedFromLedgerId ?? null,
    idempotencyKey: input.idempotencyKey ?? `integrity-test:${id}`,
    reason: input.reason,
    stripeRef: input.stripeRef ?? null,
  });
  return id;
}

let reservationCounter = 0;
async function insertReservation(input: {
  salonId: string;
  status: schema.SmsCreditReservationStatus;
  expiresAt: Date;
}): Promise<string> {
  reservationCounter += 1;
  const id = `scr_integrity_${reservationCounter}`;
  await db.insert(schema.smsCreditReservationSchema).values({
    id,
    salonId: input.salonId,
    dedupeKey: `integrity-test-dedupe:${id}`,
    segments: 1,
    status: input.status,
    expiresAt: input.expiresAt,
  });
  return id;
}

let attemptCounter = 0;
async function insertCheckoutAttempt(input: {
  salonId: string;
  status: schema.BillingCheckoutAttemptStatus;
  expiresAt: Date;
}): Promise<string> {
  attemptCounter += 1;
  const id = `bca_integrity_${attemptCounter}`;
  await db.insert(schema.billingCheckoutAttemptSchema).values({
    id,
    salonId: input.salonId,
    purpose: 'sms_topup',
    topupOfferKey: 'topup_500',
    status: input.status,
    stripeIdempotencyKey: `integrity-test-idem:${id}`,
    expiresAt: input.expiresAt,
  });
  return id;
}

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
});

describe('runBillingIntegrityCheck — clean seed', () => {
  it('reports no violations for a salon with matching cache, no reservations past lease, and no held attempts', async () => {
    const salonId = await seedSalon();
    await seedAccount(salonId, { cachedAvailable: 0, cachedReserved: 0 });

    const { runBillingIntegrityCheck } = await integrity();
    const result = await runBillingIntegrityCheck(db, { now: new Date() });

    expect(result.violations.filter(v => v.salonId === salonId)).toHaveLength(0);
  });

  it('does not flag legitimate multiple monthly/top-up lots that differ by window end / payment', async () => {
    const salonId = await seedSalon();
    // Deliberately no sms_credit_account row for this salon: the test is
    // scoped to the duplicate-lot-family checks only, which do not depend on
    // an account row existing.

    await insertLedgerRow({
      salonId,
      entryType: 'grant',
      bucket: 'monthly',
      amount: 200,
      expiresAt: new Date('2026-01-31T00:00:00.000Z'),
      reason: 'monthly_window_grant',
    });
    await insertLedgerRow({
      salonId,
      entryType: 'grant',
      bucket: 'monthly',
      amount: 200,
      expiresAt: new Date('2026-02-28T00:00:00.000Z'),
      reason: 'monthly_window_grant',
    });
    await insertLedgerRow({
      salonId,
      entryType: 'grant',
      bucket: 'purchased',
      amount: 50,
      expiresAt: null,
      reason: 'topup_fulfillment',
      stripeRef: 'pi_test_1',
    });
    await insertLedgerRow({
      salonId,
      entryType: 'grant',
      bucket: 'purchased',
      amount: 50,
      expiresAt: null,
      reason: 'topup_fulfillment',
      stripeRef: 'pi_test_2',
    });

    const { runBillingIntegrityCheck } = await integrity();
    const result = await runBillingIntegrityCheck(db, { now: new Date() });

    const forSalon = result.violations.filter(v => v.salonId === salonId);

    expect(forSalon.filter(v => v.code === 'DUPLICATE_MONTHLY_WINDOW_GRANT_LOTS')).toHaveLength(0);
    expect(forSalon.filter(v => v.code === 'DUPLICATE_TOPUP_GRANT_LOTS')).toHaveLength(0);
  });
});

describe('runBillingIntegrityCheck — injected anomalies', () => {
  it('flags two starter lots for one salon as DUPLICATE_STARTER_GRANT_LOTS, and nothing else for that salon', async () => {
    const salonId = await seedSalon();
    await insertLedgerRow({ salonId, entryType: 'grant', bucket: 'starter', amount: 100, reason: 'starter_grant', idempotencyKey: `starter-grant:identity-a-${salonId}` });
    await insertLedgerRow({ salonId, entryType: 'grant', bucket: 'starter', amount: 100, reason: 'starter_grant', idempotencyKey: `starter-grant:identity-b-${salonId}` });

    const { runBillingIntegrityCheck } = await integrity();
    const result = await runBillingIntegrityCheck(db, { now: new Date() });

    const forSalon = result.violations.filter(v => v.salonId === salonId);

    expect(forSalon).toHaveLength(1);
    expect(forSalon[0]!.code).toBe('DUPLICATE_STARTER_GRANT_LOTS');
    expect(forSalon[0]!.detail).toMatchObject({ lotCount: 2 });
  });

  it('flags a negative available balance as NEGATIVE_AVAILABLE_BALANCE, and nothing else for that salon', async () => {
    const salonId = await seedSalon();
    const lotId = await insertLedgerRow({ salonId, entryType: 'grant', bucket: 'purchased', amount: 50, reason: 'topup_fulfillment', stripeRef: 'pi_negative_1' });
    // Over-consumption beyond the lot's own value — simulates a corrupted
    // dispute-reversal state, driving computeAvailableBalance's overhang
    // branch negative (-30).
    await insertLedgerRow({
      salonId,
      entryType: 'purchase_reversal',
      bucket: 'purchased',
      amount: -80,
      reason: 'topup_dispute_reversal',
      consumedFromLedgerId: lotId,
    });
    // Cache set to match the true computed balance so this salon triggers
    // ONLY the negative-balance violation, never a drift violation too.
    await seedAccount(salonId, { cachedAvailable: -30, cachedReserved: 0 });

    const { runBillingIntegrityCheck } = await integrity();
    const result = await runBillingIntegrityCheck(db, { now: new Date() });

    const forSalon = result.violations.filter(v => v.salonId === salonId);

    expect(forSalon).toHaveLength(1);
    expect(forSalon[0]!.code).toBe('NEGATIVE_AVAILABLE_BALANCE');
    expect(forSalon[0]!.detail).toMatchObject({ available: -30, disputeReversalCount: 1 });
  });

  it('flags a cached-balance vs ledger-sum mismatch as CACHED_BALANCE_DRIFT, and nothing else for that salon', async () => {
    const salonId = await seedSalon();
    // No ledger activity at all: the true computed balance is 0.
    await seedAccount(salonId, { cachedAvailable: 999, cachedReserved: 0 });

    const { runBillingIntegrityCheck } = await integrity();
    const result = await runBillingIntegrityCheck(db, { now: new Date() });

    const forSalon = result.violations.filter(v => v.salonId === salonId);

    expect(forSalon).toHaveLength(1);
    expect(forSalon[0]!.code).toBe('CACHED_BALANCE_DRIFT');
    expect(forSalon[0]!.detail).toMatchObject({ cachedAvailable: 999, computedAvailable: 0 });
  });

  it('flags a reservation past its lease with no settlement/release as ORPHAN_RESERVATION, and nothing else for that salon', async () => {
    const salonId = await seedSalon();
    // Deliberately no sms_credit_account row: a held reservation contributes
    // to computeAvailableBalance's `reserved` figure, and seeding a cache
    // value here would risk a spurious CACHED_BALANCE_DRIFT alongside the
    // orphan-reservation violation this test targets.
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const reservationId = await insertReservation({ salonId, status: 'held', expiresAt: past });

    const { runBillingIntegrityCheck } = await integrity();
    const result = await runBillingIntegrityCheck(db, { now: new Date() });

    const forSalon = result.violations.filter(v => v.salonId === salonId);

    expect(forSalon).toHaveLength(1);
    expect(forSalon[0]!.code).toBe('ORPHAN_RESERVATION');
    expect(forSalon[0]!.detail).toMatchObject({ reservationId });
  });

  it('flags an expired, unresolved top-up checkout attempt as HELD_TOPUP_ATTEMPT, and nothing else for that salon', async () => {
    const salonId = await seedSalon();
    await seedAccount(salonId, { cachedAvailable: 0, cachedReserved: 0 });
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const attemptId = await insertCheckoutAttempt({ salonId, status: 'checkout_created', expiresAt: past });

    const { runBillingIntegrityCheck } = await integrity();
    const result = await runBillingIntegrityCheck(db, { now: new Date() });

    const forSalon = result.violations.filter(v => v.salonId === salonId);

    expect(forSalon).toHaveLength(1);
    expect(forSalon[0]!.code).toBe('HELD_TOPUP_ATTEMPT');
    expect(forSalon[0]!.detail).toMatchObject({ attemptId, expired: true });
  });

  it('summary.byCode counts violations by code across the checked snapshot', async () => {
    const salonId = await seedSalon();
    await insertLedgerRow({ salonId, entryType: 'grant', bucket: 'starter', amount: 100, reason: 'starter_grant', idempotencyKey: `starter-grant:identity-c-${salonId}` });
    await insertLedgerRow({ salonId, entryType: 'grant', bucket: 'starter', amount: 100, reason: 'starter_grant', idempotencyKey: `starter-grant:identity-d-${salonId}` });

    const { runBillingIntegrityCheck } = await integrity();
    const result = await runBillingIntegrityCheck(db, { now: new Date() });

    expect(result.summary.violationCount).toBe(result.violations.length);
    expect(result.summary.byCode.DUPLICATE_STARTER_GRANT_LOTS).toBeGreaterThanOrEqual(1);
  });
});
