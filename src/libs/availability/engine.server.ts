import 'server-only';

import type {
  BookingHoursCeiling,
  LoadedBookingPolicy,
  RequestedService,
  TechnicianCapabilityMode,
} from '@/libs/bookingPolicy';
import { canTechnicianTakeAppointment } from '@/libs/bookingPolicy';
import type { BookingSelectionErrorCode } from '@/libs/bookingQuote';
import type { GoogleCalendarBusyWindow } from '@/libs/googleCalendar';
import { isBusyWindowConflict } from '@/libs/googleCalendar';
import { isZonedTimeMatch, zonedTimeToUtc } from '@/libs/timeZone';
import type { WeeklySchedule } from '@/models/Schema';

import type { DiagnosisCode } from './reasons';
import { TECHNICIAN_DECISION_DIAGNOSIS } from './reasons';

/**
 * A1-2 Piece 1 — the day-availability engine, lifted verbatim out of
 * `GET /api/appointments/availability`.
 *
 * This module owns exactly two things the route used to own inline: the
 * technician preflight, and the slot loop. Everything the route decides ABOVE
 * the loop stays in the route — request parsing, the salon/status guards, the
 * client-session / manage-token ownership proof, Smart Fit resolution, the
 * Google Calendar fetch and its 503 mapping, and the response envelope. The
 * engine takes only PRE-RESOLVED inputs, so it can be called a second time by
 * a read-only diagnostic (the owner assistant's `diagnose_day_availability`)
 * without that caller inheriting the public route's authentication surface.
 *
 * Two hard rules govern this file:
 *
 *  1. BYTE PARITY for the pinned legacy fixtures. With `explain: false`
 *     the returned slot objects preserve the original route's shape — same
 *     iteration order, same early-`continue` decisions, same rounding, same
 *     key order (`time`, `startTime`, any annotation, `availability`), because
 *     `JSON.stringify` is key-order sensitive.
 *     `route.parity.test.ts` pins this against committed snapshots. Salon
 *     timezone and daylight-saving corrections have dedicated tests; explain
 *     mode must produce the same slots as ordinary mode for every input.
 *
 *  2. NO IDENTITY. The engine never learns who is asking. It must not import
 *     `getClientSession`, `verifyAppointmentAccessToken`,
 *     `resolveAutomaticBookingDiscount`, `buildSmartFitClientKeys` or anything
 *     under `src/libs/smartFit*` — Smart Fit reaches the loop only through the
 *     opaque `annotateSlot` callback the route supplies.
 *     `engine.imports.test.ts` enforces this by module resolution.
 */

export type AvailabilityTechnician = {
  id: string;
  weeklySchedule: WeeklySchedule | null;
  enabledServiceIds?: string[];
  serviceIds?: string[];
  specialties?: string[] | null;
  primaryLocationId?: string | null;
};

export type DayAvailabilityPreflight<TTechnician> =
  | { ok: true; technicians: TTechnician[] }
  | { ok: false; code: 'no_technicians' | 'no_compatible_technicians' };

/**
 * The pure decision behind the route's two early "there is nobody to book
 * with" responses. The route still builds the `Response` bodies (they carry
 * echoed request fields the engine has no business knowing).
 *
 * `compatibility` stays a caller-supplied predicate: whether a technician can
 * perform the requested services depends on the SELECTION MODE (base-service
 * vs legacy `serviceIds`), which is a request-parsing concern.
 */
export function preflightDayAvailability<TTechnician>(args: {
  technicians: TTechnician[];
  compatibility: (technician: TTechnician) => boolean;
}): DayAvailabilityPreflight<TTechnician> {
  if (args.technicians.length === 0) {
    return { ok: false, code: 'no_technicians' };
  }

  const compatibleTechnicians = args.technicians.filter(technician => args.compatibility(technician));

  if (compatibleTechnicians.length === 0) {
    return { ok: false, code: 'no_compatible_technicians' };
  }

  return { ok: true, technicians: compatibleTechnicians };
}

/**
 * A slot before the final `availability` verdict is stamped on it. The index
 * signature is what keeps the engine ignorant of Smart Fit: `annotateSlot` may
 * add whatever field it owns (today: `smartFit`), and because it is added to
 * the draft BEFORE the verdict is spread on, the serialized key order is
 * `time`, `startTime`, <annotation>, `availability` — exactly as before.
 */
export type DaySlotDraft = {
  time: string;
  startTime: string;
  [annotation: string]: unknown;
};

