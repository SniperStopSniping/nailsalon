/**
 * Calendar availability overlay — the owner calendar's read model of the same
 * authorities the booking engine enforces.
 *
 * The engine (`bookingPolicy.ts`) refuses a booking for four reasons the owner
 * calendar used to render nowhere: the salon is closed that day, the technician
 * does not work it, the technician is on approved time off, and a blocked slot
 * covers the window. This module turns the raw rows those authorities live in
 * (`salon_location.business_hours` → `salon.business_hours`,
 * `technician.weekly_schedule`, `technician_time_off`,
 * `technician_blocked_slot`) into day-shaped facts the calendar can draw.
 *
 * Everything here is pure and date-key based (`YYYY-MM-DD` in the salon's
 * timezone), so the same helper serves the API payload, the month/week grid,
 * the day grid bounds and the create-form time picker without any of them
 * re-deriving the rules.
 */

import type { BusinessHours } from '@/libs/bookingPolicy';
import { normalizeScheduleDay } from '@/libs/weeklySchedule';
import type { WeeklySchedule } from '@/models/Schema';

export const CALENDAR_DAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export type CalendarDayKey = (typeof CALENDAR_DAY_KEYS)[number];

export type CalendarScheduleTechnician = {
  id: string;
  name: string;
  weeklySchedule: WeeklySchedule | null;
};

export type CalendarTimeOff = {
  id: string;
  technicianId: string;
  /** `YYYY-MM-DD`, inclusive. */
  startDate: string;
  /** `YYYY-MM-DD`, inclusive. */
  endDate: string;
  reason: string | null;
};

export type CalendarBlockedSlot = {
  id: string;
  technicianId: string;
  /** 0 = Sunday … 6 = Saturday; null for a one-off block. */
  dayOfWeek: number | null;
  startTime: string;
  endTime: string;
  /** `YYYY-MM-DD` for a one-off block, else null. */
  specificDate: string | null;
  label: string | null;
  isRecurring: boolean;
};

export type CalendarSchedule = {
  businessHours: BusinessHours;
  /** Which record the hours came from — `none` means no hours are published. */
  businessHoursSource: 'location' | 'salon' | 'none';
  technicians: CalendarScheduleTechnician[];
  timeOff: CalendarTimeOff[];
  blockedSlots: CalendarBlockedSlot[];
};

export type CalendarBlockedWindow = {
  id: string;
  technicianId: string;
  technicianName: string | null;
  startMinutes: number;
  endMinutes: number;
  label: string | null;
};

export type CalendarDayAvailability = {
  dateKey: string;
  /** True only when hours are published AND the salon is shut that weekday. */
  closed: boolean;
  /** Salon opening window in minutes from midnight, when published. */
  openMinutes: number | null;
  closeMinutes: number | null;
  /** Technicians with approved time off covering the day. */
  techniciansOff: Array<{ id: string; name: string; reason: string | null }>;
  /** Technicians who simply do not work that weekday. */
  technicianIdsNotWorking: string[];
  /** Technicians working the day, with their own window. */
  working: Array<{ id: string; name: string; startMinutes: number; endMinutes: number }>;
  blockedWindows: CalendarBlockedWindow[];
};

export const EMPTY_CALENDAR_SCHEDULE: CalendarSchedule = {
  businessHours: null,
  businessHoursSource: 'none',
  technicians: [],
  timeOff: [],
  blockedSlots: [],
};

