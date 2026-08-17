/**
 * Credit reservations — reserve / settle-on-provider-acceptance / release /
 * refund / recovery / reaper.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §7.4-§7.7.
 *
 * Lifecycle (settle-on-accept — a binding Rev 2.2 correction):
 *
 *   reserve (tx, account-locked, spend-order lots)  → COMMIT
 *   → provider call happens OUTSIDE any transaction
 *      ├─ synchronous rejection  → releaseReservation (no ledger rows)
 *      └─ provider returns SID   → settleReservationOnAccept (per-lot debits)
 *   → later terminal failed/undelivered/canceled → refundTerminalFailure
 *        (per-lot, exactly once; expired source lots recover into the
 *         delivery_recovery bucket expiring +30 days; purchased value
 *         returns purchased/non-expiring; refund never exceeds the debit)
 *   → provider reports FEWER actual segments → refundOverpredictedSegments
 *
 * The reaper releases only clearly pre-send abandoned holds and skips
 * settled/settling/unknown-outcome reservations (B2's dispatcher owns the
 * unknown-outcome resolution).
 */

import 'server-only';

import { and, eq, inArray, lt, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  smsCreditReservationLotSchema,
  smsCreditReservationSchema,
} from '@/models/Schema';

import {
  appendLotGrant,
  appendNegativeEntry,
  computeAvailableBalance,
  lockCreditAccount,
  lotRemaining,
  recomputeCachedBalance,
  selectOpenLots,
  SPEND_ORDER_RANK,
} from './creditLedger';

export const RESERVATION_TTL_MS = 15 * 60 * 1000;
export const DELIVERY_RECOVERY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type ReserveResult =
  | { ok: true; reservationId: string; reused: boolean }
  | { ok: false; reason: 'blocked_no_credit'; required: number; available: number };

export async function reserveSmsCredits(input: {
  salonId: string;
  dedupeKey: string;
  segments: number;
  deliveryId?: string | null;
  now?: Date;
}): Promise<ReserveResult> {
  const now = input.now ?? new Date();
  if (!Number.isInteger(input.segments) || input.segments <= 0) {
    throw new RangeError(`segments must be a positive integer, got ${input.segments}`);
  }
  return db.transaction(async (tx) => {
    await lockCreditAccount(tx, input.salonId);

    // Idempotent reuse: an existing live claim under the same dedupe key is
    // returned, never duplicated. Safe as check-then-insert because every
    // reserve for this salon serializes on the account lock; the partial
    // unique index is the cross-salon backstop.
    const existing = await tx
      .select({ id: smsCreditReservationSchema.id })
      .from(smsCreditReservationSchema)
      .where(and(
        eq(smsCreditReservationSchema.dedupeKey, input.dedupeKey),
        inArray(smsCreditReservationSchema.status, ['held', 'settled']),
      ))
      .limit(1);
    if (existing.length > 0) {
      return { ok: true, reservationId: existing[0]!.id, reused: true };
    }

    const balance = await computeAvailableBalance(tx, input.salonId, now);
    if (balance.available < input.segments) {
      return {
        ok: false,
        reason: 'blocked_no_credit',
        required: input.segments,
        available: balance.available,
      };
    }

    const lots = await selectOpenLots(tx, input.salonId, now);
    const reservationId = `scr_${crypto.randomUUID()}`;
    await tx.insert(smsCreditReservationSchema).values({
      id: reservationId,
      salonId: input.salonId,
      deliveryId: input.deliveryId ?? null,
      dedupeKey: input.dedupeKey,
      segments: input.segments,
      status: 'held',
      expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS),
    });

    let remaining = input.segments;
    for (const lot of lots) {
      if (remaining <= 0) {
        break;
      }
      const take = Math.min(remaining, lot.free);
      await tx.insert(smsCreditReservationLotSchema).values({
        reservationId,
        lotLedgerId: lot.lotId,
        salonId: input.salonId,
        segments: take,
      });
      remaining -= take;
    }
    if (remaining > 0) {
      // Balance said yes but lots said no — only possible via a logic bug;
      // abort loudly rather than under-reserve.
      throw new Error('credit reservation could not be fully allocated');
    }

    await recomputeCachedBalance(tx, input.salonId, now);
    return { ok: true, reservationId, reused: false };
  });
}

/**
 * Settle on provider acceptance: per-lot debits, exactly once. Idempotent
 * under replay (per-lot keys + status CAS). Never waits for delivery.
 */