export type DaySlot = DaySlotDraft & {
  availability: 'available' | 'schedule_conflict';
};

export type AnnotateSlotContext = {
  /** Mutable draft. Mutate it, or return a replacement. */
  slot: DaySlotDraft;
  startTime: Date;
  /** Start + visible duration + buffer — the window the booking would occupy. */
  endTime: Date;
  technicians: AvailabilityTechnician[];
  /** The SAME decision-pass predicate the loop just used, for per-technician annotation. */
  isTechnicianAvailable: (technician: AvailabilityTechnician) => boolean;
};

export type AnnotateSlot = (context: AnnotateSlotContext) => DaySlotDraft;

export type ComputeDaySlotsInput = {
  /** `YYYY-MM-DD` in `timeZone` — the grid every slot start is resolved against. */
  date: string;
  technicians: AvailabilityTechnician[];
  requestedServices: RequestedService[];
  capabilityMode: TechnicianCapabilityMode;
  bookingPolicy: LoadedBookingPolicy;
  googleBusyWindows: GoogleCalendarBusyWindow[];
  hoursCeiling: BookingHoursCeiling;
  effectiveLocationId: string | null;
  visibleDurationMinutes: number;
  bufferMinutes: number;
  slotIntervalMinutes: number;
  minimumNoticeMinutes: number;
  timeZone: string;
  /** Wall clock for the minimum-notice floor. The route passes `new Date(Date.now())`. */
  now: Date;
  excludedAppointmentId: string | null;
};

export type ComputeDaySlotsOptions = {
  explain?: boolean;
  annotateSlot?: AnnotateSlot;
};

/**
 * One aggregated reason the loop refused slots.
 *
 * `count` = slots refused for this reason (per technician where applicable).
 * Slots that were never in play are not counted: a technician's inability to
 * work an hour is charged only when NO technician could take that slot, and
 * the minimum-notice floor is charged only for slots that would otherwise
 * have been offered. The decision pass's `time_conflict` is per technician by
 * the rule it always had — it can only ever reach slots that were visible.
 * `count` is always a SLOT count — never a count of appointments, events or
 * clients, and never any identifying detail about them.
 *
 * `technicianId` is present only for per-technician causes. `detail` is for
 * CALLERS above the loop: it carries the specific `BookingSelectionErrorCode`
 * behind a `service_not_bookable` cause (see `BOOKING_SELECTION_DIAGNOSIS`).
 * The engine itself never sets it.
 */
export type AvailabilityCause = {
  code: DiagnosisCode;
  count: number;
  technicianId?: string;
  detail?: BookingSelectionErrorCode;
};

/**
 * The aggregate `explain: true` adds. Every `count` inside `causes` means
 * "slots refused for this reason (per technician where applicable)", so the
 * numbers can be read against `bookableSlotCount` without double-counting a
 * slot that some other technician could still take.
 */
export type DayAvailabilityExplanation = {
  bookableSlotCount: number;
  /** The earliest bookable slot's grid label (e.g. `"14:30"`), or `null`. */
  firstBookable: string | null;
  causes: AvailabilityCause[];
};

export type DaySlotsResult = {
  visibleSlots: string[];
  slots: DaySlot[];
  bookedSlots: string[];
};

export type ExplainedDaySlotsResult = DaySlotsResult & {
  explanation: DayAvailabilityExplanation;
};

function getAllSlots(intervalMinutes: number): string[] {
  const slots: string[] = [];

  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += intervalMinutes) {
      slots.push(`${hour}:${minute.toString().padStart(2, '0')}`);
    }
  }

  return slots;
}

/**
 * Insertion-ordered tally. Deterministic because the loop's iteration order is
 * deterministic: causes come out in the order the day first hit them.
 */
function createCauseTally() {
  const byKey = new Map<string, AvailabilityCause>();

  return {
    record(code: DiagnosisCode, technicianId?: string) {
      const key = technicianId === undefined ? code : `${code}\u0000${technicianId}`;
      const existing = byKey.get(key);

      if (existing) {
        existing.count += 1;
        return;
      }

      byKey.set(
        key,
        technicianId === undefined ? { code, count: 1 } : { code, count: 1, technicianId },
      );
    },
    toArray(): AvailabilityCause[] {
      return Array.from(byKey.values());
    },
  };
}

