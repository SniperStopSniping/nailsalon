/**
 * Durable communication-intent materialization — Gate C / C1.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §11
 * (+ owner decisions 2.1/2.2 of the Gate C completion authorization).
 *
 * This module is the ONLY producer of appointment-lifecycle communication
 * intents. It turns an authoritative business event into deterministic
 * intents for every enabled channel, inside the caller's transaction, so a
 * crash between the business write and the enqueue cannot lose a message
 * and a replay cannot mint a second one (dedupe_key UNIQUE + ON CONFLICT
 * DO NOTHING).
 *
 * Both shared and connected Twilio senders use these same intents. Provider
 * configuration, consent, credits and delivery are evaluated by the dispatcher.
 * Each registered lifecycle template describes the actual appointment state.
 */

import 'server-only';

import type {
  CommunicationIntentDatabase,
  CommunicationIntentTransaction,
  EnqueueIntentInput,
} from '@/libs/communicationIntent';
import { cancelAppointmentIntents, enqueueCommunicationIntent } from '@/libs/communicationIntent';
import {
  applyQuietHours,
  computeSchedulingRevision,
  confirmationDedupeKey,
  lifecycleDedupeKey,
  planReminders,
  resolveNotAfter,
} from '@/libs/communicationScheduling';
import type { CommunicationSettings } from '@/libs/communicationSettings';
import { resolveActiveReminderRules, resolveEventChannels } from '@/libs/communicationSettings';
import type { CommunicationEventType } from '@/models/Schema';

/** Events with a registered client SMS template (Gate A registry). */
const TEMPLATED_SMS_EVENTS: Partial<Record<CommunicationEventType, { templateKey: string; templateVersion: string }>> = {
  booking_confirmation: { templateKey: 'client_booking_confirmation_shortlink', templateVersion: 'v1' },
  appointment_reminder: { templateKey: 'client_appointment_reminder_shortlink', templateVersion: 'v1' },
  manual_reminder: { templateKey: 'client_appointment_reminder_shortlink', templateVersion: 'v1' },
  booking_request_received: { templateKey: 'client_booking_request_received_shortlink', templateVersion: 'v1' },
  booking_request_approved: { templateKey: 'client_booking_request_approved_shortlink', templateVersion: 'v1' },
  appointment_rescheduled: { templateKey: 'client_appointment_rescheduled_shortlink', templateVersion: 'v1' },
  appointment_cancelled: { templateKey: 'client_appointment_cancelled_shortlink', templateVersion: 'v1' },
  booking_request_declined: { templateKey: 'client_booking_request_declined_shortlink', templateVersion: 'v1' },
  booking_request_expired: { templateKey: 'client_booking_request_expired_shortlink', templateVersion: 'v1' },
};

/** Email uses per-event template keys the email lane renders. */
function emailTemplateFor(eventType: CommunicationEventType): { templateKey: string; templateVersion: string } {
  return { templateKey: `email_${eventType}`, templateVersion: 'v1' };
}

export type MaterializeEventInput = {
  /**
   * The caller's transaction, or the plain db handle for post-commit
   * producers whose durability comes from an at-least-once driver.
   */
  tx: CommunicationIntentDatabase;
  salonId: string;
  appointmentId: string;
  eventType: Exclude<CommunicationEventType, 'appointment_reminder'>;
  /**
   * Identity of the authoritative transition (deposit id on the deposit-paid
   * lane, appointment mutation revision on direct transitions). This is what
   * collapses Stripe return page, browser refresh, duplicate webhook, reaper
   * and client retry onto ONE intent per channel (§7.5 of the C prompt).
   */
  transitionEventId: string;
  clientPhone: string | null;
  clientEmail: string | null;
  /** Pre-resolved communications settings for this salon. */
  settings: CommunicationSettings;
  timeZone: string | null;
  appointmentStart: Date | null;
  variables: Record<string, string>;
  /** Resolved SMS master for the salon's current sender mode. */
  smsEligible: boolean;
  now?: Date;
};

export type MaterializedIntent = { intentId: string; channel: 'sms' | 'email'; created: boolean };

