/**
 * Canonical SMS dispatcher for shared Luster and connected salon senders.
 * Durable intents own delivery history, retries, quiet hours and current
 * client/appointment checks. Shared sends reserve credits before provider
 * acceptance; connected sends use the same pipeline without Luster credits.
 * Ambiguous provider outcomes are parked and never automatically resent.
 */

import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq, isNull, or, sql } from 'drizzle-orm';

import {
  reapExpiredReservations,
  refundTerminalFailure,
  releaseReservation,
  reserveSmsCredits,
  settleReservationOnAccept,
} from '@/libs/billing/creditReservation';
import {
  claimDueIntents,
  expireStaleIntents,
  recoverExpiredLeases,
  transitionIntent,
} from '@/libs/communicationIntent';
import { checkSharedSendRateLimits } from '@/libs/communicationRateLimit.server';
import { applyQuietHours } from '@/libs/communicationScheduling';
import { resolveEventChannels, resolveSalonCommunicationSettings } from '@/libs/communicationSettings';
import { COMMUNICATION_TEMPLATES } from '@/libs/communicationTemplates';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { readCommunicationControlUncached } from '@/libs/platformCommunicationControl';
import { hasGlobalSuppression, normalizeConsentRecipient } from '@/libs/smsConsentShared';
import { resolveSmsDestination } from '@/libs/smsDestination';
import { calculateSmsSegments } from '@/libs/smsSegments';
import {
  readSharedSenderEnvConfig,
  resolveByoSenderReadiness,
  resolveSharedSenderReadiness,
  resolveSmsSenderMode,
} from '@/libs/smsSender';
import { ProviderOutcomeUnknownError } from '@/libs/twilioMessagingSend';
import {
  communicationConsentSchema,
  type CommunicationIntent,
  communicationIntentSchema,
  notificationDeliverySchema,
  salonSchema,
  salonTwilioConnectionSchema,
} from '@/models/Schema';

/**
 * Gate C's provider wiring throws THIS when the send outcome is ambiguous
 * (timeout/connection-drop after the request may have reached Twilio). The
 * dispatcher then parks the intent as send_outcome_unknown — never released,
 * never resent — for the §7.5 reconciliation to resolve. A plain throw stays
 * a proven synchronous rejection (release, no debit).
 */
export { ProviderOutcomeUnknownError } from '@/libs/twilioMessagingSend';

export type ProviderSendFn = (input: {
  to: string;
  body: string;
  messagingServiceSid: string | null;
  accountSid?: string;
  from?: string | null;
  statusCallbackUrl: string | null;
}) => Promise<{ sid: string }>;

export type DispatchSummary = {
  claimed: number;
  sent: number;
  suppressed: number;
  blockedNoCredit: number;
  failed: number;
  deferred: number;
  expired: number;
  leaseRecovered: number;
  unknownOutcome: number;
};

async function hasSalonTransactionalConsent(salonId: string, recipient: string, requireGranted = true): Promise<boolean> {
  const rows = await db
    .select({ status: communicationConsentSchema.status })
    .from(communicationConsentSchema)
    .where(and(
      eq(communicationConsentSchema.salonId, salonId),
      eq(communicationConsentSchema.recipient, normalizeConsentRecipient(recipient)),
      eq(communicationConsentSchema.channel, 'sms'),
      eq(communicationConsentSchema.purpose, 'appointment_transactional'),
    ))
    .orderBy(sql`${communicationConsentSchema.createdAt} DESC`)
    .limit(1);
  return requireGranted ? rows[0]?.status === 'granted' : rows[0]?.status !== 'revoked';
}

/**
 * Appointment-linked intents re-check the appointment's CURRENT state before
 * any send (review H6 — the ≤15-minute orphan-sweep window is real time in
 * which a cancellation can land): a no-longer-active appointment suppresses
 * the message. Non-appointment intents pass through.
 */
