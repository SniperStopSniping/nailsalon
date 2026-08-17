/**
 * SMS credit ledger core — account lock, lot arithmetic, grants ledger.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §7.
 *
 * The append-only lot ledger is the financial source of truth: positive
 * rows are credit lots with their own expiry; negative rows consume a
 * named lot. `sms_credit_account` is the per-salon SELECT ... FOR UPDATE
 * serialization anchor plus a NON-authoritative cache — every credit
 * mutation in this domain locks the account row first, which makes lot
 * arithmetic race-free by construction (row locks are transaction-scoped
 * and safe under Neon's transaction pooling; advisory session locks are
 * not, and serializable-retry storms are untestable under PGlite).
 *
 * Spending order (contract §7.2, locked):
 *   monthly → promotional → delivery_recovery → administrative → starter → purchased
 * within a bucket: earliest expiry first, then oldest grant. Expired lots
 * are excluded VIRTUALLY in every query — correctness never depends on an
 * expiry sweep having run.
 */

import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import type { db } from '@/libs/DB';
import {
  smsCreditAccountSchema,
  type SmsCreditBucket,
  type SmsCreditEntryType,
  smsCreditLedgerSchema,
} from '@/models/Schema';

export type BillingDbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Contract §7.2 rank — lower spends first. */
export const SPEND_ORDER_RANK: Record<SmsCreditBucket, number> = {
  monthly: 1,
  promotional: 2,
  delivery_recovery: 3,
  administrative: 4,
  starter: 5,
  purchased: 6,
};

/**
 * Lock (lazily creating) the salon's account row. MUST be the first credit
 * touch of every mutating transaction in this domain.
 */
export async function lockCreditAccount(
  tx: BillingDbTransaction,
  salonId: string,
): Promise<void> {
  await tx
    .insert(smsCreditAccountSchema)
    .values({ salonId })
    .onConflictDoNothing();
  await tx
    .select({ salonId: smsCreditAccountSchema.salonId })
    .from(smsCreditAccountSchema)
    .where(eq(smsCreditAccountSchema.salonId, salonId))
    .for('update');
}

export type OpenLot = {
  lotId: string;
  bucket: SmsCreditBucket;
  expiresAt: Date | null;
  createdAt: Date;
  /** lot amount + consumed (negative rows) − active holds. */
  free: number;
};

/**
 * Open lots in exact spend order with free = amount + consumed − held,
 * expired lots excluded virtually. Caller must hold the account lock.
 */
export async function selectOpenLots(
  tx: BillingDbTransaction,
  salonId: string,
  now: Date,
): Promise<OpenLot[]> {
  const rows = await tx.execute(sql`
    SELECT l.id AS lot_id,
           l.bucket AS bucket,
           l.expires_at AS expires_at,
           l.created_at AS created_at,
           l.amount
             + COALESCE(c.consumed, 0)
             - COALESCE(h.held, 0) AS free
    FROM sms_credit_ledger l
    LEFT JOIN (
      SELECT consumed_from_ledger_id AS lot, SUM(amount)::int AS consumed
      FROM sms_credit_ledger
      WHERE salon_id = ${salonId} AND amount < 0
      GROUP BY 1
    ) c ON c.lot = l.id
    LEFT JOIN (
      SELECT rl.lot_ledger_id AS lot, SUM(rl.segments)::int AS held
      FROM sms_credit_reservation_lot rl
      JOIN sms_credit_reservation r ON r.id = rl.reservation_id
      WHERE r.salon_id = ${salonId} AND r.status = 'held'
      GROUP BY 1
    ) h ON h.lot = l.id
    WHERE l.salon_id = ${salonId}
      AND l.amount > 0
      AND (l.expires_at IS NULL OR l.expires_at > ${now})
    ORDER BY
      CASE l.bucket
        WHEN 'monthly' THEN 1
        WHEN 'promotional' THEN 2
        WHEN 'delivery_recovery' THEN 3
        WHEN 'administrative' THEN 4
        WHEN 'starter' THEN 5
        WHEN 'purchased' THEN 6
      END,
      l.expires_at ASC NULLS LAST,
      l.created_at ASC,
      l.id ASC
  `);
  return (rows.rows as Array<Record<string, unknown>>)
    .map(row => ({
      lotId: String(row.lot_id),
      bucket: row.bucket as SmsCreditBucket,
      expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
      createdAt: new Date(row.created_at as string),
      free: Number(row.free),
    }))
    .filter(lot => lot.free > 0);
}

