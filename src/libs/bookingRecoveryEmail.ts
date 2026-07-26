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
const CANONICAL_RECOVERY_PURPOSE = 'booking_recovery';
const ORPHAN_RECOVERY_PURPOSE = 'booking_recovery_zero_candidate';

export type RecoveryRecipientMode =
  | 'canonical_terminal'
  | 'zero_candidate_orphan';

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

class RecoveryProviderError extends Error {}

function isAmbiguousProviderFailure(errorCode: string | null): boolean {
  return errorCode === 'RESEND_NETWORK_ERROR';
}

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

function planManageLink(
  salon: RecoverySalon,
  appointment: RecoveryAppointment,
): {
    url: string;
    tokenHash: string;
    row: typeof appointmentAccessTokenSchema.$inferInsert;
  } {
  const capability = createOpaqueToken();
  return {
    url: buildAppointmentManageUrl({ slug: salon.slug, customDomain: salon.customDomain }, capability.token),
    tokenHash: capability.tokenHash,
    row: {
      id: crypto.randomUUID(),
      salonId: salon.id,
      appointmentId: appointment.id,
      tokenHash: capability.tokenHash,
      expiresAt: new Date(appointment.endTime.getTime() + TOKEN_LIFETIME_AFTER_END_MS),
    },
  };
}

async function revokeRecoveryTokens(salonId: string, tokenHashes: string[]): Promise<void> {
  if (!tokenHashes.length) {
    return;
  }
  await db.update(appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(and(
    eq(appointmentAccessTokenSchema.salonId, salonId),
    inArray(appointmentAccessTokenSchema.tokenHash, tokenHashes),
  ));
}

async function pruneRecoveryTokensAfterSuccess(
  salonId: string,
  appointmentIds: string[],
): Promise<void> {
  for (const appointmentId of appointmentIds) {
    const active = await db.select({ id: appointmentAccessTokenSchema.id })
      .from(appointmentAccessTokenSchema)
      .where(and(
        eq(appointmentAccessTokenSchema.salonId, salonId),
        eq(appointmentAccessTokenSchema.appointmentId, appointmentId),
        isNull(appointmentAccessTokenSchema.revokedAt),
      ))
      .orderBy(asc(appointmentAccessTokenSchema.createdAt));
    const staleIds = active
      .slice(0, Math.max(0, active.length - MAX_ACTIVE_TOKENS_PER_APPOINTMENT))
      .map(row => row.id);
    if (staleIds.length) {
      await db.update(appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(and(
        eq(appointmentAccessTokenSchema.salonId, salonId),
        inArray(appointmentAccessTokenSchema.id, staleIds),
      ));
    }
  }
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
  recipientMode: RecoveryRecipientMode,
): Promise<{ email: string; terminalClientId: string | null } | null> {
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
    if (recipientMode === 'zero_candidate_orphan') {
      if (
        recipient.status !== 'appointment_snapshot'
        || recipient.terminalClientId !== null
        || !('identityResolution' in recipient)
        || recipient.identityResolution !== 'zero_identity_candidates'
      ) {
        return null;
      }
    } else if (recipient.terminalClientId === null) {
      return null;
    }
    destinations.add(recipient.email);
    if (recipient.terminalClientId !== null) {
      terminalClientIds.add(recipient.terminalClientId);
    }
  }
  if (
    destinations.size !== 1
    || (
      recipientMode === 'canonical_terminal'
        ? terminalClientIds.size !== 1
        : terminalClientIds.size !== 0
    )
  ) {
    return null;
  }
  const email = [...destinations][0];
  if (!email) {
    return null;
  }
  return {
    email,
    terminalClientId:
      recipientMode === 'canonical_terminal'
        ? [...terminalClientIds][0]!
        : null,
  };
}

function recoveryPurposeForMode(mode: RecoveryRecipientMode): string {
  return mode === 'zero_candidate_orphan'
    ? ORPHAN_RECOVERY_PURPOSE
    : CANONICAL_RECOVERY_PURPOSE;
}

function recoveryModeForPurpose(purpose: string): RecoveryRecipientMode | null {
  if (purpose === ORPHAN_RECOVERY_PURPOSE) {
    return 'zero_candidate_orphan';
  }
  if (purpose === CANONICAL_RECOVERY_PURPOSE) {
    return 'canonical_terminal';
  }
  return null;
}

async function loadExactRecoveryAppointments(
  salonId: string,
  requestedAppointmentIds: string[],
): Promise<RecoveryAppointment[] | null> {
  const appointmentIds = [...new Set(requestedAppointmentIds)].sort();
  if (!appointmentIds.length) {
    return null;
  }
  const appointments = await db.select({
    id: appointmentSchema.id,
    startTime: appointmentSchema.startTime,
    endTime: appointmentSchema.endTime,
  }).from(appointmentSchema).where(and(
    eq(appointmentSchema.salonId, salonId),
    inArray(appointmentSchema.id, appointmentIds),
    inArray(appointmentSchema.status, [...ACTIVE_APPOINTMENT_STATUSES]),
    gt(appointmentSchema.endTime, new Date()),
    isNull(appointmentSchema.deletedAt),
  )).orderBy(asc(appointmentSchema.startTime), asc(appointmentSchema.id));
  const loadedIds = new Set(appointments.map(appointment => appointment.id));
  return appointments.length === appointmentIds.length
    && appointmentIds.every(id => loadedIds.has(id))
    ? appointments
    : null;
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

async function markRecoveryRetryableFailure(input: {
  salonId: string;
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
    ne(notificationDeliverySchema.status, 'sent'),
  ));
}

async function markRecoveryAmbiguousFailure(input: {
  salonId: string;
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
    ne(notificationDeliverySchema.status, 'sent'),
  ));
}

