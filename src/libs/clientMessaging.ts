import 'server-only';

import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { getSalonClientLineageIdentityWithHandle, lockTerminalSalonClientWithHandle, resolveTerminalSalonClient } from '@/libs/clientLifecycleStabilization';
import { enqueueCommunicationIntent } from '@/libs/communicationIntent';
import { friendlyFailureReason, maskRecipient } from '@/libs/communicationMasking';
import { applyQuietHours, computeSchedulingRevision } from '@/libs/communicationScheduling';
import { resolveCommunicationSettingsFromSettings } from '@/libs/communicationSettings';
import { COMMUNICATION_TEMPLATES } from '@/libs/communicationTemplates';
import { db } from '@/libs/DB';
import { isValidPhone } from '@/libs/phone';
import { calculateSmsSegments } from '@/libs/smsSegments';
import { appointmentSchema, communicationIntentSchema, notificationDeliverySchema, salonSchema } from '@/models/Schema';

export class ClientMessagingError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

/** One durable intent per owner action. The provider is called only by the dispatcher. */
export async function queueClientSms(input: {
  salonId: string;
  clientId: string;
  appointmentId?: string;
  message: string;
  requestId: string;
  availability?: { available: boolean; code: string | null; message: string };
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const client = await lockTerminalSalonClientWithHandle(tx, {
      salonId: input.salonId,
      clientId: input.clientId,
      allowArchived: false,
    });
    const identity = await getSalonClientLineageIdentityWithHandle(tx, { salonId: input.salonId, terminalClientId: client.id });
    // Action identity survives client merges and lost HTTP responses. Observe
    // a completed enqueue before rechecking mutable setup or contact fields.
    const dedupeKey = `manual:${input.salonId}:${input.requestId}`;
    const [existing] = await tx.select().from(communicationIntentSchema).where(and(
      eq(communicationIntentSchema.salonId, input.salonId),
      eq(communicationIntentSchema.dedupeKey, dedupeKey),
    )).limit(1);
    if (existing) {
      if (existing.variables.message !== input.message || !identity.clientIds.includes(existing.variables.clientId ?? '')
        || existing.appointmentId !== (input.appointmentId ?? null)) {
        throw new ClientMessagingError('IDEMPOTENCY_CONFLICT', 'This send was already used for a different message. Start a new text.', 409);
      }
      return { intentId: existing.id, created: false };
    }
    if (input.availability?.available === false) {
      throw new ClientMessagingError(input.availability.code ?? 'SMS_UNAVAILABLE', input.availability.message, 409);
    }
    const contact = identity.terminal;
    if (!isValidPhone(contact.phone)) {
      throw new ClientMessagingError('INVALID_CLIENT_PHONE', 'Add a valid mobile number to this client before sending.');
    }
    if (input.appointmentId) {
      const [appointment] = await tx.select().from(appointmentSchema).where(and(
        eq(appointmentSchema.id, input.appointmentId),
        eq(appointmentSchema.salonId, input.salonId),
        inArray(appointmentSchema.salonClientId, identity.clientIds),
        isNull(appointmentSchema.deletedAt),
      )).for('update').limit(1);
      if (!appointment) {
        throw new ClientMessagingError('APPOINTMENT_NOT_FOUND', 'This appointment does not belong to this client.', 404);
      }
    }
    const [salon] = await tx.select().from(salonSchema).where(and(
      eq(salonSchema.id, input.salonId),
      isNull(salonSchema.deletedAt),
    )).limit(1);
    if (!salon || salon.isActive === false) {
      throw new ClientMessagingError('SALON_UNAVAILABLE', 'This salon is unavailable.', 404);
    }
    const body = COMMUNICATION_TEMPLATES.client_manual_text!.render({ salonName: salon.name, message: input.message });
    if (calculateSmsSegments(body).segments > 10) {
      throw new ClientMessagingError('MESSAGE_TOO_LONG', 'Shorten this message to 10 SMS segments or fewer.');
    }
    const settings = resolveCommunicationSettingsFromSettings(salon.settings);
    const timeZone = salon.settings?.booking?.timezone ?? null;
    const notAfter = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const quiet = applyQuietHours({ instant: now, quietHours: settings.quietHours, timeZone, notAfter });
    if (quiet.kind === 'stale') {
      throw new ClientMessagingError('QUIET_HOURS_STALE', 'Quiet hours leave no sending window for this message.');
    }
    return enqueueCommunicationIntent({
      database: tx,
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      channel: 'sms',
      eventType: 'manual_text',
      audience: 'client',
      dedupeKey,
      recipient: contact.phone,
      destinationCountry: 'CA',
      templateKey: 'client_manual_text',
      templateVersion: 'v1',
      variables: { clientId: client.id, message: input.message },
      schedulingRevision: computeSchedulingRevision({ timeZone, quietHours: settings.quietHours, appointmentStart: null, appointmentUpdatedAt: null, smsEnabled: settings.sms.enabled, emailEnabled: settings.email.enabled }),
      scheduledFor: quiet.sendAt,
      notAfter,
    });
  });
}