export type BucketedBalance = {
  available: number;
  byBucket: Partial<Record<SmsCreditBucket, number>>;
  reserved: number;
};

/** Pure ledger read (virtual expiry, minus active holds). May be negative overall. */
export async function computeAvailableBalance(
  tx: BillingDbTransaction,
  salonId: string,
  now: Date,
): Promise<BucketedBalance> {
  const lots = await selectOpenLots(tx, salonId, now);
  const byBucket: Partial<Record<SmsCreditBucket, number>> = {};
  let available = 0;
  for (const lot of lots) {
    byBucket[lot.bucket] = (byBucket[lot.bucket] ?? 0) + lot.free;
    available += lot.free;
  }
  // Dispute reversals may exceed a lot's remaining value: count the global
  // negative overhang so a disputed account cannot authorize sends.
  const overhang = await tx.execute(sql`
    SELECT COALESCE(SUM(shortfall), 0)::int AS overhang FROM (
      SELECT l.amount + COALESCE(SUM(c.amount), 0) AS shortfall
      FROM sms_credit_ledger l
      LEFT JOIN sms_credit_ledger c ON c.consumed_from_ledger_id = l.id
      WHERE l.salon_id = ${salonId} AND l.amount > 0
      GROUP BY l.id, l.amount
      HAVING l.amount + COALESCE(SUM(c.amount), 0) < 0
    ) s
  `);
  available += Number((overhang.rows[0] as Record<string, unknown>).overhang);

  const held = await tx.execute(sql`
    SELECT COALESCE(SUM(segments), 0)::int AS reserved
    FROM sms_credit_reservation
    WHERE salon_id = ${salonId} AND status = 'held'
  `);
  return {
    available,
    byBucket,
    reserved: Number((held.rows[0] as Record<string, unknown>).reserved),
  };
}

/** Refresh the non-authoritative cache. Caller must hold the account lock. */
export async function recomputeCachedBalance(
  tx: BillingDbTransaction,
  salonId: string,
  now: Date,
): Promise<void> {
  const balance = await computeAvailableBalance(tx, salonId, now);
  await tx
    .update(smsCreditAccountSchema)
    .set({
      cachedAvailable: balance.available,
      cachedReserved: balance.reserved,
      cacheComputedAt: now,
    })
    .where(eq(smsCreditAccountSchema.salonId, salonId));
}

export type LotGrantInput = {
  salonId: string;
  bucket: SmsCreditBucket;
  amount: number;
  expiresAt: Date | null;
  idempotencyKey: string;
  entryType?: Extract<SmsCreditEntryType, 'grant' | 'sms_refund'>;
  reason: string;
  stripeRef?: string | null;
  actor?: string | null;
  note?: string | null;
};

/**
 * Append a positive lot. Idempotent on the ledger's unique key: a replay
 * returns the existing lot id and grants nothing. Every NEW lot bumps
 * warning_epoch, deterministically resetting low-balance warning
 * eligibility (contract §7.1 — C4 needs no further migration).
 * Caller must hold the account lock.
 */
