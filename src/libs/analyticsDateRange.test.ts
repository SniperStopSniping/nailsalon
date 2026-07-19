import { describe, expect, it } from 'vitest';

import { getAnalyticsDateRange } from './analyticsDateRange';

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

  it('starts the week on the salon-local Sunday', () => {
    // 2026-07-15 is a Wednesday; the containing week starts Sunday 2026-07-12.
    const { start, end, previousStart, previousEnd } = getAnalyticsDateRange('weekly', TORONTO, '2026-07-15');

    expect(start.toISOString()).toBe('2026-07-12T04:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-19T04:00:00.000Z');
    expect(previousStart.toISOString()).toBe('2026-07-05T04:00:00.000Z');
    expect(previousEnd.toISOString()).toBe(start.toISOString());
  });

  it('anchors an anchor that IS a Sunday to itself', () => {
    const { start, end } = getAnalyticsDateRange('weekly', TORONTO, '2026-07-12');

    expect(start.toISOString()).toBe('2026-07-12T04:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-19T04:00:00.000Z');
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