/** Both workflow histories show Twilio delivery state, not merely queue acceptance. */
export async function getClientSmsHistory(input: { salonId: string; clientId: string; appointmentId?: string }) {
  const client = await resolveTerminalSalonClient({ salonId: input.salonId, clientId: input.clientId, allowArchived: true });
  const identity = await getSalonClientLineageIdentityWithHandle(db, { salonId: input.salonId, terminalClientId: client.id, allowArchived: true });
  const rows = await db.select({ intent: communicationIntentSchema, delivery: notificationDeliverySchema })
    .from(communicationIntentSchema)
    .leftJoin(appointmentSchema, and(eq(appointmentSchema.id, communicationIntentSchema.appointmentId), eq(appointmentSchema.salonId, input.salonId)))
    .leftJoin(notificationDeliverySchema, and(eq(notificationDeliverySchema.id, communicationIntentSchema.deliveryId), eq(notificationDeliverySchema.salonId, input.salonId)))
    .where(and(
      eq(communicationIntentSchema.salonId, input.salonId),
      eq(communicationIntentSchema.channel, 'sms'),
      eq(communicationIntentSchema.audience, 'client'),
      or(inArray(sql<string>`${communicationIntentSchema.variables}->>'clientId'`, identity.clientIds), inArray(appointmentSchema.salonClientId, identity.clientIds)),
      input.appointmentId ? eq(communicationIntentSchema.appointmentId, input.appointmentId) : undefined,
    ))
    .orderBy(desc(communicationIntentSchema.createdAt), desc(communicationIntentSchema.id)).limit(50);
  return rows.map(({ intent, delivery }) => serializeSmsHistory(intent, delivery));
}

export function serializeSmsHistory(
  intent: typeof communicationIntentSchema.$inferSelect,
  delivery: typeof notificationDeliverySchema.$inferSelect | null,
) {
  const pending = ['pending', 'claimed', 'sending', 'blocked_no_credit'].includes(intent.status);
  const status = intent.status === 'sent'
    ? (delivery?.status ?? 'sent')
    : intent.status === 'send_outcome_unknown'
      ? 'checking_delivery'
      : pending
        ? 'queued'
        : ['suppressed', 'expired'].includes(intent.status)
            ? 'failed'
            : intent.status === 'canceled' ? 'cancelled' : intent.status;
  const canRetry = Boolean(intent.variables.clientId) && intent.status === 'failed' && intent.lastError === 'PROVIDER_SYNC_REJECT'
    && Boolean(delivery?.retryable && !delivery.providerMessageId && delivery.settlementState === 'not_applicable')
    && intent.notAfter.getTime() > Date.now();
  return {
    id: intent.id,
    appointmentId: intent.appointmentId,
    eventType: intent.eventType,
    recipient: maskRecipient('sms', intent.recipient),
    status: status === 'accepted' ? 'queued' : status,
    message: intent.bodySnapshot ?? (intent.eventType === 'manual_text' ? intent.variables.message ?? null : null),
    scheduledFor: intent.availableAt.toISOString(),
    createdAt: intent.createdAt.toISOString(),
    updatedAt: (delivery?.updatedAt ?? intent.updatedAt).toISOString(),
    failureReason: intent.status === 'sent' && !['failed', 'undelivered', 'canceled'].includes(status)
      ? null
      : friendlyFailureReason(intent.blockedReason ?? delivery?.errorCode ?? intent.lastError),
    canRetry,
  };
}

/** Proven provider rejection only. Ambiguous or accepted messages can never be resent here. */
export async function retryClientSms(input: { salonId: string; clientId: string; intentId: string; now?: Date }) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const client = await lockTerminalSalonClientWithHandle(tx, { salonId: input.salonId, clientId: input.clientId, allowArchived: false });
    const identity = await getSalonClientLineageIdentityWithHandle(tx, { salonId: input.salonId, terminalClientId: client.id });
    const [intent] = await tx.select().from(communicationIntentSchema).where(and(
      eq(communicationIntentSchema.id, input.intentId),
      eq(communicationIntentSchema.salonId, input.salonId),
      eq(communicationIntentSchema.channel, 'sms'),
      eq(communicationIntentSchema.audience, 'client'),
      inArray(sql<string>`${communicationIntentSchema.variables}->>'clientId'`, identity.clientIds),
    )).for('update').limit(1);
    if (!intent) {
      throw new ClientMessagingError('MESSAGE_NOT_FOUND', 'Message not found for this client.', 404);
    }
    // A repeated retry click only observes the same queued attempt.
    if (['pending', 'claimed', 'sending'].includes(intent.status)) {
      return { intentId: intent.id, created: false };
    }
    const [delivery] = intent.deliveryId
      ? await tx.select().from(notificationDeliverySchema).where(and(
        eq(notificationDeliverySchema.id, intent.deliveryId),
        eq(notificationDeliverySchema.salonId, input.salonId),
      )).for('update').limit(1)
      : [];
    if (intent.status !== 'failed' || intent.lastError !== 'PROVIDER_SYNC_REJECT' || !delivery
      || !delivery.retryable || delivery.providerMessageId || delivery.settlementState !== 'not_applicable' || intent.notAfter <= now) {
      throw new ClientMessagingError('RETRY_UNSAFE', 'This message cannot be retried safely. Check its delivery status before sending a new text.', 409);
    }
    await tx.update(communicationIntentSchema).set({
      status: 'pending',
      availableAt: now,
      resolvedAt: null,
      lastError: null,
      lockedBy: null,
      leaseExpiresAt: null,
    }).where(and(eq(communicationIntentSchema.id, intent.id), eq(communicationIntentSchema.salonId, input.salonId)));
    return { intentId: intent.id, created: false };
  });
}