async function appointmentStillActive(intent: CommunicationIntent, now = new Date()): Promise<boolean> {
  if (intent.appointmentId === null) {
    return true;
  }
  const rows = await db.execute(sql`
    SELECT status, start_time, request_expires_at FROM appointment
    WHERE id = ${intent.appointmentId} AND salon_id = ${intent.salonId}
      AND deleted_at IS NULL LIMIT 1
  `);
  const appointment = rows.rows[0] as { status: string; start_time: Date | string; request_expires_at: Date | string | null } | undefined;
  if (!appointment) {
    return false;
  }
  if (['appointment_cancelled', 'booking_request_declined', 'booking_request_expired', 'owner_appointment_cancelled', 'tech_appointment_cancelled'].includes(intent.eventType)) {
    return appointment.status === 'cancelled' || (intent.audience !== 'client' && appointment.status === 'no_show');
  }
  if (intent.eventType === 'manual_text') {
    return true;
  }
  if (intent.startRevision && new Date(appointment.start_time).toISOString() !== intent.startRevision) {
    return false;
  }
  if (intent.eventType === 'booking_request_received') {
    return appointment.status === 'pending' && (!appointment.request_expires_at || new Date(appointment.request_expires_at).getTime() > now.getTime());
  }
  if (['appointment_reminder', 'manual_reminder'].includes(intent.eventType)) {
    return appointment.status === 'confirmed' || (appointment.status === 'pending' && !appointment.request_expires_at);
  }
  if (['booking_confirmation', 'booking_request_approved'].includes(intent.eventType)) {
    return appointment.status === 'confirmed';
  }
  return ['pending', 'confirmed'].includes(appointment.status);
}

/** An intent must still address the same tenant-owned client at send time. */
async function recipientStillCurrent(intent: CommunicationIntent): Promise<boolean> {
  if (intent.channel !== 'sms') {
    return true;
  }
  if (intent.audience !== 'client') {
    const [salon] = await db.select({ ownerPhone: salonSchema.ownerPhone, settings: salonSchema.settings })
      .from(salonSchema).where(eq(salonSchema.id, intent.salonId)).limit(1);
    if (!salon) {
      return false;
    }
    const { resolveBookingNotificationSettingsFromSettings } = await import('@/libs/bookingNotificationSettings');
    const notifications = resolveBookingNotificationSettingsFromSettings(salon.settings);
    const preference = intent.eventType.endsWith('appointment_cancelled') ? notifications.appointmentCancelled : notifications.newBooking;
    if (intent.audience === 'owner') {
      return preference.ownerEnabled && preference.ownerChannel !== 'email' && !!salon.ownerPhone
        && normalizeConsentRecipient(salon.ownerPhone) === normalizeConsentRecipient(intent.recipient);
    }
    if (!preference.technicianEnabled || preference.technicianChannel === 'email' || !intent.appointmentId) {
      return false;
    }
    const rows = await db.execute(sql`
      SELECT t.phone FROM appointment a JOIN technician t ON t.id = a.technician_id AND t.salon_id = a.salon_id
      WHERE a.id = ${intent.appointmentId} AND a.salon_id = ${intent.salonId} AND t.is_active IS NOT FALSE LIMIT 1
    `);
    const technician = rows.rows[0] as { phone: string | null } | undefined;
    return !!technician?.phone && normalizeConsentRecipient(technician.phone) === normalizeConsentRecipient(intent.recipient);
  }
  let clientId = intent.variables?.clientId;
  if (intent.appointmentId) {
    const rows = await db.execute(sql`
      SELECT client_phone, salon_client_id FROM appointment
      WHERE id = ${intent.appointmentId} AND salon_id = ${intent.salonId} LIMIT 1
    `);
    const appointment = rows.rows[0] as { client_phone: string; salon_client_id: string | null } | undefined;
    if (!appointment) {
      return false;
    }
    clientId = appointment.salon_client_id ?? clientId;
    if (!clientId) {
      return normalizeConsentRecipient(appointment.client_phone) === normalizeConsentRecipient(intent.recipient);
    }
  }
  if (!clientId) {
    return true;
  }
  const { ClientLifecycleStabilizationError, resolveOperationalSalonClientContact } = await import('@/libs/clientLifecycleStabilization');
  try {
    const client = await resolveOperationalSalonClientContact({ salonId: intent.salonId, clientId, allowArchived: false });
    return normalizeConsentRecipient(client.phone) === normalizeConsentRecipient(intent.recipient);
  } catch (error) {
    if (error instanceof ClientLifecycleStabilizationError) {
      return false;
    }
    throw error;
  }
}

async function deferIntent(intentId: string, reason: string, now: Date, availableAt = new Date(now.getTime() + 5 * 60 * 1000)): Promise<void> {
  await db
    .update(communicationIntentSchema)
    .set({
      status: 'pending',
      lockedBy: null,
      leaseExpiresAt: null,
      availableAt,
      lastError: reason,
    })
    .where(and(
      eq(communicationIntentSchema.id, intentId),
      eq(communicationIntentSchema.status, 'claimed'),
    ));
}

