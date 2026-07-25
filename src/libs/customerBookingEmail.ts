import { and, desc, eq, isNull, ne } from 'drizzle-orm';

import { buildAppointmentManageUrl } from '@/libs/appointmentManageUrl';
import { resolveAppointmentOperationalEmailRecipient } from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import type { TransactionalEmailResult } from '@/libs/email';
import { createOpaqueToken } from '@/libs/lusterSecurity';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/libs/timeZone';
import { appointmentAccessTokenSchema, appointmentSchema, appointmentServicesSchema, integrationOutboxSchema, notificationDeliverySchema, salonSchema } from '@/models/Schema';

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\'': '&#39;', '"': '&quot;' })[character]!);
}

const unavailableRecipientResult: TransactionalEmailResult = {
  ok: false,
  errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
  providerMessageId: null,
};

const ambiguousDeliveryResult: TransactionalEmailResult = {
  ok: false,
  errorCode: 'EMAIL_DELIVERY_STATE_UNKNOWN',
  providerMessageId: null,
};

function isAmbiguousProviderFailure(
  result: TransactionalEmailResult,
): boolean {
  return result.errorCode === 'RESEND_NETWORK_ERROR';
}

async function markBookingRecipientUnavailable(input: {
  salonId: string;
  appointmentId: string;
  deliveryId: string;
}) {
  await db.update(notificationDeliverySchema).set({
    status: 'failed',
    errorCode: unavailableRecipientResult.errorCode,
    retryable: false,
  }).where(and(
    eq(notificationDeliverySchema.id, input.deliveryId),
    eq(notificationDeliverySchema.salonId, input.salonId),
    eq(notificationDeliverySchema.appointmentId, input.appointmentId),
    ne(notificationDeliverySchema.status, 'sent'),
  ));
}

async function markBookingRetryableFailure(input: {
  salonId: string;
  appointmentId: string;
  deliveryId: string;
  errorCode: string;
}) {
  await db.update(notificationDeliverySchema).set({
    status: 'failed',
    errorCode: input.errorCode,
    retryable: true,
  }).where(and(
    eq(notificationDeliverySchema.id, input.deliveryId),
    eq(notificationDeliverySchema.salonId, input.salonId),
    eq(notificationDeliverySchema.appointmentId, input.appointmentId),
    ne(notificationDeliverySchema.status, 'sent'),
  ));
}

async function markBookingAmbiguousFailure(input: {
  salonId: string;
  appointmentId: string;
  deliveryId: string;
  errorCode: string;
}) {
  await db.update(notificationDeliverySchema).set({
    status: 'failed',
    errorCode: input.errorCode,
    retryable: false,
  }).where(and(
    eq(notificationDeliverySchema.id, input.deliveryId),
    eq(notificationDeliverySchema.salonId, input.salonId),
    eq(notificationDeliverySchema.appointmentId, input.appointmentId),
    ne(notificationDeliverySchema.status, 'sent'),
  ));
}

async function enqueueBookingConfirmationRetry(input: {
  salonId: string;
  appointmentId: string;
  deliveryId: string;
}) {
  await db.insert(integrationOutboxSchema).values({
    id: crypto.randomUUID(),
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    provider: 'email',
    operation: 'retry_booking_confirmation',
    dedupeKey: `email:booking-confirmation-retry:${input.appointmentId}`,
    payload: { deliveryId: input.deliveryId },
  }).onConflictDoNothing();
}

async function revokeBookingCapability(input: {
  salonId: string;
  tokenHash: string;
}) {
  await db.update(appointmentAccessTokenSchema).set({
    revokedAt: new Date(),
  }).where(and(
    eq(appointmentAccessTokenSchema.salonId, input.salonId),
    eq(appointmentAccessTokenSchema.tokenHash, input.tokenHash),
  ));
}

