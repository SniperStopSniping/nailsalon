/**
 * Unknown-outcome resolver — Gate C / C1 (contract §7.5, §19).
 *
 * An intent parks as `send_outcome_unknown` when the process lost the
 * provider's answer (crash or ambiguous transport failure between
 * messages.create() and SID persistence). The rules are absolute:
 *
 *   - NEVER blind-resend: there is no transition from send_outcome_unknown
 *     back to pending anywhere in the system.
 *   - Adopt a SID only on POSITIVE provider evidence. Evidence path 1 is a
 *     signed status callback carrying the delivery identity (the callback
 *     URL embeds deliveryId), which lands providerMessageId on the delivery
 *     row — this module then settles the reservation exactly once and marks
 *     the intent sent.
 *   - Release only on PROVEN non-send. Proof requires querying the provider
 *     (recipient + Messaging Service + bounded window + body fingerprint —
 *     §7.5 path 2), which is inherently a live-provider operation: it stays
 *     a documented pilot-runbook step, not automated dark code. Absent
 *     proof, the reservation stays held as evidence.
 *   - Alert once the unresolved age exceeds the §19 budget (30 minutes).
 */

import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';

import { transitionIntent } from '@/libs/communicationIntent';
import { db } from '@/libs/DB';
import {
  communicationIntentSchema,
  notificationDeliverySchema,
} from '@/models/Schema';

/** §19: send_outcome_unknown older than this must alert. */
export const UNKNOWN_OUTCOME_ALERT_AGE_MS = 30 * 60 * 1000;

export type UnknownOutcomeResolution = {
  scanned: number;
  adopted: number;
  overdue: number;
};

/**
 * One resolver pass. Adoption is idempotent: the settle key is per
 * (reservation, lot), so a replayed pass after a crash cannot double-debit,
 * and `sent` from `send_outcome_unknown` is an allowed CAS transition that
 * simply no-ops when already applied.
 */
export async function resolveUnknownOutcomes(now = new Date()): Promise<UnknownOutcomeResolution> {
  const result: UnknownOutcomeResolution = { scanned: 0, adopted: 0, overdue: 0 };

  const unknowns = await db
    .select({
      id: communicationIntentSchema.id,
      deliveryId: communicationIntentSchema.deliveryId,
      creditReservationId: communicationIntentSchema.creditReservationId,
      updatedAt: communicationIntentSchema.updatedAt,
    })
    .from(communicationIntentSchema)
    .where(eq(communicationIntentSchema.status, 'send_outcome_unknown'))
    .limit(200);
  result.scanned = unknowns.length;

  for (const intent of unknowns) {
    if (intent.deliveryId !== null) {
      const [delivery] = await db
        .select({ providerMessageId: notificationDeliverySchema.providerMessageId })
        .from(notificationDeliverySchema)
        .where(eq(notificationDeliverySchema.id, intent.deliveryId))
        .limit(1);
      const sid = delivery?.providerMessageId ?? null;
      if (sid !== null) {
        // Positive evidence: a signed callback proved Twilio accepted this
        // exact delivery. Settle the reservation (idempotent per-lot keys),
        // then resolve the intent.
        if (intent.creditReservationId !== null) {
          const { settleReservationOnAccept } = await import('@/libs/billing/creditReservation');
          await settleReservationOnAccept({
            reservationId: intent.creditReservationId,
            providerSid: sid,
          });
        }
        const moved = await transitionIntent(intent.id, { to: 'sent' }, now);
        if (moved.applied) {
          result.adopted += 1;
        }
        continue;
      }
    }
    if (now.getTime() - intent.updatedAt.getTime() > UNKNOWN_OUTCOME_ALERT_AGE_MS) {
      result.overdue += 1;
    }
  }

  if (result.overdue > 0) {
    // §19 alert: unresolved past budget. The reservation stays held — that
    // is deliberate evidence preservation, not a leak; only the pilot
    // runbook's provider-evidence query may release it.
    Sentry.captureMessage('communications.unknown_outcome_overdue', {
      level: 'warning',
      extra: { overdue: result.overdue, budgetMs: UNKNOWN_OUTCOME_ALERT_AGE_MS },
    });
  }
  return result;
}

/**
 * Reaper-safety predicate used by tests: rows this module is responsible for
 * must never be visible to the ordinary reservation reaper.
 */
export async function countUnknownOutcomeReservationsVisibleToReaper(): Promise<number> {
  const rows = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM sms_credit_reservation r
    JOIN communication_intent i ON i.credit_reservation_id = r.id
    WHERE i.status = 'send_outcome_unknown'
      AND r.status = 'held'
      AND r.expires_at < now()
  `);
  return Number((rows.rows[0] as Record<string, unknown>).n);
}

/** Narrow filter helper for ops surfaces (C4). */
export function unknownOutcomeAgeFilter(now: Date) {
  return and(
    eq(communicationIntentSchema.status, 'send_outcome_unknown'),
    lt(communicationIntentSchema.updatedAt, new Date(now.getTime() - UNKNOWN_OUTCOME_ALERT_AGE_MS)),
    isNotNull(communicationIntentSchema.deliveryId),
    inArray(communicationIntentSchema.channel, ['sms']),
  );
}
