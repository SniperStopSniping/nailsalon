/**
 * Twilio delivery-status callback — hardened in Gate B (contract §7.4).
 *
 * LIVE BYO SURFACE: legacy rows (status_rank NULL) keep today's behavior —
 * their first callback always applies — and then become monotonically
 * ordered. New pipeline rows carry ranks from creation. Terminal failure
 * ranks ABOVE delivered on purpose: Twilio legitimately emits
 * sent → undelivered, and dropping a late `delivered` after `undelivered`
 * is the safe direction (delivered triggers no ledger action anyway).
 *
 * Financial dispositions are exactly-once: refunds ride B1's per-lot
 * refunded_at fences and idempotency keys; a replayed or out-of-order
 * callback can never refund twice or regress a status. Reconciliation
 * (provider price + actual segments) is enqueued on the first terminal or
 * delivered transition of pipeline rows.
 */
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import twilio from 'twilio';

import { refundTerminalFailure } from '@/libs/billing/creditReservation';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { enqueueTwilioCostReconciliation } from '@/libs/integrationOutbox';
import { notificationDeliverySchema } from '@/models/Schema';

const RETRYABLE_ERROR_CODES = new Set(['30001', '30008']);
const DELIVERY_STATES = new Set([
  'accepted',
  'scheduled',
  'queued',
  'sending',
  'sent',
  'delivered',
  'undelivered',
  'failed',
  'read',
  'canceled',
]);

/** Monotonic ranks; terminal failures outrank delivered (see header). */
const STATUS_RANK: Record<string, number> = {
  queued: 10,
  scheduled: 15,
  accepted: 20,
  sending: 30,
  sent: 40,
  delivered: 50,
  read: 55,
  canceled: 70,
  undelivered: 70,
  failed: 70,
};

const TERMINAL_FAILURES = new Set(['failed', 'undelivered', 'canceled']);

export async function POST(request: Request) {
  const form = await request.formData();
  const params = Object.fromEntries(Array.from(form.entries()).map(([key, value]) => [key, String(value)]));
  const signature = request.headers.get('x-twilio-signature') || '';
  if (!Env.TWILIO_AUTH_TOKEN || !twilio.validateRequest(Env.TWILIO_AUTH_TOKEN, signature, request.url, params)) {
    return Response.json({ error: 'Invalid Twilio signature' }, { status: 403 });
  }

  const deliveryId = new URL(request.url).searchParams.get('deliveryId');
  const providerMessageId = params.MessageSid || params.SmsSid;
  const providerStatus = (params.MessageStatus || params.SmsStatus || '').toLowerCase();
  if (!deliveryId || !providerMessageId || !DELIVERY_STATES.has(providerStatus)) {
    return Response.json({ error: 'Invalid delivery callback' }, { status: 400 });
  }

  const [delivery] = await db
    .select({
      salonId: notificationDeliverySchema.salonId,
      creditReservationId: notificationDeliverySchema.creditReservationId,
      settlementState: notificationDeliverySchema.settlementState,
      reconciledAt: notificationDeliverySchema.reconciledAt,
      appointmentId: notificationDeliverySchema.appointmentId,
    })
    .from(notificationDeliverySchema)
    .where(eq(notificationDeliverySchema.id, deliveryId))
    .limit(1);
  if (!delivery) {
    return new Response(null, { status: 204 });
  }

  const rank = STATUS_RANK[providerStatus] ?? 0;
  const errorCode = params.ErrorCode || null;

  // Monotonic CAS: legacy NULL-rank rows accept their first callback (the
  // pre-Gate-B behavior, byte-identical), then become ordered. updated_at is
  // set explicitly — stale updated_at on callback-updated rows was a latent
  // bug in the pre-hardening route.
  const applied = await db
    .update(notificationDeliverySchema)
    .set({
      providerMessageId,
      status: providerStatus,
      statusRank: rank,
      errorCode,
      errorMessage: params.ErrorMessage || null,
      retryable: errorCode ? RETRYABLE_ERROR_CODES.has(errorCode) : null,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(and(
      eq(notificationDeliverySchema.id, deliveryId),
      eq(notificationDeliverySchema.salonId, delivery.salonId),
      or(
        isNull(notificationDeliverySchema.statusRank),
        sql`${notificationDeliverySchema.statusRank} < ${rank}`,
      ),
    ))
    .returning();

  // Financial disposition + reconciliation only on the FIRST transition into
  // the state (the CAS returned a row) and only for pipeline rows (a
  // reservation is linked; legacy BYO rows have none). The refund gate reads
  // the settlement state from the CAS RESULT — the pre-CAS snapshot could
  // predate the dispatcher's settle and skip the refund forever. A callback
  // that instead lands mid-settle ('settling' here) is repaired by the
  // dispatcher's own post-settle terminal re-check.
  if (applied.length === 1 && delivery.creditReservationId !== null) {
    if (TERMINAL_FAILURES.has(providerStatus) && applied[0]!.settlementState === 'settled') {
      await refundTerminalFailure({ reservationId: delivery.creditReservationId });
      await db
        .update(notificationDeliverySchema)
        .set({ settlementState: 'refunded' })
        .where(and(
          eq(notificationDeliverySchema.id, deliveryId),
          eq(notificationDeliverySchema.settlementState, 'settled'),
        ));
    }
    if (delivery.reconciledAt === null
      && (providerStatus === 'delivered' || TERMINAL_FAILURES.has(providerStatus))) {
      await enqueueTwilioCostReconciliation({
        salonId: delivery.salonId,
        appointmentId: delivery.appointmentId,
        deliveryId,
        providerMessageId,
      });
    }
  }

  return new Response(null, { status: 204 });
}