async function restoreRecoveryRetryAfterCapabilityCleanup(input: {
  salonId: string;
  deliveryId: string;
  tokenHashes: string[];
  errorCode: string;
}) {
  try {
    await revokeRecoveryTokens(input.salonId, input.tokenHashes);
  } catch {
    await markRecoveryAmbiguousFailure({
      salonId: input.salonId,
      deliveryId: input.deliveryId,
      errorCode: 'RECOVERY_CAPABILITY_CLEANUP_FAILED',
    }).catch(() => undefined);
    throw new Error('RECOVERY_CAPABILITY_CLEANUP_FAILED');
  }
  await markRecoveryRetryableFailure({
    salonId: input.salonId,
    deliveryId: input.deliveryId,
    errorCode: input.errorCode,
  });
}

async function claimRecoveryRetry(input: {
  salonId: string;
  deliveryId: string;
}): Promise<boolean> {
  const claimed = await db.update(notificationDeliverySchema).set({
    status: 'queued',
    errorCode: 'EMAIL_DELIVERY_STATE_UNKNOWN',
    retryable: false,
  }).where(and(
    eq(notificationDeliverySchema.id, input.deliveryId),
    eq(notificationDeliverySchema.salonId, input.salonId),
    eq(notificationDeliverySchema.status, 'failed'),
    eq(notificationDeliverySchema.retryable, true),
  )).returning();
  return claimed.length === 1;
}

