import { and, desc, eq, isNull, ne } from 'drizzle-orm';

import { buildAppointmentManageUrl } from '@/libs/appointmentManageUrl';
import { resolveBookingExperience } from '@/libs/bookingExperience';
import { resolveAppointmentOperationalEmailRecipient } from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import type { TransactionalEmailResult } from '@/libs/email';
import { createOpaqueToken } from '@/libs/lusterSecurity';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/libs/timeZone';
import { appointmentAccessTokenSchema, appointmentSchema, appointmentServicesSchema, integrationOutboxSchema, notificationDeliverySchema, salonSchema } from '@/models/Schema';

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\'': '&#39;', '"': '&quot;' })[character]!);
}

function appendConfirmationMessageText(
  systemContent: string,
  confirmationMessage: string | null,
): string {
  return confirmationMessage
    ? `${systemContent}\n\n${confirmationMessage}`
    : systemContent;
}

function appendConfirmationMessageHtml(
  systemContent: string,
  confirmationMessage: string | null,
): string {
  if (!confirmationMessage) {
    return systemContent;
  }

  const safeMessage = escapeHtml(confirmationMessage).replace(/\n/g, '<br />');
  return `${systemContent}<p>${safeMessage}</p>`;
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

const appointmentNotConfirmableResult: TransactionalEmailResult = {
  ok: false,
  errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
  providerMessageId: null,
};

type BookingConfirmationEligibility = {
  deletedAt: Date | null;
  startTime: Date;
  status: string;
};

function isBookingConfirmationEligible(
  appointment: BookingConfirmationEligibility | undefined,
): appointment is BookingConfirmationEligibility {
  return Boolean(
    appointment
    && appointment.deletedAt === null
    && appointment.startTime.getTime() > Date.now()
    && (appointment.status === 'pending' || appointment.status === 'confirmed'),
  );
}

async function loadBookingConfirmationEligibility(input: {
  salonId: string;
  appointmentId: string;
}) {
  const [appointment] = await db.select({
    status: appointmentSchema.status,
    deletedAt: appointmentSchema.deletedAt,
    startTime: appointmentSchema.startTime,
  }).from(appointmentSchema).where(and(
    eq(appointmentSchema.id, input.appointmentId),
    eq(appointmentSchema.salonId, input.salonId),
  )).limit(1);
  return appointment;
}

async function loadBookingConfirmationMessage(
  salonId: string,
): Promise<string | null> {
  try {
    const [salon] = await db.select({
      settings: salonSchema.settings,
    }).from(salonSchema).where(eq(salonSchema.id, salonId)).limit(1);

    return resolveBookingExperience(salon?.settings).confirmationMessage;
  } catch {
    // Booking customization is optional. A lookup or legacy-data failure must
    // never prevent the unchanged operational confirmation from being sent.
    return null;
  }
}

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

async function markBookingAppointmentNotConfirmable(input: {
  salonId: string;
  appointmentId: string;
  deliveryId: string;
}) {
  await markBookingAmbiguousFailure({
    ...input,
    errorCode: appointmentNotConfirmableResult.errorCode!,
  });
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

async function claimBookingConfirmationRetry(input: {
  salonId: string;
  appointmentId: string;
  deliveryId: string;
}): Promise<boolean> {
  const claimed = await db.update(notificationDeliverySchema).set({
    status: 'queued',
    errorCode: 'EMAIL_DELIVERY_STATE_UNKNOWN',
    retryable: false,
  }).where(and(
    eq(notificationDeliverySchema.id, input.deliveryId),
    eq(notificationDeliverySchema.salonId, input.salonId),
    eq(notificationDeliverySchema.appointmentId, input.appointmentId),
    eq(notificationDeliverySchema.status, 'failed'),
    eq(notificationDeliverySchema.retryable, true),
  )).returning();
  return claimed.length === 1;
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

async function restoreBookingRetryAfterCapabilityCleanup(input: {
  salonId: string;
  appointmentId: string;
  deliveryId: string;
  tokenHash: string | null;
  errorCode: string;
}) {
  if (input.tokenHash) {
    try {
      await revokeBookingCapability({
        salonId: input.salonId,
        tokenHash: input.tokenHash,
      });
    } catch {
      await markBookingAmbiguousFailure({
        salonId: input.salonId,
        appointmentId: input.appointmentId,
        deliveryId: input.deliveryId,
        errorCode: 'BOOKING_CAPABILITY_CLEANUP_FAILED',
      }).catch(() => undefined);
      throw new Error('BOOKING_CAPABILITY_CLEANUP_FAILED');
    }
  }
  await markBookingRetryableFailure({
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    deliveryId: input.deliveryId,
    errorCode: input.errorCode,
  });
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
  const systemText = [
    `Hi ${input.clientName},`,
    `Your ${input.serviceNames.join(', ')} appointment with ${input.salonName} is confirmed for ${date} at ${time}.`,
    `View, reschedule, or cancel: ${input.manageUrl}`,
  ].join('\n\n');
  const systemHtml = `<p>Hi ${escapeHtml(input.clientName)},</p><p>Your <strong>${escapeHtml(input.serviceNames.join(', '))}</strong> appointment with ${escapeHtml(input.salonName)} is confirmed for <strong>${escapeHtml(date)} at ${escapeHtml(time)}</strong>.</p><p><a href="${escapeHtml(input.manageUrl)}">View, reschedule, or cancel your appointment</a></p>`;
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
  let confirmationMessage: string | null = null;
  try {
    const appointment = await loadBookingConfirmationEligibility(input);
    if (!isBookingConfirmationEligible(appointment)) {
      await markBookingAppointmentNotConfirmable({
        ...input,
        deliveryId,
      });
      return false;
    }
    confirmationMessage = await loadBookingConfirmationMessage(input.salonId);
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
    text: appendConfirmationMessageText(systemText, confirmationMessage),
    html: appendConfirmationMessageHtml(systemHtml, confirmationMessage),
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
    errorCode: notificationDeliverySchema.errorCode,
    providerMessageId: notificationDeliverySchema.providerMessageId,
    retryable: notificationDeliverySchema.retryable,
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
  if (
    delivery.status !== 'failed'
    || delivery.retryable !== true
    || !await claimBookingConfirmationRetry(input)
  ) {
    return {
      ok: false,
      errorCode: delivery.errorCode ?? 'BOOKING_EMAIL_NOT_RETRYABLE',
      providerMessageId: delivery.providerMessageId,
    } satisfies TransactionalEmailResult;
  }

  let capabilityTokenHash: string | null = null;
  let emailInput: {
    to: string;
    subject: string;
    text: string;
    html: string;
  };
  let sendTransactionalEmailDetailed: typeof import('@/libs/email').sendTransactionalEmailDetailed;
  try {
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
    if (!row || !isBookingConfirmationEligible(row.appointment)) {
      await markBookingAppointmentNotConfirmable(input);
      return appointmentNotConfirmableResult;
    }
    const services = await db.select({ name: appointmentServicesSchema.nameSnapshot }).from(appointmentServicesSchema).where(eq(appointmentServicesSchema.appointmentId, input.appointmentId));
    const { resolveBookingConfigFromSettings } = await import('@/libs/bookingConfig');
    const config = resolveBookingConfigFromSettings(row.salonSettings);
    const confirmationMessage = resolveBookingExperience(
      row.salonSettings,
    ).confirmationMessage;
    const date = formatDateInTimeZone(row.appointment.startTime.toISOString(), { weekday: 'long', month: 'long', day: 'numeric' }, config.timezone);
    const time = formatTimeInTimeZone(row.appointment.startTime.toISOString(), {}, config.timezone);
    const serviceNames = services.map(service => service.name || 'Appointment');
    ({ sendTransactionalEmailDetailed } = await import('@/libs/email'));

    const finalRecipientBeforeToken = await resolveAppointmentOperationalEmailRecipient({
      salonId: input.salonId,
      appointmentId: input.appointmentId,
    });
    if (finalRecipientBeforeToken.status === 'unavailable') {
      await markBookingRecipientUnavailable(input);
      return unavailableRecipientResult;
    }

    const capability = createOpaqueToken();
    capabilityTokenHash = capability.tokenHash;
    await db.insert(appointmentAccessTokenSchema).values({
      id: crypto.randomUUID(),
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      tokenHash: capability.tokenHash,
      expiresAt: new Date(row.appointment.endTime.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
    const manageUrl = buildAppointmentManageUrl({ slug: row.salonSlug, customDomain: row.customDomain }, capability.token);
    const systemText = `Your ${serviceNames.join(', ')} appointment with ${row.salonName} is confirmed for ${date} at ${time}.\n\nView, reschedule, or cancel: ${manageUrl}`;
    const systemHtml = `<p>Your appointment with <strong>${escapeHtml(row.salonName)}</strong> is confirmed for <strong>${escapeHtml(date)} at ${escapeHtml(time)}</strong>.</p><p><a href="${escapeHtml(manageUrl)}">View, reschedule, or cancel</a></p>`;
    const finalRecipient = await resolveAppointmentOperationalEmailRecipient({
      salonId: input.salonId,
      appointmentId: input.appointmentId,
    });
    if (finalRecipient.status === 'unavailable') {
      await revokeBookingCapability({
        salonId: input.salonId,
        tokenHash: capability.tokenHash,
      });
      capabilityTokenHash = null;
      await markBookingRecipientUnavailable(input);
      return unavailableRecipientResult;
    }
    const finalEligibility = await loadBookingConfirmationEligibility(input);
    if (!isBookingConfirmationEligible(finalEligibility)) {
      await revokeBookingCapability({
        salonId: input.salonId,
        tokenHash: capability.tokenHash,
      });
      capabilityTokenHash = null;
      await markBookingAppointmentNotConfirmable(input);
      return appointmentNotConfirmableResult;
    }
    emailInput = {
      to: finalRecipient.email,
      subject: `${row.salonName} booking confirmed`,
      text: appendConfirmationMessageText(systemText, confirmationMessage),
      html: appendConfirmationMessageHtml(systemHtml, confirmationMessage),
    };
  } catch (error) {
    await restoreBookingRetryAfterCapabilityCleanup({
      ...input,
      tokenHash: capabilityTokenHash,
      errorCode: 'BOOKING_EMAIL_PREPARATION_FAILED',
    });
    throw error;
  }

  let result: TransactionalEmailResult;
  try {
    result = await sendTransactionalEmailDetailed(emailInput);
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

  await restoreBookingRetryAfterCapabilityCleanup({
    ...input,
    tokenHash: capabilityTokenHash,
    errorCode: result.errorCode ?? 'BOOKING_EMAIL_RETRY_FAILED',
  });
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
    status: 'failed',
    errorCode: 'MANUAL_RESEND_REQUESTED',
    retryable: true,
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
