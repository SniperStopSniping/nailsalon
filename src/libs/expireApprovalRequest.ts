import 'server-only';

import { and, eq, isNotNull, lte } from 'drizzle-orm';

import { buildAppointmentAuditRow } from '@/libs/appointmentAudit';
import { enqueueCommunicationIntent } from '@/libs/communicationIntent';
import type { db } from '@/libs/DB';
import { appointmentAuditLogSchema, appointmentSchema } from '@/models/Schema';

/**
 * Luster L1 PR5 — the ONE transactional finalizer that turns a lapsed
 * `pending` request-approval booking into a real terminal state.
 *
 * Everything upstream of this module (PR4) only ever CREATES a correctly
 * dated request (`request_expires_at`, via
 * `resolveExplicitRequestApprovalActivation`) and stops a lapsed one from
 * BLOCKING the slot (`appointmentBlocking.ts`'s `request_expires_at > now`
 * predicate). Neither of those writes anything — a lapsed request stays
 * `status = 'pending'` forever unless something calls this function. The
 * bounded sweep (`approvalRequestSweeper.ts`, invoked from the reminders
 * cron) is its ONLY caller, so there is exactly one place the CAS, the
 * audit record, and the notification intent are written together.
 *
 * The confirm-time strict rejection in `[id]/route.ts` deliberately does
 * NOT call this. It REJECTS a lapsed request with a typed
 * `REQUEST_EXPIRED` conflict and leaves the row exactly as it found it:
 * refusing a confirm must not mutate the appointment as a side effect of
 * being refused. The row is finalized by the next sweep tick either way.
 * A lapsed row therefore keeps `status = 'pending'` until that tick — but
 * no caller observes it as an open request in the meantime, because the
 * authoritative status endpoint computes the EFFECTIVE state through the
 * same cutoff and already reports it as `expired`.
 *
 * EXACTLY-ONCE, by construction rather than by locking discipline alone:
 *
 *   1. `SELECT ... FOR UPDATE` serializes every concurrent caller for the
 *      SAME appointment row onto one Postgres row lock — a second caller
 *      blocks here until the first commits or rolls back.
 *   2. After acquiring the lock, a row already `cancelled` with
 *      `cancel_reason = 'request_expired'` is recognized as SOMEONE ELSE'S
 *      already-committed finalization (the winner released the lock by
 *      committing) and returns `'already_expired'` — no second UPDATE, no
 *      second audit row, no second notification intent.
 *   3. The UPDATE itself is STILL a compare-and-set (`status = 'pending'`
 *      AND `request_expires_at` non-null AND `<= transactionNow`) even
 *      though the row lock already makes a second winner impossible in
 *      production Postgres — belt-and-suspenders, and it means a caller
 *      that (incorrectly) ran this outside a locked read still fails safe
 *      instead of double-transitioning.
 *   4. `enqueueCommunicationIntent`'s dedupe key
 *      (`appointment-approval-expired:{appointmentId}:{requestExpiresAt}`)
 *      is unique-indexed at the DB level (`communication_intent_dedupe_uniq`,
 *      migration 0070) and only ever reached from inside the CAS's success
 *      branch, so even a caller retry after a crash-after-commit (the
 *      caller doesn't know its own transaction committed) lands on
 *      `'already_expired'` at step 2 before ever reaching the enqueue call.
 *
 * `not_expirable` covers every row this function is not responsible for:
 * a LEGACY `pending` row (`request_expires_at IS NULL`, which blocks and
 * reminds exactly as it always has — never touched here), any non-pending
 * status, and a `pending` explicit request whose deadline has not yet
 * passed. It deliberately does NOT cover a row already finalized by THIS
 * function (`already_expired`) or a row terminalized some other way
 * (declined, cancelled by the client, completed, ...) — those are simply
 * "not mine to transition," same bucket as `not_expirable`.
 */

type ExpireApprovalRequestTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ExpireApprovalRequestOutcome =
  | { outcome: 'transitioned'; notificationIntentId: string }
  | { outcome: 'already_expired' }
  | { outcome: 'not_expirable' };

export type ExpireApprovalRequestArgs = {
  appointmentId: string;
  /** The caller's own transaction-stable instant — never re-read mid-transaction. */
  transactionNow: Date;
};