export async function settleReservationOnAccept(input: {
  reservationId: string;
  providerSid: string;
  now?: Date;
}): Promise<{ settled: boolean; alreadySettled: boolean }> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(smsCreditReservationSchema)
      .where(eq(smsCreditReservationSchema.id, input.reservationId))
      .for('update');
    const reservation = rows[0];
    if (reservation === undefined) {
      return { settled: false, alreadySettled: false };
    }
    await lockCreditAccount(tx, reservation.salonId);

    if (reservation.status === 'settled') {
      return { settled: true, alreadySettled: true };
    }
    if (reservation.status !== 'held') {
      // released/expired: the send happened after we gave up — absorbed,
      // surfaced by reconciliation, never re-billed here.
      return { settled: false, alreadySettled: false };
    }

    const lots = await tx
      .select()
      .from(smsCreditReservationLotSchema)
      .where(eq(smsCreditReservationLotSchema.reservationId, input.reservationId));
    for (const lot of lots) {
      const info = await lotRemaining(tx, lot.lotLedgerId);
      const { entryId } = await appendNegativeEntry(tx, {
        salonId: reservation.salonId,
        entryType: 'debit',
        bucket: info?.bucket ?? 'purchased',
        amount: lot.segments,
        consumedFromLedgerId: lot.lotLedgerId,
        reservationId: reservation.id,
        idempotencyKey: `sms-settle:${reservation.id}:${lot.lotLedgerId}`,
        reason: 'sms_settle_on_accept',
      });
      await tx
        .update(smsCreditReservationLotSchema)
        .set({ debitLedgerId: entryId })
        .where(and(
          eq(smsCreditReservationLotSchema.reservationId, lot.reservationId),
          eq(smsCreditReservationLotSchema.lotLedgerId, lot.lotLedgerId),
        ));
    }

    await tx
      .update(smsCreditReservationSchema)
      .set({ status: 'settled', providerSid: input.providerSid, settledAt: now })
      .where(and(
        eq(smsCreditReservationSchema.id, reservation.id),
        eq(smsCreditReservationSchema.status, 'held'),
      ));
    await recomputeCachedBalance(tx, reservation.salonId, now);
    return { settled: true, alreadySettled: false };
  });
}

/** Release a held reservation (sync provider rejection / suppression). No ledger rows. */
export async function releaseReservation(input: {
  reservationId: string;
  reason: string;
  now?: Date;
}): Promise<{ released: boolean }> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: smsCreditReservationSchema.id,
        salonId: smsCreditReservationSchema.salonId,
        status: smsCreditReservationSchema.status,
      })
      .from(smsCreditReservationSchema)
      .where(eq(smsCreditReservationSchema.id, input.reservationId))
      .for('update');
    const reservation = rows[0];
    if (reservation === undefined || reservation.status !== 'held') {
      // Never release after settlement (contract §19 zero-budget invariant).
      return { released: false };
    }
    await lockCreditAccount(tx, reservation.salonId);
    await tx
      .update(smsCreditReservationSchema)
      .set({ status: 'released', releasedAt: now, releaseReason: input.reason })
      .where(and(
        eq(smsCreditReservationSchema.id, reservation.id),
        eq(smsCreditReservationSchema.status, 'held'),
      ));
    await recomputeCachedBalance(tx, reservation.salonId, now);
    return { released: true };
  });
}

/**
 * Terminal-failure refund: per lot, exactly once. Valid source lot →
 * original bucket with the ORIGINAL expiry; expired non-purchased source →
 * delivery_recovery expiring +30 days; purchased → purchased, non-expiring.
 */
