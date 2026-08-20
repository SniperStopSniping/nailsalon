import 'server-only';

import { and, desc, eq, gt, gte, isNull, lt, sql } from 'drizzle-orm';

import { buildAppointmentManageUrl } from '@/libs/appointmentManageUrl';
import { mintAppointmentManageCapability } from '@/libs/bookingCommitEffects';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import {
  resolveOperationalSalonClientContact,
  resolveOperationalSalonClientContactByPhone,
  sendAppointmentOperationalEmailOnce,
} from '@/libs/clientLifecycleStabilization';
import {
  formatIntentStartTime,
  reconcileAppointmentReminders,
  resolveSalonCommunicationContext,
} from '@/libs/communicationMaterialization';
import { planReminders } from '@/libs/communicationScheduling';
import { resolveActiveReminderRules, resolveEventChannels } from '@/libs/communicationSettings';
import { db } from '@/libs/DB';
import { normalizePhone } from '@/libs/phone';
import { getAppointmentServiceNames } from '@/libs/queries';
import { isReminderEligibleAppointment, reminderEligibleAppointmentCondition } from '@/libs/reminderEligibility';
import { isSmsEnabled } from '@/libs/salonStatus';
import { sendAppointmentReminder } from '@/libs/SMS';
import {
  appointmentSchema,
  communicationConsentSchema,
  communicationIntentSchema,
  notificationDeliverySchema,
  salonClientSchema,
  salonSchema,
  technicianSchema,
} from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

// The RECONCILER's horizon must cover the longest configurable rule lead
// (7 days) plus a margin, or long-lead intents escape reconciliation
// entirely: a reschedule outside the legacy 36h window would never cancel
// its stale reminder (adversarial review H5). The BYO legacy due-windows
// are unchanged — they gate per candidate, not in the query.
const RECONCILER_QUERY_HOURS = 8 * 24;
const DAY_BEFORE_WINDOW_MINUTES = 30;
const SAME_DAY_WINDOW_MIN_MINUTES = 105;
const SAME_DAY_WINDOW_MAX_MINUTES = 135;
const MAX_CANDIDATES_PER_RUN = 500;

type ReminderChannel = 'email' | 'sms';
type ReminderType = 'day_before' | 'same_day';

type ReminderCandidate = {
  appointmentId: string;
  salonId: string;
  salonClientId: string | null;
  salonName: string;
  salonSettings: unknown;
  clientName: string | null;
  clientPhone: string;
  startTime: Date;
  endTime: Date;
  technicianName: string | null;
  salonClientEmail: string | null;
  appointmentEmail: string | null;
  dayBeforeReminderSentAt: Date | null;
  sameDayReminderSentAt: Date | null;
  salonSlug: string;
  salonCustomDomain: string | null;
  appointmentUpdatedAt: Date;
};

type ReminderSendResult = {
  channel: ReminderChannel | null;
  attempted: boolean;
  superseded?: boolean;
};

type ReminderSmsClaim = {
  claimed: boolean;
  claimedAt: Date | null;
  deliveryId: string | null;
  status: string | null;
};

export type ProcessAppointmentRemindersResult = {
  scanned: number;
  dayBeforeSent: number;
  dayBeforeEmail: number;
  dayBeforeSms: number;
  sameDaySent: number;
  skipped: number;
  failures: number;
  /** Gate C1 reconciler counters (shared-mode salons only). */
  intentsMaterialized: number;
  intentsCanceledStale: number;
  orphanIntentsCanceled: number;
  failedEmailsRetried: number;
};