export async function sendCustomerBookingConfirmationEmail(input: {
  salonName: string;
  clientName: string;
  serviceNames: string[];
  startTime: string;
  timeZone: string;
  manageUrl: string;
  salonId: string;
  appointmentId: string;
}) {
  const { sendTransactionalEmailDetailed } = await import('@/libs/email');
  const date = formatDateInTimeZone(input.startTime, { weekday: 'long', month: 'long', day: 'numeric' }, input.timeZone);
  const time = formatTimeInTimeZone(input.startTime, {}, input.timeZone);
  const subject = `${input.salonName} booking confirmed`;
  const text = [
    `Hi ${input.clientName},`,
    `Your ${input.serviceNames.join(', ')} appointment with ${input.salonName} is confirmed for ${date} at ${time}.`,
    `View, reschedule, or cancel: ${input.manageUrl}`,
  ].join('\n\n');
  const html = `<p>Hi ${escapeHtml(input.clientName)},</p><p>Your <strong>${escapeHtml(input.serviceNames.join(', '))}</strong> appointment with ${escapeHtml(input.salonName)} is confirmed for <strong>${escapeHtml(date)} at ${escapeHtml(time)}</strong>.</p><p><a href="${escapeHtml(input.manageUrl)}">View, reschedule, or cancel your appointment</a></p>`;
  const deliveryId = crypto.randomUUID();
  const inserted = await db.insert(notificationDeliverySchema).values({
    id: deliveryId,
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    channel: 'email',
    purpose: 'booking_confirmation',
    dedupeKey: `email:booking-confirmation:${input.appointmentId}`,
    status: 'queued',
  }).onConflictDoNothing().returning();
  if (!inserted.length) {
    return true;
  }
  let recipient;
  try {
    recipient = await resolveAppointmentOperationalEmailRecipient({
      salonId: input.salonId,
      appointmentId: input.appointmentId,
    });
  } catch {
    await markBookingRetryableFailure({
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      deliveryId,
      errorCode: 'OPERATIONAL_EMAIL_RESOLUTION_FAILED',
    }).catch(() => undefined);
    await enqueueBookingConfirmationRetry({
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      deliveryId,
    }).catch(() => undefined);
    return false;
  }
  if (recipient.status === 'unavailable') {
    await markBookingRecipientUnavailable({
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      deliveryId,
    });
    return false;
  }
  const result = await sendTransactionalEmailDetailed({
    to: recipient.email,
    subject,
    text,
    html,
  });
  if (result.ok) {
    // The provider has accepted the message. A ledger outage must not turn the
    // acknowledged business event into a duplicate send on a later retry.
    try {
      await db.update(notificationDeliverySchema).set({
        status: 'sent',
        providerMessageId: result.providerMessageId,
        errorCode: null,
        retryable: false,
      }).where(and(
        eq(notificationDeliverySchema.id, deliveryId),
        eq(notificationDeliverySchema.salonId, input.salonId),
      ));
    } catch {
      // Provider acceptance is authoritative for retry suppression.
    }
    return true;
  }

  if (isAmbiguousProviderFailure(result)) {
    await markBookingAmbiguousFailure({
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      deliveryId,
      errorCode: result.errorCode!,
    }).catch(() => undefined);
    return false;
  }

  await markBookingRetryableFailure({
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    deliveryId,
    errorCode: result.errorCode ?? 'BOOKING_EMAIL_FAILED',
  }).catch(() => undefined);
  await enqueueBookingConfirmationRetry({
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    deliveryId,
  }).catch(() => undefined);
  return false;
}