/**
 * Process one claimed SMS intent through the full pipeline. Exported for
 * tests; the cron route drives it through processDueCommunications.
 */
export async function dispatchClaimedIntent(
  intent: CommunicationIntent,
  providerSend: ProviderSendFn,
  now = new Date(),
): Promise<'sent' | 'suppressed' | 'blocked_no_credit' | 'failed' | 'deferred' | 'expired' | 'unknown_outcome'> {
  const dispatchStartedAt = Date.now();
  if (intent.notAfter.getTime() <= now.getTime()) {
    await transitionIntent(intent.id, { to: 'expired', lastError: 'NOT_AFTER_ELAPSED' }, now);
    return 'expired';
  }

  // Render from the controlled template registry.
  const template = Object.hasOwn(COMMUNICATION_TEMPLATES, intent.templateKey)
    ? COMMUNICATION_TEMPLATES[intent.templateKey]
    : undefined;
  if (template === undefined) {
    await transitionIntent(intent.id, { to: 'failed', lastError: 'UNKNOWN_TEMPLATE' }, now);
    return 'failed';
  }
  const salonRows = await db
    .select({ name: salonSchema.name, slug: salonSchema.slug, isActive: salonSchema.isActive, settings: salonSchema.settings, smsRemindersEnabled: salonSchema.smsRemindersEnabled })
    .from(salonSchema)
    .where(eq(salonSchema.id, intent.salonId))
    .limit(1);
  const salon = salonRows[0];
  if (salon === undefined || salon.isActive === false) {
    await transitionIntent(intent.id, { to: 'suppressed', lastError: 'SALON_INACTIVE' }, now);
    return 'suppressed';
  }

  // Destination policy (explicit stored country; +1 is not proof of Canada).
  const destination = resolveSmsDestination({
    rawPhone: intent.recipient,
    storedCountry: intent.destinationCountry,
  });
  if (!destination.supported) {
    await transitionIntent(intent.id, { to: 'suppressed', lastError: `DESTINATION_NOT_SUPPORTED:${destination.detail}` }, now);
    return 'suppressed';
  }

  const [connection] = await db.select().from(salonTwilioConnectionSchema)
    .where(eq(salonTwilioConnectionSchema.salonId, intent.salonId)).limit(1);
  const mode = resolveSmsSenderMode({ connection: connection ?? null, perSalonDisabled: false });
  const settings = resolveSalonCommunicationSettings(salon.settings, {
    senderMode: mode,
    legacySmsEnabled: salon.smsRemindersEnabled,
  });
  if (!resolveEventChannels(settings, intent.eventType).includes('sms')) {
    await transitionIntent(intent.id, { to: 'suppressed', lastError: 'SALON_SMS_DISABLED' }, now);
    return 'suppressed';
  }
  const quiet = applyQuietHours({
    instant: now,
    quietHours: settings.quietHours,
    timeZone: salon.settings?.booking?.timezone,
    notAfter: intent.notAfter,
    bypass: ['booking_confirmation', 'booking_request_received'].includes(intent.eventType),
  });
  if (quiet.kind === 'stale') {
    await transitionIntent(intent.id, { to: 'expired', lastError: quiet.reason }, now);
    return 'expired';
  }
  if (quiet.kind === 'shifted') {
    await deferIntent(intent.id, 'QUIET_HOURS', now, quiet.sendAt);
    return 'deferred';
  }
  const control = await readCommunicationControlUncached();
  const envConfig = readSharedSenderEnvConfig();
  const readiness = mode === 'connected_byo' && connection
    ? resolveByoSenderReadiness(connection, { authTokenPresent: !!Env.TWILIO_AUTH_TOKEN })
    : resolveSharedSenderReadiness({
      salonSlug: salon.slug,
      config: {
        ...envConfig,
        platformControl: control === null ? null : { smsEnabled: control.smsEnabled },
        creditReservation: { available: true },
      },
    });
  if (!readiness.ready) {
    await deferIntent(intent.id, `SENDER_UNAVAILABLE:${readiness.reason}`, now);
    return 'deferred';
  }
  if (mode === 'shared_luster') {
    if (control !== null && (control.disabledEventTypes ?? []).includes(intent.eventType)) {
      await deferIntent(intent.id, 'KILL_SWITCH:EVENT_DISABLED', now);
      return 'deferred';
    }
    const rate = await checkSharedSendRateLimits({ salonId: intent.salonId, recipient: destination.e164 });
    if (!rate.allowed) {
      await deferIntent(intent.id, `RATE_LIMITED:${rate.reason}`, now);
      return 'deferred';
    }
  }

  if (!(await appointmentStillActive(intent, now))) {
    await transitionIntent(intent.id, { to: 'suppressed', lastError: 'APPOINTMENT_NO_LONGER_ACTIVE' }, now);
    return 'suppressed';
  }
  if (!(await recipientStillCurrent(intent))) {
    await transitionIntent(intent.id, { to: 'suppressed', lastError: 'CLIENT_CONTACT_CHANGED' }, now);
    return 'suppressed';
  }
  let variables = intent.variables;
  if (intent.appointmentId && intent.templateKey.endsWith('_shortlink') && variables.manageUrl
    && !/\/a\/[\w-]{22}$/.test(variables.manageUrl)) {
    // Retain the capability URL on the intent under a row lock, so retries
    // reuse it and simultaneous workers cannot mint different aliases.
    variables = await db.transaction(async (tx) => {
      const [current] = await tx.select({ variables: communicationIntentSchema.variables })
        .from(communicationIntentSchema).where(and(
          eq(communicationIntentSchema.id, intent.id),
          eq(communicationIntentSchema.salonId, intent.salonId),
        )).for('update').limit(1);
      if (current?.variables.manageUrl && /\/a\/[\w-]{22}$/.test(current.variables.manageUrl)) {
        return current.variables;
      }
      const { mintShortManageToken } = await import('@/libs/shortManageLink');
      const link = await mintShortManageToken(tx, {
        salonId: intent.salonId,
        appointmentId: intent.appointmentId!,
        expiresAt: new Date(Math.max(now.getTime(), intent.notAfter.getTime()) + 30 * 24 * 60 * 60 * 1000),
      });
      const nextVariables = { ...intent.variables, manageUrl: link.url };
      await tx.update(communicationIntentSchema).set({ variables: nextVariables })
        .where(and(eq(communicationIntentSchema.id, intent.id), eq(communicationIntentSchema.salonId, intent.salonId)));
      return nextVariables;
    });
  }
  const body = template.render({ ...variables, salonName: salon.name });
  const segmentation = calculateSmsSegments(body);

  // TX1: reserve + delivery(settling) + intent→sending, committed BEFORE the
  // provider call (invariant I1).
  const reservation = mode === 'shared_luster'
    ? await reserveSmsCredits({
      salonId: intent.salonId,
      dedupeKey: `${intent.dedupeKey}:r${intent.attempts}`,
      segments: segmentation.segments,
      now,
    })
    : { ok: true as const, reservationId: null };
  if (!reservation.ok) {
    await transitionIntent(intent.id, {
      to: 'blocked_no_credit',
      blockedReason: 'NO_CREDITS',
      requiredCredits: reservation.required,
    }, now);
    return 'blocked_no_credit';
  }

  let deliveryId = intent.deliveryId ?? `nd_${crypto.randomUUID()}`;
  const bodyFingerprint = createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 32);
  // The attempt-scoped delivery dedupe key doubles as the same-intent race
  // gate: two dispatchers holding the same claimed row (double invocation of
  // one claim, not a double claim) resolve HERE — only the inserter
  // proceeds. The loser must touch NOTHING on the way out: its reservation
  // is dedupe-shared with the winner, so releasing it would strip the
  // winner's held credits mid-send.
  const deliveryValues = {
    id: deliveryId,
    salonId: intent.salonId,
    appointmentId: intent.appointmentId,
    channel: 'sms',
    purpose: `intent:${intent.eventType}`,
    dedupeKey: `delivery:${intent.dedupeKey}`,
    status: 'queued',
    retryable: false,
    intentId: intent.id,
    creditReservationId: reservation.reservationId,
    segmentCount: segmentation.segments,
    encoding: segmentation.encoding,
    senderIdentity: readiness.mode === 'shared_luster' ? readiness.senderIdentity : `byo:${readiness.connectAccountSid}`,
    messagingServiceSid: readiness.messagingServiceSid,
    settlementState: reservation.reservationId ? 'settling' : 'not_applicable',
    statusRank: 0,
  };
  // The delivery evidence and sending transition commit together. A crash
  // before this transaction leaves only an expiring credit hold; a crash
  // after it leaves a sending intent that recovery will never resend.
  const preparedDeliveryId = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(communicationIntentSchema)
      .where(and(eq(communicationIntentSchema.id, intent.id), eq(communicationIntentSchema.salonId, intent.salonId)))
      .for('update').limit(1);
    if (!current || current.status !== 'claimed' || current.attempts !== intent.attempts || current.lockedBy !== intent.lockedBy) {
      return null;
    }
    const [existing] = await tx.select().from(notificationDeliverySchema)
      .where(eq(notificationDeliverySchema.dedupeKey, deliveryValues.dedupeKey)).for('update').limit(1);
    if (existing) {
      const provenPreSend = existing.status === 'queued' && current.deliveryId === null;
      const provenStopped = ['failed', 'canceled'].includes(existing.status) && existing.settlementState === 'not_applicable';
      if (existing.salonId !== intent.salonId || existing.intentId !== intent.id || existing.providerMessageId || (!provenPreSend && !provenStopped)) {
        return null;
      }
      deliveryId = existing.id;
      await tx.update(notificationDeliverySchema).set({ ...deliveryValues, id: existing.id, errorCode: null, errorMessage: null })
        .where(and(eq(notificationDeliverySchema.id, existing.id), eq(notificationDeliverySchema.salonId, intent.salonId)));
    } else {
      await tx.insert(notificationDeliverySchema).values(deliveryValues);
    }
    await tx.update(communicationIntentSchema).set({
      status: 'sending',
      deliveryId,
      creditReservationId: reservation.reservationId,
      bodySnapshot: body,
      bodyFingerprint,
      segmentCount: segmentation.segments,
      encoding: segmentation.encoding,
    }).where(and(eq(communicationIntentSchema.id, intent.id), eq(communicationIntentSchema.salonId, intent.salonId)));
    return deliveryId;
  });
  if (!preparedDeliveryId) {
    const [fresh] = await db.select({ status: communicationIntentSchema.status, creditReservationId: communicationIntentSchema.creditReservationId })
      .from(communicationIntentSchema).where(and(eq(communicationIntentSchema.id, intent.id), eq(communicationIntentSchema.salonId, intent.salonId))).limit(1);
    const winnerOwnsOurReservation = fresh && ['sending', 'sent', 'send_outcome_unknown'].includes(fresh.status)
      && fresh.creditReservationId === reservation.reservationId;
    if (!winnerOwnsOurReservation && reservation.reservationId) {
      await releaseReservation({ reservationId: reservation.reservationId, reason: 'INTENT_SUPERSEDED', now });
    }
    return 'failed';
  }

  // FINAL pre-provider check (invariant I2): FRESH reads after TX1 committed.
  const finalControl = await readCommunicationControlUncached();
  const finalSuppressed = readiness.mode === 'shared_luster' && await hasGlobalSuppression(readiness.senderIdentity, destination.e164);
  const finalConsent = await hasSalonTransactionalConsent(intent.salonId, intent.recipient, intent.audience === 'client');
  const [freshSalon] = await db.select({ isActive: salonSchema.isActive, settings: salonSchema.settings, smsRemindersEnabled: salonSchema.smsRemindersEnabled })
    .from(salonSchema).where(eq(salonSchema.id, intent.salonId)).limit(1);
  const finalSettings = resolveSalonCommunicationSettings(freshSalon?.settings, { senderMode: mode, legacySmsEnabled: freshSalon?.smsRemindersEnabled });
  const finalChannels = resolveEventChannels(finalSettings, intent.eventType);
  const recipientCurrent = await recipientStillCurrent(intent);
  const [freshConnection] = await db.select().from(salonTwilioConnectionSchema)
    .where(eq(salonTwilioConnectionSchema.salonId, intent.salonId)).limit(1);
  const currentMode = resolveSmsSenderMode({ connection: freshConnection ?? null, perSalonDisabled: finalSettings.killSwitch });
  const senderChanged = currentMode !== mode || (readiness.mode === 'connected_byo' && (
    freshConnection?.connectAccountSid !== readiness.connectAccountSid
    || freshConnection.messagingServiceSid !== readiness.messagingServiceSid
    || freshConnection.phoneNumber !== readiness.phoneNumber
  ));
  const finalNow = new Date(now.getTime() + Math.max(0, Date.now() - dispatchStartedAt));
  const finalQuiet = applyQuietHours({ instant: finalNow, quietHours: finalSettings.quietHours, timeZone: freshSalon?.settings?.booking?.timezone, notAfter: intent.notAfter, bypass: ['booking_confirmation', 'booking_request_received'].includes(intent.eventType) });
  if (
    (mode === 'shared_luster' && (finalControl === null || !finalControl.smsEnabled || (finalControl.disabledEventTypes ?? []).includes(intent.eventType)))
    || !freshSalon || freshSalon.isActive === false
    || senderChanged
    || !finalChannels.includes('sms')
    || !recipientCurrent
    || finalSuppressed
    || !finalConsent
    || finalQuiet.kind === 'stale'
    || intent.notAfter.getTime() <= finalNow.getTime()
  ) {
    if (reservation.reservationId) {
      await releaseReservation({ reservationId: reservation.reservationId, reason: 'FINAL_CHECK_STOPPED', now });
    }
    await db
      .update(notificationDeliverySchema)
      .set({ status: 'canceled', settlementState: 'not_applicable' })
      .where(eq(notificationDeliverySchema.id, deliveryId));
    await transitionIntent(intent.id, { to: 'suppressed', lastError: 'FINAL_CHECK_STOPPED' }, now);
    return 'suppressed';
  }

  if (finalQuiet.kind === 'shifted') {
    if (reservation.reservationId) {
      await releaseReservation({ reservationId: reservation.reservationId, reason: 'QUIET_HOURS', now: finalNow });
    }
    await db.transaction(async (tx) => {
      await tx.update(notificationDeliverySchema).set({ status: 'canceled', settlementState: 'not_applicable' })
        .where(and(eq(notificationDeliverySchema.id, deliveryId), eq(notificationDeliverySchema.salonId, intent.salonId)));
      await tx.update(communicationIntentSchema).set({ status: 'pending', availableAt: finalQuiet.sendAt, lockedBy: null, leaseExpiresAt: null, lastError: 'QUIET_HOURS' })
        .where(and(eq(communicationIntentSchema.id, intent.id), eq(communicationIntentSchema.salonId, intent.salonId), eq(communicationIntentSchema.status, 'sending')));
    });
    return 'deferred';
  }

  if (!(await appointmentStillActive(intent, finalNow))) {
    // Final pre-provider appointment recheck: the reservation releases and
    // the provider is never called — same linearization posture as STOP.
    if (reservation.reservationId) {
      await releaseReservation({ reservationId: reservation.reservationId, reason: 'appointment_inactive', now });
    }
    await db.update(notificationDeliverySchema)
      .set({ status: 'canceled', settlementState: 'not_applicable' })
      .where(eq(notificationDeliverySchema.id, deliveryId));
    await transitionIntent(intent.id, { to: 'suppressed', lastError: 'APPOINTMENT_NO_LONGER_ACTIVE' }, now);
    return 'suppressed';
  }

  // Provider call — OUTSIDE any transaction.
  let sid: string;
  try {
    const result = await providerSend({
      to: destination.e164,
      body,
      messagingServiceSid: readiness.messagingServiceSid,
      ...(readiness.mode === 'connected_byo' ? { accountSid: readiness.connectAccountSid, from: readiness.phoneNumber } : {}),
      // Delivery identity in the callback (§6.10): a signed status callback
      // carrying this id is the §7.5 evidence that lets the resolver adopt a
      // SID onto an unknown-outcome intent.
      statusCallbackUrl: (await import('@/libs/twilioMessagingSend')).buildStatusCallbackUrl(deliveryId),
    });
    sid = result.sid;
  } catch (error) {
    if (error instanceof ProviderOutcomeUnknownError) {
      // The request MAY have reached the provider: park, never release,
      // never resend (§7.5). Reconciliation settles or releases on proof.
      await transitionIntent(intent.id, { to: 'send_outcome_unknown', lastError: 'PROVIDER_OUTCOME_UNKNOWN' }, now);
      return 'unknown_outcome';
    }
    if (reservation.reservationId) {
      await releaseReservation({ reservationId: reservation.reservationId, reason: 'PROVIDER_SYNC_REJECT', now });
    }
    await db
      .update(notificationDeliverySchema)
      .set({
        status: 'failed',
        settlementState: 'not_applicable',
        errorCode: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'PROVIDER_SYNC_REJECT',
        errorMessage: 'The provider rejected this send before accepting a message.',
        retryable: true,
      })
      .where(eq(notificationDeliverySchema.id, deliveryId));
    await transitionIntent(intent.id, { to: 'failed', lastError: 'PROVIDER_SYNC_REJECT' }, now);
    return 'failed';
  }

  // TX2: SID + settle-on-accept (idempotent; invariant I3). The accepted
  // write is rank-fenced: a terminal callback that raced in ahead of us must
  // never be regressed to 'accepted'.
  await db
    .update(notificationDeliverySchema)
    .set({ providerMessageId: sid, status: 'accepted', statusRank: 20 })
    .where(and(
      eq(notificationDeliverySchema.id, deliveryId),
      or(
        isNull(notificationDeliverySchema.statusRank),
        sql`${notificationDeliverySchema.statusRank} < 20`,
      ),
    ));
  if (reservation.reservationId) {
    await settleReservationOnAccept({ reservationId: reservation.reservationId, providerSid: sid, now });
  }
  await db
    .update(notificationDeliverySchema)
    .set({ settlementState: 'settled', settledAt: now })
    .where(and(
      eq(notificationDeliverySchema.id, deliveryId),
      eq(notificationDeliverySchema.settlementState, 'settling'),
    ));
  // Close the accept→settle window from THIS side: a terminal callback that
  // landed inside it saw settlement 'settling' and skipped its refund; its
  // rank fence means it will never fire again. Re-check now that we are
  // settled and pay the refund the callback could not.
  const [postSettle] = await db
    .select({
      status: notificationDeliverySchema.status,
      settlementState: notificationDeliverySchema.settlementState,
    })
    .from(notificationDeliverySchema)
    .where(eq(notificationDeliverySchema.id, deliveryId))
    .limit(1);
  if (
    reservation.reservationId !== null
    && postSettle !== undefined
    && ['failed', 'undelivered', 'canceled'].includes(postSettle.status)
    && postSettle.settlementState === 'settled'
  ) {
    await refundTerminalFailure({ reservationId: reservation.reservationId, now });
    await db
      .update(notificationDeliverySchema)
      .set({ settlementState: 'refunded' })
      .where(and(
        eq(notificationDeliverySchema.id, deliveryId),
        eq(notificationDeliverySchema.settlementState, 'settled'),
      ));
  }
  await transitionIntent(intent.id, { to: 'sent' }, now);
  return 'sent';
}