export async function processAppointmentReminders(args?: {
  now?: Date;
  beforeDeliveryGuard?: () => Promise<void>;
}): Promise<ProcessAppointmentRemindersResult> {
  const now = args?.now ?? new Date();
  const candidates = await loadReminderCandidates(now);

  const result: ProcessAppointmentRemindersResult = {
    scanned: candidates.length,
    dayBeforeSent: 0,
    dayBeforeEmail: 0,
    dayBeforeSms: 0,
    sameDaySent: 0,
    skipped: 0,
    failures: 0,
    intentsMaterialized: 0,
    intentsCanceledStale: 0,
    orphanIntentsCanceled: 0,
    failedEmailsRetried: 0,
  };

  const contextCache = new Map<string, Awaited<ReturnType<typeof resolveSalonCommunicationContext>>>();
  for (const candidate of candidates) {
    const bookingConfig = resolveBookingConfigFromSettings(
      (candidate.salonSettings as SalonSettings | null | undefined) ?? null,
    );
    const timeZone = bookingConfig.timezone;

    // MODE-FIRST (Gate C1, owner decision 2.2). Shared-Luster salons use the
    // rule-based durable reconciler below; active BYO salons keep the legacy
    // dual-window synchronous path BYTE-IDENTICAL — routing them through
    // intents would subject their sends to shared credits, suppression and
    // rate limits, exactly what BYO continuity forbids.
    let communicationContext = contextCache.get(candidate.salonId);
    if (communicationContext === undefined) {
      communicationContext = await resolveSalonCommunicationContext(db, candidate.salonId);
      contextCache.set(candidate.salonId, communicationContext);
    }
    if (communicationContext.mode !== 'connected_byo') {
      try {
        const outcome = await reconcileSharedModeReminders({
          candidate,
          communicationContext,
          timeZone,
          now,
        });
        result.intentsMaterialized += outcome.materialized;
        result.intentsCanceledStale += outcome.canceledStale;
        if (outcome.materialized === 0 && outcome.canceledStale === 0) {
          result.skipped += 1;
        }
      } catch {
        result.failures += 1;
      }
      continue;
    }

    const dueDayBefore = candidate.dayBeforeReminderSentAt == null
      && isDayBeforeReminderDue({
        now,
        startTime: candidate.startTime,
        timeZone,
      });
    const dueSameDay = candidate.sameDayReminderSentAt == null
      && isSameDayReminderDue({
        now,
        startTime: candidate.startTime,
      });

    if (!dueDayBefore && !dueSameDay) {
      result.skipped += 1;
      continue;
    }

    let operationalCandidate: ReminderCandidate;
    try {
      operationalCandidate = await resolveReminderOperationalContact(
        candidate,
      );
    } catch {
      result.failures += 1;
      continue;
    }
    const services = await getAppointmentServiceNames(
      operationalCandidate.appointmentId,
    );
    let guardHookUsed = false;
    const beforeDeliveryGuard = async () => {
      if (!guardHookUsed) {
        guardHookUsed = true;
        await args?.beforeDeliveryGuard?.();
      }
    };

    if (dueDayBefore) {
      const sendResult = await sendDayBeforeReminder(operationalCandidate, {
        services,
        timeZone,
        now,
        beforeDeliveryGuard,
      });

      if (sendResult.superseded) {
        result.skipped += 1;
        continue;
      }
      if (sendResult.channel) {
        const marked = await markReminderSent({
          appointmentId: operationalCandidate.appointmentId,
          salonId: operationalCandidate.salonId,
          reminderType: 'day_before',
          channel: sendResult.channel,
          now,
          startTime: operationalCandidate.startTime,
        });
        if (!marked) {
          result.skipped += 1;
          continue;
        }
        result.dayBeforeSent += 1;
        if (sendResult.channel === 'email') {
          result.dayBeforeEmail += 1;
        } else {
          result.dayBeforeSms += 1;
        }
      } else if (sendResult.attempted) {
        result.failures += 1;
      } else {
        result.skipped += 1;
      }

      continue;
    }

    if (dueSameDay) {
      const sendResult = await sendSameDayReminder(operationalCandidate, {
        services,
        timeZone,
        now,
        beforeDeliveryGuard,
      });

      if (sendResult.superseded) {
        result.skipped += 1;
        continue;
      }
      if (sendResult.channel) {
        const marked = await markReminderSent({
          appointmentId: operationalCandidate.appointmentId,
          salonId: operationalCandidate.salonId,
          reminderType: 'same_day',
          channel: sendResult.channel,
          now,
          startTime: operationalCandidate.startTime,
        });
        if (!marked) {
          result.skipped += 1;
          continue;
        }
        result.sameDaySent += 1;
      } else if (sendResult.attempted) {
        result.failures += 1;
      } else {
        result.skipped += 1;
      }
    }
  }

  // Failed-EMAIL retry (review H7): the legacy leg retried failed reminder
  // emails; the intent lane must not silently do worse. A failed email
  // intent whose window is still open returns to pending with backoff, at
  // most three attempts. SMS is NEVER blanket-retried this way — its failure
  // semantics (credits, §7.5 ambiguity) belong to the dispatcher.
  const retriedEmails = await db.execute(sql`
    UPDATE communication_intent
       SET status = 'pending', available_at = ${new Date(now.getTime() + 10 * 60 * 1000)}
     WHERE channel = 'email'
       AND status = 'failed'
       AND attempts <= 3
       AND not_after > ${now}
    RETURNING id
  `);
  result.failedEmailsRetried = retriedEmails.rows.length;

  // Orphan sweep (contract §11.1): live reminder intents whose appointment is
  // no longer active — cancelled, completed elsewhere, or soft-deleted — are
  // canceled. The per-candidate reconciler never sees these appointments (the
  // candidate query filters to live ones), so the sweep is what guarantees a
  // cancellation that happened BETWEEN cron passes suppresses its reminders.
  const orphaned = await db.execute(sql`
    UPDATE communication_intent i
       SET status = 'canceled',
           resolved_at = ${now},
           last_error = 'APPOINTMENT_NO_LONGER_ACTIVE'
      FROM appointment a
     WHERE i.appointment_id = a.id
       AND i.salon_id = a.salon_id
       AND i.event_type = 'appointment_reminder'
       AND i.status IN ('pending', 'blocked_no_credit')
       AND (a.status NOT IN ('pending', 'confirmed') OR a.deleted_at IS NOT NULL)
    RETURNING i.id
  `);
  result.orphanIntentsCanceled = orphaned.rows.length;

  return result;
}