async function enqueueRecoveryRetry(input: {
  salonId: string;
  deliveryId: string;
  appointmentIds: string[];
}) {
  await db.insert(integrationOutboxSchema).values({
    id: crypto.randomUUID(),
    salonId: input.salonId,
    appointmentId: input.appointmentIds[0]!,
    provider: 'email',
    operation: 'retry_booking_recovery',
    dedupeKey: `email:booking-recovery-retry:${input.deliveryId}`,
    // IDs only — never email addresses or tokens.
    payload: {
      deliveryId: input.deliveryId,
      appointmentIds: input.appointmentIds,
    },
  }).onConflictDoNothing();
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
  recipientMode?: RecoveryRecipientMode;
}): Promise<{ ok: boolean; deduped: boolean; deliveryId: string | null; errorCode?: string | null }> {
  const { salon } = input;
  const recipientMode = input.recipientMode ?? 'canonical_terminal';
  const appointmentIds = [...new Set(
    input.appointments.map(appointment => appointment.id),
  )].sort();
  if (!appointmentIds.length) {
    return { ok: true, deduped: false, deliveryId: null };
  }

  const appointments = await loadExactRecoveryAppointments(
    salon.id,
    appointmentIds,
  );
  if (!appointments) {
    return {
      ok: false,
      deduped: false,
      deliveryId: null,
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
    };
  }

  const initialRecipient = await resolveRecoveryRecipient(
    salon.id,
    appointments,
    recipientMode,
  );
  if (!initialRecipient) {
    return {
      ok: false,
      deduped: false,
      deliveryId: null,
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
    };
  }

  const deliveryId = crypto.randomUUID();
  const inserted = await db.insert(notificationDeliverySchema).values({
    id: deliveryId,
    salonId: salon.id,
    appointmentId: appointments[0]!.id,
    channel: 'email',
    purpose: recoveryPurposeForMode(recipientMode),
    dedupeKey: buildRecoveryDedupeKey(salon.id, appointmentIds),
    status: 'queued',
  }).onConflictDoNothing().returning();
  if (!inserted.length) {
    return { ok: true, deduped: true, deliveryId: null };
  }

  const issuedTokenHashes: string[] = [];
  let content: { subject: string; text: string; html: string };
  let recipientEmail: string;
  let sendTransactionalEmailDetailed: typeof import('./email').sendTransactionalEmailDetailed;
  try {
    const serviceNames = await loadServiceNames(appointmentIds);
    const timezone = await resolveTimezone(salon.settings);
    ({ sendTransactionalEmailDetailed } = await import('./email'));
    const finalRecipientBeforeTokens = await resolveRecoveryRecipient(
      salon.id,
      appointments,
      recipientMode,
    );
    if (!finalRecipientBeforeTokens) {
      await markRecoveryRecipientUnavailable({ salonId: salon.id, deliveryId });
      return {
        ok: false,
        deduped: false,
        deliveryId,
        errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
      };
    }
    // Recovery capabilities are created only after the final supported
    // destination has been resolved. They are still committed before the
    // provider call, so no database locks are held during external delivery.
    const entries: Array<{ serviceNames: string[]; startTime: Date; url: string }> = [];
    for (const appointment of appointments) {
      const link = planManageLink(salon, appointment);
      issuedTokenHashes.push(link.tokenHash);
      await db.insert(appointmentAccessTokenSchema).values(link.row);
      entries.push({
        serviceNames: serviceNames.get(appointment.id) ?? [],
        startTime: appointment.startTime,
        url: link.url,
      });
    }
    content = buildEmailContent({ salonName: salon.name, timezone, entries });
    const finalRecipient = await resolveRecoveryRecipient(
      salon.id,
      appointments,
      recipientMode,
    );
    if (!finalRecipient) {
      await revokeRecoveryTokens(salon.id, issuedTokenHashes);
      issuedTokenHashes.length = 0;
      await markRecoveryRecipientUnavailable({ salonId: salon.id, deliveryId });
      return {
        ok: false,
        deduped: false,
        deliveryId,
        errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
      };
    }
    recipientEmail = finalRecipient.email;
  } catch {
    await restoreRecoveryRetryAfterCapabilityCleanup({
      salonId: salon.id,
      deliveryId,
      tokenHashes: issuedTokenHashes,
      errorCode: 'RECOVERY_EMAIL_PREPARATION_FAILED',
    });
    await enqueueRecoveryRetry({ salonId: salon.id, deliveryId, appointmentIds });
    return {
      ok: false,
      deduped: false,
      deliveryId,
      errorCode: 'RECOVERY_EMAIL_PREPARATION_FAILED',
    };
  }

  let result;
  try {
    result = await sendTransactionalEmailDetailed({
      to: recipientEmail,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  } catch {
    await markRecoveryAmbiguousFailure({
      salonId: salon.id,
      deliveryId,
      errorCode: 'EMAIL_DELIVERY_STATE_UNKNOWN',
    }).catch(() => undefined);
    return {
      ok: false,
      deduped: false,
      deliveryId,
      errorCode: 'EMAIL_DELIVERY_STATE_UNKNOWN',
    };
  }

  if (result.ok) {
    // Provider acceptance is the no-resend boundary. Ledger/cap maintenance is
    // best-effort after this point so an acknowledged message is never sent
    // again and its freshly delivered capabilities remain valid.
    try {
      await db.update(notificationDeliverySchema).set({
        status: 'sent',
        providerMessageId: result.providerMessageId,
        errorCode: null,
        retryable: false,
      }).where(and(
        eq(notificationDeliverySchema.id, deliveryId),
        eq(notificationDeliverySchema.salonId, salon.id),
      ));
    } catch {
      // Provider acceptance is authoritative for retry suppression.
    }
    await pruneRecoveryTokensAfterSuccess(salon.id, appointmentIds)
      .catch(() => undefined);
    return {
      ok: true,
      deduped: false,
      deliveryId,
      errorCode: null,
    };
  }

  if (isAmbiguousProviderFailure(result.errorCode)) {
    await markRecoveryAmbiguousFailure({
      salonId: salon.id,
      deliveryId,
      errorCode: result.errorCode!,
    }).catch(() => undefined);
    return {
      ok: false,
      deduped: false,
      deliveryId,
      errorCode: result.errorCode,
    };
  }

  await restoreRecoveryRetryAfterCapabilityCleanup({
    salonId: salon.id,
    deliveryId,
    tokenHashes: issuedTokenHashes,
    errorCode: result.errorCode ?? 'RECOVERY_EMAIL_FAILED',
  });
  await enqueueRecoveryRetry({ salonId: salon.id, deliveryId, appointmentIds })
    .catch(() => undefined);
  return {
    ok: false,
    deduped: false,
    deliveryId,
    errorCode: result.errorCode ?? 'RECOVERY_EMAIL_FAILED',
  };
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
    errorCode: notificationDeliverySchema.errorCode,
    retryable: notificationDeliverySchema.retryable,
    purpose: notificationDeliverySchema.purpose,
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
  const recipientMode = recoveryModeForPurpose(delivery.purpose);
  if (!recipientMode) {
    await markRecoveryRecipientUnavailable(input);
    return { ok: false, errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE' };
  }
  if (
    delivery.status !== 'failed'
    || delivery.retryable !== true
    || !await claimRecoveryRetry(input)
  ) {
    return {
      ok: false,
      errorCode: delivery.errorCode ?? 'RECOVERY_EMAIL_NOT_RETRYABLE',
    };
  }

  const appointmentIds = [...new Set(input.appointmentIds)].sort();
  let salon: RecoverySalon;
  let appointments: RecoveryAppointment[];
  try {
    const [loadedSalon] = await db.select({
      id: salonSchema.id,
      slug: salonSchema.slug,
      name: salonSchema.name,
      customDomain: salonSchema.customDomain,
      settings: salonSchema.settings,
    }).from(salonSchema).where(eq(salonSchema.id, input.salonId)).limit(1);
    if (!loadedSalon) {
      throw new Error('RECOVERY_SALON_UNAVAILABLE');
    }
    salon = loadedSalon;

    const loadedAppointments = await loadExactRecoveryAppointments(
      input.salonId,
      appointmentIds,
    );
    if (!loadedAppointments) {
      await markRecoveryRecipientUnavailable(input);
      return { ok: false, errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE' };
    }
    appointments = loadedAppointments;

    const initialRecipient = await resolveRecoveryRecipient(
      input.salonId,
      appointments,
      recipientMode,
    );
    if (!initialRecipient) {
      await markRecoveryRecipientUnavailable(input);
      return { ok: false, errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE' };
    }
  } catch (error) {
    await markRecoveryRetryableFailure({
      salonId: input.salonId,
      deliveryId: input.deliveryId,
      errorCode: 'RECOVERY_EMAIL_PREPARATION_FAILED',
    });
    throw error;
  }

  const issuedTokenHashes: string[] = [];
  let content: { subject: string; text: string; html: string };
  let recipientEmail: string;
  let sendTransactionalEmailDetailed: typeof import('./email').sendTransactionalEmailDetailed;
  try {
    const serviceNames = await loadServiceNames(appointmentIds);
    const timezone = await resolveTimezone(salon.settings);
    ({ sendTransactionalEmailDetailed } = await import('./email'));
    const finalRecipientBeforeTokens = await resolveRecoveryRecipient(
      input.salonId,
      appointments,
      recipientMode,
    );
    if (!finalRecipientBeforeTokens) {
      await markRecoveryRecipientUnavailable(input);
      return { ok: false, errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE' };
    }

    const entries: Array<{ serviceNames: string[]; startTime: Date; url: string }> = [];
    for (const appointment of appointments) {
      const link = planManageLink(salon, appointment);
      issuedTokenHashes.push(link.tokenHash);
      await db.insert(appointmentAccessTokenSchema).values(link.row);
      entries.push({
        serviceNames: serviceNames.get(appointment.id) ?? [],
        startTime: appointment.startTime,
        url: link.url,
      });
    }
    content = buildEmailContent({ salonName: salon.name, timezone, entries });
    const finalRecipient = await resolveRecoveryRecipient(
      input.salonId,
      appointments,
      recipientMode,
    );
    if (!finalRecipient) {
      await revokeRecoveryTokens(input.salonId, issuedTokenHashes);
      issuedTokenHashes.length = 0;
      await markRecoveryRecipientUnavailable(input);
      return { ok: false, errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE' };
    }
    recipientEmail = finalRecipient.email;
  } catch (error) {
    await restoreRecoveryRetryAfterCapabilityCleanup({
      salonId: input.salonId,
      deliveryId: input.deliveryId,
      tokenHashes: issuedTokenHashes,
      errorCode: 'RECOVERY_EMAIL_PREPARATION_FAILED',
    });
    throw error;
  }

  let result;
  try {
    result = await sendTransactionalEmailDetailed({
      to: recipientEmail,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  } catch {
    await markRecoveryAmbiguousFailure({
      salonId: input.salonId,
      deliveryId: input.deliveryId,
      errorCode: 'EMAIL_DELIVERY_STATE_UNKNOWN',
    }).catch(() => undefined);
    return { ok: false, errorCode: 'EMAIL_DELIVERY_STATE_UNKNOWN' };
  }

  if (result.ok) {
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
    await pruneRecoveryTokensAfterSuccess(input.salonId, appointmentIds)
      .catch(() => undefined);
    return { ok: true };
  }

  if (isAmbiguousProviderFailure(result.errorCode)) {
    await markRecoveryAmbiguousFailure({
      salonId: input.salonId,
      deliveryId: input.deliveryId,
      errorCode: result.errorCode!,
    }).catch(() => undefined);
    return { ok: false, errorCode: result.errorCode! };
  }

  await restoreRecoveryRetryAfterCapabilityCleanup({
    salonId: input.salonId,
    deliveryId: input.deliveryId,
    tokenHashes: issuedTokenHashes,
    errorCode: result.errorCode ?? 'RECOVERY_EMAIL_RETRY_FAILED',
  });
  throw new RecoveryProviderError(
    result.errorCode || 'RECOVERY_EMAIL_RETRY_FAILED',
  );
}
