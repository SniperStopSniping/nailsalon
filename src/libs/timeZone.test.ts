import { describe, expect, it } from 'vitest';

import { formatTimeInTimeZone, getDateKeyInTimeZone, getZonedDayBounds, isZonedTimeMatch, zonedTimeToUtc } from './timeZone';

describe('timeZone helpers', () => {
  it.each(['America/Toronto', 'America/Vancouver'])('detects nonexistent spring-forward times in %s', (timeZone) => {
    const input = { date: '2026-03-08', time: '2:30', timeZone };

    expect(isZonedTimeMatch(zonedTimeToUtc(input), input)).toBe(false);

    const valid = { ...input, time: '3:30' };

    expect(isZonedTimeMatch(zonedTimeToUtc(valid), valid)).toBe(true);
  });

  it.each(['America/Toronto', 'America/New_York'])('keeps the repeated fall-back hour as a valid, deterministic instant in %s', (timeZone) => {
    const input = { date: '2026-11-01', time: '1:30', timeZone };

    expect(isZonedTimeMatch(zonedTimeToUtc(input), input)).toBe(true);
    expect(getZonedDayBounds(input.date, input.timeZone).endOfDay.getTime() - getZonedDayBounds(input.date, input.timeZone).startOfDay.getTime() + 1).toBe(25 * 60 * 60 * 1000);
  });

  it('converts Toronto wall-clock appointment times to UTC instants', () => {
    expect(zonedTimeToUtc({
      date: '2026-03-13',
      time: '10:30',
      timeZone: 'America/Toronto',
    }).toISOString()).toBe('2026-03-13T14:30:00.000Z');
  });

  it('formats stored UTC instants back in the salon timezone', () => {
    expect(formatTimeInTimeZone(
      '2026-03-13T14:30:00.000Z',
      {},
      'America/Toronto',
    )).toBe('10:30 AM');
  });

  it('uses timezone-aware day bounds across daylight saving changes', () => {
    const { startOfDay, endOfDay } = getZonedDayBounds('2026-03-08', 'America/Toronto');

    expect(startOfDay.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(endOfDay.toISOString()).toBe('2026-03-09T03:59:59.999Z');
  });

  it('gets the date key in the requested timezone', () => {
    expect(getDateKeyInTimeZone(
      new Date('2026-03-14T02:00:00.000Z'),
      'America/Toronto',
    )).toBe('2026-03-13');
  });
});