export async function retryCustomerBookingConfirmationEmail(input: { salonId: string; appointmentId: string; deliveryId: string }) {
  const [delivery] = await db.select({
    status: notificationDeliverySchema.status,
  }).from(notificationDeliverySchema).where(and(
    eq(notificationDeliverySchema.id, input.deliveryId),
    eq(notificationDeliverySchema.salonId, input.salonId),
    eq(notificationDeliverySchema.appointmentId, input.appointmentId),
  )).limit(1);
  if (!delivery) {
    throw new Error('BOOKING_EMAIL_DELIVERY_NOT_FOUND');
  }
  if (delivery.status === 'sent') {
    return {
      ok: true,
      errorCode: null,
      providerMessageId: null,
    } satisfies TransactionalEmailResult;
  }

  let recipient;
  try {
    recipient = await resolveAppointmentOperationalEmailRecipient({
      salonId: input.salonId,
      appointmentId: input.appointmentId,
    });
  } catch (error) {
    await markBookingRetryableFailure({
      ...input,
      errorCode: 'OPERATIONAL_EMAIL_RESOLUTION_FAILED',
    }).catch(() => undefined);
    throw error;
  }
  if (recipient.status === 'unavailable') {
    await markBookingRecipientUnavailable(input);
    return unavailableRecipientResult;
  }

  const [row] = await db.select({
    appointment: appointmentSchema,
    salonName: salonSchema.name,
    salonSlug: salonSchema.slug,
    customDomain: salonSchema.customDomain,
    salonSettings: salonSchema.settings,
  }).from(appointmentSchema).innerJoin(salonSchema, eq(salonSchema.id, appointmentSchema.salonId)).where(and(
    eq(appointmentSchema.id, input.appointmentId),
    eq(appointmentSchema.salonId, input.salonId),
  )).limit(1);
  if (!row) {
    throw new Error('BOOKING_EMAIL_APPOINTMENT_NOT_FOUND');
  }
  const services = await db.select({ name: appointmentServicesSchema.nameSnapshot }).from(appointmentServicesSchema).where(eq(appointmentServicesSchema.appointmentId, input.appointmentId));
  const capability = createOpaqueToken();
  await db.insert(appointmentAccessTokenSchema).values({
    id: crypto.randomUUID(),
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    tokenHash: capability.tokenHash,
    expiresAt: new Date(row.appointment.endTime.getTime() + 30 * 24 * 60 * 60 * 1000),
  });
  const manageUrl = buildAppointmentManageUrl({ slug: row.salonSlug, customDomain: row.customDomain }, capability.token);
  const { resolveBookingConfigFromSettings } = await import('@/libs/bookingConfig');
  const config = resolveBookingConfigFromSettings(row.salonSettings);
  const date = formatDateInTimeZone(row.appointment.startTime.toISOString(), { weekday: 'long', month: 'long', day: 'numeric' }, config.timezone);
  const time = formatTimeInTimeZone(row.appointment.startTime.toISOString(), {}, config.timezone);
  const serviceNames = services.map(service => service.name || 'Appointment');
  const text = `Your ${serviceNames.join(', ')} appointment with ${row.salonName} is confirmed for ${date} at ${time}.\n\nView, reschedule, or cancel: ${manageUrl}`;
  const { sendTransactionalEmailDetailed } = await import('@/libs/email');
  let finalRecipient;
  try {
    finalRecipient = await resolveAppointmentOperationalEmailRecipient({
      salonId: input.salonId,
      appointmentId: input.appointmentId,
    });
  } catch (error) {
    await revokeBookingCapability({
      salonId: input.salonId,
      tokenHash: capability.tokenHash,
    });
    throw error;
  }
  if (finalRecipient.status === 'unavailable') {
    await revokeBookingCapability({
      salonId: input.salonId,
      tokenHash: capability.tokenHash,
    });
    await markBookingRecipientUnavailable(input);
    return unavailableRecipientResult;
  }
  let result: TransactionalEmailResult;
  try {
    result = await sendTransactionalEmailDetailed({
      to: finalRecipient.email,
      subject: `${row.salonName} booking confirmed`,
      text,
      html: `<p>Your appointment with <strong>${escapeHtml(row.salonName)}</strong> is confirmed for <strong>${escapeHtml(date)} at ${escapeHtml(time)}</strong>.</p><p><a href="${escapeHtml(manageUrl)}">View, reschedule, or cancel</a></p>`,
    });
  } catch {
    await markBookingAmbiguousFailure({
      ...input,
      errorCode: ambiguousDeliveryResult.errorCode!,
    }).catch(() => undefined);
    return ambiguousDeliveryResult;
  }

  if (result.ok) {
    // Once accepted by the provider, every remaining database write is
    // best-effort. Throwing would make the outbox send this event again.
    try {
      await db.update(notificationDeliverySchema).set({
        status: 'sent',
        providerMessageId: result.providerMessageId,
        errorCode: null,
        retryable: false,
      }).where(and(
        eq(notificationDeliverySchema.id, input.deliveryId),
        eq(notificationDeliverySchema.salonId, input.salonId),
      ));
    } catch {
      // Provider acceptance is authoritative for retry suppression.
    }
    let activeTokens: Array<{ id: string }> = [];
    try {
      activeTokens = await db.select({ id: appointmentAccessTokenSchema.id })
        .from(appointmentAccessTokenSchema)
        .where(and(
          eq(appointmentAccessTokenSchema.salonId, input.salonId),
          eq(appointmentAccessTokenSchema.appointmentId, input.appointmentId),
          isNull(appointmentAccessTokenSchema.revokedAt),
        ))
        .orderBy(desc(appointmentAccessTokenSchema.createdAt));
    } catch {
      // Token-cap maintenance must not retry an acknowledged email.
    }
    for (const stale of activeTokens.slice(3)) {
      try {
        await db.update(appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(and(
          eq(appointmentAccessTokenSchema.id, stale.id),
          eq(appointmentAccessTokenSchema.salonId, input.salonId),
        ));
      } catch {
        // Token-cap maintenance must not retry an acknowledged email.
      }
    }
    return result;
  }

  if (isAmbiguousProviderFailure(result)) {
    await markBookingAmbiguousFailure({
      ...input,
      errorCode: result.errorCode!,
    }).catch(() => undefined);
    return result;
  }

  await markBookingRetryableFailure({
    ...input,
    errorCode: result.errorCode ?? 'BOOKING_EMAIL_RETRY_FAILED',
  }).catch(() => undefined);
  await revokeBookingCapability({
    salonId: input.salonId,
    tokenHash: capability.tokenHash,
  }).catch(() => undefined);
  throw new Error(result.errorCode || 'BOOKING_EMAIL_RETRY_FAILED');
}

export async function resendCustomerBookingConfirmationEmail(input: { salonId: string; appointmentId: string }) {
  const deliveryId = crypto.randomUUID();
  await db.insert(notificationDeliverySchema).values({
    id: deliveryId,
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    channel: 'email',
    purpose: 'booking_confirmation_resend',
    dedupeKey: `email:booking-confirmation-resend:${input.appointmentId}:${deliveryId}`,
    status: 'queued',
  });
  try {
    return await retryCustomerBookingConfirmationEmail({
      ...input,
      deliveryId,
    });
  } catch (error) {
    await db.insert(integrationOutboxSchema).values({
      id: crypto.randomUUID(),
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      provider: 'email',
      operation: 'retry_booking_confirmation',
      dedupeKey: `email:booking-confirmation-manual-retry:${input.appointmentId}:${deliveryId}`,
      payload: { deliveryId },
    }).onConflictDoNothing();
    throw error;
  }
}