export function isDayBeforeReminderDue(args: {
  now: Date;
  startTime: Date;
  timeZone: string;
}): boolean {
  const nowParts = getTimeZoneParts(args.now, args.timeZone);
  if (nowParts.hour !== 18 || nowParts.minute >= DAY_BEFORE_WINDOW_MINUTES) {
    return false;
  }

  return getEpochDay(getDateKeyInTimeZone(args.startTime, args.timeZone))
    - getEpochDay(getDateKeyInTimeZone(args.now, args.timeZone)) === 1;
}

export function isSameDayReminderDue(args: {
  now: Date;
  startTime: Date;
}): boolean {
  const diffMinutes = (args.startTime.getTime() - args.now.getTime()) / 60000;
  return diffMinutes >= SAME_DAY_WINDOW_MIN_MINUTES && diffMinutes < SAME_DAY_WINDOW_MAX_MINUTES;
}

async function loadReminderCandidates(now: Date): Promise<ReminderCandidate[]> {
  const latestRelevantStartTime = new Date(now.getTime() + RECONCILER_QUERY_HOURS * 60 * 60 * 1000);

  const rows = await db
    .select({
      appointmentId: appointmentSchema.id,
      salonId: appointmentSchema.salonId,
      salonClientId: appointmentSchema.salonClientId,
      salonName: salonSchema.name,
      salonSettings: salonSchema.settings,
      salonSlug: salonSchema.slug,
      salonCustomDomain: salonSchema.customDomain,
      appointmentUpdatedAt: appointmentSchema.updatedAt,
      clientName: appointmentSchema.clientName,
      clientPhone: appointmentSchema.clientPhone,
      startTime: appointmentSchema.startTime,
      endTime: appointmentSchema.endTime,
      technicianName: technicianSchema.name,
      salonClientEmail: salonClientSchema.email,
      appointmentEmail: appointmentSchema.clientEmail,
      dayBeforeReminderSentAt: appointmentSchema.dayBeforeReminderSentAt,
      sameDayReminderSentAt: appointmentSchema.sameDayReminderSentAt,
    })
    .from(appointmentSchema)
    .innerJoin(
      salonSchema,
      and(
        eq(appointmentSchema.salonId, salonSchema.id),
        eq(salonSchema.isActive, true),
      ),
    )
    .leftJoin(
      salonClientSchema,
      and(
        eq(appointmentSchema.salonClientId, salonClientSchema.id),
        eq(appointmentSchema.salonId, salonClientSchema.salonId),
      ),
    )
    .leftJoin(
      technicianSchema,
      and(
        eq(appointmentSchema.technicianId, technicianSchema.id),
        eq(appointmentSchema.salonId, technicianSchema.salonId),
      ),
    )
    .where(
      and(
        // L1 PR5 — an unapproved explicit request-approval booking (pending
        // + non-null request_expires_at) is excluded here; see
        // reminderEligibility.ts for why.
        reminderEligibleAppointmentCondition(),
        isNull(appointmentSchema.deletedAt),
        gt(appointmentSchema.startTime, now),
        lt(appointmentSchema.startTime, latestRelevantStartTime),
        // The legacy sent-at columns no longer filter the QUERY: shared-mode
        // reconciliation must see every near-horizon appointment (a settings
        // change can invalidate an already-materialized plan). The BYO legs
        // still consult the columns per candidate, preserving their exact
        // legacy dedupe.
      ),
    )
    .orderBy(appointmentSchema.startTime)
    .limit(MAX_CANDIDATES_PER_RUN);

  return rows;
}

async function resolveReminderOperationalContact(
  candidate: ReminderCandidate,
): Promise<ReminderCandidate> {
  const contact = candidate.salonClientId
    ? await resolveOperationalSalonClientContact({
      salonId: candidate.salonId,
      clientId: candidate.salonClientId,
      allowArchived: true,
    })
    : await resolveOperationalSalonClientContactByPhone({
      salonId: candidate.salonId,
      phone: candidate.clientPhone,
      allowArchived: true,
    });
  return {
    ...candidate,
    // A legacy appointment with no stable or alias match retains its immutable
    // destination snapshot. Ambiguous or invalid lifecycle state throws above,
    // so no management capability is sent until the state is resolved.
    clientPhone: contact?.phone ?? candidate.clientPhone,
  };
}

