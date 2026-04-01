import 'server-only';

import { and, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';

import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { db } from '@/libs/DB';
import { sendTransactionalEmail } from '@/libs/email';
import { normalizePhone } from '@/libs/phone';
import { getAppointmentServiceNames, getClientByPhone } from '@/libs/queries';
import { sendAppointmentReminder } from '@/libs/SMS';
import {
  appointmentSchema,
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
  salonName: string;
  salonSettings: unknown;
  clientName: string | null;
  clientPhone: string;
  startTime: Date;
  technicianName: string | null;
  salonClientEmail: string | null;
  dayBeforeReminderSentAt: Date | null;
  sameDayReminderSentAt: Date | null;
};

type ReminderSendResult = {
  channel: ReminderChannel | null;
  attempted: boolean;
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
      && isDayBeforeReminderDue({ now, startTime: candidate.startTime, timeZone });
    const dueSameDay = candidate.sameDayReminderSentAt == null
      && isSameDayReminderDue({ now, startTime: candidate.startTime });

    if (!dueDayBefore && !dueSameDay) {
      result.skipped += 1;
      continue;
    }

    const services = await getAppointmentServiceNames(candidate.appointmentId);

    if (dueDayBefore) {
      const sendResult = await sendDayBeforeReminder(candidate, {
        services,
        timeZone,
        now,
      });

      if (sendResult.channel) {
        await markReminderSent({
          appointmentId: candidate.appointmentId,
          salonId: candidate.salonId,
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
      const sendResult = await sendSameDayReminder(candidate, {
        services,
        timeZone,
      });

      if (sendResult.channel) {
        await markReminderSent({
          appointmentId: candidate.appointmentId,
          salonId: candidate.salonId,
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
      salonName: salonSchema.name,
      salonSettings: salonSchema.settings,
      clientName: appointmentSchema.clientName,
      clientPhone: appointmentSchema.clientPhone,
      startTime: appointmentSchema.startTime,
      technicianName: technicianSchema.name,
      salonClientEmail: salonClientSchema.email,
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

async function sendDayBeforeReminder(
  candidate: ReminderCandidate,
  context: {
    services: string[];
    timeZone: string;
    now: Date;
  },
): Promise<ReminderSendResult> {
  const clientEmail = await resolveClientEmail(candidate);

  if (clientEmail) {
    const emailSent = await sendTransactionalEmail(
      buildDayBeforeEmailPayload(candidate, {
        to: clientEmail,
        services: context.services,
        timeZone: context.timeZone,
      }),
    );

    if (emailSent) {
      return { channel: 'email', attempted: true };
    }
  }

  const normalizedPhone = normalizeReminderPhone(candidate.clientPhone);
  if (!normalizedPhone) {
    return { channel: null, attempted: Boolean(clientEmail) };
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
  });

  return {
    channel: smsSent ? 'sms' : null,
    attempted: true,
  };
}

async function sendSameDayReminder(
  candidate: ReminderCandidate,
  context: {
    services: string[];
    timeZone: string;
  },
): Promise<ReminderSendResult> {
  const normalizedPhone = normalizeReminderPhone(candidate.clientPhone);
  if (!normalizedPhone) {
    return { channel: null, attempted: false };
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
  });

  return {
    channel: smsSent ? 'sms' : null,
    attempted: true,
  };
}

async function resolveClientEmail(candidate: ReminderCandidate): Promise<string | null> {
  const salonClientEmail = candidate.salonClientEmail?.trim().toLowerCase() ?? '';
  if (salonClientEmail) {
    return salonClientEmail;
  }

  const globalClient = await getClientByPhone(candidate.clientPhone);
  const globalEmail = globalClient?.email?.trim().toLowerCase() ?? '';
  return globalEmail || null;
}

function buildDayBeforeEmailPayload(
  candidate: ReminderCandidate,
  args: {
    to: string;
    services: string[];
    timeZone: string;
  },
): {
  to: string;
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
    'If you need to reschedule or cancel, please contact the salon as soon as possible.',
  ].join('\n');

  return {
    to: args.to,
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
