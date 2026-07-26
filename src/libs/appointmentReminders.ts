import 'server-only';

import { and, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';

import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import {
  resolveOperationalSalonClientContact,
  resolveOperationalSalonClientContactByPhone,
  sendAppointmentOperationalEmailOnce,
} from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import { normalizePhone } from '@/libs/phone';
import { getAppointmentServiceNames } from '@/libs/queries';
import { sendAppointmentReminder } from '@/libs/SMS';
import {
  appointmentSchema,
  notificationDeliverySchema,
  salonClientSchema,
  salonSchema,
  technicianSchema,
} from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

const DAY_BEFORE_QUERY_HOURS = 36;
const DAY_BEFORE_WINDOW_MINUTES = 30;
const SAME_DAY_WINDOW_MIN_MINUTES = 105;
const SAME_DAY_WINDOW_MAX_MINUTES = 135;
const MAX_CANDIDATES_PER_RUN = 500;

type ReminderChannel = 'email' | 'sms';

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
};

type ReminderSendResult = {
  channel: ReminderChannel | null;
  attempted: boolean;
};

type ReminderSmsClaim = {
  claimed: boolean;
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
};

export async function processAppointmentReminders(args?: {
  now?: Date;
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
  };

  for (const candidate of candidates) {
    const bookingConfig = resolveBookingConfigFromSettings(
      (candidate.salonSettings as SalonSettings | null | undefined) ?? null,
    );
    const timeZone = bookingConfig.timezone;
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

    if (dueDayBefore) {
      const sendResult = await sendDayBeforeReminder(operationalCandidate, {
        services,
        timeZone,
        now,
      });

      if (sendResult.channel) {
        await markReminderSent({
          appointmentId: operationalCandidate.appointmentId,
          salonId: operationalCandidate.salonId,
          reminderType: 'day_before',
          channel: sendResult.channel,
          now,
        });
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
      });

      if (sendResult.channel) {
        await markReminderSent({
          appointmentId: operationalCandidate.appointmentId,
          salonId: operationalCandidate.salonId,
          reminderType: 'same_day',
          channel: sendResult.channel,
          now,
        });
        result.sameDaySent += 1;
      } else if (sendResult.attempted) {
        result.failures += 1;
      } else {
        result.skipped += 1;
      }
    }
  }

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
  const latestRelevantStartTime = new Date(now.getTime() + DAY_BEFORE_QUERY_HOURS * 60 * 60 * 1000);

  const rows = await db
    .select({
      appointmentId: appointmentSchema.id,
      salonId: appointmentSchema.salonId,
      salonClientId: appointmentSchema.salonClientId,
      salonName: salonSchema.name,
      salonSettings: salonSchema.settings,
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
        inArray(appointmentSchema.status, ['pending', 'confirmed']),
        isNull(appointmentSchema.deletedAt),
        gt(appointmentSchema.startTime, now),
        lt(appointmentSchema.startTime, latestRelevantStartTime),
        or(
          isNull(appointmentSchema.dayBeforeReminderSentAt),
          isNull(appointmentSchema.sameDayReminderSentAt),
        ),
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
      deliveryId: inserted.id,
      status: inserted.status,
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
    deliveryId: existing?.id ?? null,
    status: existing?.status ?? null,
  };
}

async function finishReminderSmsDelivery(input: {
  salonId: string;
  deliveryId: string;
  sent: boolean;
}) {
  await db.update(notificationDeliverySchema).set({
    status: input.sent ? 'sent' : 'failed',
    errorCode: input.sent ? null : 'SMS_DELIVERY_UNAVAILABLE',
    retryable: false,
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
  const emailDelivery = await sendAppointmentOperationalEmailOnce({
    salonId: candidate.salonId,
    appointmentId: candidate.appointmentId,
    purpose: 'appointment_day_before_reminder',
    eventVersion: candidate.startTime.toISOString(),
    retryFailed: true,
    prepare: async () =>
      buildDayBeforeEmailPayload(candidate, {
        services: context.services,
        timeZone: context.timeZone,
        manageUrl: await getManageUrl(),
      }),
  });
  const emailSent = emailDelivery.status === 'sent';

  const normalizedPhone = normalizeReminderPhone(candidate.clientPhone);
  if (!normalizedPhone) {
    return {
      channel: emailSent ? 'email' : null,
      attempted: emailDelivery.status === 'failed',
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
    manageUrl: await getManageUrl(),
  }).catch(() => false);
  await finishReminderSmsDelivery({
    salonId: candidate.salonId,
    deliveryId: smsClaim.deliveryId,
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
  const emailDelivery = await sendAppointmentOperationalEmailOnce({
    salonId: candidate.salonId,
    appointmentId: candidate.appointmentId,
    purpose: 'appointment_same_day_reminder',
    eventVersion: candidate.startTime.toISOString(),
    retryFailed: true,
    prepare: async () =>
      buildSameDayEmailPayload(candidate, {
        services: context.services,
        timeZone: context.timeZone,
        manageUrl: await getManageUrl(),
      }),
  });
  const emailSent = emailDelivery.status === 'sent';
  const normalizedPhone = normalizeReminderPhone(candidate.clientPhone);
  if (!normalizedPhone) {
    return {
      channel: emailSent ? 'email' : null,
      attempted: emailDelivery.status === 'failed',
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
    manageUrl: await getManageUrl(),
  }).catch(() => false);
  await finishReminderSmsDelivery({
    salonId: candidate.salonId,
    deliveryId: smsClaim.deliveryId,
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
}): Promise<void> {
  if (args.reminderType === 'day_before') {
    await db
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
          isNull(appointmentSchema.dayBeforeReminderSentAt),
        ),
      );
    return;
  }

  await db
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
        isNull(appointmentSchema.sameDayReminderSentAt),
      ),
    );
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