async function isCurrentReminderCandidate(args: {
  candidate: ReminderCandidate;
  reminderType: ReminderType;
  now: Date;
}): Promise<boolean> {
  const [current] = await db
    .select({
      startTime: appointmentSchema.startTime,
      status: appointmentSchema.status,
      deletedAt: appointmentSchema.deletedAt,
      requestExpiresAt: appointmentSchema.requestExpiresAt,
      dayBeforeReminderSentAt: appointmentSchema.dayBeforeReminderSentAt,
      sameDayReminderSentAt: appointmentSchema.sameDayReminderSentAt,
      salonSettings: salonSchema.settings,
    })
    .from(appointmentSchema)
    .innerJoin(
      salonSchema,
      and(
        eq(appointmentSchema.salonId, salonSchema.id),
        eq(salonSchema.isActive, true),
      ),
    )
    .where(and(
      eq(appointmentSchema.id, args.candidate.appointmentId),
      eq(appointmentSchema.salonId, args.candidate.salonId),
    ))
    .limit(1);
  if (
    !current
    || current.deletedAt
    // L1 PR5 — must agree with reminderEligibleAppointmentCondition() above.
    || !isReminderEligibleAppointment(current)
    || current.startTime.getTime() !== args.candidate.startTime.getTime()
  ) {
    return false;
  }

  if (args.reminderType === 'day_before') {
    const timeZone = resolveBookingConfigFromSettings(
      current.salonSettings as SalonSettings | null,
    ).timezone;
    return current.dayBeforeReminderSentAt == null
      && isDayBeforeReminderDue({ now: args.now, startTime: current.startTime, timeZone });
  }
  return current.sameDayReminderSentAt == null
    && isSameDayReminderDue({ now: args.now, startTime: current.startTime });
}

async function claimReminderSmsDelivery(input: {
  appointmentId: string;
  salonId: string;
  reminderType: 'day_before' | 'same_day';
  eventVersion: string;
}): Promise<ReminderSmsClaim> {
  const purpose = input.reminderType === 'day_before'
    ? 'appointment_reminder_24h_guard'
    : 'appointment_reminder_2h_guard';
  const dedupeKey = [
    'sms',
    'appointment-reminder',
    input.reminderType,
    input.salonId,
    input.appointmentId,
    input.eventVersion,
  ].join(':');
  const deliveryId = crypto.randomUUID();
  const [inserted] = await db.insert(notificationDeliverySchema).values({
    id: deliveryId,
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    channel: 'sms',
    purpose,
    dedupeKey,
    status: 'queued',
    retryable: false,
  }).onConflictDoNothing().returning();
  if (inserted) {
    return {
      claimed: true,
      claimedAt: inserted.updatedAt,
      deliveryId: inserted.id,
      status: inserted.status,
    };
  }
  const [reclaimed] = await db.update(notificationDeliverySchema).set({
    status: 'queued',
    errorCode: null,
    errorMessage: null,
    retryable: false,
    updatedAt: sql`clock_timestamp()`,
  }).where(and(
    eq(notificationDeliverySchema.salonId, input.salonId),
    eq(notificationDeliverySchema.appointmentId, input.appointmentId),
    eq(notificationDeliverySchema.dedupeKey, dedupeKey),
    eq(notificationDeliverySchema.status, 'failed'),
    eq(notificationDeliverySchema.retryable, true),
  )).returning();
  if (reclaimed) {
    return {
      claimed: true,
      claimedAt: reclaimed.updatedAt,
      deliveryId: reclaimed.id,
      status: reclaimed.status,
    };
  }
  const [existing] = await db.select({
    id: notificationDeliverySchema.id,
    status: notificationDeliverySchema.status,
  }).from(notificationDeliverySchema).where(and(
    eq(notificationDeliverySchema.salonId, input.salonId),
    eq(notificationDeliverySchema.appointmentId, input.appointmentId),
    eq(notificationDeliverySchema.dedupeKey, dedupeKey),
  )).limit(1);
  return {
    claimed: false,
    claimedAt: null,
    deliveryId: existing?.id ?? null,
    status: existing?.status ?? null,
  };
}

async function canAttemptReminderSms(input: {
  salonId: string;
  phone: string;
}): Promise<boolean> {
  if (!await isSmsEnabled(input.salonId)) {
    return false;
  }
  const [consent] = await db.select({
    status: communicationConsentSchema.status,
  }).from(communicationConsentSchema).where(and(
    eq(communicationConsentSchema.salonId, input.salonId),
    eq(communicationConsentSchema.recipient, input.phone),
    eq(communicationConsentSchema.channel, 'sms'),
    eq(
      communicationConsentSchema.purpose,
      'appointment_transactional',
    ),
  )).orderBy(desc(communicationConsentSchema.createdAt)).limit(1);
  return consent?.status === 'granted';
}

