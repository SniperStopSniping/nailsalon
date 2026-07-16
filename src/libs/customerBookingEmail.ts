import { and, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { createOpaqueToken } from '@/libs/lusterSecurity';
import { buildSalonTenantPublicUrl } from '@/libs/publicUrl';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/libs/timeZone';
import { appointmentAccessTokenSchema, appointmentSchema, appointmentServicesSchema, integrationOutboxSchema, notificationDeliverySchema, salonSchema } from '@/models/Schema';

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\'': '&#39;', '"': '&quot;' })[character]!);
}

export async function sendCustomerBookingConfirmationEmail(input: {
  to: string;
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
  const result = await sendTransactionalEmailDetailed({ to: input.to, subject, text, html });
  await db.update(notificationDeliverySchema).set({
    status: result.ok ? 'sent' : 'failed',
    providerMessageId: result.providerMessageId,
    errorCode: result.errorCode,
    retryable: !result.ok,
  }).where(and(eq(notificationDeliverySchema.id, deliveryId), eq(notificationDeliverySchema.salonId, input.salonId)));
  if (!result.ok) {
    await db.insert(integrationOutboxSchema).values({
      id: crypto.randomUUID(),
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      provider: 'email',
      operation: 'retry_booking_confirmation',
      dedupeKey: `email:booking-confirmation-retry:${input.appointmentId}`,
      payload: { deliveryId },
    }).onConflictDoNothing();
  }
  return result.ok;
}

export async function retryCustomerBookingConfirmationEmail(input: { salonId: string; appointmentId: string; deliveryId: string }) {
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
  if (!row?.appointment.clientEmail) {
    throw new Error('BOOKING_EMAIL_RECIPIENT_UNAVAILABLE');
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
  const manageUrl = buildSalonTenantPublicUrl(`/manage/${capability.token}`, { slug: row.salonSlug, customDomain: row.customDomain });
  const { resolveBookingConfigFromSettings } = await import('@/libs/bookingConfig');
  const config = resolveBookingConfigFromSettings(row.salonSettings);
  const date = formatDateInTimeZone(row.appointment.startTime.toISOString(), { weekday: 'long', month: 'long', day: 'numeric' }, config.timezone);
  const time = formatTimeInTimeZone(row.appointment.startTime.toISOString(), {}, config.timezone);
  const serviceNames = services.map(service => service.name || 'Appointment');
  const text = `Your ${serviceNames.join(', ')} appointment with ${row.salonName} is confirmed for ${date} at ${time}.\n\nView, reschedule, or cancel: ${manageUrl}`;
  const { sendTransactionalEmailDetailed } = await import('@/libs/email');
  const result = await sendTransactionalEmailDetailed({
    to: row.appointment.clientEmail,
    subject: `${row.salonName} booking confirmed`,
    text,
    html: `<p>Your appointment with <strong>${escapeHtml(row.salonName)}</strong> is confirmed for <strong>${escapeHtml(date)} at ${escapeHtml(time)}</strong>.</p><p><a href="${escapeHtml(manageUrl)}">View, reschedule, or cancel</a></p>`,
  });
  await db.update(notificationDeliverySchema).set({ status: result.ok ? 'sent' : 'failed', providerMessageId: result.providerMessageId, errorCode: result.errorCode, retryable: !result.ok }).where(and(eq(notificationDeliverySchema.id, input.deliveryId), eq(notificationDeliverySchema.salonId, input.salonId)));
  if (!result.ok) {
    await db.update(appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(and(
      eq(appointmentAccessTokenSchema.salonId, input.salonId),
      eq(appointmentAccessTokenSchema.tokenHash, capability.tokenHash),
    ));
    throw new Error(result.errorCode || 'BOOKING_EMAIL_RETRY_FAILED');
  }
  const activeTokens = await db.select({ id: appointmentAccessTokenSchema.id })
    .from(appointmentAccessTokenSchema)
    .where(and(
      eq(appointmentAccessTokenSchema.salonId, input.salonId),
      eq(appointmentAccessTokenSchema.appointmentId, input.appointmentId),
      isNull(appointmentAccessTokenSchema.revokedAt),
    ))
    .orderBy(desc(appointmentAccessTokenSchema.createdAt));
  for (const stale of activeTokens.slice(3)) {
    await db.update(appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(and(
      eq(appointmentAccessTokenSchema.id, stale.id),
      eq(appointmentAccessTokenSchema.salonId, input.salonId),
    ));
  }
  return result;
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
    return await retryCustomerBookingConfirmationEmail({ ...input, deliveryId });
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
