import { describe, expect, it } from 'vitest';

import {
  dateOnlyToLocalDate,
  dateOnlyToUtcDate,
  formatDateOnlyLabel,
  toDateOnlyString,
} from './timeOffDates';

describe('toDateOnlyString', () => {
  it('passes a DATE column value through unchanged', () => {
    expect(toDateOnlyString('2026-09-17')).toBe('2026-09-17');
  });

  it('trims the time component off a timestamp string', () => {
    expect(toDateOnlyString('2026-09-17 00:00:00')).toBe('2026-09-17');
    expect(toDateOnlyString('2026-09-17T04:00:00.000Z')).toBe('2026-09-17');
  });

  it('reads a Date in UTC', () => {
    expect(toDateOnlyString(new Date('2026-09-17T00:00:00.000Z'))).toBe('2026-09-17');
  });

  it('returns null instead of throwing on values it cannot read', () => {
    // The regression this guards: an Invalid Date used to reach
    // `.toISOString()` and 500 the whole time-off inbox.
    expect(toDateOnlyString(new Date('2026-09-17+0000'))).toBeNull();
    expect(toDateOnlyString('not a date')).toBeNull();
    expect(toDateOnlyString('2026-02-30')).toBeNull();
    expect(toDateOnlyString(null)).toBeNull();
    expect(toDateOnlyString(undefined)).toBeNull();
    expect(toDateOnlyString(1_234_567)).toBeNull();
  });
});

describe('dateOnlyToUtcDate', () => {
  it('maps a calendar day to midnight UTC', () => {
    expect(dateOnlyToUtcDate('2026-09-17')?.toISOString()).toBe('2026-09-17T00:00:00.000Z');
  });

  it('returns null for an unreadable value', () => {
    expect(dateOnlyToUtcDate('nope')).toBeNull();
  });
});

describe('dateOnlyToLocalDate', () => {
  it('maps a calendar day to local midnight on that same day', () => {
    const parsed = dateOnlyToLocalDate('2026-09-17');

    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(8);
    expect(parsed?.getDate()).toBe(17);
    expect(parsed?.getHours()).toBe(0);
  });

  it('returns null for an unreadable value', () => {
    expect(dateOnlyToLocalDate('')).toBeNull();
  });
});

describe('formatDateOnlyLabel', () => {
  it('labels the calendar day regardless of the server zone', () => {
    expect(formatDateOnlyLabel('2026-09-17')).toBe('Sep 17');
  });

  it('returns null for an unreadable value', () => {
    expect(formatDateOnlyLabel('bad')).toBeNull();
  });
});