async function wasReminderSmsFailureRetryable(input: {
  appointmentId: string;
  salonId: string;
  reminderType: 'day_before' | 'same_day';
  claimedAt: Date;
}): Promise<boolean> {
  const purpose = input.reminderType === 'day_before'
    ? 'appointment_reminder_24h'
    : 'appointment_reminder_2h';
  const attempts = await db.select({
    retryable: notificationDeliverySchema.retryable,
    status: notificationDeliverySchema.status,
  }).from(notificationDeliverySchema).where(and(
    eq(notificationDeliverySchema.salonId, input.salonId),
    eq(notificationDeliverySchema.appointmentId, input.appointmentId),
    eq(notificationDeliverySchema.channel, 'sms'),
    eq(notificationDeliverySchema.purpose, purpose),
    gte(notificationDeliverySchema.createdAt, input.claimedAt),
  )).orderBy(desc(notificationDeliverySchema.createdAt)).limit(2);
  return attempts.length === 1
    && attempts[0]!.status === 'failed'
    && attempts[0]!.retryable === true;
}

async function finishReminderSmsDelivery(input: {
  salonId: string;
  deliveryId: string;
  retryable: boolean;
  sent: boolean;
  errorCode?: string;
}) {
  await db.update(notificationDeliverySchema).set({
    status: input.sent ? 'sent' : 'failed',
    errorCode: input.sent ? null : input.errorCode ?? 'SMS_DELIVERY_UNAVAILABLE',
    retryable: input.sent ? false : input.retryable,
  }).where(and(
    eq(notificationDeliverySchema.id, input.deliveryId),
    eq(notificationDeliverySchema.salonId, input.salonId),
    eq(notificationDeliverySchema.status, 'queued'),
  ));
}

async function sendDayBeforeReminder(
  candidate: ReminderCandidate,
  context: {
    services: string[];
    timeZone: string;
    now: Date;
    beforeDeliveryGuard: () => Promise<void>;
  },
): Promise<ReminderSendResult> {
  let manageUrl: string | null = null;
  let manageUrlResolved = false;
  const getManageUrl = async () => {
    if (!manageUrlResolved) {
      manageUrl = await resolveReminderManageUrl(candidate);
      manageUrlResolved = true;
    }
    return manageUrl;
  };
  let superseded = false;
  const emailDelivery = await sendAppointmentOperationalEmailOnce({
    salonId: candidate.salonId,
    appointmentId: candidate.appointmentId,
    purpose: 'appointment_day_before_reminder',
    eventVersion: candidate.startTime.toISOString(),
    retryFailed: true,
    validationErrorCode: 'REMINDER_SUPERSEDED',
    prepare: async () =>
      buildDayBeforeEmailPayload(candidate, {
        services: context.services,
        timeZone: context.timeZone,
        manageUrl: await getManageUrl(),
      }),
    validateBeforeDelivery: async () => {
      await context.beforeDeliveryGuard();
      const current = await isCurrentReminderCandidate({
        candidate,
        reminderType: 'day_before',
        now: context.now,
      });
      if (!current) {
        superseded = true;
      }
      return current;
    },
  });
  if (superseded) {
    return { channel: null, attempted: false, superseded: true };
  }
  const emailSent = emailDelivery.status === 'sent';

  const normalizedPhone = normalizeReminderPhone(candidate.clientPhone);
  if (!normalizedPhone) {
    return {
      channel: emailSent ? 'email' : null,
      attempted: emailDelivery.status === 'failed',
    };
  }
  const smsEligible = await canAttemptReminderSms({
    salonId: candidate.salonId,
    phone: normalizedPhone,
  }).catch(() => false);
  if (!smsEligible) {
    return {
      channel: emailSent ? 'email' : null,
      attempted: true,
    };
  }

  const smsClaim = await claimReminderSmsDelivery({
    appointmentId: candidate.appointmentId,
    salonId: candidate.salonId,
    reminderType: 'day_before',
    eventVersion: candidate.startTime.toISOString(),
  });
  if (!smsClaim.claimed || !smsClaim.deliveryId) {
    return {
      channel:
        emailSent
          ? 'email'
          : smsClaim.status === 'sent'
            ? 'sms'
            : null,
      attempted: false,
    };
  }

  const smsManageUrl = await getManageUrl();
  await context.beforeDeliveryGuard();
  if (!await isCurrentReminderCandidate({
    candidate,
    reminderType: 'day_before',
    now: context.now,
  })) {
    await finishReminderSmsDelivery({
      salonId: candidate.salonId,
      deliveryId: smsClaim.deliveryId,
      retryable: false,
      sent: false,
      errorCode: 'REMINDER_SUPERSEDED',
    });
    return { channel: null, attempted: false, superseded: true };
  }
  const smsSent = await sendAppointmentReminder(candidate.salonId, {
    phone: normalizedPhone,
    clientName: candidate.clientName ?? undefined,
    appointmentId: candidate.appointmentId,
    salonName: candidate.salonName,
    startTime: candidate.startTime.toISOString(),
    hoursUntil: Math.max(1, Math.round((candidate.startTime.getTime() - context.now.getTime()) / 3600000)),
    kind: 'day_before',
    services: context.services,
    technicianName: candidate.technicianName,
    timeZone: context.timeZone,
    manageUrl: smsManageUrl,
  }).catch(() => false);
  const smsRetryable = !smsSent && smsClaim.claimedAt
    ? await wasReminderSmsFailureRetryable({
      appointmentId: candidate.appointmentId,
      salonId: candidate.salonId,
      reminderType: 'day_before',
      claimedAt: smsClaim.claimedAt,
    }).catch(() => false)
    : false;
  await finishReminderSmsDelivery({
    salonId: candidate.salonId,
    deliveryId: smsClaim.deliveryId,
    retryable: smsRetryable,
    sent: smsSent,
  }).catch(() => undefined);

  return {
    channel: emailSent ? 'email' : smsSent ? 'sms' : null,
    attempted: emailDelivery.status === 'failed' || Boolean(normalizedPhone),
  };
}

