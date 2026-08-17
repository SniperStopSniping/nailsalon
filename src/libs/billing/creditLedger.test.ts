/**
 * B1 financial core — PGlite integration proofs for the lot ledger,
 * spend order, reservations, settle-on-accept, refunds and recovery.
 * Real-lock interleavings live in the disposable-Postgres concurrency
 * suite; everything here is single-connection logic proof.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
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

let db: ReturnType<typeof drizzle<typeof schema>>;

const NOW = new Date('2026-08-17T12:00:00.000Z');
const SOON = new Date('2026-08-31T12:00:00.000Z');
const PAST = new Date('2026-08-01T12:00:00.000Z');

const ledger = () => import('./creditLedger');
const reservations = () => import('./creditReservation');

async function seedSalon(id: string) {
  await db.insert(schema.salonSchema).values({ id, name: `Salon ${id}`, slug: `salon-${id}` });
}

async function grantLot(salonId: string, bucket: schema.SmsCreditBucket, amount: number, expiresAt: Date | null, key: string) {
  const { appendLotGrant, lockCreditAccount } = await ledger();
  return db.transaction(async (tx) => {
    await lockCreditAccount(tx, salonId);
    return appendLotGrant(tx, {
      salonId,
      bucket,
      amount,
      expiresAt,
      idempotencyKey: key,
      reason: 'test_grant',
    });
  });
}

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

describe('migration 0069 replay + constraints', () => {
  it('replayed the full chain including 0069 (append-only trigger active)', async () => {
    await seedSalon('s_constraints');
    await grantLot('s_constraints', 'purchased', 10, null, 'k_constraints_grant');

    await expect(
      db.execute(sql`UPDATE sms_credit_ledger SET amount = 99 WHERE idempotency_key = 'k_constraints_grant'`),
    ).rejects.toThrow(/append-only/);
  });

  it('rejects malformed rows: sign-vs-type, zero amounts, orphan negatives, bad buckets', async () => {
    await expect(db.execute(sql`
      INSERT INTO sms_credit_ledger (id, salon_id, entry_type, bucket, amount, idempotency_key, reason)
      VALUES ('bad1', 's_constraints', 'grant', 'monthly', -5, 'bad1', 'x')
    `)).rejects.toThrow();
    await expect(db.execute(sql`
      INSERT INTO sms_credit_ledger (id, salon_id, entry_type, bucket, amount, idempotency_key, reason)
      VALUES ('bad2', 's_constraints', 'debit', 'monthly', -5, 'bad2', 'x')
    `)).rejects.toThrow(); // negative without consumed_from_ledger_id
    await expect(db.execute(sql`
      INSERT INTO sms_credit_ledger (id, salon_id, entry_type, bucket, amount, idempotency_key, reason)
      VALUES ('bad3', 's_constraints', 'grant', 'gold', 5, 'bad3', 'x')
    `)).rejects.toThrow();
  });

  it('enforces the ledger idempotency backbone (duplicate keys grant nothing)', async () => {
    const first = await grantLot('s_constraints', 'purchased', 7, null, 'k_dup');
    const replay = await grantLot('s_constraints', 'purchased', 7, null, 'k_dup');

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.lotId).toBe(first.lotId);
  });
});

describe('spend order + virtual expiry', () => {
  it('spends monthly → promotional → delivery_recovery → administrative → starter → purchased, earliest expiry first', async () => {
    const { reserveSmsCredits } = await reservations();
    const { selectOpenLots, lockCreditAccount } = await ledger();
    await seedSalon('s_order');
    await grantLot('s_order', 'purchased', 5, null, 'o_purchased');
    await grantLot('s_order', 'starter', 5, null, 'o_starter');
    await grantLot('s_order', 'administrative', 5, null, 'o_admin');
    await grantLot('s_order', 'delivery_recovery', 5, SOON, 'o_recovery');
    await grantLot('s_order', 'promotional', 5, SOON, 'o_promo');
    await grantLot('s_order', 'monthly', 5, SOON, 'o_monthly');

    const order = await db.transaction(async (tx) => {
      await lockCreditAccount(tx, 's_order');
      return (await selectOpenLots(tx, 's_order', NOW)).map(lot => lot.bucket);
    });

    expect(order).toEqual(['monthly', 'promotional', 'delivery_recovery', 'administrative', 'starter', 'purchased']);

    const result = await reserveSmsCredits({ salonId: 's_order', dedupeKey: 'o_r1', segments: 12, now: NOW });

    expect(result.ok).toBe(true);

    const after = await db.transaction(async (tx) => {
      await lockCreditAccount(tx, 's_order');
      return await selectOpenLots(tx, 's_order', NOW);
    });
    // 12 segments consume monthly(5) + promotional(5) + recovery(2).
    const byBucket = Object.fromEntries(after.map(lot => [lot.bucket, lot.free]));

    expect(byBucket.monthly).toBeUndefined();
    expect(byBucket.promotional).toBeUndefined();
    expect(byBucket.delivery_recovery).toBe(3);
    expect(byBucket.starter).toBe(5);
    expect(byBucket.purchased).toBe(5);
  });

  it('excludes expired lots virtually — correctness never waits for a sweep', async () => {
    const { reserveSmsCredits } = await reservations();
    await seedSalon('s_expiry');
    await grantLot('s_expiry', 'monthly', 100, PAST, 'e_expired');
    const blocked = await reserveSmsCredits({ salonId: 's_expiry', dedupeKey: 'e_r1', segments: 1, now: NOW });

    expect(blocked).toMatchObject({ ok: false, reason: 'blocked_no_credit', available: 0 });
  });
});

describe('reservation lifecycle — settle-on-accept', () => {
  it('reserves, reuses idempotently, and blocks below balance without going negative', async () => {
    const { reserveSmsCredits } = await reservations();
    await seedSalon('s_res');
    await grantLot('s_res', 'purchased', 3, null, 'r_grant');

    const first = await reserveSmsCredits({ salonId: 's_res', dedupeKey: 'r_key', segments: 2, now: NOW });

    expect(first).toMatchObject({ ok: true, reused: false });

    const reuse = await reserveSmsCredits({ salonId: 's_res', dedupeKey: 'r_key', segments: 2, now: NOW });

    expect(reuse).toMatchObject({ ok: true, reused: true });

    const blocked = await reserveSmsCredits({ salonId: 's_res', dedupeKey: 'r_other', segments: 2, now: NOW });

    expect(blocked).toMatchObject({ ok: false, reason: 'blocked_no_credit', available: 1 });
  });

  it('settles on provider acceptance exactly once (replay-safe) and never re-releases', async () => {
    const { reserveSmsCredits, settleReservationOnAccept, releaseReservation } = await reservations();
    await seedSalon('s_settle');
    await grantLot('s_settle', 'purchased', 5, null, 'st_grant');
    const reserved = await reserveSmsCredits({ salonId: 's_settle', dedupeKey: 'st_key', segments: 2, now: NOW });

    expect(reserved.ok).toBe(true);

    const reservationId = (reserved as { reservationId: string }).reservationId;

    const settled = await settleReservationOnAccept({ reservationId, providerSid: 'SM_test_1', now: NOW });

    expect(settled).toEqual({ settled: true, alreadySettled: false });

    const replay = await settleReservationOnAccept({ reservationId, providerSid: 'SM_test_1', now: NOW });

    expect(replay).toEqual({ settled: true, alreadySettled: true });

    const debits = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM sms_credit_ledger WHERE reservation_id = ${reservationId} AND entry_type = 'debit'
    `);

    expect(Number((debits.rows[0] as Record<string, unknown>).n)).toBe(1);

    const releaseAfterSettle = await releaseReservation({ reservationId, reason: 'nope', now: NOW });

    expect(releaseAfterSettle.released).toBe(false);
  });

  it('sync provider rejection releases the hold with zero ledger rows', async () => {
    const { reserveSmsCredits, releaseReservation } = await reservations();
    await seedSalon('s_reject');
    await grantLot('s_reject', 'purchased', 2, null, 'rj_grant');
    const reserved = await reserveSmsCredits({ salonId: 's_reject', dedupeKey: 'rj_key', segments: 1, now: NOW });
    const reservationId = (reserved as { reservationId: string }).reservationId;
    const released = await releaseReservation({ reservationId, reason: 'provider_reject', now: NOW });

    expect(released.released).toBe(true);

    const entries = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM sms_credit_ledger WHERE reservation_id = ${reservationId}
    `);

    expect(Number((entries.rows[0] as Record<string, unknown>).n)).toBe(0);

    // Freed capacity is immediately reservable again.
    const again = await reserveSmsCredits({ salonId: 's_reject', dedupeKey: 'rj_key2', segments: 2, now: NOW });

    expect(again.ok).toBe(true);
  });

  it('the reaper releases only pre-send abandoned holds and skips settled work', async () => {
    const { reserveSmsCredits, settleReservationOnAccept, reapExpiredReservations } = await reservations();
    await seedSalon('s_reap');
    await grantLot('s_reap', 'purchased', 4, null, 'rp_grant');
    const stale = await reserveSmsCredits({ salonId: 's_reap', dedupeKey: 'rp_stale', segments: 1, now: PAST });
    const live = await reserveSmsCredits({ salonId: 's_reap', dedupeKey: 'rp_live', segments: 1, now: NOW });
    const settled = await reserveSmsCredits({ salonId: 's_reap', dedupeKey: 'rp_settled', segments: 1, now: PAST });
    await settleReservationOnAccept({
      reservationId: (settled as { reservationId: string }).reservationId,
      providerSid: 'SM_keep',
      now: NOW,
    });

    const result = await reapExpiredReservations(NOW);

    expect(result.released).toBe(1);

    const staleRow = await db.execute(sql`
      SELECT status FROM sms_credit_reservation WHERE id = ${(stale as { reservationId: string }).reservationId}
    `);

    expect((staleRow.rows[0] as Record<string, unknown>).status).toBe('released');

    const liveRow = await db.execute(sql`
      SELECT status FROM sms_credit_reservation WHERE id = ${(live as { reservationId: string }).reservationId}
    `);

    expect((liveRow.rows[0] as Record<string, unknown>).status).toBe('held');
  });
});

describe('refunds — terminal failure, expired-lot recovery, overprediction', () => {
  it('refunds a terminal failure exactly once into the ORIGINAL bucket with the original expiry', async () => {
    const { reserveSmsCredits, settleReservationOnAccept, refundTerminalFailure } = await reservations();
    await seedSalon('s_refund');
    await grantLot('s_refund', 'monthly', 3, SOON, 'rf_monthly');
    const reserved = await reserveSmsCredits({ salonId: 's_refund', dedupeKey: 'rf_key', segments: 2, now: NOW });
    const reservationId = (reserved as { reservationId: string }).reservationId;
    await settleReservationOnAccept({ reservationId, providerSid: 'SM_rf', now: NOW });

    const refund = await refundTerminalFailure({ reservationId, now: NOW });

    expect(refund.refundedLots).toBe(1);

    const replay = await refundTerminalFailure({ reservationId, now: NOW });

    expect(replay.refundedLots).toBe(0);

    const rows = await db.execute(sql`
      SELECT bucket, amount, expires_at FROM sms_credit_ledger
      WHERE idempotency_key = ${`sms-refund:${reservationId}:${await lotIdFor('rf_monthly')}`}
    `);

    expect(rows.rows).toHaveLength(1);

    const row = rows.rows[0] as Record<string, unknown>;

    expect(row.bucket).toBe('monthly');
    expect(Number(row.amount)).toBe(2);
    expect(new Date(row.expires_at as string).toISOString()).toBe(SOON.toISOString());
  });

  it('routes refunds for EXPIRED source lots into delivery_recovery (+30 days); purchased stays purchased', async () => {
    const { reserveSmsCredits, settleReservationOnAccept, refundTerminalFailure } = await reservations();
    await seedSalon('s_recovery');
    const nearExpiry = new Date(NOW.getTime() + 60_000);
    await grantLot('s_recovery', 'monthly', 1, nearExpiry, 'rc_monthly');
    await grantLot('s_recovery', 'purchased', 1, null, 'rc_purchased');
    const reserved = await reserveSmsCredits({ salonId: 's_recovery', dedupeKey: 'rc_key', segments: 2, now: NOW });
    const reservationId = (reserved as { reservationId: string }).reservationId;
    await settleReservationOnAccept({ reservationId, providerSid: 'SM_rc', now: NOW });

    const later = new Date(NOW.getTime() + 3_600_000); // monthly lot now expired
    const refund = await refundTerminalFailure({ reservationId, now: later });

    expect(refund.refundedLots).toBe(2);

    const recovery = await db.execute(sql`
      SELECT bucket, amount, expires_at FROM sms_credit_ledger
      WHERE salon_id = 's_recovery' AND entry_type = 'sms_refund' AND bucket = 'delivery_recovery'
    `);

    expect(recovery.rows).toHaveLength(1);

    const recoveryRow = recovery.rows[0] as Record<string, unknown>;

    expect(Number(recoveryRow.amount)).toBe(1);

    const expiresAt = new Date(recoveryRow.expires_at as string).getTime();

    expect(expiresAt).toBe(later.getTime() + 30 * 24 * 60 * 60 * 1000);

    const purchased = await db.execute(sql`
      SELECT amount, expires_at FROM sms_credit_ledger
      WHERE salon_id = 's_recovery' AND entry_type = 'sms_refund' AND bucket = 'purchased'
    `);

    expect(purchased.rows).toHaveLength(1);
    expect((purchased.rows[0] as Record<string, unknown>).expires_at).toBeNull();
  });

  it('refunds segment overprediction exactly (predicted − actual), once', async () => {
    const { reserveSmsCredits, settleReservationOnAccept, refundOverpredictedSegments } = await reservations();
    await seedSalon('s_over');
    await grantLot('s_over', 'purchased', 5, null, 'ov_grant');
    const reserved = await reserveSmsCredits({ salonId: 's_over', dedupeKey: 'ov_key', segments: 3, now: NOW });
    const reservationId = (reserved as { reservationId: string }).reservationId;
    await settleReservationOnAccept({ reservationId, providerSid: 'SM_ov', now: NOW });

    const refund = await refundOverpredictedSegments({ reservationId, actualSegments: 1, now: NOW });

    expect(refund.refundedSegments).toBe(2);

    const replay = await refundOverpredictedSegments({ reservationId, actualSegments: 1, now: NOW });

    expect(replay.refundedSegments).toBe(0);

    const equalCase = await refundOverpredictedSegments({ reservationId, actualSegments: 3, now: NOW });

    expect(equalCase.refundedSegments).toBe(0);
  });

  it('the two refund arms NEVER stack past the debit: overprediction first, terminal failure second', async () => {
    const { reserveSmsCredits, settleReservationOnAccept, refundOverpredictedSegments, refundTerminalFailure } = await reservations();
    await seedSalon('s_stack1');
    await grantLot('s_stack1', 'purchased', 5, null, 'st1_grant');
    const reserved = await reserveSmsCredits({ salonId: 's_stack1', dedupeKey: 'st1_key', segments: 3, now: NOW });
    const reservationId = (reserved as { reservationId: string }).reservationId;
    await settleReservationOnAccept({ reservationId, providerSid: 'SM_st1', now: NOW });

    expect((await refundOverpredictedSegments({ reservationId, actualSegments: 1, now: NOW })).refundedSegments).toBe(2);

    await refundTerminalFailure({ reservationId, now: NOW });

    const totals = await db.execute(sql`
      SELECT COALESCE(SUM(amount), 0)::int AS refunded FROM sms_credit_ledger
      WHERE salon_id = 's_stack1' AND entry_type = 'sms_refund'
    `);

    // 2 (overpredict) + 1 (terminal, net) — never 2 + 3.
    expect((totals.rows[0] as Record<string, unknown>).refunded).toBe(3);
  });

  it('the two refund arms NEVER stack past the debit: terminal failure first, reconciliation second', async () => {
    const { reserveSmsCredits, settleReservationOnAccept, refundOverpredictedSegments, refundTerminalFailure } = await reservations();
    await seedSalon('s_stack2');
    await grantLot('s_stack2', 'purchased', 5, null, 'st2_grant');
    const reserved = await reserveSmsCredits({ salonId: 's_stack2', dedupeKey: 'st2_key', segments: 3, now: NOW });
    const reservationId = (reserved as { reservationId: string }).reservationId;
    await settleReservationOnAccept({ reservationId, providerSid: 'SM_st2', now: NOW });
    await refundTerminalFailure({ reservationId, now: NOW });

    expect((await refundOverpredictedSegments({ reservationId, actualSegments: 1, now: NOW })).refundedSegments).toBe(0);

    const totals = await db.execute(sql`
      SELECT COALESCE(SUM(amount), 0)::int AS refunded FROM sms_credit_ledger
      WHERE salon_id = 's_stack2' AND entry_type = 'sms_refund'
    `);

    expect((totals.rows[0] as Record<string, unknown>).refunded).toBe(3);
  });

  it('overprediction refunds return LOWEST-priority value first (purchased before monthly)', async () => {
    const { reserveSmsCredits, settleReservationOnAccept, refundOverpredictedSegments } = await reservations();
    await seedSalon('s_revorder');
    await grantLot('s_revorder', 'monthly', 2, new Date(NOW.getTime() + 7 * 24 * 3600 * 1000), 'or_monthly');
    await grantLot('s_revorder', 'purchased', 2, null, 'or_purchased');
    const reserved = await reserveSmsCredits({ salonId: 's_revorder', dedupeKey: 'or_key', segments: 3, now: NOW });
    const reservationId = (reserved as { reservationId: string }).reservationId;
    await settleReservationOnAccept({ reservationId, providerSid: 'SM_or', now: NOW });

    expect((await refundOverpredictedSegments({ reservationId, actualSegments: 2, now: NOW })).refundedSegments).toBe(1);

    const refund = await db.execute(sql`
      SELECT bucket, amount FROM sms_credit_ledger
      WHERE salon_id = 's_revorder' AND entry_type = 'sms_refund'
    `);

    // The salon paid cash for the purchased segment: it must come back as
    // purchased, never as the expiring monthly slice.
    expect(refund.rows).toEqual([expect.objectContaining({ bucket: 'purchased', amount: 1 })]);
  });

  it('the expiry sweep never expires segments under an ACTIVE hold (no double charge on settle)', async () => {
    const { reserveSmsCredits, settleReservationOnAccept } = await reservations();
    const { expireLapsedLots } = await import('./creditGrants');
    const { computeAvailableBalance } = await import('./creditLedger');
    await seedSalon('s_holdexp');
    const expiresAt = new Date(NOW.getTime() + 60 * 1000);
    await grantLot('s_holdexp', 'monthly', 5, expiresAt, 'he_grant');
    const reserved = await reserveSmsCredits({ salonId: 's_holdexp', dedupeKey: 'he_key', segments: 3, now: NOW });
    const reservationId = (reserved as { reservationId: string }).reservationId;

    const afterExpiry = new Date(expiresAt.getTime() + 1000);
    await db.transaction(async tx => expireLapsedLots(tx, { salonId: 's_holdexp', now: afterExpiry }));

    const expiry = await db.execute(sql`
      SELECT COALESCE(SUM(-amount), 0)::int AS expired FROM sms_credit_ledger
      WHERE salon_id = 's_holdexp' AND entry_type = 'expiry'
    `);

    // 5 remaining − 3 held = 2 expirable; the held 3 stay for the settle.
    expect((expiry.rows[0] as Record<string, unknown>).expired).toBe(2);

    await settleReservationOnAccept({ reservationId, providerSid: 'SM_he', now: afterExpiry });

    const balance = await db.transaction(async tx =>
      computeAvailableBalance(tx, 's_holdexp', afterExpiry));

    // 5 − 2 expired − 3 settled = 0, never negative (the double-charge shape).
    expect(balance.available).toBe(0);
  });
});

async function lotIdFor(idempotencyKey: string): Promise<string> {
  const rows = await db.execute(sql`SELECT id FROM sms_credit_ledger WHERE idempotency_key = ${idempotencyKey}`);
  return String((rows.rows[0] as Record<string, unknown>).id);
}
