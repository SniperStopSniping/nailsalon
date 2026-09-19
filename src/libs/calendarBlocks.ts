import { z } from 'zod';

import { getDateKeyInTimeZone, getTimeKeyInTimeZone, zonedTimeToUtc } from '@/libs/timeZone';

export const calendarBlockInput = z.object({
  id: z.string().uuid(),
  technicianId: z.string().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  label: z.string().trim().max(120).default(''),
  version: z.string().datetime().optional(),
}).strict();

/** Exact salon-local date/time, with invalid dates and DST gaps refused. */
export function resolveCalendarBlockWindow(input: z.infer<typeof calendarBlockInput>, timeZone: string) {
  const startsAt = zonedTimeToUtc({ date: input.date, time: input.startTime, timeZone });
  const endsAt = zonedTimeToUtc({ date: input.date, time: input.endTime, timeZone });
  const valid = (value: Date, time: string) => Number.isFinite(value.getTime())
    && getDateKeyInTimeZone(value, timeZone) === input.date
    && getTimeKeyInTimeZone(value, timeZone) === time;
  if (!valid(startsAt, input.startTime) || !valid(endsAt, input.endTime) || endsAt <= startsAt) {
    throw new Error('Choose a valid start and later end time on the same day.');
  }
  // On the fall-back day the same wall time can name two different instants.
  // Require a different time rather than silently leaving one occurrence open.
  const ambiguous = (value: Date, time: string) => [-120, -60, -30, 30, 60, 120].some(minutes => valid(new Date(value.getTime() + minutes * 60000), time));
  if (ambiguous(startsAt, input.startTime) || ambiguous(endsAt, input.endTime)) {
    throw new Error('This time occurs twice because the clocks change. Choose a time outside that repeated hour.');
  }
  return { startsAt, endsAt };
}