export async function refundTerminalFailure(input: {
  reservationId: string;
  now?: Date;
}): Promise<{ refundedLots: number }> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(smsCreditReservationSchema)
      .where(eq(smsCreditReservationSchema.id, input.reservationId))
      .for('update');
    const reservation = rows[0];
    if (reservation === undefined || reservation.status !== 'settled') {
      return { refundedLots: 0 };
    }
    await lockCreditAccount(tx, reservation.salonId);

    const lots = await tx
      .select()
      .from(smsCreditReservationLotSchema)
      .where(eq(smsCreditReservationLotSchema.reservationId, reservation.id));

    let refunded = 0;
    for (const lot of lots) {
      if (lot.refundedAt !== null) {
        continue; // per-lot exactly-once fence
      }
      // Net of anything the overprediction arm already returned: the two
      // refund paths can meet in either order and must never stack past the
      // original per-lot debit.
      const refundable = lot.segments - lot.refundedSegments;
      if (refundable <= 0) {
        await tx
          .update(smsCreditReservationLotSchema)
          .set({ refundedAt: now })
          .where(and(
            eq(smsCreditReservationLotSchema.reservationId, lot.reservationId),
            eq(smsCreditReservationLotSchema.lotLedgerId, lot.lotLedgerId),
            sql`${smsCreditReservationLotSchema.refundedAt} IS NULL`,
          ));
        continue;
      }
      const info = await lotRemaining(tx, lot.lotLedgerId);
      const sourceExpired = info?.expiresAt != null && info.expiresAt.getTime() <= now.getTime();
      const sourceBucket = info?.bucket ?? 'purchased';

      const target = sourceBucket === 'purchased'
        ? { bucket: 'purchased' as const, expiresAt: null, key: `sms-refund:${reservation.id}:${lot.lotLedgerId}` }
        : sourceExpired
          ? {
              bucket: 'delivery_recovery' as const,
              expiresAt: new Date(now.getTime() + DELIVERY_RECOVERY_TTL_MS),
              key: `sms-refund-recovery:${reservation.id}:${lot.lotLedgerId}`,
            }
          : {
              bucket: sourceBucket,
              expiresAt: info?.expiresAt ?? null,
              key: `sms-refund:${reservation.id}:${lot.lotLedgerId}`,
            };

      const { lotId } = await appendLotGrant(tx, {
        salonId: reservation.salonId,
        bucket: target.bucket,
        amount: refundable, // never exceeds the original per-lot debit
        expiresAt: target.expiresAt,
        idempotencyKey: target.key,
        entryType: 'sms_refund',
        reason: 'sms_terminal_failure_refund',
      });
      await tx
        .update(smsCreditReservationLotSchema)
        .set({ refundedAt: now, refundLedgerId: lotId })
        .where(and(
          eq(smsCreditReservationLotSchema.reservationId, lot.reservationId),
          eq(smsCreditReservationLotSchema.lotLedgerId, lot.lotLedgerId),
          sql`${smsCreditReservationLotSchema.refundedAt} IS NULL`,
        ));
      refunded += 1;
    }

    if (refunded > 0 && reservation.refundedAt === null) {
      await tx
        .update(smsCreditReservationSchema)
        .set({ refundedAt: now })
        .where(eq(smsCreditReservationSchema.id, reservation.id));
    }
    await recomputeCachedBalance(tx, reservation.salonId, now);
    return { refundedLots: refunded };
  });
}

/**
 * Segment-overprediction refund (contract §7.7): actual < predicted ⇒
 * refund exactly predicted − actual, once, back to the original valid
 * source lots (same routing rules as terminal refunds for expired lots).
 * B2's reconciliation owns detection; this owns the accounting.
 */