export async function appendLotGrant(
  tx: BillingDbTransaction,
  input: LotGrantInput,
): Promise<{ lotId: string; created: boolean }> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new RangeError(`lot grant amount must be a positive integer, got ${input.amount}`);
  }
  const id = `scl_${crypto.randomUUID()}`;
  const inserted = await tx
    .insert(smsCreditLedgerSchema)
    .values({
      id,
      salonId: input.salonId,
      entryType: input.entryType ?? 'grant',
      bucket: input.bucket,
      amount: input.amount,
      expiresAt: input.expiresAt,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      stripeRef: input.stripeRef ?? null,
      actor: input.actor ?? null,
      note: input.note ?? null,
    })
    .onConflictDoNothing({ target: smsCreditLedgerSchema.idempotencyKey })
    .returning();

  if (inserted.length === 0) {
    const existing = await tx
      .select({ id: smsCreditLedgerSchema.id })
      .from(smsCreditLedgerSchema)
      .where(eq(smsCreditLedgerSchema.idempotencyKey, input.idempotencyKey))
      .limit(1);
    return { lotId: existing[0]!.id, created: false };
  }

  await tx
    .update(smsCreditAccountSchema)
    .set({ warningEpoch: sql`${smsCreditAccountSchema.warningEpoch} + 1` })
    .where(eq(smsCreditAccountSchema.salonId, input.salonId));

  return { lotId: inserted[0]!.id, created: true };
}

export type NegativeEntryInput = {
  salonId: string;
  entryType: Extract<SmsCreditEntryType, 'debit' | 'expiry' | 'purchase_reversal'>;
  bucket: SmsCreditBucket;
  amount: number; // positive magnitude; stored negative
  consumedFromLedgerId: string;
  reservationId?: string | null;
  idempotencyKey: string;
  reason: string;
  stripeRef?: string | null;
  actor?: string | null;
  note?: string | null;
};

/** Append a negative entry against a named lot. Idempotent on the key. */
export async function appendNegativeEntry(
  tx: BillingDbTransaction,
  input: NegativeEntryInput,
): Promise<{ entryId: string; created: boolean }> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new RangeError(`negative-entry magnitude must be a positive integer, got ${input.amount}`);
  }
  const id = `scl_${crypto.randomUUID()}`;
  const inserted = await tx
    .insert(smsCreditLedgerSchema)
    .values({
      id,
      salonId: input.salonId,
      entryType: input.entryType,
      bucket: input.bucket,
      amount: -input.amount,
      consumedFromLedgerId: input.consumedFromLedgerId,
      reservationId: input.reservationId ?? null,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      stripeRef: input.stripeRef ?? null,
      actor: input.actor ?? null,
      note: input.note ?? null,
    })
    .onConflictDoNothing({ target: smsCreditLedgerSchema.idempotencyKey })
    .returning();
  if (inserted.length === 0) {
    const existing = await tx
      .select({ id: smsCreditLedgerSchema.id })
      .from(smsCreditLedgerSchema)
      .where(eq(smsCreditLedgerSchema.idempotencyKey, input.idempotencyKey))
      .limit(1);
    return { entryId: existing[0]!.id, created: false };
  }
  return { entryId: inserted[0]!.id, created: true };
}

/** Remaining value of one lot (amount + all negative rows against it). */
export async function lotRemaining(
  tx: BillingDbTransaction,
  lotId: string,
): Promise<{ bucket: SmsCreditBucket; expiresAt: Date | null; remaining: number; salonId: string } | null> {
  const lot = await tx
    .select({
      bucket: smsCreditLedgerSchema.bucket,
      expiresAt: smsCreditLedgerSchema.expiresAt,
      amount: smsCreditLedgerSchema.amount,
      salonId: smsCreditLedgerSchema.salonId,
    })
    .from(smsCreditLedgerSchema)
    .where(and(eq(smsCreditLedgerSchema.id, lotId), sql`${smsCreditLedgerSchema.amount} > 0`))
    .limit(1);
  if (lot.length === 0) {
    return null;
  }
  const consumed = await tx.execute(sql`
    SELECT COALESCE(SUM(amount), 0)::int AS consumed
    FROM sms_credit_ledger WHERE consumed_from_ledger_id = ${lotId}
  `);
  return {
    bucket: lot[0]!.bucket,
    expiresAt: lot[0]!.expiresAt,
    salonId: lot[0]!.salonId,
    remaining: lot[0]!.amount + Number((consumed.rows[0] as Record<string, unknown>).consumed),
  };
}