/**
 * Materialize one client-facing lifecycle event (confirmation, cancellation,
 * reschedule, deposit events, request lifecycle). Immediate events bypass
 * quiet hours per §11.4 ONLY for client-triggered confirmations; everything
 * else respects them.
 */
export async function materializeClientEvent(
  input: MaterializeEventInput,
): Promise<MaterializedIntent[]> {
  const now = input.now ?? new Date();
  const channels = resolveEventChannels(input.settings, input.eventType);
  const results: MaterializedIntent[] = [];

  const notAfter = resolveNotAfter({
    eventType: input.eventType,
    appointmentStart: input.appointmentStart,
    enqueuedAt: now,
  });
  if (notAfter.getTime() <= now.getTime()) {
    // The CHECK constraint (not_after > scheduled_for) is strict; a window
    // that is already closed means "do not enqueue", never "clamp".
    return results;
  }

  for (const channel of channels) {
    if (channel === 'sms' && !input.smsEligible) {
      continue; // SMS disabled for this salon.
    }
    const recipient = channel === 'sms' ? input.clientPhone : input.clientEmail;
    if (!recipient) {
      continue;
    }
    const smsTemplate = TEMPLATED_SMS_EVENTS[input.eventType];
    if (channel === 'sms' && smsTemplate === undefined) {
      continue; // no registered SMS template — email only until one lands.
    }
    const template = channel === 'sms' ? smsTemplate! : emailTemplateFor(input.eventType);

    // Client-triggered confirmations send immediately (quiet-hours bypass,
    // §11.4); other lifecycle notices shift out of quiet hours.
    const isConfirmation = input.eventType === 'booking_confirmation';
    const decision = applyQuietHours({
      instant: now,
      quietHours: input.settings.quietHours,
      timeZone: input.timeZone,
      notAfter,
      bypass: isConfirmation || input.eventType === 'booking_request_received' || channel === 'email',
    });
    if (decision.kind === 'stale') {
      continue;
    }

    const dedupeKey = isConfirmation
      ? confirmationDedupeKey({
        salonId: input.salonId,
        appointmentId: input.appointmentId,
        transitionEventId: input.transitionEventId,
        channel,
      })
      : lifecycleDedupeKey({
        salonId: input.salonId,
        appointmentId: input.appointmentId,
        eventType: input.eventType,
        mutationRevision: input.transitionEventId,
        channel,
      });

    const enqueueInput: EnqueueIntentInput = {
      database: input.tx,
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      channel,
      eventType: input.eventType,
      audience: 'client',
      dedupeKey,
      recipient,
      destinationCountry: channel === 'sms' ? 'CA' : null,
      templateKey: template.templateKey,
      templateVersion: template.templateVersion,
      variables: input.variables,
      startRevision: input.appointmentStart?.toISOString() ?? null,
      schedulingRevision: computeSchedulingRevision({
        timeZone: input.timeZone,
        quietHours: input.settings.quietHours,
        rule: null,
        appointmentStart: input.appointmentStart,
        appointmentUpdatedAt: null,
        smsEnabled: input.settings.sms.enabled,
        emailEnabled: input.settings.email.enabled,
      }),
      scheduledFor: decision.sendAt,
      notAfter,
    };
    const { intentId, created } = await enqueueCommunicationIntent(enqueueInput);
    results.push({ intentId, channel, created });
  }
  return results;
}

export type MaterializeRemindersInput = {
  tx: CommunicationIntentDatabase;
  salonId: string;
  appointmentId: string;
  appointmentStart: Date;
  /** Monotonic mutation revision — see computeSchedulingRevision's contract. */
  appointmentUpdatedAt: Date | null;
  clientPhone: string | null;
  clientEmail: string | null;
  settings: CommunicationSettings;
  timeZone: string | null;
  variables: Record<string, string>;
  smsEligible: boolean;
  now?: Date;
  existingDedupeKeys?: ReadonlySet<string>;
};

/**
 * Materialize every future reminder for one appointment from the salon's
 * configured rules. Skipped plans (already-passed lead times, quiet-hours
 * stale) are returned for observability, never silently dropped.
 */
