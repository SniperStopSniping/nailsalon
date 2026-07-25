import { and, asc, eq, gt, inArray, isNull, ne } from 'drizzle-orm';

import {
  appointmentAccessTokenSchema,
  appointmentSchema,
  appointmentServicesSchema,
  integrationOutboxSchema,
  notificationDeliverySchema,
  salonSchema,
} from '@/models/Schema';

import { ACTIVE_APPOINTMENT_STATUSES } from './activeAppointments';
import { buildAppointmentManageUrl } from './appointmentManageUrl';
import { resolveAppointmentOperationalEmailRecipient } from './clientLifecycleStabilization';
import { db } from './DB';
import { createOpaqueToken, hashOpaqueToken } from './lusterSecurity';
import { formatDateInTimeZone, formatTimeInTimeZone } from './timeZone';

const RECOVERY_DEDUPE_BUCKET_MS = 10 * 60_000;
const MAX_ACTIVE_TOKENS_PER_APPOINTMENT = 3;
const TOKEN_LIFETIME_AFTER_END_MS = 30 * 24 * 60 * 60 * 1000;

type RecoverySalonSettings = import('@/types/salonPolicy').SalonSettings | null | undefined;

type RecoverySalon = {
  id: string;
  slug: string;
  name: string;
  customDomain: string | null;
  settings?: RecoverySalonSettings;
};

type RecoveryAppointment = {
  id: string;
  startTime: Date;
  endTime: Date;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\'': '&#39;', '"': '&quot;' })[character]!);
}

/**
 * One recovery email per exact appointment set per 10-minute window. Recipient
 * changes do not create a new business event, and appointment IDs are hashed
 * so the delivery ledger contains no customer-facing values.
 */
export function buildRecoveryDedupeKey(
  salonId: string,
  appointmentIds: string[],
  now: Date = new Date(),
): string {
  const bucketStart = now.getTime() - (now.getTime() % RECOVERY_DEDUPE_BUCKET_MS);
  const appointmentSet = [...new Set(appointmentIds)].sort().join(':');
  return `email:booking-recovery:${salonId}:${hashOpaqueToken(appointmentSet)}:${bucketStart}`;
}

