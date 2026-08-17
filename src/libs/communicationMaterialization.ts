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
 * MODE-FIRST ROUTING (owner decision 2.2) lives at the CALL SITES, not here:
 * a `connected_byo` salon keeps its existing synchronous SMS.ts path
 * byte-identical, so callers consult the sender mode and only route
 * shared-mode salons through this module for SMS. Email intents are
 * mode-independent. This module never reads Twilio configuration.
 *
 * Template coverage: the Gate A template registry ships client templates
 * only for confirmation and reminder. Events without a registered SMS
 * template materialize EMAIL ONLY until their template lands — enforced
 * here via TEMPLATED_SMS_EVENTS so an intent can never reference a template
 * key the dispatcher cannot render.
 */

import 'server-only';

import type {
  CommunicationIntentDatabase,
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
  /**
   * Owner decision 2.2: SMS only materializes for shared-mode salons. BYO
   * salons keep the legacy synchronous path, so their callers pass false.
   */
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
      continue; // BYO or SMS-ineligible: legacy path owns SMS (decision 2.2).
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
      bypass: isConfirmation || channel === 'email',
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
};

/**
 * Materialize every future reminder for one appointment from the salon's
 * configured rules. Skipped plans (already-passed lead times, quiet-hours
 * stale) are returned for observability, never silently dropped.
 */
export async function materializeReminders(
  input: MaterializeRemindersInput,
): Promise<{ materialized: MaterializedIntent[]; skipped: Array<{ ruleId: string; channel: string; reason: string }> }> {
  const now = input.now ?? new Date();
  const allowedChannels = resolveEventChannels(input.settings, 'appointment_reminder')
    .filter(channel => (channel === 'sms' ? input.smsEligible && input.clientPhone : input.clientEmail));
  const planned = planReminders({
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    appointmentStart: input.appointmentStart,
    appointmentUpdatedAt: input.appointmentUpdatedAt,
    timeZone: input.timeZone,
    quietHours: input.settings.quietHours,
    rules: resolveActiveReminderRules(input.settings),
    allowedChannels,
    smsEnabled: input.settings.sms.enabled,
    emailEnabled: input.settings.email.enabled,
    now,
  });

  const materialized: MaterializedIntent[] = [];
  const skipped: Array<{ ruleId: string; channel: string; reason: string }> = [];
  for (const plan of planned) {
    if (plan.kind === 'skipped') {
      skipped.push({ ruleId: plan.ruleId, channel: plan.channel, reason: plan.reason });
      continue;
    }
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
      variables: input.variables,
      ruleId: plan.ruleId,
      startRevision: input.appointmentStart.toISOString(),
      schedulingRevision: plan.schedulingRevision,
      scheduledFor: plan.scheduledFor,
      notAfter: plan.notAfter,
    });
    materialized.push({ intentId, channel: plan.channel, created });
  }
  return { materialized, skipped };
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
  const { resolveCommunicationSettingsFromSettings } = await import('@/libs/communicationSettings');
  const { salonSchema, salonTwilioConnectionSchema } = await import('@/models/Schema');
  const { eq } = await import('drizzle-orm');

  const [salon] = await tx
    .select({ name: salonSchema.name, settings: salonSchema.settings })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);
  const settings = resolveCommunicationSettingsFromSettings(
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
  const storedSettings = (salon?.settings ?? null) as { booking?: { timezone?: string } } | null;
  return {
    settings,
    mode,
    // Owner decision 2.2: only shared-mode salons route SMS through intents;
    // BYO keeps the legacy synchronous path byte-identical.
    smsEligible: mode === 'shared_luster' && settings.sms.enabled,
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
): Promise<string | null> {
  const { appointmentSchema } = await import('@/models/Schema');
  const { eq } = await import('drizzle-orm');
  const [row] = await dbh
    .select({ clientEmail: appointmentSchema.clientEmail })
    .from(appointmentSchema)
    .where(eq(appointmentSchema.id, appointmentId))
    .limit(1);
  return row?.clientEmail ?? null;
}
