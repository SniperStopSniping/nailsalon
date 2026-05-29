import { describe, expect, it } from 'vitest';

import { formatTimeInTimeZone, getDateKeyInTimeZone, getZonedDayBounds, zonedTimeToUtc } from './timeZone';

describe('timeZone helpers', () => {
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