export function computeDaySlots(
  input: ComputeDaySlotsInput,
  options: ComputeDaySlotsOptions & { explain: true },
): ExplainedDaySlotsResult;
export function computeDaySlots(
  input: ComputeDaySlotsInput,
  options?: ComputeDaySlotsOptions,
): DaySlotsResult;
/**
 * The slot loop, unchanged.
 *
 * Two passes per slot, exactly as the route ran them:
 *
 *   - the VISIBLE pass asks whether any technician could take the window at
 *     all, ignoring existing appointments (`existingAppointments: []`). A slot
 *     no technician can even show is skipped entirely — it never reaches
 *     `visibleSlots` or `slots`.
 *   - the DECISION pass repeats the question WITH that technician's
 *     appointments. A visible slot that nobody can actually take is still
 *     listed, marked `schedule_conflict`, and counted in `bookedSlots`.
 *
 * Both passes pass `bufferMinutes: 0` because the requested buffer is already
 * baked into `blockedEndTime`; passing it again would double-count it.
 *
 * With `explain: true` the loop additionally tallies the typed `reason` both
 * passes normally discard, so that every `count` means SLOTS REFUSED for that
 * reason. Three explain-only differences, none of which can change the slot
 * output because `canTechnicianTakeAppointment` is pure:
 *
 *   - the per-technician `.some()` short-circuit becomes a full iteration, so
 *     every technician's reason is seen;
 *   - the visible pass's per-technician reasons are held back until the slot
 *     is known to be refused OUTRIGHT. A slot some colleague can still take
 *     was not lost, so nobody's refusal is charged for it;
 *   - a slot inside the minimum-notice window still runs the visible pass, to
 *     find out whether the notice floor is what cost the day that slot. It is
 *     charged to `min_notice` only if it would otherwise have been visible;
 *     otherwise the visible pass's own reasons are charged, exactly as they
 *     would have been on any other closed hour.
 */