async function sendSameDayReminder(
  candidate: ReminderCandidate,
  context: {
    services: string[];
    timeZone: string;
    now: Date;
    beforeDeliveryGuard: () => Promise<void>;
  },
): Promise<ReminderSendResult> {
  let manageUrl: string | null = null;
  let manageUrlResolved = false;
  const getManageUrl = async () => {
    if (!manageUrlResolved) {
      manageUrl = await resolveReminderManageUrl(candidate);
      manageUrlResolved = true;
    }
    return manageUrl;
  };
  let superseded = false;
  const emailDelivery = await sendAppointmentOperationalEmailOnce({
    salonId: candidate.salonId,
    appointmentId: candidate.appointmentId,
    purpose: 'appointment_same_day_reminder',
    eventVersion: candidate.startTime.toISOString(),
    retryFailed: true,
    validationErrorCode: 'REMINDER_SUPERSEDED',
    prepare: async () =>
      buildSameDayEmailPayload(candidate, {
        services: context.services,
        timeZone: context.timeZone,
        manageUrl: await getManageUrl(),
      }),
    validateBeforeDelivery: async () => {
      await context.beforeDeliveryGuard();
      const current = await isCurrentReminderCandidate({
        candidate,
        reminderType: 'same_day',
        now: context.now,
      });
      if (!current) {
        superseded = true;
      }
      return current;
    },
  });
  if (superseded) {
    return { channel: null, attempted: false, superseded: true };
  }
  const emailSent = emailDelivery.status === 'sent';
  const normalizedPhone = normalizeReminderPhone(candidate.clientPhone);
  if (!normalizedPhone) {
    return {
      channel: emailSent ? 'email' : null,
      attempted: emailDelivery.status === 'failed',
    };
  }
  const smsEligible = await canAttemptReminderSms({
    salonId: candidate.salonId,
    phone: normalizedPhone,
  }).catch(() => false);
  if (!smsEligible) {
    return {
      channel: emailSent ? 'email' : null,
      attempted: true,
    };
  }

  const smsClaim = await claimReminderSmsDelivery({
    appointmentId: candidate.appointmentId,
    salonId: candidate.salonId,
    reminderType: 'same_day',
    eventVersion: candidate.startTime.toISOString(),
  });
  if (!smsClaim.claimed || !smsClaim.deliveryId) {
    return {
      channel:
        emailSent
          ? 'email'
          : smsClaim.status === 'sent'
            ? 'sms'
            : null,
      attempted: false,
    };
  }

  const smsManageUrl = await getManageUrl();
  await context.beforeDeliveryGuard();
  if (!await isCurrentReminderCandidate({
    candidate,
    reminderType: 'same_day',
    now: context.now,
  })) {
    await finishReminderSmsDelivery({
      salonId: candidate.salonId,
      deliveryId: smsClaim.deliveryId,
      retryable: false,
      sent: false,
      errorCode: 'REMINDER_SUPERSEDED',
    });
    return { channel: null, attempted: false, superseded: true };
  }
  const smsSent = await sendAppointmentReminder(candidate.salonId, {
    phone: normalizedPhone,
    clientName: candidate.clientName ?? undefined,
    appointmentId: candidate.appointmentId,
    salonName: candidate.salonName,
    startTime: candidate.startTime.toISOString(),
    hoursUntil: 2,
    kind: 'same_day',
    services: context.services,
    technicianName: candidate.technicianName,
    timeZone: context.timeZone,
    manageUrl: smsManageUrl,
  }).catch(() => false);
  const smsRetryable = !smsSent && smsClaim.claimedAt
    ? await wasReminderSmsFailureRetryable({
      appointmentId: candidate.appointmentId,
      salonId: candidate.salonId,
      reminderType: 'same_day',
      claimedAt: smsClaim.claimedAt,
    }).catch(() => false)
    : false;
  await finishReminderSmsDelivery({
    salonId: candidate.salonId,
    deliveryId: smsClaim.deliveryId,
    retryable: smsRetryable,
    sent: smsSent,
  }).catch(() => undefined);

  return {
    channel: emailSent ? 'email' : smsSent ? 'sms' : null,
    attempted: emailDelivery.status === 'failed' || Boolean(normalizedPhone),
  };
}

