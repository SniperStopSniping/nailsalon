import type {
  AppointmentWindow,
  BlockedSlotWindow,
  BusinessHours,
  ScheduleOverride,
} from '@/libs/bookingPolicy';
import { getDayNameForDate, getEffectiveScheduleForWindow } from '@/libs/bookingPolicy';
import type { GoogleCalendarBusyWindow } from '@/libs/googleCalendar';
import { normalizePhone } from '@/libs/phone';
import type {
  SmartFitBlock,
  SmartFitDayContext,
  SmartFitEvaluation,
  SmartFitSide,
} from '@/libs/smartFit';
import { calculateSmartFitDiscountCents } from '@/libs/smartFit';
import type { ResolvedSmartFitConfig, SmartFitDiscountType } from '@/libs/smartFitConfig';
import { zonedTimeToUtc } from '@/libs/timeZone';
import type { WeeklySchedule } from '@/models/Schema';

/**
 * Smart Fit booking integration helpers (P7.2).
 *
 * Bridges the app's resolved scheduling data (loadBookingPolicy maps, Google
 * busy windows, technician schedules) into the pure evaluator's input model.
 * All instants are converted on the slot-grid basis (`zonedTimeToUtc` +
 * `bookingConfig.timezone`) as approved by the P6 architecture — deliberately
 * NOT bookingPolicy.ts's Toronto-local minutes math.
 *
 * Privacy contract: client identity travels ONLY as the opaque comparison
 * keys produced by `buildSmartFitClientKeys`; day contexts and evaluations
 * never leave the server, and `buildSmartFitSlotAnnotation` derives the only
 * client-facing payload — prices and minutes, never neighbor records or keys.
 */

const MINUTE_MS = 60_000;

/**
 * Opaque identity keys for self-adjacency exclusion. Both the candidate side
 * and the block side must be built with this helper so key intersection is
 * meaningful; `normalizePhone` is idempotent, so raw and stored phone shapes
 * collapse to the same key.
 */
export function buildSmartFitClientKeys(identity: {
  salonClientId?: string | null;
  clientPhone?: string | null;
}): string[] {
  const keys: string[] = [];
  if (identity.salonClientId) {
    keys.push(`client:${identity.salonClientId}`);
  }
  const normalized = normalizePhone(identity.clientPhone ?? '');
  if (normalized) {
    keys.push(`phone:${normalized}`);
  }
  return keys;
}

export type SmartFitDayContextArgs = {
  technicianId: string;
  weeklySchedule: WeeklySchedule | null;
  override?: ScheduleOverride | null;
  isOnTimeOff?: boolean;
  /** The technician's day appointments (blocked windows incl. buffer fallback). */
  appointments: AppointmentWindow[];
  /** Breaks (`technician_blocked_slot`) already filtered to this date. */
  blockedSlots?: BlockedSlotWindow[];
  /** Salon-wide Google busy windows for the day — shrink-only blocks. */
  googleBusyWindows?: GoogleCalendarBusyWindow[];
  locationId: string | null;
  locationBusinessHours?: BusinessHours;
  /** YYYY-MM-DD in the salon's booking timezone. */
  date: string;
  timeZone: string;
  slotIntervalMinutes: number;
  /** UTC ms of the salon-local midnight (getZonedDayBounds().startOfDay). */
  gridAnchorMs: number;
  nowMs: number;
};

function toMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * Resolve one technician's day into the evaluator's context, or null when the
 * technician has no bookable window that day (time off, day off, closed
 * location, inverted hours) — null simply means "no Smart Fit today".
 *
 * The appointment blocked-end math mirrors `hasBufferedConflict` /
 * `lockTechnicianAndAssertSlotFree` with their zero-buffer fallback, so the
 * evaluator sees exactly the windows the conflict guards enforce.
 */
