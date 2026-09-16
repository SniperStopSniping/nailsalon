import 'server-only';

import { computeDaySlots, preflightDayAvailability } from '@/libs/availability/engine.server';
import type { DiagnosisCode } from '@/libs/availability/reasons';
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import type {
  BookingHoursCeiling,
  LoadedBookingPolicy,
  RequestedService,
} from '@/libs/bookingPolicy';
import {
  getDayNameForDate,
  getEffectiveScheduleForWindow,
  loadBookingPolicy,
  resolveBookingHoursCeiling,
  resolveTechnicianCapabilityMode,
} from '@/libs/bookingPolicy';
import {
  BookingSelectionError,
  getPublicTechnicianCompatibility,
  validatePublicBookingSelection,
} from '@/libs/bookingQuote';
import { resolveEntitlement } from '@/libs/featureEntitlements';
import {
  getGoogleCalendarBusyWindows,
  GoogleCalendarAvailabilityError,
} from '@/libs/googleCalendar';
import {
  getPrimaryLocation,
  getSalonById,
  getServicesBySalonIdIncludingInactive,
  getTechniciansBySalonId,
} from '@/libs/queries';
import { checkSalonStatus } from '@/libs/salonStatus';
import { getDateKeyInTimeZone, getZonedDayBounds } from '@/libs/timeZone';
import type { SalonFeatures, SalonSettings } from '@/types/salonPolicy';

import type { DiagnoseDayCause, DiagnoseDayResult } from '../contracts';
import { normalizeAssistantText } from '../registry';
import { OwnerAssistantSalonMissingError } from './getSalonOverview.server';

/**
 * `diagnose_day_availability` (A1-2 Piece 2; docs/OWNER_ASSISTANT_CHAT.md §3).
 *
 * Answers one question — "why can (or can't) customers book that day?" — by
 * re-running the PUBLIC booking page's own decisions in the same order, using
 * the same helpers, and reporting what each one said. It resolves the booking
 * config, the hours ceiling, the technicians, the compatibility rule, the
 * booking policy and the Google busy windows exactly as
 * `GET /api/appointments/availability` does, MINUS everything that endpoint
 * does for a client: no client session, no manage token, no reschedule
 * exclusion, no Smart Fit. So the diagnosis cannot advertise a slot the
 * booking page would refuse, and it cannot see anything a client owns.
 *
 * Privacy: every cause carries a SLOT count and, at most, a staff display name
 * and a fixed short code. No appointment, client or calendar-event field ever
 * reaches the result — the engine is asked for counts, and nothing here reads
 * an appointment row.
 *
 * TWO DIFFERENT QUESTIONS. `bookableSlotCount` answers "what would this salon's
 * own rules allow on that day" and is `null` whenever the slot loop did not run.
 * `customersCanBookNow` answers "can a customer actually book right now", which
 * is false for an unpublished salon or one without the online-booking
 * entitlement however healthy its rules are, and false whenever nothing was
 * measured. Only the second one may be turned into "customers can book".
 *
 * KNOWN LIMITATION — single location. The hours ceiling is resolved from the
 * salon's PRIMARY location (`getPrimaryLocation`), while the public route
 * resolves it from the location the customer is booking against. A
 * multi-location salon can therefore be diagnosed against different hours than
 * the page serves for a secondary location. Recorded in
 * docs/OWNER_ASSISTANT_CHAT.md §3; multi-location is an elite-tier feature and
 * out of scope for this slice.
 *
 * TIMEZONE LIMITATION: the booking policy engine resolves weekdays and
 * schedule windows in America/Toronto (`getDayNameForDate`,
 * `isWindowWithinSchedule` in `bookingPolicy.ts`). A salon on any other
 * timezone would get a confidently wrong answer, so step 0 refuses instead.
 */

/** Same fallback the public route uses when no service is named. */
const DEFAULT_DURATION_MINUTES = 30;

/** How far ahead an explicit date may look. */
const MAX_DAYS_AHEAD = 60;

/** The only timezone the booking policy engine is correct for today. */
const SUPPORTED_TIME_ZONE = 'America/Toronto';

/** At most this many names come back with a `clarify`. */
const MAX_CLARIFY_OPTIONS = 8;