/**
 * Reminder emails carry the same private capability link as the booking
 * confirmation, so "view, reschedule, or cancel" is always one tap away.
 * A minting failure must never cost the customer their reminder: the email
 * still goes out, just without the link.
 */
async function resolveReminderManageUrl(candidate: ReminderCandidate): Promise<string | null> {
  try {
    const { mintAppointmentManageLink } = await import('@/libs/appointmentManageLink');
    return await mintAppointmentManageLink({
      id: candidate.appointmentId,
      salonId: candidate.salonId,
      endTime: candidate.endTime,
    });
  } catch {
    return null;
  }
}

function buildSameDayEmailPayload(
  candidate: ReminderCandidate,
  args: { services: string[]; timeZone: string; manageUrl: string | null },
) {
  const formattedTime = formatDateTime(candidate.startTime, args.timeZone, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const text = [
    `Hi ${candidate.clientName || 'there'},`,
    '',
    `Your appointment at ${candidate.salonName} is today at ${formattedTime}.`,
    ...(args.services.length > 0 ? [`Services: ${args.services.join(', ')}`] : []),
    ...(candidate.technicianName ? [`Artist: ${candidate.technicianName}`] : []),
    ...(args.manageUrl ? ['', `View, reschedule, or cancel: ${args.manageUrl}`] : []),
  ].join('\n');
  return {
    subject: `Your ${candidate.salonName} appointment is today`,
    text,
    html: textToSimpleHtml(text),
  };
}

function buildDayBeforeEmailPayload(
  candidate: ReminderCandidate,
  args: {
    services: string[];
    timeZone: string;
    manageUrl: string | null;
  },
): {
    subject: string;
    text: string;
    html: string;
  } {
  const formattedDate = formatDateTime(candidate.startTime, args.timeZone, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const formattedTime = formatDateTime(candidate.startTime, args.timeZone, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const text = [
    `Hi ${candidate.clientName || 'there'},`,
    '',
    `This is a reminder that you have an appointment tomorrow at ${candidate.salonName}.`,
    `Date: ${formattedDate}`,
    `Time: ${formattedTime}`,
    ...(args.services.length > 0 ? [`Services: ${args.services.join(', ')}`] : []),
    ...(candidate.technicianName ? [`Artist: ${candidate.technicianName}`] : []),
    '',
    ...(args.manageUrl
      ? [`Need to change it? View, reschedule, or cancel: ${args.manageUrl}`]
      : ['If you need to reschedule or cancel, please contact the salon as soon as possible.']),
  ].join('\n');

  return {
    subject: `Reminder: Your appointment tomorrow at ${candidate.salonName}`,
    text,
    html: textToSimpleHtml(text),
  };
}

async function markReminderSent(args: {
  appointmentId: string;
  salonId: string;
  reminderType: 'day_before' | 'same_day';
  channel: ReminderChannel;
  now: Date;
  startTime: Date;
}): Promise<boolean> {
  if (args.reminderType === 'day_before') {
    const marked = await db
      .update(appointmentSchema)
      .set({
        dayBeforeReminderSentAt: args.now,
        dayBeforeReminderChannel: args.channel,
        updatedAt: args.now,
      })
      .where(
        and(
          eq(appointmentSchema.id, args.appointmentId),
          eq(appointmentSchema.salonId, args.salonId),
          eq(appointmentSchema.startTime, args.startTime),
          // L1 PR5 — must agree with reminderEligibleAppointmentCondition() above.
          reminderEligibleAppointmentCondition(),
          isNull(appointmentSchema.deletedAt),
          isNull(appointmentSchema.dayBeforeReminderSentAt),
        ),
      )
      .returning();
    return marked.length === 1;
  }

  const marked = await db
    .update(appointmentSchema)
    .set({
      sameDayReminderSentAt: args.now,
      sameDayReminderChannel: args.channel,
      updatedAt: args.now,
    })
    .where(
      and(
        eq(appointmentSchema.id, args.appointmentId),
        eq(appointmentSchema.salonId, args.salonId),
        eq(appointmentSchema.startTime, args.startTime),
        // L1 PR5 — must agree with reminderEligibleAppointmentCondition() above.
        reminderEligibleAppointmentCondition(),
        isNull(appointmentSchema.deletedAt),
        isNull(appointmentSchema.sameDayReminderSentAt),
      ),
    )
    .returning();
  return marked.length === 1;
}

function normalizeReminderPhone(phone: string): string | null {
  const normalizedPhone = normalizePhone(phone);
  return normalizedPhone.length === 10 ? normalizedPhone : null;
}

function formatDateTime(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return date.toLocaleString('en-US', {
    timeZone,
    ...options,
  });
}

function textToSimpleHtml(text: string): string {
  const html = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => `<div>${escapeHtml(line)}</div>`)
    .join('');

  return `<div>${html}</div>`;
}

function getDateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const lookup = Object.fromEntries(
    parts
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  ) as Record<string, string>;

  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function getTimeZoneParts(date: Date, timeZone: string): {
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const lookup = Object.fromEntries(
    parts
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  ) as Record<string, string>;

  return {
    hour: Number.parseInt(lookup.hour ?? '0', 10),
    minute: Number.parseInt(lookup.minute ?? '0', 10),
  };
}

function getEpochDay(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(value => Number.parseInt(value, 10));
  return Math.floor(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) / 86400000);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

/**
 * Shared-mode reminder reconciliation for one candidate (contract §11.2).
 *
 * Fast path first: the desired plan is computed PURELY (planReminders) and
 * compared against the live intent rows; when every desired dedupe key is
 * already live and nothing stale remains, the candidate is untouched — no
 * capability mint, no writes. Only drift (settings/timezone/quiet-hours/rule
 * or start change, or a brand-new appointment) pays for a manage-capability
 * mint and the reconcile transaction.
 */
async function reconcileSharedModeReminders(args: {
  candidate: ReminderCandidate;
  communicationContext: Awaited<ReturnType<typeof resolveSalonCommunicationContext>>;
  timeZone: string;
  now: Date;
}): Promise<{ materialized: number; canceledStale: number }> {
  const { candidate, communicationContext, timeZone, now } = args;
  const settings = communicationContext.settings;
  const clientEmail = candidate.appointmentEmail ?? candidate.salonClientEmail ?? null;
  const clientPhone = candidate.clientPhone ?? null;

  const allowedChannels = resolveEventChannels(settings, 'appointment_reminder')
    .filter(channel => (channel === 'sms'
      ? communicationContext.smsEligible && clientPhone !== null
      : clientEmail !== null));
  const planned = planReminders({
    salonId: candidate.salonId,
    appointmentId: candidate.appointmentId,
    appointmentStart: candidate.startTime,
    appointmentUpdatedAt: candidate.appointmentUpdatedAt,
    timeZone,
    quietHours: settings.quietHours,
    rules: resolveActiveReminderRules(settings),
    allowedChannels,
    smsEnabled: settings.sms.enabled,
    emailEnabled: settings.email.enabled,
    now,
  });
  const desiredKeys = planned.flatMap(plan => (plan.kind === 'scheduled' ? [plan.dedupeKey] : []));

  const allRows = await db
    .select({
      dedupeKey: communicationIntentSchema.dedupeKey,
      status: communicationIntentSchema.status,
    })
    .from(communicationIntentSchema)
    .where(and(
      eq(communicationIntentSchema.salonId, candidate.salonId),
      eq(communicationIntentSchema.appointmentId, candidate.appointmentId),
      eq(communicationIntentSchema.eventType, 'appointment_reminder'),
    ));
  // ANY existing row satisfies a desired key for the fast path — a FAILED or
  // SENT row still owns its dedupe key (the unique index has no status
  // predicate), so treating it as drift would re-enter the transaction and
  // mint a fresh manage capability every pass, forever (review H7). Stale
  // detection cares only about LIVE rows outside the desired set.
  const anyKeys = new Set(allRows.map(row => row.dedupeKey));
  const liveKeys = new Set(allRows
    .filter(row => row.status === 'pending' || row.status === 'blocked_no_credit')
    .map(row => row.dedupeKey));
  const desiredSet = new Set(desiredKeys);
  const missing = desiredKeys.some(key => !anyKeys.has(key));
  const stale = [...liveKeys].some(key => !desiredSet.has(key));
  if (!missing && !stale) {
    return { materialized: 0, canceledStale: 0 };
  }

  return db.transaction(async (tx) => {
    const capability = await mintAppointmentManageCapability(tx, {
      salonId: candidate.salonId,
      appointmentId: candidate.appointmentId,
      appointmentEndTime: candidate.endTime,
    });
    const outcome = await reconcileAppointmentReminders({
      tx,
      salonId: candidate.salonId,
      appointmentId: candidate.appointmentId,
      appointmentStart: candidate.startTime,
      appointmentUpdatedAt: candidate.appointmentUpdatedAt,
      clientPhone,
      clientEmail,
      settings,
      timeZone,
      variables: {
        salonName: candidate.salonName,
        startTime: formatIntentStartTime(candidate.startTime, timeZone),
        manageUrl: buildAppointmentManageUrl(
          { slug: candidate.salonSlug, customDomain: candidate.salonCustomDomain ?? null },
          capability.token,
        ),
      },
      smsEligible: communicationContext.smsEligible,
      now,
    });
    return { materialized: outcome.materialized.length, canceledStale: outcome.canceledStale };
  });
}
