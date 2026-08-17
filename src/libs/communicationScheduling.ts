/**
 * Pure scheduling math for communication intents — Gate C / C1.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §11.1
 * (absolute instants, notAfter on every row), §11.2 (scheduling revision),
 * §11.3 (DST matrix), §11.4 (quiet hours).
 *
 * Deliberately DB-free and side-effect-free: every function here is a pure
 * function of its arguments, so the §11.3 DST matrix and the quiet-hours
 * boundary cases are unit-testable without a database or a fake clock.
 *
 * ---------------------------------------------------------------------------
 * WHY DST BARELY MATTERS HERE, AND EXACTLY WHERE IT DOES
 * ---------------------------------------------------------------------------
 * A reminder instant is `appointmentStart - offsetMinutes` — absolute
 * arithmetic on two instants. It is therefore completely immune to DST: a
 * 24-hour reminder for an appointment on the far side of a transition still
 * fires exactly 24 hours of real elapsed time earlier, which is what
 * "remind me a day before" means.
 *
 * DST enters through QUIET HOURS alone, because quiet hours are wall-clock
 * ("no texts between 21:00 and 09:00 salon-local"). Deciding whether an
 * instant falls inside a local window, and shifting it to the next local
 * 09:00, are both timezone-dependent and both cross DST boundaries. All of
 * that is confined to `applyQuietHours` below.
 */

import 'server-only';

import { createHash } from 'node:crypto';

import type {
  CommunicationChannelMode,
  QuietHoursSettings,
  ReminderRule,
} from '@/libs/communicationSettings';
import {
  DEFAULT_BOOKING_TIME_ZONE,
  getDateKeyInTimeZone,
  getTimeKeyInTimeZone,
  zonedTimeToUtc,
} from '@/libs/timeZone';
import type { CommunicationEventType } from '@/models/Schema';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Contract §11.4: a quiet-hours shift that outlives its usefulness expires. */
export const QUIET_HOURS_STALE = 'QUIET_HOURS_STALE';

/** Minutes of local time since midnight, from an "HH:MM" setting value. */
function minutesOfDay(timeOfDay: string): number {
  const [hour = 0, minute = 0] = timeOfDay.split(':').map(Number);
  return hour * 60 + minute;
}

/**
 * Local wall-clock minutes-since-midnight for an absolute instant, in the
 * salon's timezone. Uses the repo's existing Intl-backed helper rather than
 * a second date library.
 */
function localMinutesOfDay(instant: Date, timeZone: string): number {
  // getTimeKeyInTimeZone yields "HH:MM" in the target zone.
  return minutesOfDay(getTimeKeyInTimeZone(instant, timeZone));
}

/**
 * Advance a "YYYY-MM-DD" local calendar key by one calendar day.
 *
 * This MUST be calendar arithmetic on the date components, never
 * `instant + 24h`. Adding 24 hours to an instant whose local time is near
 * midnight jumps two calendar days across a spring-forward transition: Mar 7
 * 23:00 EST plus 24h is Mar 9 00:00 EDT, skipping Mar 8 entirely and shifting
 * a quiet-hours reminder a full day late. Mirrors the component-wise stepping
 * already used by getZonedDayBounds (timeZone.ts:63-69).
 */