/**
 * At most this many ENGINE-derived causes reach the model.
 *
 * The engine charges up to six codes per technician plus two salon-wide ones,
 * so a large team produced an unbounded list that is replayed into the model on
 * every later call of the turn. The tool's own causes (steps 0–7) are
 * authoritative and always survive; only the per-slot tallies below are capped,
 * keeping the biggest counts because those are the ones that explain the day.
 */
const MAX_ENGINE_CAUSES = 8;

/**
 * Engine causes that merely restate the working window. On a day that yields
 * bookable slots they explain nothing — a healthy Friday charges one
 * `outside_schedule` per technician for the sixteen grid slots outside 09:00–17:00
 * — so they are dropped there and kept when the day yields nothing, where they
 * may be the real explanation.
 */
const SCHEDULE_SHAPE_CODES = new Set<DiagnosisCode>(['outside_schedule', 'location_unavailable']);

const WEEKDAY_WORDS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

/**
 * Where an owner goes to change each cause. Registry keys only (the model may
 * cite them in `links`, and code turns a key into an href); `null` where
 * nothing in the dashboard can fix it.
 */
export const CAUSE_LINKS: Record<DiagnosisCode, string | null> = {
  // Not an owner-fixable state: Luster does not support this salon's timezone
  // in the availability engine yet.
  timezone_unsupported: null,
  salon_not_public: 'page_publish',
  // The owner cannot turn online booking back on themselves; it is a plan
  // entitlement, so pointing anywhere would be a dead end.
  online_booking_off: null,
  closed_that_day: 'business_hours',
  service_not_bookable: 'services',
  no_active_technicians: 'team_members',
  no_technician_offers_service: 'team',
  technician_time_off: 'team_time_off',
  technician_day_off: 'team',
  service_unsupported: 'team',
  outside_schedule: 'team',
  location_unavailable: 'team',
  blocked_slot: 'team',
  time_conflict: 'calendar',
  min_notice: 'booking_rules',
  google_busy: 'integrations',
  calendar_unverified: 'integrations',
  none: null,
};

/**
 * A date the tool cannot honour at all (unparseable, or outside the window it
 * is allowed to look at). The dispatcher turns this into the `invalid_arguments`
 * tool error rather than the generic `tool_failed`, so the model learns that
 * the ARGUMENT was wrong and can ask the owner for a different day.
 */
export class DiagnoseDayInvalidArgumentsError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'DiagnoseDayInvalidArgumentsError';
  }
}

export type DiagnoseDayArgs = {
  date: string;
  serviceName: string | null;
  technicianName: string | null;
};

type ResolvedDate = {
  dateKey: string;
  resolution: DiagnoseDayResult['resolution'];
  ambiguity: 'today_or_next' | null;
};