async function mintManageLink(salon: RecoverySalon, appointment: RecoveryAppointment): Promise<{ url: string; tokenHash: string }> {
  const capability = createOpaqueToken();
  await db.insert(appointmentAccessTokenSchema).values({
    id: crypto.randomUUID(),
    salonId: salon.id,
    appointmentId: appointment.id,
    tokenHash: capability.tokenHash,
    expiresAt: new Date(appointment.endTime.getTime() + TOKEN_LIFETIME_AFTER_END_MS),
  });
  const active = await db.select({ id: appointmentAccessTokenSchema.id }).from(appointmentAccessTokenSchema).where(and(
    eq(appointmentAccessTokenSchema.salonId, salon.id),
    eq(appointmentAccessTokenSchema.appointmentId, appointment.id),
    isNull(appointmentAccessTokenSchema.revokedAt),
  )).orderBy(asc(appointmentAccessTokenSchema.createdAt));
  if (active.length > MAX_ACTIVE_TOKENS_PER_APPOINTMENT) {
    await db.update(appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(inArray(
      appointmentAccessTokenSchema.id,
      active.slice(0, -MAX_ACTIVE_TOKENS_PER_APPOINTMENT).map(row => row.id),
    ));
  }
  return {
    url: buildAppointmentManageUrl({ slug: salon.slug, customDomain: salon.customDomain }, capability.token),
    tokenHash: capability.tokenHash,
  };
}

async function loadServiceNames(appointmentIds: string[]): Promise<Map<string, string[]>> {
  if (!appointmentIds.length) {
    return new Map();
  }
  const rows = await db.select({
    appointmentId: appointmentServicesSchema.appointmentId,
    name: appointmentServicesSchema.nameSnapshot,
  }).from(appointmentServicesSchema).where(inArray(appointmentServicesSchema.appointmentId, appointmentIds));
  const names = new Map<string, string[]>();
  for (const row of rows) {
    const list = names.get(row.appointmentId) ?? [];
    list.push(row.name || 'Appointment');
    names.set(row.appointmentId, list);
  }
  return names;
}

async function resolveTimezone(settings: RecoverySalonSettings): Promise<string> {
  const { resolveBookingConfigFromSettings } = await import('./bookingConfig');
  return resolveBookingConfigFromSettings(settings).timezone;
}

function buildEmailContent(args: {
  salonName: string;
  timezone: string;
  entries: Array<{ serviceNames: string[]; startTime: Date; url: string }>;
}): { subject: string; text: string; html: string } {
  const { salonName, timezone, entries } = args;
  const lines = entries.map((entry) => {
    const date = formatDateInTimeZone(entry.startTime, { weekday: 'long', month: 'long', day: 'numeric' }, timezone);
    const time = formatTimeInTimeZone(entry.startTime, { timeZoneName: 'short' }, timezone);
    return { ...entry, date, time };
  });
  const text = [
    `Your upcoming ${salonName} booking${entries.length === 1 ? '' : 's'}:`,
    ...lines.map((line, index) => [
      `${index + 1}. ${line.serviceNames.join(', ') || 'Appointment'} — ${line.date} at ${line.time}`,
      `   View, reschedule, or cancel: ${line.url}`,
    ].join('\n')),
    'These private links let you view, reschedule, or cancel. Keep them secure.',
  ].join('\n\n');
  const html = [
    `<p>Your upcoming ${escapeHtml(salonName)} booking${entries.length === 1 ? '' : 's'}:</p>`,
    ...lines.map(line => `<p><strong>${escapeHtml(line.serviceNames.join(', ') || 'Appointment')}</strong> — ${escapeHtml(line.date)} at ${escapeHtml(line.time)}<br/><a href="${escapeHtml(line.url)}">View, reschedule, or cancel</a></p>`),
    '<p>Keep these private links secure.</p>',
  ].join('');
  return { subject: `${salonName} booking access`, text, html };
}

async function resolveRecoveryRecipient(
  salonId: string,
  appointments: RecoveryAppointment[],
): Promise<string | null> {
  const destinations = new Set<string>();
  const terminalClientIds = new Set<string>();
  for (const appointment of appointments) {
    const recipient = await resolveAppointmentOperationalEmailRecipient({
      salonId,
      appointmentId: appointment.id,
    });
    if (recipient.status === 'unavailable') {
      return null;
    }
    destinations.add(recipient.email);
    terminalClientIds.add(recipient.terminalClientId);
  }
  if (destinations.size !== 1 || terminalClientIds.size !== 1) {
    return null;
  }
  return [...destinations][0] ?? null;
}

async function markRecoveryRecipientUnavailable(input: {
  salonId: string;
  deliveryId: string;
}) {
  await db.update(notificationDeliverySchema).set({
    status: 'failed',
    errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
    retryable: false,
  }).where(and(
    eq(notificationDeliverySchema.id, input.deliveryId),
    eq(notificationDeliverySchema.salonId, input.salonId),
    ne(notificationDeliverySchema.status, 'sent'),
  ));
}

/**
 * Resolve one current operational destination for the complete appointment
 * set, then mint capabilities and deliver. Lookup input never supplies the
 * destination. Provider failures are recorded as retryable and enqueued using
 * IDs only.
 */
export async function sendBookingRecoveryEmail(input: {
  salon: RecoverySalon;
  appointments: RecoveryAppointment[];
}): Promise<{ ok: boolean; deduped: boolean; deliveryId: string | null; errorCode?: string | null }> {
  const { salon, appointments } = input;
  if (!appointments.length) {
    return { ok: true, deduped: false, deliveryId: null };
  }

  const recipientEmail = await resolveRecoveryRecipient(salon.id, appointments);
  if (!recipientEmail) {
    return {
      ok: false,
      deduped: false,
      deliveryId: null,
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
    };
  }

  const deliveryId = crypto.randomUUID();
  const appointmentIds = [...new Set(
    appointments.map(appointment => appointment.id),
  )].sort();
  const inserted = await db.insert(notificationDeliverySchema).values({
    id: deliveryId,
    salonId: salon.id,
    appointmentId: appointments[0]!.id,
    channel: 'email',
    purpose: 'booking_recovery',
    dedupeKey: buildRecoveryDedupeKey(salon.id, appointmentIds),
    status: 'queued',
  }).onConflictDoNothing().returning();
  if (!inserted.length) {
    return { ok: true, deduped: true, deliveryId: null };
  }

  const issuedTokenHashes: string[] = [];
  const entries: Array<{ serviceNames: string[]; startTime: Date; url: string }> = [];
  const serviceNames = await loadServiceNames(appointments.map(appointment => appointment.id));
  for (const appointment of appointments) {
    const link = await mintManageLink(salon, appointment);
    issuedTokenHashes.push(link.tokenHash);
    entries.push({
      serviceNames: serviceNames.get(appointment.id) ?? [],
      startTime: appointment.startTime,
      url: link.url,
    });
  }

  const timezone = await resolveTimezone(salon.settings);
  const content = buildEmailContent({ salonName: salon.name, timezone, entries });
  const { sendTransactionalEmailDetailed } = await import('./email');
  const result = await sendTransactionalEmailDetailed({
    to: recipientEmail,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });

  await db.update(notificationDeliverySchema).set({
    status: result.ok ? 'sent' : 'failed',
    providerMessageId: result.providerMessageId,
    errorCode: result.errorCode,
    retryable: !result.ok,
  }).where(and(eq(notificationDeliverySchema.id, deliveryId), eq(notificationDeliverySchema.salonId, salon.id)));

  if (!result.ok) {
    if (issuedTokenHashes.length) {
      await db.update(appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(and(
        eq(appointmentAccessTokenSchema.salonId, salon.id),
        inArray(appointmentAccessTokenSchema.tokenHash, issuedTokenHashes),
      ));
    }
    await db.insert(integrationOutboxSchema).values({
      id: crypto.randomUUID(),
      salonId: salon.id,
      appointmentId: appointments[0]!.id,
      provider: 'email',
      operation: 'retry_booking_recovery',
      dedupeKey: `email:booking-recovery-retry:${deliveryId}`,
      // IDs only — never email addresses or tokens.
      payload: { deliveryId, appointmentIds },
    }).onConflictDoNothing();
  }

  return { ok: result.ok, deduped: false, deliveryId, errorCode: result.errorCode ?? null };
}

/**
 * Outbox retry: re-resolves the recipient and appointment set from the
 * database at retry time (appointments may have ended or been cancelled since
 * the original attempt), re-mints fresh tokens, and updates the original
 * delivery row. Throws on failure so the outbox applies backoff.
 */
export async function retryBookingRecoveryEmail(input: {
  salonId: string;
  deliveryId: string;
  appointmentIds: string[];
}): Promise<{ ok: boolean; errorCode?: string }> {
  const [delivery] = await db.select({
    status: notificationDeliverySchema.status,
  }).from(notificationDeliverySchema).where(and(
    eq(notificationDeliverySchema.id, input.deliveryId),
    eq(notificationDeliverySchema.salonId, input.salonId),
  )).limit(1);
  if (!delivery) {
    throw new Error('RECOVERY_EMAIL_DELIVERY_NOT_FOUND');
  }
  if (delivery.status === 'sent') {
    return { ok: true };
  }

  const [salon] = await db.select({
    id: salonSchema.id,
    slug: salonSchema.slug,
    name: salonSchema.name,
    customDomain: salonSchema.customDomain,
    settings: salonSchema.settings,
  }).from(salonSchema).where(eq(salonSchema.id, input.salonId)).limit(1);
  if (!salon) {
    throw new Error('RECOVERY_SALON_UNAVAILABLE');
  }

  const appointmentIds = [...new Set(input.appointmentIds)].sort();
  const appointments = await db.select({
    id: appointmentSchema.id,
    startTime: appointmentSchema.startTime,
    endTime: appointmentSchema.endTime,
    clientEmail: appointmentSchema.clientEmail,
  }).from(appointmentSchema).where(and(
    eq(appointmentSchema.salonId, input.salonId),
    inArray(appointmentSchema.id, appointmentIds),
    inArray(appointmentSchema.status, [...ACTIVE_APPOINTMENT_STATUSES]),
    gt(appointmentSchema.endTime, new Date()),
    isNull(appointmentSchema.deletedAt),
  )).orderBy(asc(appointmentSchema.startTime));

  const loadedAppointmentIds = new Set(
    appointments.map(appointment => appointment.id),
  );
  if (
    !appointmentIds.length
    || appointments.length !== appointmentIds.length
    || appointmentIds.some(id => !loadedAppointmentIds.has(id))
  ) {
    await markRecoveryRecipientUnavailable(input);
    return { ok: false, errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE' };
  }

  const recipientEmail = await resolveRecoveryRecipient(
    input.salonId,
    appointments,
  );
  if (!recipientEmail) {
    await markRecoveryRecipientUnavailable(input);
    return { ok: false, errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE' };
  }

  const issuedTokenHashes: string[] = [];
  const entries: Array<{ serviceNames: string[]; startTime: Date; url: string }> = [];
  const serviceNames = await loadServiceNames(appointments.map(appointment => appointment.id));
  for (const appointment of appointments) {
    const link = await mintManageLink(salon, appointment);
    issuedTokenHashes.push(link.tokenHash);
    entries.push({
      serviceNames: serviceNames.get(appointment.id) ?? [],
      startTime: appointment.startTime,
      url: link.url,
    });
  }

  const timezone = await resolveTimezone(salon.settings);
  const content = buildEmailContent({ salonName: salon.name, timezone, entries });
  const { sendTransactionalEmailDetailed } = await import('./email');
  const result = await sendTransactionalEmailDetailed({
    to: recipientEmail,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });

  await db.update(notificationDeliverySchema).set({
    status: result.ok ? 'sent' : 'failed',
    providerMessageId: result.providerMessageId,
    errorCode: result.errorCode,
    retryable: !result.ok,
  }).where(and(eq(notificationDeliverySchema.id, input.deliveryId), eq(notificationDeliverySchema.salonId, input.salonId)));

  if (!result.ok) {
    if (issuedTokenHashes.length) {
      await db.update(appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(and(
        eq(appointmentAccessTokenSchema.salonId, input.salonId),
        inArray(appointmentAccessTokenSchema.tokenHash, issuedTokenHashes),
      ));
    }
    throw new Error(result.errorCode || 'RECOVERY_EMAIL_RETRY_FAILED');
  }

  return { ok: true };
}