/**
 * Email lane send function — injected exactly like ProviderSendFn so tests
 * never touch a real mail provider. The production implementation wraps the
 * repo's idempotent operational-email helper; it MUST be internally
 * idempotent on the intent id, because the email lane relies on that (not on
 * credit reservations, which email deliberately does not have — §3.6).
 */
export type EmailSendFn = (input: {
  intentId: string;
  salonId: string;
  appointmentId: string | null;
  recipient: string;
  subject: string;
  body: string;
}) => Promise<{ delivered: boolean }>;

/**
 * Minimal email dispatch (blueprint H1): no credits, no SMS consent gates,
 * no rate-limit CLOSED posture — email is not SMS (§3.6). The salon kill
 * switch and per-event toggles were already applied at MATERIALIZATION time,
 * and a canceled appointment cancels its intents, so the only pre-send gates
 * here are template resolution and the notAfter recheck the claim query
 * already performed.
 */
async function dispatchClaimedEmailIntent(
  intent: CommunicationIntent,
  emailSend: EmailSendFn,
  now: Date,
): Promise<'sent' | 'failed'> {
  const { getEmailTemplate } = await import('@/libs/communicationEmailTemplates');
  const template = getEmailTemplate(intent.templateKey);
  if (template === null) {
    await transitionIntent(intent.id, { to: 'failed', lastError: 'TEMPLATE_UNKNOWN' }, now);
    return 'failed';
  }
  if (!(await appointmentStillActive(intent, now))) {
    await transitionIntent(intent.id, { to: 'suppressed', lastError: 'APPOINTMENT_NO_LONGER_ACTIVE' }, now);
    return 'failed';
  }
  const variables = (intent.variables ?? {}) as Record<string, string>;
  const subject = template.subject(variables);
  const body = template.body(variables);
  // A real delivery row: intent.delivery_id carries an FK, and the history
  // surface (C4) reads email sends from the same table as everything else.
  // Idempotent on the intent-scoped dedupe key, exactly like the SMS lane.
  const deliveryId = `nd_${crypto.randomUUID()}`;
  const insertedDelivery = await db.insert(notificationDeliverySchema).values({
    id: deliveryId,
    salonId: intent.salonId,
    appointmentId: intent.appointmentId,
    channel: 'email',
    purpose: intent.eventType,
    dedupeKey: `intent:${intent.id}:email`,
    status: 'queued',
    intentId: intent.id,
    encoding: 'email',
  }).onConflictDoNothing({ target: notificationDeliverySchema.dedupeKey }).returning();
  const effectiveDeliveryId = insertedDelivery.length === 1
    ? deliveryId
    : (await db.select({ id: notificationDeliverySchema.id })
        .from(notificationDeliverySchema)
        .where(eq(notificationDeliverySchema.dedupeKey, `intent:${intent.id}:email`))
        .limit(1))[0]!.id;
  const moved = await transitionIntent(intent.id, {
    to: 'sending',
    deliveryId: effectiveDeliveryId,
    creditReservationId: null,
    bodySnapshot: body,
    bodyFingerprint: '',
    segmentCount: 0,
    encoding: 'email',
  }, now);
  if (!moved.applied) {
    return 'failed';
  }
  try {
    await emailSend({
      intentId: intent.id,
      salonId: intent.salonId,
      appointmentId: intent.appointmentId,
      recipient: intent.recipient,
      subject,
      body,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : 'EMAIL_SEND_FAILED';
    await db.update(notificationDeliverySchema)
      .set({ status: 'failed', errorMessage: message })
      .where(eq(notificationDeliverySchema.id, effectiveDeliveryId));
    await transitionIntent(intent.id, { to: 'failed', lastError: message }, now);
    return 'failed';
  }
  await db.update(notificationDeliverySchema)
    .set({ status: 'sent' })
    .where(eq(notificationDeliverySchema.id, effectiveDeliveryId));
  await transitionIntent(intent.id, { to: 'sent' }, now);
  return 'sent';
}

/** One dispatcher pass: housekeeping → claim → per-intent pipeline. */
export async function processDueCommunications(input: {
  workerId: string;
  providerSend: ProviderSendFn;
  /**
   * Optional until the cron route wires the production implementation —
   * absent, email intents fail closed with EMAIL_LANE_NOT_WIRED rather than
   * silently vanishing.
   */
  emailSend?: EmailSendFn;
  now?: Date;
}): Promise<DispatchSummary> {
  const now = input.now ?? new Date();
  const summary: DispatchSummary = {
    claimed: 0,
    sent: 0,
    suppressed: 0,
    blockedNoCredit: 0,
    failed: 0,
    deferred: 0,
    expired: 0,
    leaseRecovered: 0,
    unknownOutcome: 0,
  };

  const leases = await recoverExpiredLeases(now);
  summary.leaseRecovered = leases.recovered;
  summary.unknownOutcome = leases.unknownOutcome;
  summary.expired += (await expireStaleIntents(now)).expired;
  // Release clearly pre-send abandoned holds (§7.6) — without this sweep a
  // crashed worker's reservation would suppress the salon's balance forever.
  await reapExpiredReservations(now);

  const control = await readCommunicationControlUncached();
  const batchLimit = control?.dispatchBatchLimit ?? 100;
  const perSalonLimit = control?.perSalonBatchLimit ?? 1;

  const intents = await claimDueIntents({
    workerId: input.workerId,
    batchLimit,
    perSalonLimit,
    now,
  });
  summary.claimed = intents.length;

  for (const intent of intents) {
    if (intent.channel === 'email') {
      if (input.emailSend === undefined) {
        await transitionIntent(intent.id, { to: 'failed', lastError: 'EMAIL_LANE_NOT_WIRED' }, now);
        summary.failed += 1;
        continue;
      }
      const emailOutcome = await dispatchClaimedEmailIntent(intent, input.emailSend, now);
      if (emailOutcome === 'sent') {
        summary.sent += 1;
      } else {
        summary.failed += 1;
      }
      continue;
    }
    if (intent.channel !== 'sms') {
      await transitionIntent(intent.id, { to: 'failed', lastError: 'CHANNEL_NOT_IMPLEMENTED' }, now);
      summary.failed += 1;
      continue;
    }
    const outcome = await dispatchClaimedIntent(intent, input.providerSend, now);
    switch (outcome) {
      case 'sent': {
        summary.sent += 1;
        break;
      }
      case 'suppressed': {
        summary.suppressed += 1;
        break;
      }
      case 'blocked_no_credit': {
        summary.blockedNoCredit += 1;
        break;
      }
      case 'failed': {
        summary.failed += 1;
        break;
      }
      case 'deferred': {
        summary.deferred += 1;
        break;
      }
      case 'expired': {
        summary.expired += 1;
        break;
      }
      case 'unknown_outcome': {
        summary.unknownOutcome += 1;
        break;
      }
    }
  }
  return summary;
}
