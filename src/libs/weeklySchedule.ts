import type { WeeklySchedule } from '@/models/Schema';

type LegacyScheduleSource = {
  weeklySchedule?: WeeklySchedule | null;
  workDays?: number[] | null;
  startTime?: string | null;
  endTime?: string | null;
};

const DAY_KEYS: Array<keyof WeeklySchedule> = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export const EMPTY_WEEKLY_SCHEDULE: WeeklySchedule = {
  sunday: null,
  monday: null,
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
};

type ScheduleDay = NonNullable<WeeklySchedule[keyof WeeklySchedule]>;

type LegacyScheduleDay =
  | ScheduleDay
  | { open?: string | null; close?: string | null }
  | { startTime?: string | null; endTime?: string | null }
  | null
  | undefined;

function isTimeString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim());
}

export function normalizeScheduleDay(
  daySchedule?: LegacyScheduleDay,
): ScheduleDay | null {
  if (!daySchedule || typeof daySchedule !== 'object') {
    return null;
  }

  const candidate = daySchedule as {
    start?: unknown;
    end?: unknown;
    open?: unknown;
    close?: unknown;
    startTime?: unknown;
    endTime?: unknown;
  };

  const start = candidate.start ?? candidate.open ?? candidate.startTime;
  const end = candidate.end ?? candidate.close ?? candidate.endTime;

  if (!isTimeString(start) || !isTimeString(end)) {
    return null;
  }

  return {
    start: start.trim(),
    end: end.trim(),
  };
}

export function normalizeWeeklySchedule(
  weeklySchedule?: WeeklySchedule | null,
): WeeklySchedule {
  const normalized: WeeklySchedule = { ...EMPTY_WEEKLY_SCHEDULE };

  if (!weeklySchedule) {
    return normalized;
  }

  for (const dayKey of DAY_KEYS) {
    normalized[dayKey] = normalizeScheduleDay(weeklySchedule[dayKey]) ?? null;
  }

  return normalized;
}

export function hasWorkingHours(
  weeklySchedule?: WeeklySchedule | null,
): boolean {
  const normalized = normalizeWeeklySchedule(weeklySchedule);
  return DAY_KEYS.some(dayKey => {
    const daySchedule = normalized[dayKey];
    return Boolean(daySchedule?.start && daySchedule?.end);
  });
}

export function weeklyScheduleFromLegacyFields(
  workDays?: number[] | null,
  startTime?: string | null,
  endTime?: string | null,
): WeeklySchedule | null {
  if (!workDays?.length || !startTime || !endTime) {
    return null;
  }

  const schedule = normalizeWeeklySchedule();

  for (const dayIndex of workDays) {
    const dayKey = DAY_KEYS[dayIndex];
    if (!dayKey) {
      continue;
    }

    schedule[dayKey] = { start: startTime, end: endTime };
  }

  return hasWorkingHours(schedule) ? schedule : null;
}

export function resolveWeeklySchedule(source?: LegacyScheduleSource | null): WeeklySchedule | null {
  if (!source) {
    return null;
  }

  if (hasWorkingHours(source.weeklySchedule)) {
    return normalizeWeeklySchedule(source.weeklySchedule);
  }

  return weeklyScheduleFromLegacyFields(
    source.workDays,
    source.startTime,
    source.endTime,
  );
}
