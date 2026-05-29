export const DEFAULT_BOOKING_TIME_ZONE = 'America/Toronto';

function getTimeZoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(part => part.type === type)?.value ?? 0);

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour') === 24 ? 0 : value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getTimeZoneParts(date, timeZone);
  const wallTimeAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return wallTimeAsUtc - date.getTime();
}

export function zonedTimeToUtc(args: {
  date: string;
  time: string;
  timeZone?: string | null;
}): Date {
  const { date, time, timeZone = DEFAULT_BOOKING_TIME_ZONE } = args;
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const [hour = 0, minute = 0, second = 0] = time.split(':').map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone ?? DEFAULT_BOOKING_TIME_ZONE);
  const firstResult = new Date(utcGuess - firstOffset);
  const secondOffset = getTimeZoneOffsetMs(firstResult, timeZone ?? DEFAULT_BOOKING_TIME_ZONE);

  return new Date(utcGuess - secondOffset);
}

export function getZonedDayBounds(date: string, timeZone?: string | null): {
  startOfDay: Date;
  endOfDay: Date;
} {
  const startOfDay = zonedTimeToUtc({ date, time: '00:00', timeZone });
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const nextDayDate = new Date(Date.UTC(year, month - 1, day + 1));
  const nextDayKey = [
    nextDayDate.getUTCFullYear(),
    String(nextDayDate.getUTCMonth() + 1).padStart(2, '0'),
    String(nextDayDate.getUTCDate()).padStart(2, '0'),
  ].join('-');
  const nextDay = zonedTimeToUtc({ date: nextDayKey, time: '00:00', timeZone });

  return {
    startOfDay,
    endOfDay: new Date(nextDay.getTime() - 1),
  };
}

export function getDateKeyInTimeZone(value: Date, timeZone?: string | null): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone ?? DEFAULT_BOOKING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);

  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;

  return `${year}-${month}-${day}`;
}

export function formatDateInTimeZone(
  value: string | Date,
  options: Intl.DateTimeFormatOptions,
  timeZone?: string | null,
): string {
  return new Date(value).toLocaleDateString('en-US', {
    timeZone: timeZone ?? DEFAULT_BOOKING_TIME_ZONE,
    ...options,
  });
}

export function formatTimeInTimeZone(
  value: string | Date,
  options: Intl.DateTimeFormatOptions = {},
  timeZone?: string | null,
): string {
  return new Date(value).toLocaleTimeString('en-US', {
    timeZone: timeZone ?? DEFAULT_BOOKING_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...options,
  });
}
