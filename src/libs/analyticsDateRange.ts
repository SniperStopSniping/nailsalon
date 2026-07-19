import { getDateKeyInTimeZone, getZonedDayBounds } from '@/libs/timeZone';

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
): { start: Date; end: Date; previousStart: Date; previousEnd: Date } {
  const anchorKey = anchor ?? getDateKeyInTimeZone(new Date(), timeZone);
  const [anchorYear = 1970, anchorMonth = 1, anchorDay = 1] = anchorKey.split('-').map(Number);
  const anchorNoonUtc = new Date(Date.UTC(anchorYear, anchorMonth - 1, anchorDay, 12));

  const keyOf = (noon: Date): string => noon.toISOString().slice(0, 10);
  const addDays = (noon: Date, days: number): Date =>
    new Date(noon.getTime() + days * 86_400_000);
  const monthKey = (year: number, monthIndex: number): string =>
    keyOf(new Date(Date.UTC(year, monthIndex, 1, 12)));
  const boundary = (key: string): Date => getZonedDayBounds(key, timeZone).startOfDay;

  let startKey: string;
  let endKey: string;
  let previousStartKey: string;

  switch (period) {
    case 'weekly': {
      const weekStartNoon = addDays(anchorNoonUtc, -anchorNoonUtc.getUTCDay());
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
    start: boundary(startKey),
    end: boundary(endKey),
    previousStart: boundary(previousStartKey),
    // The previous period always ends exactly where the current one starts.
    previousEnd: boundary(startKey),
  };
}