export async function refundOverpredictedSegments(input: {
  reservationId: string;
  actualSegments: number;
  now?: Date;
}): Promise<{ refundedSegments: number }> {
  const now = input.now ?? new Date();
  if (!Number.isInteger(input.actualSegments) || input.actualSegments < 0) {
    throw new RangeError(`actualSegments must be a non-negative integer, got ${input.actualSegments}`);
  }
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(smsCreditReservationSchema)
      .where(eq(smsCreditReservationSchema.id, input.reservationId))
      .for('update');
    const reservation = rows[0];
    if (reservation === undefined || reservation.status !== 'settled') {
      return { refundedSegments: 0 };
    }
    if (reservation.providerSegments !== null) {
      // Already reconciled — replay-safe.
      return { refundedSegments: 0 };
    }
    if (reservation.refundedAt !== null) {
      // A terminal-failure refund already returned the ENTIRE debit; record
      // the actual segment count for evidence but move no more money.
      await tx
        .update(smsCreditReservationSchema)
        .set({ providerSegments: input.actualSegments })
        .where(eq(smsCreditReservationSchema.id, reservation.id));
      return { refundedSegments: 0 };
    }
    const over = reservation.segments - input.actualSegments;
    if (over <= 0) {
      return { refundedSegments: 0 };
    }
    await lockCreditAccount(tx, reservation.salonId);
    await tx
      .update(smsCreditReservationSchema)
      .set({ providerSegments: input.actualSegments })
      .where(eq(smsCreditReservationSchema.id, reservation.id));

    const lotRows = await tx
      .select()
      .from(smsCreditReservationLotSchema)
      .where(eq(smsCreditReservationLotSchema.reservationId, reservation.id));
    // Return the overage LOWEST-priority-first — the exact reverse of the
    // spend order — so a purchased segment comes back as purchased before an
    // expiring monthly segment does. (Lot ids are random UUIDs; insertion
    // order is not recoverable from them.)
    const infoByLot = new Map<string, Awaited<ReturnType<typeof lotRemaining>>>();
    for (const lot of lotRows) {
      infoByLot.set(lot.lotLedgerId, await lotRemaining(tx, lot.lotLedgerId));
    }
    const lots = [...lotRows].sort((a, b) => {
      const rankA = SPEND_ORDER_RANK[infoByLot.get(a.lotLedgerId)?.bucket ?? 'purchased'];
      const rankB = SPEND_ORDER_RANK[infoByLot.get(b.lotLedgerId)?.bucket ?? 'purchased'];
      return rankB - rankA;
    });

    let toRefund = over;
    let refundedSegments = 0;
    for (const lot of lots) {
      if (toRefund <= 0) {
        break;
      }
      if (lot.refundedAt !== null) {
        continue; // terminal refund already returned this lot in full
      }
      const give = Math.min(toRefund, lot.segments - lot.refundedSegments);
      if (give <= 0) {
        continue;
      }
      const info = infoByLot.get(lot.lotLedgerId);
      const sourceExpired = info?.expiresAt != null && info.expiresAt.getTime() <= now.getTime();
      const sourceBucket = info?.bucket ?? 'purchased';
      const bucket = sourceBucket === 'purchased'
        ? 'purchased' as const
        : sourceExpired ? 'delivery_recovery' as const : sourceBucket;
      const { created } = await appendLotGrant(tx, {
        salonId: reservation.salonId,
        bucket,
        amount: give,
        expiresAt: bucket === 'purchased'
          ? null
          : bucket === 'delivery_recovery'
            ? new Date(now.getTime() + DELIVERY_RECOVERY_TTL_MS)
            : info?.expiresAt ?? null,
        idempotencyKey: `segment-overpredict-refund:${reservation.id}:${lot.lotLedgerId}`,
        entryType: 'sms_refund',
        reason: 'segment_overpredict_refund',
      });
      toRefund -= give;
      if (created) {
        refundedSegments += give;
        await tx
          .update(smsCreditReservationLotSchema)
          .set({ refundedSegments: lot.refundedSegments + give })
          .where(and(
            eq(smsCreditReservationLotSchema.reservationId, lot.reservationId),
            eq(smsCreditReservationLotSchema.lotLedgerId, lot.lotLedgerId),
          ));
      }
    }
    await recomputeCachedBalance(tx, reservation.salonId, now);
    return { refundedSegments };
  });
}

/**
 * Release clearly pre-send abandoned holds. Skips anything with a provider
 * SID and anything not simply 'held'; unknown-outcome handling is the
 * B2 reconciler's job, never the reaper's.
 */
export async function reapExpiredReservations(now = new Date()): Promise<{ released: number }> {
  const stale = await db
    .select({ id: smsCreditReservationSchema.id })
    .from(smsCreditReservationSchema)
    .where(and(
      eq(smsCreditReservationSchema.status, 'held'),
      lt(smsCreditReservationSchema.expiresAt, now),
      sql`${smsCreditReservationSchema.providerSid} IS NULL`,
      // §7.6: only CLEARLY pre-send holds. A delivery row in settling/settled
      // means the provider call may have happened (crash between accept and
      // settle) — that ambiguity belongs to the §7.5 reconciler, never here.
      sql`NOT EXISTS (
        SELECT 1 FROM notification_delivery nd
        WHERE nd.credit_reservation_id = ${smsCreditReservationSchema.id}
          AND nd.settlement_state IN ('settling', 'settled')
          AND nd.status <> 'canceled'
      )`,
    ));
  let released = 0;
  for (const row of stale) {
    const result = await releaseReservation({
      reservationId: row.id,
      reason: 'reaper_expired',
      now,
    });
    if (result.released) {
      released += 1;
    }
  }
  return { released };
}
