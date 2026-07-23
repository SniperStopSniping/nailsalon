import {
  DEFAULT_BOOKING_TIME_ZONE,
  getDateKeyInTimeZone,
  getZonedDayBounds,
  zonedTimeToUtc,
} from '@/libs/timeZone';

export type AnalyticsDateRange = {
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
};

const MILLISECONDS_PER_DAY = 86_400_000;

function parseDateKey(key: string): {
  year: number;
  month: number;
  day: number;
} {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  return { year, month, day };
}

function noonUtcForDateKey(key: string): Date {
  const { year, month, day } = parseDateKey(key);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function keyOf(noon: Date): string {
  return noon.toISOString().slice(0, 10);
}

function addDays(noon: Date, days: number): Date {
  return new Date(noon.getTime() + days * MILLISECONDS_PER_DAY);
}

function monthKey(year: number, monthIndex: number): string {
  return keyOf(new Date(Date.UTC(year, monthIndex, 1, 12)));
}

function boundary(key: string, timeZone: string | null | undefined): Date {
  return getZonedDayBounds(key, timeZone).startOfDay;
}

function getLocalClockParts(value: Date, timeZone: string | null | undefined): {
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone ?? DEFAULT_BOOKING_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find(candidate => candidate.type === type)?.value ?? 0);

  return {
    hour: part('hour') === 24 ? 0 : part('hour'),
    minute: part('minute'),
    second: part('second'),
  };
}

function localDateTimeToUtc(
  dateKey: string,
  clock: ReturnType<typeof getLocalClockParts>,
  milliseconds: number,
  timeZone: string | null | undefined,
): Date {
  const value = zonedTimeToUtc({
    date: dateKey,
    time: [
      String(clock.hour).padStart(2, '0'),
      String(clock.minute).padStart(2, '0'),
      String(clock.second).padStart(2, '0'),
    ].join(':'),
    timeZone,
  });
  value.setUTCMilliseconds(milliseconds);
  return value;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
}

function shiftedComparisonDateKey(period: string, anchorKey: string): string {
  const anchorNoonUtc = noonUtcForDateKey(anchorKey);
  const { year, month, day } = parseDateKey(anchorKey);

  switch (period) {
    case 'weekly':
      return keyOf(addDays(anchorNoonUtc, -7));
    case 'monthly': {
      const previousMonthStart = new Date(Date.UTC(year, month - 2, 1, 12));
      const previousYear = previousMonthStart.getUTCFullYear();
      const previousMonth = previousMonthStart.getUTCMonth() + 1;
      const previousDay = Math.min(day, daysInMonth(previousYear, previousMonth));
      return keyOf(new Date(Date.UTC(previousYear, previousMonth - 1, previousDay, 12)));
    }
    case 'yearly': {
      const previousYear = year - 1;
      const previousDay = Math.min(day, daysInMonth(previousYear, month));
      return keyOf(new Date(Date.UTC(previousYear, month - 1, previousDay, 12)));
    }
    case 'daily':
    default:
      return keyOf(addDays(anchorNoonUtc, -1));
  }
}

/**
 * Calculate analytics date ranges for the requested period, anchored to the
 * SALON's timezone (Prompt 9 audit fix — the dashboard previously used the
 * server's local timezone, which shifted day/week/month edges for any salon
 * whose timezone differed from the deployment region; Smart Fit reporting
 * already used salon-tz bounds, so the two revenue surfaces disagreed on
 * day-edge rows).
 *
 * Calendar arithmetic runs on UTC-noon anchors (immune to DST edge cases);
 * each resulting day KEY is then converted to its real UTC boundary in the
 * salon timezone via getZonedDayBounds.
 *
 * @param period - 'daily' | 'weekly' | 'monthly' | 'yearly'
 * @param timeZone - The salon's IANA timezone (from settings.booking.timezone)
 * @param anchor - Optional anchor date key (YYYY-MM-DD, salon-local). If not
 *                 provided, "today" in the salon timezone is used.
 */
export function getAnalyticsDateRange(
  period: string,
  timeZone: string | null | undefined,
  anchor?: string,
): AnalyticsDateRange {
  const anchorKey = anchor ?? getDateKeyInTimeZone(new Date(), timeZone);
  const { year: anchorYear, month: anchorMonth } = parseDateKey(anchorKey);
  const anchorNoonUtc = noonUtcForDateKey(anchorKey);

  let startKey: string;
  let endKey: string;
  let previousStartKey: string;

  switch (period) {
    case 'weekly': {
      // ISO/business week: Monday through Sunday. JavaScript's Sunday=0
      // representation is shifted so Monday=0 before finding the boundary.
      const daysSinceMonday = (anchorNoonUtc.getUTCDay() + 6) % 7;
      const weekStartNoon = addDays(anchorNoonUtc, -daysSinceMonday);
      startKey = keyOf(weekStartNoon);
      endKey = keyOf(addDays(weekStartNoon, 7));
      previousStartKey = keyOf(addDays(weekStartNoon, -7));
      break;
    }
    case 'monthly': {
      startKey = monthKey(anchorYear, anchorMonth - 1);
      endKey = monthKey(anchorYear, anchorMonth);
      previousStartKey = monthKey(anchorYear, anchorMonth - 2);
      break;
    }
    case 'yearly': {
      startKey = monthKey(anchorYear, 0);
      endKey = monthKey(anchorYear + 1, 0);
      previousStartKey = monthKey(anchorYear - 1, 0);
      break;
    }
    case 'daily':
    default: {
      startKey = anchorKey;
      endKey = keyOf(addDays(anchorNoonUtc, 1));
      previousStartKey = keyOf(addDays(anchorNoonUtc, -1));
      break;
    }
  }

  return {
    start: boundary(startKey, timeZone),
    end: boundary(endKey, timeZone),
    previousStart: boundary(previousStartKey, timeZone),
    // The previous period always ends exactly where the current one starts.
    previousEnd: boundary(startKey, timeZone),
  };
}

/**
 * Return a current, partial reporting period plus a fair comparison period
 * ending at the same salon-local clock position.
 *
 * `getAnalyticsDateRange` intentionally continues to return complete calendar
 * periods for historical reporting. Current dashboards should opt into this
 * helper so a partial day/week/month is never compared with a complete prior
 * period.
 */
export function getAnalyticsToDateRange(
  period: string,
  timeZone: string | null | undefined,
  now: Date = new Date(),
): AnalyticsDateRange {
  const anchorKey = getDateKeyInTimeZone(now, timeZone);
  const fullRange = getAnalyticsDateRange(period, timeZone, anchorKey);
  const comparisonDateKey = shiftedComparisonDateKey(period, anchorKey);
  const clock = getLocalClockParts(now, timeZone);
  const { day: anchorDay, month: anchorMonth, year: anchorYear }
    = parseDateKey(anchorKey);
  const previousMonthStart = new Date(Date.UTC(
    anchorYear,
    anchorMonth - 2,
    1,
    12,
  ));
  const previousMonthDays = daysInMonth(
    previousMonthStart.getUTCFullYear(),
    previousMonthStart.getUTCMonth() + 1,
  );
  const comparisonClipsAtPreviousMonthEnd
    = period === 'monthly' && anchorDay > previousMonthDays;

  return {
    start: fullRange.start,
    end: now,
    previousStart: fullRange.previousStart,
    previousEnd: comparisonClipsAtPreviousMonthEnd
      ? fullRange.previousEnd
      : localDateTimeToUtc(
        comparisonDateKey,
        clock,
        now.getUTCMilliseconds(),
        timeZone,
      ),
  };
}