/** No SMS template is registered yet for this dark event type (PR7 owns the customer-facing copy) — see `communicationMaterialization.ts`'s `TEMPLATED_SMS_EVENTS` doc comment for the same convention. This module enqueues directly rather than through that helper because the dedupe key here is deliberately fixed to the request's own identity, not a mutation-revision-keyed lifecycle dedupe key. */
const NOTIFICATION_TEMPLATE_KEY = 'client_booking_request_expired_shortlink';
const NOTIFICATION_TEMPLATE_VERSION = 'v1';

/** Mirrors `resolveNotAfter`'s (`communicationScheduling.ts`) fallback window for a non-start-anchored lifecycle event: the appointment is already cancelled, so there is no `appointmentStart` to expire the window against. */
const NOTIFICATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function expireApprovalRequest(
  tx: ExpireApprovalRequestTransaction,
  args: ExpireApprovalRequestArgs,
): Promise<ExpireApprovalRequestOutcome> {
  const { appointmentId, transactionNow } = args;

  const [locked] = await tx
    .select()
    .from(appointmentSchema)
    .where(eq(appointmentSchema.id, appointmentId))
    .for('update')
    .limit(1);

  if (!locked) {
    return { outcome: 'not_expirable' };
  }

  if (locked.status === 'cancelled' && locked.cancelReason === 'request_expired') {
    // A concurrent winner (possibly an earlier call from THIS same retrying
    // caller) already finalized this exact request while we waited on the
    // row lock above.
    return { outcome: 'already_expired' };
  }

  const requestExpiresAt = locked.requestExpiresAt;
  const isExpirableNow = locked.status === 'pending'
    && requestExpiresAt !== null
    && requestExpiresAt.getTime() <= transactionNow.getTime();
  if (!isExpirableNow || requestExpiresAt === null) {
    return { outcome: 'not_expirable' };
  }

  const [transitioned] = await tx
    .update(appointmentSchema)
    .set({
      status: 'cancelled',
      cancelReason: 'request_expired',
      canvasState: 'cancelled',
      canvasStateUpdatedAt: transactionNow,
      updatedAt: transactionNow,
    })
    .where(and(
      eq(appointmentSchema.id, appointmentId),
      eq(appointmentSchema.salonId, locked.salonId),
      eq(appointmentSchema.status, 'pending'),
      isNotNull(appointmentSchema.requestExpiresAt),
      lte(appointmentSchema.requestExpiresAt, transactionNow),
    ))
    .returning();

  if (!transitioned) {
    // The row lock above should make this unreachable in real Postgres —
    // fail closed (no audit row, no notification) rather than assume a
    // transition that did not happen.
    return { outcome: 'already_expired' };
  }

  await tx.insert(appointmentAuditLogSchema).values(buildAppointmentAuditRow({
    appointmentId,
    salonId: locked.salonId,
    action: 'status_changed',
    performedBy: 'system:approval-lifecycle',
    performedByRole: 'system',
    previousValue: { status: 'pending' },
    newValue: { status: 'cancelled', cancelReason: 'request_expired' },
    reason: 'request_expired',
  }));

  const { intentId } = await enqueueCommunicationIntent({
    database: tx,
    salonId: locked.salonId,
    appointmentId,
    channel: 'sms',
    eventType: 'booking_request_expired',
    audience: 'client',
    dedupeKey: `appointment-approval-expired:${appointmentId}:${requestExpiresAt.toISOString()}`,
    recipient: locked.clientPhone,
    destinationCountry: 'CA',
    templateKey: NOTIFICATION_TEMPLATE_KEY,
    templateVersion: NOTIFICATION_TEMPLATE_VERSION,
    variables: {
      appointmentId,
      requestExpiresAt: requestExpiresAt.toISOString(),
    },
    startRevision: locked.startTime.toISOString(),
    schedulingRevision: `request-expired:${requestExpiresAt.toISOString()}`,
    scheduledFor: transactionNow,
    notAfter: new Date(transactionNow.getTime() + NOTIFICATION_WINDOW_MS),
  });

  return { outcome: 'transitioned', notificationIntentId: intentId };
}