export async function materializeReminders(
  input: MaterializeRemindersInput,
): Promise<{
    materialized: MaterializedIntent[];
    skipped: Array<{ ruleId: string; channel: string; reason: string }>;
    /** Every dedupe key the CURRENT plan wants live — the reconciler's set. */
    desiredDedupeKeys: string[];
  }> {
  const now = input.now ?? new Date();
  const allowedChannels = resolveEventChannels(input.settings, 'appointment_reminder')
    .filter(channel => (channel === 'sms' ? input.smsEligible && input.clientPhone : input.clientEmail));
  const activeRules = resolveActiveReminderRules(input.settings);
  const leadMinutesByRuleId = new Map(activeRules.map(rule => [rule.id, rule.offsetMinutes]));
  const planned = planReminders({
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    appointmentStart: input.appointmentStart,
    appointmentUpdatedAt: input.appointmentUpdatedAt,
    timeZone: input.timeZone,
    quietHours: input.settings.quietHours,
    rules: activeRules,
    allowedChannels,
    smsEnabled: input.settings.sms.enabled,
    emailEnabled: input.settings.email.enabled,
    existingDedupeKeys: input.existingDedupeKeys,
    now,
  });

  const materialized: MaterializedIntent[] = [];
  const skipped: Array<{ ruleId: string; channel: string; reason: string }> = [];
  const desiredDedupeKeys: string[] = [];
  for (const plan of planned) {
    if (plan.kind === 'skipped') {
      skipped.push({ ruleId: plan.ruleId, channel: plan.channel, reason: plan.reason });
      continue;
    }
    desiredDedupeKeys.push(plan.dedupeKey);
    const recipient = plan.channel === 'sms' ? input.clientPhone! : input.clientEmail!;
    const template = plan.channel === 'sms'
      ? TEMPLATED_SMS_EVENTS.appointment_reminder!
      : emailTemplateFor('appointment_reminder');
    const { intentId, created } = await enqueueCommunicationIntent({
      database: input.tx,
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      channel: plan.channel,
      eventType: 'appointment_reminder',
      audience: 'client',
      dedupeKey: plan.dedupeKey,
      recipient,
      destinationCountry: plan.channel === 'sms' ? 'CA' : null,
      templateKey: template.templateKey,
      templateVersion: template.templateVersion,
      // Persist the lead time on this intent. Existing history without this
      // value keeps the neutral “Appointment reminder” label.
      variables: {
        ...input.variables,
        reminderLeadMinutes: String(leadMinutesByRuleId.get(plan.ruleId) ?? ''),
      },
      ruleId: plan.ruleId,
      startRevision: input.appointmentStart.toISOString(),
      schedulingRevision: plan.schedulingRevision,
      scheduledFor: plan.scheduledFor,
      notAfter: plan.notAfter,
    });
    materialized.push({ intentId, channel: plan.channel, created });
  }
  return { materialized, skipped, desiredDedupeKeys };
}

/**
 * Reconciler entry (contract §11.2): make the live reminder intents for one
 * appointment match the CURRENT desired plan. Missing intents are
 * materialized (idempotent); live intents whose dedupe key fell out of the
 * desired set — a settings, timezone, quiet-hours, rule or start change
 * moved the scheduling revision — are canceled. Terminal rows are never
 * touched; claimed/sending rows belong to the dispatcher.
 */