function nextCalendarDay(dateKey: string): string {
  const [year = 0, month = 1, day = 1] = dateKey.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, '0'),
    String(next.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Is `instant` inside the quiet window? The window wraps midnight whenever
 * start > end (21:00 → 09:00 is the default and wraps; 09:00 → 21:00 would
 * not). Half-open [start, end): an instant exactly at the end boundary is
 * already outside quiet hours and needs no shift.
 *
 * start === end is rejected by the settings schema, so it cannot reach here
 * and be ambiguous between "never quiet" and "always quiet".
 */
export function isWithinQuietHours(
  instant: Date,
  quietHours: QuietHoursSettings,
  timeZone: string | null | undefined,
): boolean {
  if (!quietHours.enabled) {
    return false;
  }
  const zone = timeZone ?? DEFAULT_BOOKING_TIME_ZONE;
  const now = localMinutesOfDay(instant, zone);
  const start = minutesOfDay(quietHours.start);
  const end = minutesOfDay(quietHours.end);
  if (start < end) {
    return now >= start && now < end;
  }
  // Wrapping window: quiet either late tonight or early tomorrow.
  return now >= start || now < end;
}

export type QuietHoursDecision =
  | { kind: 'unchanged'; sendAt: Date }
  | { kind: 'shifted'; sendAt: Date; shiftedFrom: Date }
  | { kind: 'stale'; reason: typeof QUIET_HOURS_STALE };

/**
 * Shift an instant out of quiet hours to the next local quiet-hours END, or
 * declare it stale.
 *
 * Contract §11.4: "If shifting lands after notAfter, after the appointment,
 * or too close to be useful ⇒ expire as stale, never send late."
 *
 * The shift is computed by asking for the wall-clock end time on a specific
 * local CALENDAR DAY and converting that back to an instant, which is what
 * makes the result correct across DST: on a spring-forward day the local
 * 09:00 is a different amount of elapsed time away than on an ordinary day,
 * and `zonedTimeToUtc` accounts for that. A naive "add N minutes" shift
 * would land an hour off twice a year.
 */
export function applyQuietHours(input: {
  instant: Date;
  quietHours: QuietHoursSettings;
  timeZone: string | null | undefined;
  /** Hard ceiling — the intent is pointless after this (usually appt start). */
  notAfter: Date;
  /**
   * Contract §11.4: client-triggered immediate confirmations bypass quiet
   * hours entirely (the client just acted; a silent confirmation is worse).
   */
  bypass?: boolean;
}): QuietHoursDecision {
  const { instant, quietHours, timeZone, notAfter } = input;
  if (input.bypass || !isWithinQuietHours(instant, quietHours, timeZone)) {
    return instant.getTime() >= notAfter.getTime()
      ? { kind: 'stale', reason: QUIET_HOURS_STALE }
      : { kind: 'unchanged', sendAt: instant };
  }

  const zone = timeZone ?? DEFAULT_BOOKING_TIME_ZONE;
  const endMinutes = minutesOfDay(quietHours.end);
  const localNow = localMinutesOfDay(instant, zone);

  // If we are in the pre-dawn tail of a wrapping window (local time already
  // before the end boundary) the target is TODAY's end; otherwise we are in
  // the evening head and the target is TOMORROW's end.
  const sameLocalDay = localNow < endMinutes;
  const todayKey = getDateKeyInTimeZone(instant, zone);
  const dateKey = sameLocalDay ? todayKey : nextCalendarDay(todayKey);
  const shifted = zonedTimeToUtc({ date: dateKey, time: quietHours.end, timeZone: zone });

  // Defensive: a DST gap can make the requested wall time nonexistent, in
  // which case zonedTimeToUtc resolves forward past the gap. If that lands
  // at or before the original instant (only reachable with pathological
  // settings) treat it as unshiftable rather than scheduling backwards.
  if (shifted.getTime() <= instant.getTime()) {
    return { kind: 'stale', reason: QUIET_HOURS_STALE };
  }
  if (shifted.getTime() >= notAfter.getTime()) {
    return { kind: 'stale', reason: QUIET_HOURS_STALE };
  }
  return { kind: 'shifted', sendAt: shifted, shiftedFrom: instant };
}

/**
 * A reminder's absolute send instant. Pure subtraction — see the header note
 * on why this is DST-immune.
 */
export function computeReminderInstant(
  appointmentStart: Date,
  offsetMinutes: number,
): Date {
  return new Date(appointmentStart.getTime() - offsetMinutes * MINUTE_MS);
}

/**
 * notAfter policy per event class (contract §11.1 requires notAfter NOT NULL
 * on every row; this table is the ratified policy for what that value is).
 *
 *  - Anything about attending a specific appointment is worthless once the
 *    appointment has started, so it expires at start. A reminder delivered
 *    after the start time is spam, not a reminder.
 *  - Records of something that already happened (cancellation, reschedule
 *    notice, deposit receipt, internal alerts) stay useful briefly but must
 *    not be delivered days later, so they expire 24h after enqueue.
 *
 * The `communication_intent_window_ordered` CHECK is STRICT (not_after >
 * scheduled_for), so callers MUST treat a non-positive window as
 * "do not enqueue" rather than clamping — see resolveNotAfter's contract.
 */
export function resolveNotAfter(input: {
  eventType: CommunicationEventType;
  appointmentStart: Date | null;
  enqueuedAt: Date;
}): Date {
  const { eventType, appointmentStart, enqueuedAt } = input;
  const expiresAtStart
    = eventType === 'appointment_reminder'
    || eventType === 'booking_confirmation'
    || eventType === 'balance_reminder'
    || eventType === 'manual_reminder';

  if (expiresAtStart && appointmentStart) {
    return appointmentStart;
  }
  return new Date(enqueuedAt.getTime() + DAY_MS);
}

/**
 * Deterministic fingerprint feeding both `communication_intent
 * .scheduling_revision` and the dedupe identity.
 *
 * ---------------------------------------------------------------------------
 * WHY `appointmentUpdatedAt` IS AN INPUT (this is subtle and load-bearing)
 * ---------------------------------------------------------------------------
 * `communication_intent_dedupe_uniq` is UNIQUE on dedupe_key with NO status
 * predicate, so a CANCELED intent occupies its dedupe key permanently.
 *
 * Consider: appointment at T1 materializes intent with key K(T1). Owner
 * reschedules to T2 — the T1 intent is canceled, a new one takes key K(T2).
 * Owner reschedules BACK to T1. Without a monotonic input the recomputed key
 * is K(T1) again, the reconciler's `ON CONFLICT DO NOTHING` matches the
 * canceled row, no live intent is created, and the client silently never
 * gets a reminder.
 *
 * `appointmentUpdatedAt` advances on every appointment mutation, so the
 * reschedule-back case produces a fresh key. The cost is that an unrelated
 * appointment edit also changes the revision and causes the reconciler to
 * cancel and rematerialize that appointment's future intents. That churn is
 * bounded (a few rows per edit), fully audited, and deliberately preferred
 * over a silently missed reminder.
 *
 * Truncated to 16 hex chars: 64 bits over a per-(salon, appointment, rule,
 * channel) namespace, which is collision-free for this purpose while keeping
 * the dedupe index narrow.
 */
export function computeSchedulingRevision(input: {
  timeZone: string | null | undefined;
  quietHours: QuietHoursSettings;
  rule?: Pick<ReminderRule, 'id' | 'offsetMinutes' | 'channels'> | null;
  appointmentStart: Date | null;
  appointmentUpdatedAt: Date | null;
  smsEnabled: boolean;
  emailEnabled: boolean;
}): string {
  // Canonical, order-stable payload: an object literal's key order is fixed
  // here in source, so the digest is reproducible across processes.
  const payload = JSON.stringify({
    tz: input.timeZone ?? DEFAULT_BOOKING_TIME_ZONE,
    qh: input.quietHours.enabled
      ? `${input.quietHours.start}-${input.quietHours.end}`
      : 'off',
    rule: input.rule
      ? `${input.rule.id}:${input.rule.offsetMinutes}:${input.rule.channels}`
      : null,
    start: input.appointmentStart?.toISOString() ?? null,
    rev: input.appointmentUpdatedAt?.toISOString() ?? null,
    sms: input.smsEnabled,
    email: input.emailEnabled,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Dedupe identities (contract §11.1 "dedupe identity table"). Every key
 * embeds the salon id because `dedupe_key` is globally unique — the tenant
 * must be part of the identity, not merely a column alongside it.
 */
export function reminderDedupeKey(input: {
  salonId: string;
  appointmentId: string;
  ruleId: string;
  channel: 'sms' | 'email';
  schedulingRevision: string;
}): string {
  return [
    input.salonId,
    input.appointmentId,
    input.ruleId,
    input.channel,
    input.schedulingRevision,
  ].join(':');
}

/**
 * Confirmation dedupe identity. `transitionEventId` is the identity of the
 * authoritative transition that confirmed the appointment — the deposit id
 * on the deposit-paid lane, or the appointment's mutation revision on the
 * direct-confirm lane. Keying on the TRANSITION rather than on the
 * appointment is what makes a Stripe return page, a browser refresh, a
 * duplicate webhook, the reaper and a client retry all collapse onto one
 * intent (prompt §7.5).
 */
export function confirmationDedupeKey(input: {
  salonId: string;
  appointmentId: string;
  transitionEventId: string;
  channel: 'sms' | 'email';
}): string {
  return [
    input.salonId,
    input.appointmentId,
    'confirm',
    input.transitionEventId,
    input.channel,
  ].join(':');
}

/** Cancellation / reschedule notices, keyed on the mutation that caused them. */
export function lifecycleDedupeKey(input: {
  salonId: string;
  appointmentId: string;
  eventType: CommunicationEventType;
  mutationRevision: string;
  channel: 'sms' | 'email';
}): string {
  return [
    input.salonId,
    input.appointmentId,
    input.eventType,
    input.mutationRevision,
    input.channel,
  ].join(':');
}

/**
 * One planned reminder send: the resolved instant, its window, and the
 * dedupe identity, or an explicit reason it will not be scheduled.
 */
export type PlannedReminder =
  | {
    kind: 'scheduled';
    ruleId: string;
    channel: 'sms' | 'email';
    scheduledFor: Date;
    notAfter: Date;
    schedulingRevision: string;
    dedupeKey: string;
    quietHoursShifted: boolean;
  }
  | { kind: 'skipped'; ruleId: string; channel: 'sms' | 'email'; reason: string };

/**
 * Plan every reminder for one appointment: the cartesian product of enabled
 * rules and their resolved channels, quiet-hours-shifted, with passed and
 * stale entries reported rather than silently dropped so the reconciler and
 * tests can assert on them.
 */
export function planReminders(input: {
  salonId: string;
  appointmentId: string;
  appointmentStart: Date;
  appointmentUpdatedAt: Date | null;
  timeZone: string | null | undefined;
  quietHours: QuietHoursSettings;
  rules: ReminderRule[];
  /** Channels permitted for the reminder event after settings resolution. */
  allowedChannels: Array<'sms' | 'email'>;
  smsEnabled: boolean;
  emailEnabled: boolean;
  now: Date;
}): PlannedReminder[] {
  const planned: PlannedReminder[] = [];
  const notAfter = resolveNotAfter({
    eventType: 'appointment_reminder',
    appointmentStart: input.appointmentStart,
    enqueuedAt: input.now,
  });

  for (const rule of input.rules) {
    const instant = computeReminderInstant(input.appointmentStart, rule.offsetMinutes);
    for (const channel of input.allowedChannels) {
      if (!channelModeCovers(rule.channels, channel)) {
        continue;
      }
      const schedulingRevision = computeSchedulingRevision({
        timeZone: input.timeZone,
        quietHours: input.quietHours,
        rule,
        appointmentStart: input.appointmentStart,
        appointmentUpdatedAt: input.appointmentUpdatedAt,
        smsEnabled: input.smsEnabled,
        emailEnabled: input.emailEnabled,
      });
      const identity = { ruleId: rule.id, channel } as const;

      // Contract §11 / blueprint H13: a lead time already in the past for a
      // last-minute booking is skipped, never fired immediately.
      if (instant.getTime() <= input.now.getTime()) {
        planned.push({ kind: 'skipped', ...identity, reason: 'REMINDER_TIME_PASSED' });
        continue;
      }
      const decision = applyQuietHours({
        instant,
        quietHours: input.quietHours,
        timeZone: input.timeZone,
        notAfter,
      });
      if (decision.kind === 'stale') {
        planned.push({ kind: 'skipped', ...identity, reason: QUIET_HOURS_STALE });
        continue;
      }
      planned.push({
        kind: 'scheduled',
        ...identity,
        scheduledFor: decision.sendAt,
        notAfter,
        schedulingRevision,
        dedupeKey: reminderDedupeKey({
          salonId: input.salonId,
          appointmentId: input.appointmentId,
          ruleId: rule.id,
          channel,
          schedulingRevision,
        }),
        quietHoursShifted: decision.kind === 'shifted',
      });
    }
  }
  return planned;
}

function channelModeCovers(
  mode: CommunicationChannelMode,
  channel: 'sms' | 'email',
): boolean {
  return mode === 'both' || mode === channel;
}
