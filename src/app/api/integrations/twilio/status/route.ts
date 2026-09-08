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

import { refundTerminalFailure } from '@/libs/billing/creditReservation';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { enqueueTwilioCostReconciliation } from '@/libs/integrationOutbox';
import { validateTwilioWebhook } from '@/libs/twilioWebhook';
import { communicationIntentSchema, notificationDeliverySchema, salonTwilioConnectionSchema } from '@/models/Schema';

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
  if (!await validateTwilioWebhook(request, params)) {
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
      providerMessageId: notificationDeliverySchema.providerMessageId,
      channel: notificationDeliverySchema.channel,
      senderIdentity: notificationDeliverySchema.senderIdentity,
      messagingServiceSid: notificationDeliverySchema.messagingServiceSid,
      intentId: notificationDeliverySchema.intentId,
    })
    .from(notificationDeliverySchema)
    .where(eq(notificationDeliverySchema.id, deliveryId))
    .limit(1);
  if (!delivery) {
    return new Response(null, { status: 204 });
  }

  if (delivery.channel !== 'sms' || (delivery.providerMessageId && delivery.providerMessageId !== providerMessageId)) {
    return Response.json({ error: 'Delivery identity mismatch' }, { status: 409 });
  }
  const [connection] = await db.select().from(salonTwilioConnectionSchema)
    .where(eq(salonTwilioConnectionSchema.salonId, delivery.salonId)).limit(1);
  const expectedAccount = delivery.senderIdentity?.startsWith('byo:')
    ? delivery.senderIdentity.slice(4)
    : delivery.senderIdentity ? Env.TWILIO_ACCOUNT_SID : connection?.connectAccountSid ?? Env.TWILIO_ACCOUNT_SID;
  if (!expectedAccount || params.AccountSid !== expectedAccount
    || (delivery.messagingServiceSid && params.MessagingServiceSid !== delivery.messagingServiceSid)) {
    return Response.json({ error: 'Sender identity mismatch' }, { status: 403 });
  }
  if (delivery.intentId) {
    const [intent] = await db.select({ recipient: communicationIntentSchema.recipient })
      .from(communicationIntentSchema).where(and(
        eq(communicationIntentSchema.id, delivery.intentId),
        eq(communicationIntentSchema.salonId, delivery.salonId),
      )).limit(1);
    const normalize = (phone: string) => phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    if (!intent || !params.To || normalize(params.To) !== normalize(intent.recipient)) {
      return Response.json({ error: 'Recipient identity mismatch' }, { status: 403 });
    }
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
      errorMessage: errorCode ? 'Twilio reported a delivery failure.' : null,
      retryable: errorCode ? RETRYABLE_ERROR_CODES.has(errorCode) : null,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(and(
      eq(notificationDeliverySchema.id, deliveryId),
      eq(notificationDeliverySchema.salonId, delivery.salonId),
      or(isNull(notificationDeliverySchema.providerMessageId), eq(notificationDeliverySchema.providerMessageId, providerMessageId)),
      or(
        isNull(notificationDeliverySchema.statusRank),
        sql`${notificationDeliverySchema.statusRank} < ${rank}`,
      ),
    ))
    .returning();

  // Resume idempotent financial work even when the status CAS already ran.
  // A crash after recording the callback must not permanently lose a refund
  // or reconciliation job on Twilio's next delivery of the same callback.
  const current = applied[0] ?? (await db.select().from(notificationDeliverySchema)
    .where(and(eq(notificationDeliverySchema.id, deliveryId), eq(notificationDeliverySchema.salonId, delivery.salonId), eq(notificationDeliverySchema.providerMessageId, providerMessageId))).limit(1))[0];
  if (current?.creditReservationId) {
    if (TERMINAL_FAILURES.has(current.status) && current.settlementState === 'settled') {
      await refundTerminalFailure({ reservationId: current.creditReservationId });
      await db.update(notificationDeliverySchema).set({ settlementState: 'refunded' })
        .where(and(eq(notificationDeliverySchema.id, deliveryId), eq(notificationDeliverySchema.salonId, delivery.salonId), eq(notificationDeliverySchema.settlementState, 'settled')));
    }
    if (current.reconciledAt === null && (current.status === 'delivered' || TERMINAL_FAILURES.has(current.status))) {
      await enqueueTwilioCostReconciliation({
        salonId: current.salonId,
        appointmentId: current.appointmentId,
        deliveryId,
        providerMessageId,
      });
    }
  }

  return new Response(null, { status: 204 });
}