export async function reconcileAppointmentReminders(
  input: MaterializeRemindersInput,
): Promise<{
    materialized: MaterializedIntent[];
    skipped: Array<{ ruleId: string; channel: string; reason: string }>;
    canceledStale: number;
  }> {
  const { communicationIntentSchema } = await import('@/models/Schema');
  const { and, eq, inArray, notInArray } = await import('drizzle-orm');
  const existing = await input.tx.select({ dedupeKey: communicationIntentSchema.dedupeKey })
    .from(communicationIntentSchema).where(and(
      eq(communicationIntentSchema.salonId, input.salonId),
      eq(communicationIntentSchema.appointmentId, input.appointmentId),
      eq(communicationIntentSchema.eventType, 'appointment_reminder'),
    ));
  const { materialized, skipped, desiredDedupeKeys } = await materializeReminders({
    ...input,
    existingDedupeKeys: new Set(existing.map(row => row.dedupeKey)),
  });
  const staleFilter = and(
    eq(communicationIntentSchema.salonId, input.salonId),
    eq(communicationIntentSchema.appointmentId, input.appointmentId),
    eq(communicationIntentSchema.eventType, 'appointment_reminder'),
    inArray(communicationIntentSchema.status, ['pending', 'blocked_no_credit']),
    ...(desiredDedupeKeys.length > 0
      ? [notInArray(communicationIntentSchema.dedupeKey, desiredDedupeKeys)]
      : []),
  );
  const canceled = await input.tx
    .update(communicationIntentSchema)
    .set({
      status: 'canceled',
      resolvedAt: input.now ?? new Date(),
      lastError: 'SCHEDULING_REVISION_SUPERSEDED',
    })
    .where(staleFilter)
    .returning();
  return { materialized, skipped, canceledStale: canceled.length };
}

/**
 * Reschedule/cancel supersession: cancel every live future intent for the
 * appointment. The caller then rematerializes (reschedule) or does not
 * (cancellation) — in the SAME transaction.
 */
export async function supersedeAppointmentCommunications(input: {
  tx: CommunicationIntentDatabase;
  salonId: string;
  appointmentId: string;
  now?: Date;
}): Promise<{ canceled: number }> {
  // cancelAppointmentIntents targets pending/blocked rows only — claimed or
  // sending rows are the dispatcher's to finish (its final pre-provider
  // check re-reads appointment state, §10.9 linearization).
  return cancelAppointmentIntents({
    database: input.tx,
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    now: input.now,
  });
}

/**
 * In-transaction sender-mode + settings resolution for materialization call
 * sites — the first production consumer of resolveSmsSenderMode (§9.4 step
 * 1: mode BEFORE any environment check). Returns everything a producer
 * needs to decide `smsEligible` and build intents, in one tx-consistent
 * read.
 */
export async function resolveSalonCommunicationContext(
  tx: CommunicationIntentDatabase,
  salonId: string,
): Promise<{
    settings: CommunicationSettings;
    mode: 'shared_luster' | 'connected_byo' | 'disabled';
    smsEligible: boolean;
    timeZone: string | null;
    salonName: string | null;
  }> {
  const { resolveSmsSenderMode } = await import('@/libs/smsSender');
  const { resolveSalonCommunicationSettings, resolveCommunicationSettingsFromSettings } = await import('@/libs/communicationSettings');
  const { salonSchema, salonTwilioConnectionSchema } = await import('@/models/Schema');
  const { eq } = await import('drizzle-orm');

  const [salon] = await tx
    .select({ name: salonSchema.name, settings: salonSchema.settings, smsRemindersEnabled: salonSchema.smsRemindersEnabled })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);
  let settings = resolveCommunicationSettingsFromSettings(
    (salon?.settings ?? null) as Parameters<typeof resolveCommunicationSettingsFromSettings>[0],
  );
  const [connection] = await tx
    .select({
      status: salonTwilioConnectionSchema.status,
      connectAccountSid: salonTwilioConnectionSchema.connectAccountSid,
      messagingServiceSid: salonTwilioConnectionSchema.messagingServiceSid,
      phoneNumber: salonTwilioConnectionSchema.phoneNumber,
    })
    .from(salonTwilioConnectionSchema)
    .where(eq(salonTwilioConnectionSchema.salonId, salonId))
    .limit(1);
  const mode = resolveSmsSenderMode({
    connection: connection ?? null,
    perSalonDisabled: settings.killSwitch,
  });
  settings = resolveSalonCommunicationSettings(salon?.settings as Parameters<typeof resolveSalonCommunicationSettings>[0], {
    senderMode: mode,
    legacySmsEnabled: salon?.smsRemindersEnabled,
  });
  const storedSettings = (salon?.settings ?? null) as { booking?: { timezone?: string } } | null;
  return {
    settings,
    mode,
    smsEligible: mode !== 'disabled' && settings.sms.enabled,
    timeZone: storedSettings?.booking?.timezone ?? null,
    salonName: salon?.name ?? null,
  };
}