export function buildSmartFitDayContext(args: SmartFitDayContextArgs): SmartFitDayContext | null {
  // Noon keeps the day-name lookup unambiguous across DST transitions.
  const noon = new Date(args.gridAnchorMs + 12 * 60 * MINUTE_MS);
  const effective = getEffectiveScheduleForWindow({
    startTime: noon,
    weeklySchedule: args.weeklySchedule,
    override: args.override ?? null,
    isOnTimeOff: args.isOnTimeOff ?? false,
  });
  if (!effective.available) {
    return null;
  }

  const timeToMs = (time: string): number =>
    zonedTimeToUtc({ date: args.date, time, timeZone: args.timeZone }).getTime();

  let workStartMs = timeToMs(effective.schedule.start);
  let workEndMs = timeToMs(effective.schedule.end);

  if (args.locationBusinessHours) {
    const hours = args.locationBusinessHours[getDayNameForDate(noon)];
    if (!hours) {
      return null;
    }
    workStartMs = Math.max(workStartMs, timeToMs(hours.open));
    workEndMs = Math.min(workEndMs, timeToMs(hours.close));
  }
  if (workEndMs <= workStartMs) {
    return null;
  }

  const blocks: SmartFitBlock[] = [];

  for (const appointment of args.appointments) {
    const startMs = toMs(appointment.startTime);
    const endMs = toMs(appointment.endTime);
    const blockedMinutes = appointment.blockedDurationMinutes
      ?? (
        (appointment.totalDurationMinutes ?? Math.max(0, (endMs - startMs) / MINUTE_MS))
        + (appointment.bufferMinutes ?? 0)
      );
    const clientKeys = buildSmartFitClientKeys({
      salonClientId: appointment.salonClientId,
      clientPhone: appointment.clientPhone,
    });
    blocks.push({
      id: appointment.id,
      kind: 'appointment',
      startMs,
      endMs: startMs + blockedMinutes * MINUTE_MS,
      ...(clientKeys.length > 0 ? { clientKeys } : {}),
    });
  }

  for (const slot of args.blockedSlots ?? []) {
    const startMs = timeToMs(slot.startTime);
    const endMs = timeToMs(slot.endTime);
    if (endMs <= startMs) {
      continue;
    }
    blocks.push({
      id: `break:${slot.startTime}-${slot.endTime}`,
      kind: 'break',
      startMs,
      endMs,
    });
  }

  (args.googleBusyWindows ?? []).forEach((window, index) => {
    const startMs = toMs(window.startTime);
    const endMs = toMs(window.endTime);
    if (endMs <= startMs) {
      return;
    }
    blocks.push({
      id: `google:${index}`,
      kind: 'google_busy',
      startMs,
      endMs,
    });
  });

  return {
    technicianId: args.technicianId,
    locationId: args.locationId,
    workStartMs,
    workEndMs,
    blocks,
    slotIntervalMinutes: args.slotIntervalMinutes,
    gridAnchorMs: args.gridAnchorMs,
    nowMs: args.nowMs,
  };
}

/**
 * Public per-slot availability annotation. Deliberately minimal: prices and
 * schedule-improvement minutes only — no neighbor ids/kinds, no reasons, no
 * client keys (asserted by test).
 */
export type SmartFitSlotAnnotation = {
  eligible: true;
  discountType: SmartFitDiscountType;
  discountValue: number;
  discountAmountCents: number;
  originalPriceCents: number;
  discountedPriceCents: number;
  qualifyingSides: SmartFitSide[];
  improvementMinutes: number | null;
  consolidatedMinutes: number | null;
};

export function buildSmartFitSlotAnnotation(args: {
  config: ResolvedSmartFitConfig;
  evaluation: SmartFitEvaluation;
  subtotalBeforeDiscountCents: number;
}): SmartFitSlotAnnotation | null {
  if (!args.evaluation.eligible) {
    return null;
  }
  const discountAmountCents = calculateSmartFitDiscountCents(
    args.config,
    args.subtotalBeforeDiscountCents,
  );
  if (discountAmountCents <= 0) {
    return null;
  }
  return {
    eligible: true,
    discountType: args.config.discountType,
    discountValue: args.config.value,
    discountAmountCents,
    originalPriceCents: args.subtotalBeforeDiscountCents,
    discountedPriceCents: Math.max(0, args.subtotalBeforeDiscountCents - discountAmountCents),
    qualifyingSides: [...args.evaluation.qualifyingSides],
    improvementMinutes: args.evaluation.improvementMinutes,
    consolidatedMinutes: args.evaluation.consolidatedMinutes,
  };
}

/**
 * Smart Fit applies to a request only when EVERY requested service is in the
 * configured allowlist (empty list = all services). Multi-service legacy
 * bookings therefore qualify only when the whole basket is eligible.
 */
export function smartFitServiceScopeAllows(
  config: ResolvedSmartFitConfig,
  serviceIds: string[],
): boolean {
  if (serviceIds.length === 0) {
    return false;
  }
  if (config.eligibleServiceIds.length === 0) {
    return true;
  }
  const eligible = new Set(config.eligibleServiceIds);
  return serviceIds.every(id => eligible.has(id));
}