/** `"09:30"` → 570. Returns null for anything that is not `H:MM`/`HH:MM`. */
export function parseTimeToMinutes(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 24 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

/** 570 → `"09:30"` (the shape the create form and the API both speak). */
export function formatMinutesAsTimeValue(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/** 780 → `"1:00 PM"`. */
export function formatMinutesLabel(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const hours24 = Math.floor(clamped / 60);
  const mins = clamped % 60;
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(mins).padStart(2, '0')} ${period}`;
}

/**
 * Weekday of a `YYYY-MM-DD` key, read from the key itself rather than from a
 * local `Date`, so a browser in another timezone never shifts the day.
 */
export function getDayIndexFromDateKey(dateKey: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return null;
  }
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.getUTCDay();
}

export function getDayKeyFromDateKey(dateKey: string): CalendarDayKey | null {
  const index = getDayIndexFromDateKey(dateKey);
  return index === null ? null : CALENDAR_DAY_KEYS[index]!;
}

function isDateKeyWithin(dateKey: string, startDate: string, endDate: string): boolean {
  // ISO date keys compare correctly as strings.
  return dateKey >= startDate && dateKey <= endDate;
}

/** The salon's published window for a date, or null when it publishes none. */
export function getBusinessHoursForDate(
  businessHours: BusinessHours,
  dateKey: string,
): { openMinutes: number; closeMinutes: number } | null {
  const dayKey = getDayKeyFromDateKey(dateKey);
  if (!businessHours || !dayKey) {
    return null;
  }
  const day = businessHours[dayKey];
  const openMinutes = parseTimeToMinutes(day?.open);
  const closeMinutes = parseTimeToMinutes(day?.close);
  if (openMinutes === null || closeMinutes === null || closeMinutes <= openMinutes) {
    return null;
  }
  return { openMinutes, closeMinutes };
}

/**
 * Whether the salon is closed on a date.
 *
 * Deliberately conservative: with no hours published anywhere the answer is
 * "not closed" (unknown), never a false "Closed" badge on every day.
 */
export function isSalonClosedOnDate(schedule: CalendarSchedule, dateKey: string): boolean {
  if (schedule.businessHoursSource === 'none' || !schedule.businessHours) {
    return false;
  }
  return getBusinessHoursForDate(schedule.businessHours, dateKey) === null;
}

function technicianScheduleForDate(
  technician: CalendarScheduleTechnician,
  dateKey: string,
): { startMinutes: number; endMinutes: number } | null {
  const dayKey = getDayKeyFromDateKey(dateKey);
  if (!dayKey) {
    return null;
  }
  const day = normalizeScheduleDay(technician.weeklySchedule?.[dayKey]);
  const startMinutes = parseTimeToMinutes(day?.start);
  const endMinutes = parseTimeToMinutes(day?.end);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return null;
  }
  return { startMinutes, endMinutes };
}

function blockedSlotAppliesToDate(slot: CalendarBlockedSlot, dateKey: string): boolean {
  if (slot.specificDate) {
    return slot.specificDate === dateKey;
  }
  if (slot.dayOfWeek === null || slot.dayOfWeek === undefined) {
    return false;
  }
  return getDayIndexFromDateKey(dateKey) === slot.dayOfWeek;
}

/**
 * Everything the calendar needs to draw one day: closure, who is off, who is
 * working and when, and the blocked windows inside it.
 */
export function getDayAvailability(
  schedule: CalendarSchedule,
  dateKey: string,
  options: { technicianId?: string | null } = {},
): CalendarDayAvailability {
  const technicianFilter = options.technicianId ?? null;
  const technicians = technicianFilter
    ? schedule.technicians.filter(technician => technician.id === technicianFilter)
    : schedule.technicians;
  const technicianNames = new Map(schedule.technicians.map(technician => [technician.id, technician.name]));

  const hours = schedule.businessHours
    ? getBusinessHoursForDate(schedule.businessHours, dateKey)
    : null;

  const offById = new Map<string, string | null>();
  for (const entry of schedule.timeOff) {
    if (isDateKeyWithin(dateKey, entry.startDate, entry.endDate)) {
      offById.set(entry.technicianId, entry.reason ?? null);
    }
  }

  const techniciansOff: CalendarDayAvailability['techniciansOff'] = [];
  const technicianIdsNotWorking: string[] = [];
  const working: CalendarDayAvailability['working'] = [];

  for (const technician of technicians) {
    if (offById.has(technician.id)) {
      techniciansOff.push({
        id: technician.id,
        name: technician.name,
        reason: offById.get(technician.id) ?? null,
      });
      continue;
    }
    const window = technicianScheduleForDate(technician, dateKey);
    if (!window) {
      technicianIdsNotWorking.push(technician.id);
      continue;
    }
    working.push({ id: technician.id, name: technician.name, ...window });
  }

  const blockedWindows: CalendarBlockedWindow[] = [];
  for (const slot of schedule.blockedSlots) {
    if (technicianFilter && slot.technicianId !== technicianFilter) {
      continue;
    }
    if (!blockedSlotAppliesToDate(slot, dateKey)) {
      continue;
    }
    // A block on a day the technician is off or does not work adds nothing.
    if (offById.has(slot.technicianId)) {
      continue;
    }
    const startMinutes = parseTimeToMinutes(slot.startTime);
    const endMinutes = parseTimeToMinutes(slot.endTime);
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
      continue;
    }
    blockedWindows.push({
      id: slot.id,
      technicianId: slot.technicianId,
      technicianName: technicianNames.get(slot.technicianId) ?? null,
      startMinutes,
      endMinutes,
      label: slot.label,
    });
  }
  blockedWindows.sort((left, right) => left.startMinutes - right.startMinutes);

  return {
    dateKey,
    closed: isSalonClosedOnDate(schedule, dateKey),
    openMinutes: hours?.openMinutes ?? null,
    closeMinutes: hours?.closeMinutes ?? null,
    techniciansOff,
    technicianIdsNotWorking,
    working,
    blockedWindows,
  };
}

export type CalendarDayBounds = { startHour: number; endHour: number };

export const DEFAULT_DAY_BOUNDS: CalendarDayBounds = { startHour: 8, endHour: 20 };

/**
 * Hour bounds for a day grid: the earliest technician start to the latest end
 * for that weekday, widened by the salon's own opening window and by any
 * appointment that already exists outside both (an early or late booking must
 * never be drawn above or below the grid — the old fixed 08:00–20:00 clipped
 * it, source-map I-019).
 */
export function resolveDayGridBounds(args: {
  schedule?: CalendarSchedule | null;
  dateKey?: string | null;
  /** Minutes from midnight for appointments already on the day. */
  appointmentWindows?: Array<{ startMinutes: number; endMinutes: number }>;
  fallback?: CalendarDayBounds;
}): CalendarDayBounds {
  const fallback = args.fallback ?? DEFAULT_DAY_BOUNDS;
  const bounds: number[] = [];

  if (args.schedule && args.dateKey) {
    const availability = getDayAvailability(args.schedule, args.dateKey);
    for (const window of availability.working) {
      bounds.push(window.startMinutes, window.endMinutes);
    }
    if (availability.openMinutes !== null && availability.closeMinutes !== null) {
      bounds.push(availability.openMinutes, availability.closeMinutes);
    }
    for (const window of availability.blockedWindows) {
      bounds.push(window.startMinutes, window.endMinutes);
    }
  }

  let startHour = bounds.length > 0
    ? Math.floor(Math.min(...bounds) / 60)
    : fallback.startHour;
  let endHour = bounds.length > 0
    ? Math.ceil(Math.max(...bounds) / 60)
    : fallback.endHour;

  for (const window of args.appointmentWindows ?? []) {
    startHour = Math.min(startHour, Math.floor(window.startMinutes / 60));
    endHour = Math.max(endHour, Math.ceil(window.endMinutes / 60));
  }

  startHour = Math.max(0, Math.min(23, startHour));
  endHour = Math.min(24, Math.max(startHour + 1, endHour));

  return { startHour, endHour };
}

/**
 * Start times the create form may offer.
 *
 * With a technician selected the range is that technician's own window for the
 * chosen day; with "any technician" it is the union of everyone's, so the
 * picker never omits the last bookable hour of the busiest technician's day and
 * never offers a time nobody works (AG-w2-calendar-writes-09).
 */
export function buildTimePickerSlots(args: {
  schedule?: CalendarSchedule | null;
  dateKey?: string | null;
  technicianId?: string | null;
  stepMinutes?: number;
  /** Always kept in the list so a prefilled time never disappears. */
  alwaysInclude?: string | null;
  fallback?: { startHour: number; endHour: number };
}): string[] {
  const step = args.stepMinutes && args.stepMinutes > 0 ? args.stepMinutes : 30;
  const fallback = args.fallback ?? DEFAULT_DAY_BOUNDS;

  const ranges: Array<{ startMinutes: number; endMinutes: number }> = [];
  if (args.schedule && args.dateKey) {
    const availability = getDayAvailability(args.schedule, args.dateKey, {
      technicianId: args.technicianId ?? null,
    });
    const { openMinutes, closeMinutes } = availability;
    for (const window of availability.working) {
      const startMinutes = openMinutes === null ? window.startMinutes : Math.max(window.startMinutes, openMinutes);
      const endMinutes = closeMinutes === null ? window.endMinutes : Math.min(window.endMinutes, closeMinutes);
      if (endMinutes > startMinutes) {
        ranges.push({ startMinutes, endMinutes });
      }
    }
    // Nobody works the day (day off, time off, or a salon with no staff
    // schedules yet): fall back to the salon's own opening window rather than
    // an arbitrary 08:00–20:00, and only then to the fixed fallback.
    if (ranges.length === 0 && openMinutes !== null && closeMinutes !== null) {
      ranges.push({ startMinutes: openMinutes, endMinutes: closeMinutes });
    }
  }

  const values = new Set<string>();
  if (ranges.length === 0) {
    for (let minutes = fallback.startHour * 60; minutes <= fallback.endHour * 60; minutes += step) {
      values.add(formatMinutesAsTimeValue(minutes));
    }
  } else {
    for (const range of ranges) {
      const first = Math.ceil(range.startMinutes / step) * step;
      for (let minutes = first; minutes <= range.endMinutes; minutes += step) {
        values.add(formatMinutesAsTimeValue(minutes));
      }
    }
  }

  if (args.alwaysInclude && parseTimeToMinutes(args.alwaysInclude) !== null) {
    values.add(args.alwaysInclude);
  }

  return [...values].sort();
}