export function computeDaySlots(
  input: ComputeDaySlotsInput,
  options: ComputeDaySlotsOptions = {},
): DaySlotsResult | ExplainedDaySlotsResult {
  const {
    date,
    technicians,
    requestedServices,
    capabilityMode,
    bookingPolicy,
    googleBusyWindows,
    hoursCeiling,
    effectiveLocationId,
    visibleDurationMinutes,
    bufferMinutes,
    slotIntervalMinutes,
    minimumNoticeMinutes,
    timeZone,
    now,
    excludedAppointmentId,
  } = input;
  const { annotateSlot } = options;
  const causes = options.explain === true ? createCauseTally() : null;

  const allSlots = getAllSlots(slotIntervalMinutes);
  const visibleSlots: string[] = [];
  const slots: DaySlotDraft[] = [];
  const blockedSlots = new Set<string>();
  const minimumStartTime = new Date(
    now.getTime() + minimumNoticeMinutes * 60 * 1000,
  );

  for (const slot of allSlots) {
    const startTime = zonedTimeToUtc({ date, time: slot, timeZone });
    if (!isZonedTimeMatch(startTime, { date, time: slot, timeZone })) {
      continue;
    }
    const insideNoticeWindow = startTime < minimumStartTime;

    // Non-explain: the notice floor short-circuits before anything else is
    // computed, exactly as the route did. Explain mode falls through to the
    // visible pass below purely to decide WHICH reason owns the lost slot.
    if (insideNoticeWindow && !causes) {
      continue;
    }

    const blockedEndTime = new Date(startTime.getTime() + (visibleDurationMinutes + bufferMinutes) * 60 * 1000);

    const visibleDecisionFor = (tech: AvailabilityTechnician) => canTechnicianTakeAppointment({
      timeZone,
      startTime,
      endTime: blockedEndTime,
      weeklySchedule: tech.weeklySchedule as WeeklySchedule | null,
      override: bookingPolicy.overridesByTechnician.get(tech.id),
      isOnTimeOff: bookingPolicy.timeOffTechnicianIds.has(tech.id),
      blockedSlots: bookingPolicy.blockedSlotsByTechnician.get(tech.id) ?? [],
      requestedServices,
      capabilityMode,
      enabledServiceIds: tech.enabledServiceIds ?? [],
      specialties: tech.specialties ?? [],
      locationId: effectiveLocationId,
      primaryLocationId: tech.primaryLocationId ?? null,
      locationBusinessHours: hoursCeiling.businessHours,
      existingAppointments: [],
      excludedAppointmentId,
      bufferMinutes: 0,
    });

    let anyTechVisible = false;
    /** Explain-only: charged to the tally only if this slot is refused outright. */
    const pendingVisibleCauses: Array<{ code: DiagnosisCode; technicianId: string }> = [];
    const chargePendingVisibleCauses = () => {
      for (const pending of pendingVisibleCauses) {
        causes?.record(pending.code, pending.technicianId);
      }
    };

    if (causes) {
      for (const tech of technicians) {
        const visibleDecision = visibleDecisionFor(tech);
        if (visibleDecision.available) {
          anyTechVisible = true;
        } else {
          pendingVisibleCauses.push({
            code: TECHNICIAN_DECISION_DIAGNOSIS[visibleDecision.reason],
            technicianId: tech.id,
          });
        }
      }
    } else {
      anyTechVisible = technicians.some(tech => visibleDecisionFor(tech).available);
    }

    if (insideNoticeWindow) {
      // Explain-only branch (non-explain already `continue`d above). The floor
      // only gets the blame for a slot it alone took away.
      if (anyTechVisible) {
        causes?.record('min_notice');
      } else {
        chargePendingVisibleCauses();
      }

      continue;
    }

    if (!anyTechVisible) {
      chargePendingVisibleCauses();
      continue;
    }

    visibleSlots.push(slot);
    const slotEntry: DaySlotDraft = {
      time: slot,
      startTime: startTime.toISOString(),
    };
    const slotIndex = slots.push(slotEntry) - 1;

    if (isBusyWindowConflict(startTime, blockedEndTime, googleBusyWindows)) {
      blockedSlots.add(slot);
      causes?.record('google_busy');
      continue;
    }

    const decisionForTechnician = (tech: AvailabilityTechnician) => canTechnicianTakeAppointment({
      timeZone,
      startTime,
      endTime: blockedEndTime,
      weeklySchedule: tech.weeklySchedule as WeeklySchedule | null,
      override: bookingPolicy.overridesByTechnician.get(tech.id),
      isOnTimeOff: bookingPolicy.timeOffTechnicianIds.has(tech.id),
      blockedSlots: bookingPolicy.blockedSlotsByTechnician.get(tech.id) ?? [],
      requestedServices,
      capabilityMode,
      enabledServiceIds: tech.enabledServiceIds ?? [],
      specialties: tech.specialties ?? [],
      locationId: effectiveLocationId,
      primaryLocationId: tech.primaryLocationId ?? null,
      locationBusinessHours: hoursCeiling.businessHours,
      existingAppointments: bookingPolicy.appointmentsByTechnician.get(tech.id) ?? [],
      excludedAppointmentId,
      bufferMinutes: 0,
    });

    const isTechAvailableAtSlot = (tech: AvailabilityTechnician): boolean =>
      decisionForTechnician(tech).available;

    let anyTechAvailable = false;
    if (causes) {
      for (const tech of technicians) {
        const decision = decisionForTechnician(tech);
        if (decision.available) {
          anyTechAvailable = true;
        } else if (decision.reason === 'time_conflict') {
          // The ONLY refusal this pass can add over the visible pass: the two
          // differ solely in `existingAppointments`. Every other reason is one
          // the visible pass already reached for this same technician — and
          // deliberately dropped, because the slot IS visible.
          causes.record('time_conflict', tech.id);
        }
      }
    } else {
      anyTechAvailable = technicians.some(isTechAvailableAtSlot);
    }

    if (!anyTechAvailable) {
      blockedSlots.add(slot);
      continue;
    }

    if (annotateSlot) {
      const annotated = annotateSlot({
        slot: slotEntry,
        startTime,
        endTime: blockedEndTime,
        technicians,
        isTechnicianAvailable: isTechAvailableAtSlot,
      });

      if (annotated !== slotEntry) {
        slots[slotIndex] = annotated;
      }
    }
  }

  const bookedSlots = Array.from(blockedSlots);
  const result: DaySlotsResult = {
    visibleSlots,
    slots: slots.map(slot => ({
      ...slot,
      availability: blockedSlots.has(slot.time) ? 'schedule_conflict' : 'available',
    })),
    bookedSlots,
  };

  if (!causes) {
    return result;
  }

  const bookable = result.slots.filter(slot => slot.availability === 'available');

  return {
    ...result,
    explanation: {
      bookableSlotCount: bookable.length,
      firstBookable: bookable[0]?.time ?? null,
      causes: causes.toArray(),
    },
  };
}