/** 'Wed Aug 26, 12:30 PM' in the salon's timezone — the template shape. */
export function formatIntentStartTime(start: Date, timeZone: string | null): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone ?? 'America/Toronto',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(start).replace(' at ', ', ');
}

/**
 * Appointment client email, tx-consistent — producers that only carry a
 * phone in their context use this instead of reaching for the raw table.
 */
export async function loadAppointmentClientEmail(
  dbh: CommunicationIntentDatabase,
  appointmentId: string,
  salonId: string,
): Promise<string | null> {
  const { appointmentSchema } = await import('@/models/Schema');
  const { and, eq } = await import('drizzle-orm');
  const [row] = await dbh
    .select({ clientEmail: appointmentSchema.clientEmail })
    .from(appointmentSchema)
    .where(and(eq(appointmentSchema.id, appointmentId), eq(appointmentSchema.salonId, salonId)))
    .limit(1);
  return row?.clientEmail ?? null;
}

/**
 * Appointment mutations persist their texts and reminder changes with the
 * business write. Every caller passes its already authorized appointment and
 * transaction; dispatch still verifies current tenant, contact and state.
 */
export async function materializeAppointmentLifecycle(input: {
  tx: CommunicationIntentTransaction;
  appointment: import('@/models/Schema').Appointment;
  eventType: MaterializeEventInput['eventType'];
  transitionEventId?: string;
  supersede?: boolean;
  notifyClient?: boolean;
  manageUrl?: string;
  now?: Date;
}): Promise<MaterializedIntent[]> {
  const { appointment, tx } = input;
  const now = input.now ?? new Date();
  if (input.supersede) {
    await supersedeAppointmentCommunications({ tx, salonId: appointment.salonId, appointmentId: appointment.id, now });
  }
  const context = await resolveSalonCommunicationContext(tx, appointment.salonId);
  const { resolveOperationalSalonClientContactWithHandle, resolveOperationalSalonClientContactByPhoneWithHandle } = await import('@/libs/clientLifecycleStabilization');
  const contact = appointment.salonClientId
    ? await resolveOperationalSalonClientContactWithHandle(tx, { salonId: appointment.salonId, clientId: appointment.salonClientId, allowArchived: true })
    : await resolveOperationalSalonClientContactByPhoneWithHandle(tx, { salonId: appointment.salonId, phone: appointment.clientPhone, allowArchived: true });
  const clientPhone = contact?.phone ?? appointment.clientPhone;
  const clientId = contact?.id ?? appointment.salonClientId;
  const { isReminderEligibleAppointment } = await import('@/libs/reminderEligibility');
  const reminderEligible = !appointment.deletedAt && isReminderEligibleAppointment(appointment);
  const channels = resolveEventChannels(context.settings, input.eventType);
  const notifySms = input.notifyClient !== false && context.smsEligible && channels.includes('sms');
  const futureReminders = reminderEligible && planReminders({
    salonId: appointment.salonId,
    appointmentId: appointment.id,
    appointmentStart: appointment.startTime,
    appointmentUpdatedAt: appointment.updatedAt,
    timeZone: context.timeZone,
    quietHours: context.settings.quietHours,
    rules: resolveActiveReminderRules(context.settings),
    allowedChannels: resolveEventChannels(context.settings, 'appointment_reminder')
      .filter(channel => channel === 'sms' ? context.smsEligible && Boolean(clientPhone) : Boolean(appointment.clientEmail)),
    smsEnabled: context.settings.sms.enabled,
    emailEnabled: context.settings.email.enabled,
    now,
  }).some(plan => plan.kind === 'scheduled');
  if (!notifySms && !futureReminders) {
    return [];
  }
  const { mintShortManageToken } = await import('@/libs/shortManageLink');
  const manageUrl = input.manageUrl ?? (await mintShortManageToken(tx, {
    salonId: appointment.salonId,
    appointmentId: appointment.id,
    expiresAt: new Date(appointment.endTime.getTime() + 30 * 24 * 60 * 60 * 1000),
  })).url;
  const variables = {
    salonName: context.salonName ?? '',
    ...(clientId ? { clientId } : {}),
    startTime: formatIntentStartTime(appointment.startTime, context.timeZone),
    manageUrl,
  };
  const results = notifySms
    ? await materializeClientEvent({
      tx,
      salonId: appointment.salonId,
      appointmentId: appointment.id,
      eventType: input.eventType,
      transitionEventId: input.transitionEventId ?? appointment.updatedAt.toISOString(),
      clientPhone,
      clientEmail: null, // Existing operational email delivery remains its channel owner.
      settings: context.settings,
      timeZone: context.timeZone,
      appointmentStart: appointment.startTime,
      variables,
      smsEligible: context.smsEligible,
      now,
    })
    : [];
  if (reminderEligible) {
    await reconcileAppointmentReminders({
      tx,
      salonId: appointment.salonId,
      appointmentId: appointment.id,
      appointmentStart: appointment.startTime,
      appointmentUpdatedAt: appointment.updatedAt,
      clientPhone,
      clientEmail: appointment.clientEmail,
      settings: context.settings,
      timeZone: context.timeZone,
      variables,
      smsEligible: context.smsEligible,
      now,
    });
  }
  return results;
}

