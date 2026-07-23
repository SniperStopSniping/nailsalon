import { describe, expect, it } from 'vitest';

import { getAnalyticsDateRange, getAnalyticsToDateRange } from './analyticsDateRange';

/**
 * Prompt 9 audit fix: analytics date boundaries must follow the SALON's
 * timezone, not the server's. These tests use fixed anchors and non-UTC
 * salon timezones on both sides of UTC, including a DST offset change
 * inside a period, so they are deterministic on any CI server timezone.
 */
describe('getAnalyticsDateRange (salon-timezone boundaries)', () => {
  const TORONTO = 'America/Toronto'; // UTC-4 (EDT) / UTC-5 (EST)
  const TOKYO = 'Asia/Tokyo'; // UTC+9, no DST

  it('computes daily bounds at the salon-local midnight, not server midnight', () => {
    const { start, end, previousStart, previousEnd } = getAnalyticsDateRange('daily', TORONTO, '2026-07-15');

    expect(start.toISOString()).toBe('2026-07-15T04:00:00.000Z'); // EDT midnight
    expect(end.toISOString()).toBe('2026-07-16T04:00:00.000Z');
    expect(previousStart.toISOString()).toBe('2026-07-14T04:00:00.000Z');
    expect(previousEnd.toISOString()).toBe(start.toISOString());
  });

  it('computes daily bounds for a timezone east of UTC', () => {
    const { start, end } = getAnalyticsDateRange('daily', TOKYO, '2026-07-15');

    expect(start.toISOString()).toBe('2026-07-14T15:00:00.000Z'); // JST midnight
    expect(end.toISOString()).toBe('2026-07-15T15:00:00.000Z');
  });

  it('starts the week on the salon-local Monday', () => {
    // 2026-07-15 is a Wednesday; the containing week starts Monday 2026-07-13.
    const { start, end, previousStart, previousEnd } = getAnalyticsDateRange('weekly', TORONTO, '2026-07-15');

    expect(start.toISOString()).toBe('2026-07-13T04:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-20T04:00:00.000Z');
    expect(previousStart.toISOString()).toBe('2026-07-06T04:00:00.000Z');
    expect(previousEnd.toISOString()).toBe(start.toISOString());
  });

  it('keeps a Sunday inside the Monday-through-Sunday week', () => {
    const { start, end } = getAnalyticsDateRange('weekly', TORONTO, '2026-07-12');

    expect(start.toISOString()).toBe('2026-07-06T04:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-13T04:00:00.000Z');
  });

  it('anchors a Monday to itself', () => {
    const { start, end } = getAnalyticsDateRange('weekly', TORONTO, '2026-07-13');

    expect(start.toISOString()).toBe('2026-07-13T04:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-20T04:00:00.000Z');
  });

  it('computes month bounds across a DST transition with the correct offsets', () => {
    // March 2026: EST (UTC-5) at the start, EDT (UTC-4) by April 1.
    const { start, end, previousStart } = getAnalyticsDateRange('monthly', TORONTO, '2026-03-15');

    expect(start.toISOString()).toBe('2026-03-01T05:00:00.000Z'); // EST midnight
    expect(end.toISOString()).toBe('2026-04-01T04:00:00.000Z'); // EDT midnight
    expect(previousStart.toISOString()).toBe('2026-02-01T05:00:00.000Z');
  });

  it('rolls the previous month across a year boundary', () => {
    const { previousStart, previousEnd } = getAnalyticsDateRange('monthly', TORONTO, '2026-01-20');

    expect(previousStart.toISOString()).toBe('2025-12-01T05:00:00.000Z');
    expect(previousEnd.toISOString()).toBe('2026-01-01T05:00:00.000Z');
  });

  it('computes year bounds in the salon timezone', () => {
    const { start, end, previousStart, previousEnd } = getAnalyticsDateRange('yearly', TORONTO, '2026-07-15');

    expect(start.toISOString()).toBe('2026-01-01T05:00:00.000Z'); // EST midnight
    expect(end.toISOString()).toBe('2027-01-01T05:00:00.000Z');
    expect(previousStart.toISOString()).toBe('2025-01-01T05:00:00.000Z');
    expect(previousEnd.toISOString()).toBe(start.toISOString());
  });

  it('places a late-night salon-local appointment inside the correct day bucket', () => {
    // 11:30 PM Toronto time on July 15 is 03:30Z on July 16 — the old
    // server-local (UTC CI) implementation put this in the NEXT day's range.
    const lateNight = new Date('2026-07-16T03:30:00.000Z');
    const { start, end } = getAnalyticsDateRange('daily', TORONTO, '2026-07-15');

    expect(lateNight.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(lateNight.getTime()).toBeLessThan(end.getTime());
  });

  it('uses "today" in the salon timezone when no anchor is given', () => {
    const now = new Date();
    const { start, end } = getAnalyticsDateRange('daily', TOKYO);

    expect(now.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(now.getTime()).toBeLessThan(end.getTime());
    expect(end.getTime() - start.getTime()).toBe(86_400_000);
  });
});

describe('getAnalyticsToDateRange (equal-elapsed comparisons)', () => {
  const TORONTO = 'America/Toronto';

  it('compares today through now with yesterday through the same local time', () => {
    const now = new Date('2026-07-15T18:34:56.789Z'); // 2:34:56 PM EDT
    const range = getAnalyticsToDateRange('daily', TORONTO, now);

    expect(range.start.toISOString()).toBe('2026-07-15T04:00:00.000Z');
    expect(range.end).toEqual(now);
    expect(range.previousStart.toISOString()).toBe('2026-07-14T04:00:00.000Z');
    expect(range.previousEnd.toISOString()).toBe('2026-07-14T18:34:56.789Z');
  });

  it('compares week-to-date with the same weekday and local time last week', () => {
    const now = new Date('2026-07-15T18:34:56.789Z'); // Wednesday, 2:34:56 PM EDT
    const range = getAnalyticsToDateRange('weekly', TORONTO, now);

    expect(range.start.toISOString()).toBe('2026-07-13T04:00:00.000Z');
    expect(range.end).toEqual(now);
    expect(range.previousStart.toISOString()).toBe('2026-07-06T04:00:00.000Z');
    expect(range.previousEnd.toISOString()).toBe('2026-07-08T18:34:56.789Z');
  });

  it('clamps a month-to-date comparison to the prior month length', () => {
    const now = new Date('2026-03-31T19:30:00.123Z'); // March 31, 3:30 PM EDT
    const range = getAnalyticsToDateRange('monthly', TORONTO, now);

    expect(range.start.toISOString()).toBe('2026-03-01T05:00:00.000Z');
    expect(range.end).toEqual(now);
    expect(range.previousStart.toISOString()).toBe('2026-02-01T05:00:00.000Z');
    expect(range.previousEnd.toISOString()).toBe('2026-03-01T05:00:00.000Z');
  });

  it('preserves salon-local clock time when comparison weeks cross DST', () => {
    const now = new Date('2026-03-09T13:30:00.000Z'); // Monday, 9:30 AM EDT
    const range = getAnalyticsToDateRange('weekly', TORONTO, now);

    expect(range.start.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(range.previousStart.toISOString()).toBe('2026-03-02T05:00:00.000Z');
    expect(range.previousEnd.toISOString()).toBe('2026-03-02T14:30:00.000Z');
  });

  it('keeps the complete-period helper unchanged for historical reporting', () => {
    const range = getAnalyticsDateRange('monthly', TORONTO, '2026-07-15');

    expect(range.end.toISOString()).toBe('2026-08-01T04:00:00.000Z');
    expect(range.previousEnd.toISOString()).toBe('2026-07-01T04:00:00.000Z');
  });
});