// ---------------------------------------------------------------------------
// Calendar arithmetic on `YYYY-MM-DD` keys
// ---------------------------------------------------------------------------
// A date key's weekday and its neighbours are pure calendar facts, so they are
// computed on a UTC instant built FROM the key. That keeps the arithmetic free
// of the salon's offset (which `getDateKeyInTimeZone` has already applied) and
// free of DST: adding a day never shifts the key by two.

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function dateKeyToUtcNoon(dateKey: string): Date {
  const [year = 0, month = 1, day = 1] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function utcToDateKey(value: Date): string {
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    String(value.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const base = dateKeyToUtcNoon(dateKey);
  return utcToDateKey(new Date(base.getTime() + days * 24 * 60 * 60 * 1000));
}

function weekdayIndexOfDateKey(dateKey: string): number {
  return dateKeyToUtcNoon(dateKey).getUTCDay();
}

/**
 * Step 1 — what day does the owner mean, in THEIR timezone?
 *
 * A weekday word means the next occurrence STRICTLY after today, because an
 * owner asking "why can't people book Friday?" on a Friday afternoon is
 * usually asking about the rest of today — and might be asking about next
 * week. That case is reported as `ambiguity: 'today_or_next'` and diagnosed
 * as the next occurrence, so the assistant has a real answer to offer while it
 * asks which one was meant.
 */
function resolveRequestedDate(rawDate: string, todayKey: string): ResolvedDate {
  const token = normalizeAssistantText(rawDate);

  if (token === 'today') {
    return { dateKey: todayKey, resolution: 'today', ambiguity: null };
  }

  if (token === 'tomorrow') {
    return { dateKey: addDaysToDateKey(todayKey, 1), resolution: 'tomorrow', ambiguity: null };
  }

  const weekdayIndex = WEEKDAY_WORDS.indexOf(token as (typeof WEEKDAY_WORDS)[number]);
  if (weekdayIndex >= 0) {
    const todayIndex = weekdayIndexOfDateKey(todayKey);
    const isToday = todayIndex === weekdayIndex;
    const ahead = isToday ? 7 : (weekdayIndex - todayIndex + 7) % 7;

    return {
      dateKey: addDaysToDateKey(todayKey, ahead),
      resolution: 'next_weekday',
      ambiguity: isToday ? 'today_or_next' : null,
    };
  }

  // `normalizeAssistantText` turns the hyphens of a date into spaces, so the
  // raw argument is what gets pattern-matched.
  const trimmed = rawDate.trim();
  if (!DATE_KEY_PATTERN.test(trimmed)) {
    throw new DiagnoseDayInvalidArgumentsError('unparseable_date');
  }
  // The pattern only proves the SHAPE. `Date.UTC` silently rolls an impossible
  // key over into a real instant ('2026-03-99' becomes June), which would slip
  // past the lexicographic range check below and be diagnosed as a day ~94 days
  // out while `resolvedDateKey` still echoed the impossible key back. A key that
  // does not survive the round trip is not a date.
  if (utcToDateKey(dateKeyToUtcNoon(trimmed)) !== trimmed) {
    throw new DiagnoseDayInvalidArgumentsError('unparseable_date');
  }
  if (trimmed < todayKey || trimmed > addDaysToDateKey(todayKey, MAX_DAYS_AHEAD)) {
    throw new DiagnoseDayInvalidArgumentsError('date_out_of_range');
  }

  return { dateKey: trimmed, resolution: 'exact', ambiguity: null };
}

/** Exact normalized match. 0 or >1 hits is a question for the owner, not a guess. */
function matchByName<T extends { name: string }>(rows: T[], rawName: string): {
  matched: T | null;
  options: string[];
} {
  const wanted = normalizeAssistantText(rawName);
  const matches = wanted === ''
    ? []
    : rows.filter(row => normalizeAssistantText(row.name) === wanted);

  if (matches.length === 1) {
    return { matched: matches[0] ?? null, options: [] };
  }

  // On several hits the owner chooses between the ambiguous rows; on none they
  // need to see what actually exists.
  const pool = matches.length > 1 ? matches : rows;

  return { matched: null, options: pool.map(row => row.name).slice(0, MAX_CLARIFY_OPTIONS) };
}

function cause(
  code: DiagnosisCode,
  extra: Omit<DiagnoseDayCause, 'code' | 'link'> = {},
): DiagnoseDayCause {
  return { code, ...extra, link: CAUSE_LINKS[code] };
}

export async function diagnoseDayAvailability(
  salonId: string,
  args: DiagnoseDayArgs,
  options: { now?: Date } = {},
): Promise<DiagnoseDayResult> {
  const now = options.now ?? new Date();
  const salon = await getSalonById(salonId);
  if (!salon) {
    throw new OwnerAssistantSalonMissingError();
  }

  const settings = (salon.settings as SalonSettings | null | undefined) ?? null;
  const features = (salon.features as SalonFeatures | null | undefined) ?? null;
  const bookingConfig = resolveBookingConfigFromSettings(settings);
  const timeZone = bookingConfig.timezone;

  // Step 1 first, even though step 0 can end the turn: resolving the day is
  // pure and timezone-correct for any salon, so the refusal below can still
  // name the day the owner meant. An unusable date argument is still an
  // argument error rather than a cause, on every timezone.
  const requested = resolveRequestedDate(args.date, getDateKeyInTimeZone(now, timeZone));

  // Every field here is what the tool knows BEFORE the slot loop runs. The
  // count and the first bookable time are `null` — NOT MEASURED — so that every
  // early return below reports honestly instead of claiming a measured zero,
  // and `customersCanBookNow` is false until something proves otherwise.
  const base = {
    resolvedDateKey: requested.dateKey,
    resolution: requested.resolution,
    ambiguity: requested.ambiguity,
    bookableSlotCount: null,
    firstBookable: null,
    publicRouteState: 'ok',
    customersCanBookNow: false,
  } as const;

  // Step 0 — the policy engine is Toronto-bound; say so instead of guessing.
  if (timeZone !== SUPPORTED_TIME_ZONE) {
    return {
      ...base,
      checked: {
        timezone: timeZone,
        serviceName: null,
        durationMinutes: DEFAULT_DURATION_MINUTES,
        bufferMinutes: bookingConfig.bufferMinutes,
        technician: 'any',
      },
      causes: [cause('timezone_unsupported')],
    };
  }

  // Step 2 — name resolution. A name the owner typed is matched against their
  // own rows; it never selects anything outside this salon.
  const [allServices, activeTechnicians] = await Promise.all([
    getServicesBySalonIdIncludingInactive(salonId),
    getTechniciansBySalonId(salonId),
  ]);

  // Matched against ALL of the salon's services, switched-off ones included. An
  // owner asking about a hidden service must be told it is switched off (step 5
  // raises `service_not_bookable` with the validator's own `invalid_service`),
  // not handed a list of other services that quietly omits the one they named.
  let service: (typeof allServices)[number] | null = null;
  if (args.serviceName !== null && args.serviceName.trim() !== '') {
    const match = matchByName(allServices, args.serviceName);
    // An EMPTY option list is not a question — it asks the owner to choose
    // between nothing. Fall through instead, so the honest gates below
    // (no services at all, nobody active) get to speak.
    if (!match.matched && match.options.length > 0) {
      return {
        ...base,
        clarify: { kind: 'service', options: match.options },
        checked: {
          timezone: timeZone,
          serviceName: null,
          durationMinutes: DEFAULT_DURATION_MINUTES,
          bufferMinutes: bookingConfig.bufferMinutes,
          technician: 'any',
        },
        causes: [],
      };
    }
    service = match.matched;
  }

  let technician: (typeof activeTechnicians)[number] | null = null;
  if (args.technicianName !== null && args.technicianName.trim() !== '') {
    const match = matchByName(activeTechnicians, args.technicianName);
    if (!match.matched && match.options.length > 0) {
      return {
        ...base,
        clarify: { kind: 'technician', options: match.options },
        checked: {
          timezone: timeZone,
          serviceName: service?.name ?? null,
          durationMinutes: service?.durationMinutes ?? DEFAULT_DURATION_MINUTES,
          bufferMinutes: bookingConfig.bufferMinutes,
          technician: 'any',
        },
        causes: [],
      };
    }
    technician = match.matched;
  }

  const causes: DiagnoseDayCause[] = [];
  let visibleDurationMinutes = service?.durationMinutes ?? DEFAULT_DURATION_MINUTES;
  let bufferMinutes = bookingConfig.bufferMinutes;
  let publicRouteState: DiagnoseDayResult['publicRouteState'] = 'ok';

  const checked = () => ({
    timezone: timeZone,
    serviceName: service?.name ?? null,
    durationMinutes: visibleDurationMinutes,
    bufferMinutes,
    technician: technician?.name ?? ('any' as const),
  });
  const stop = (): DiagnoseDayResult => ({
    ...base,
    publicRouteState,
    checked: checked(),
    causes,
  });

  // Step 3 — is the page reachable at all, and is online booking entitled?
  // Both are reported and neither stops the diagnosis: an owner fixing their
  // publication state still wants to know their Friday is fully booked. But
  // either one means the PUBLIC page serves nobody, on every day and whatever
  // the slot loop goes on to measure, so the state becomes `unreachable` and
  // `customersCanBookNow` can no longer be true.
  const status = await checkSalonStatus(salonId);
  if (!status.isActive) {
    causes.push(cause('salon_not_public'));
    publicRouteState = 'unreachable';
  }
  if (!resolveEntitlement(features, 'booking', 'onlineBooking')) {
    causes.push(cause('online_booking_off'));
    publicRouteState = 'unreachable';
  }

  // Step 4 — the opening-hours ceiling, resolved exactly as the public route
  // resolves it (the requested location, else the salon's primary location,
  // else the salon row's own hours) and read with the engine's own weekday
  // predicate.
  const location = await getPrimaryLocation(salonId);
  const hoursCeiling: BookingHoursCeiling = resolveBookingHoursCeiling({
    location: location ? { id: location.id, businessHours: location.businessHours ?? undefined } : null,
    salonBusinessHours: salon.businessHours ?? undefined,
  });
  const { startOfDay, endOfDay } = getZonedDayBounds(requested.dateKey, timeZone);

  if (hoursCeiling.businessHours) {
    const dayName = getDayNameForDate(startOfDay);
    if (!hoursCeiling.businessHours[dayName]) {
      causes.push(cause('closed_that_day'));
      // Nothing below can add a fact: with the ceiling closed, the engine
      // refuses every slot of the day as `location_unavailable`, which only
      // restates the closure with a large and meaningless count.
      return stop();
    }
  }

  // Step 5 — the public selection validator, the same one that decides whether
  // the booking page may quote this service at all. It also supplies the real
  // duration and buffer, so a wrong answer here would poison every count below.
  let requestedServices: RequestedService[] = [];
  if (service) {
    try {
      const validated = await validatePublicBookingSelection({
        salonId,
        selection: { baseServiceId: service.id, selectedAddOns: [] },
        technicianId: technician?.id ?? null,
      });
      requestedServices = [validated.baseServiceRecord];
      visibleDurationMinutes = validated.quote.visibleDurationMinutes;
      bufferMinutes = validated.quote.bufferMinutes;
    } catch (error) {
      if (!(error instanceof BookingSelectionError)) {
        throw error;
      }
      // `detail` is the validator's own code — a fixed short string, never a
      // message and never owner or client text.
      causes.push(cause('service_not_bookable', { detail: error.code }));
      return stop();
    }
  }

  // Step 6 — is there anybody to book with, and can they do it? The same
  // preflight the public route runs, with the same compatibility rule.
  const roster = technician ? [technician] : activeTechnicians;
  const preflight = preflightDayAvailability({
    technicians: roster,
    compatibility: candidate =>
      getPublicTechnicianCompatibility({
        selectionMode: service ? 'base-service' : 'legacy',
        technician: candidate,
        requestedServices,
      }).bookable,
  });

  if (!preflight.ok) {
    causes.push(
      preflight.code === 'no_technicians'
        ? cause('no_active_technicians')
        : cause('no_technician_offers_service'),
    );
    return stop();
  }

  const technicians = preflight.technicians;

  // Step 7 — per-technician day shape. Asked ONCE per technician for the whole
  // day rather than per slot, so "Mara is on time off" is one cause with a
  // name instead of a slot count.
  const bookingPolicy: LoadedBookingPolicy = await loadBookingPolicy({
    salonId,
    technicianIds: technicians.map(candidate => candidate.id),
    date: requested.dateKey,
    selectedDate: startOfDay,
    startOfDay,
    endOfDay,
    excludedAppointmentId: null,
    now,
  });

  for (const candidate of technicians) {
    const schedule = getEffectiveScheduleForWindow({
      startTime: startOfDay,
      weeklySchedule: candidate.weeklySchedule,
      override: bookingPolicy.overridesByTechnician.get(candidate.id),
      isOnTimeOff: bookingPolicy.timeOffTechnicianIds.has(candidate.id),
    });

    if (!schedule.available) {
      causes.push(
        cause(
          schedule.reason === 'time_off' ? 'technician_time_off' : 'technician_day_off',
          { technicianName: candidate.name },
        ),
      );
    }
  }

  // Step 9 (raised here, because the fetch happens before the loop) — a
  // calendar Luster cannot read is reported as its own cause AND as the public
  // page's current state, and the rest of the diagnosis still runs against an
  // empty busy list so the owner hears every other reason too.
  let googleBusyWindows: Awaited<ReturnType<typeof getGoogleCalendarBusyWindows>> = [];
  try {
    googleBusyWindows = await getGoogleCalendarBusyWindows({
      salonId,
      startTime: startOfDay,
      endTime: endOfDay,
      timeZone,
      excludeAppointmentId: null,
    });
  } catch (error) {
    if (!(error instanceof GoogleCalendarAvailabilityError)) {
      throw error;
    }
    causes.push(cause('calendar_unverified'));
    // `unreachable` outranks `error`: a page nobody can open at all cannot be
    // described as failing for this one day.
    if (publicRouteState === 'ok') {
      publicRouteState = 'error';
    }
  }

  // Step 8 — the slot loop itself, in explain mode. No annotator and no
  // excluded appointment: this is the anonymous public view of the day.
  const { explanation } = computeDaySlots({
    date: requested.dateKey,
    technicians,
    requestedServices,
    capabilityMode: service
      ? 'service_assignments'
      : resolveTechnicianCapabilityMode(technicians, requestedServices),
    bookingPolicy,
    googleBusyWindows,
    hoursCeiling,
    effectiveLocationId: hoursCeiling.locationId,
    visibleDurationMinutes,
    bufferMinutes,
    slotIntervalMinutes: bookingConfig.slotIntervalMinutes,
    minimumNoticeMinutes: bookingConfig.minimumNoticeMinutes,
    timeZone,
    now,
    excludedAppointmentId: null,
  }, { explain: true });

  const namesById = new Map(technicians.map(candidate => [candidate.id, candidate.name]));
  const dayWorks = explanation.bookableSlotCount > 0;

  const relevant = explanation.causes.filter((engineCause) => {
    // Step 7 already reported these authoritatively, once per technician and
    // with a name; the engine only restates them per refused slot.
    if (engineCause.code === 'technician_time_off' || engineCause.code === 'technician_day_off') {
      return false;
    }

    // Schedule shape is noise on a day that works (see SCHEDULE_SHAPE_CODES).
    return !(dayWorks && SCHEDULE_SHAPE_CODES.has(engineCause.code));
  });

  // Cap by BREADTH FIRST, then by count. Ranking purely on count lets one
  // busy day's per-technician causes (one per technician, each covering most
  // of the grid) crowd out a salon-wide cause like `min_notice` that is the
  // actual reason nothing is bookable. So every distinct code places its
  // largest cause before any code places a second one. Emission stays in the
  // engine's own first-hit order, which is the order the day hit them.
  const byCode = new Map<string, Array<{ engineCause: (typeof relevant)[number]; index: number }>>();
  relevant.forEach((engineCause, index) => {
    const bucket = byCode.get(engineCause.code) ?? [];
    bucket.push({ engineCause, index });
    byCode.set(engineCause.code, bucket);
  });
  for (const bucket of byCode.values()) {
    bucket.sort((left, right) => right.engineCause.count - left.engineCause.count || left.index - right.index);
  }

  const rounds: Array<{ engineCause: (typeof relevant)[number]; index: number }> = [];
  const deepest = Math.max(0, ...[...byCode.values()].map(bucket => bucket.length));
  for (let round = 0; round < deepest; round++) {
    const thisRound = [...byCode.values()]
      .map(bucket => bucket[round])
      .filter((entry): entry is { engineCause: (typeof relevant)[number]; index: number } => entry !== undefined)
      .sort((left, right) => right.engineCause.count - left.engineCause.count || left.index - right.index);
    rounds.push(...thisRound);
  }

  const capped = rounds
    .slice(0, MAX_ENGINE_CAUSES)
    .sort((left, right) => left.index - right.index);

  for (const { engineCause } of capped) {
    const technicianName = engineCause.technicianId === undefined
      ? undefined
      : namesById.get(engineCause.technicianId);

    causes.push(cause(engineCause.code, {
      count: engineCause.count,
      ...(technicianName === undefined ? {} : { technicianName }),
    }));
  }

  return {
    ...base,
    publicRouteState,
    checked: checked(),
    bookableSlotCount: explanation.bookableSlotCount,
    firstBookable: explanation.firstBookable,
    // The only place this can be true: the loop ran AND the page is serving.
    customersCanBookNow: publicRouteState === 'ok' && explanation.bookableSlotCount > 0,
    causes,
  };
}