/** Queue an owner-requested reminder without bypassing the normal send guards. */
export async function queueAppointmentReminder(input: {
  salonId: string;
  appointmentId: string;
  phone: string;
  clientId?: string;
  manageUrl: string;
  requestId?: string;
  now?: Date;
}): Promise<{ intentId: string; status: string; created: boolean; scheduledFor: string }> {
  const { db } = await import('@/libs/DB');
  const { and, eq } = await import('drizzle-orm');
  const { appointmentSchema, communicationIntentSchema } = await import('@/models/Schema');
  const { isReminderEligibleAppointment } = await import('@/libs/reminderEligibility');
  const { normalizeNanpNumber } = await import('@/libs/smsDestination');
  const now = input.now ?? new Date();
  if (!normalizeNanpNumber(input.phone)) {
    throw new Error('INVALID_CLIENT_PHONE');
  }
  return db.transaction(async (tx) => {
    const [appointment] = await tx.select().from(appointmentSchema).where(and(
      eq(appointmentSchema.id, input.appointmentId),
      eq(appointmentSchema.salonId, input.salonId),
    )).for('update').limit(1);
    if (!appointment || appointment.deletedAt || !isReminderEligibleAppointment(appointment)
      || appointment.startTime.getTime() <= now.getTime()) {
      throw new Error('APPOINTMENT_NOT_UPCOMING');
    }
    const context = await resolveSalonCommunicationContext(tx, input.salonId);
    if (!context.smsEligible || !resolveEventChannels(context.settings, 'manual_reminder').includes('sms')) {
      throw new Error('SMS_DISABLED');
    }
    const [intent] = await materializeClientEvent({
      tx,
      salonId: input.salonId,
      appointmentId: appointment.id,
      eventType: 'manual_reminder',
      transitionEventId: `${appointment.startTime.toISOString()}:${input.requestId ?? 'owner-reminder'}`,
      clientPhone: input.phone,
      clientEmail: null,
      settings: context.settings,
      timeZone: context.timeZone,
      appointmentStart: appointment.startTime,
      variables: {
        salonName: context.salonName ?? '',
        startTime: formatIntentStartTime(appointment.startTime, context.timeZone),
        manageUrl: input.manageUrl,
        ...((input.clientId ?? appointment.salonClientId) ? { clientId: (input.clientId ?? appointment.salonClientId)! } : {}),
      },
      smsEligible: context.smsEligible,
      now,
    });
    if (!intent) {
      throw new Error('QUIET_HOURS_STALE');
    }
    const [row] = await tx.select({ status: communicationIntentSchema.status, scheduledFor: communicationIntentSchema.scheduledFor })
      .from(communicationIntentSchema).where(and(eq(communicationIntentSchema.id, intent.intentId), eq(communicationIntentSchema.salonId, input.salonId))).limit(1);
    return { ...intent, status: row!.status, scheduledFor: row!.scheduledFor.toISOString() };
  });
}
