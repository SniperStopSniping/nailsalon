import { describe, expect, it } from 'vitest';

import {
  bucketKeyForDateKey,
  isSmartFitAppointment,
  isValidReportingDateKey,
  resolveSmartFitReportingRange,
  SMART_FIT_EXCLUDED_STATUSES,
  SMART_FIT_REPORTED_STATUSES,
} from './smartFitReporting';

describe('isSmartFitAppointment — the one attribution predicate', () => {
  it('matches only the persisted smart_fit discount type', () => {
    expect(isSmartFitAppointment({ discountType: 'smart_fit' })).toBe(true);
  });

  it.each([
    ['first-visit discounts', 'first_visit_25'],
    ['reward discounts', 'reward'],
    ['retention campaign discounts (6w)', 'retention_promo_6w'],
    ['retention campaign discounts (8w)', 'retention_promo_8w'],
    ['undiscounted appointments (offer shown but booked regular)', null],
    ['unknown legacy free text', 'smart_fit_v2'],
    ['case variants (never written, never matched)', 'Smart_Fit'],
  ])('excludes %s', (_label, discountType) => {
    expect(isSmartFitAppointment({ discountType })).toBe(false);
  });
});

describe('status semantics constants', () => {
  it('primary metrics include active and completed statuses only', () => {
    expect([...SMART_FIT_REPORTED_STATUSES]).toEqual([
      'pending',
      'confirmed',
      'in_progress',
      'completed',
    ]);
  });

  it('cancelled and no_show are the excluded statuses', () => {
    expect([...SMART_FIT_EXCLUDED_STATUSES]).toEqual(['cancelled', 'no_show']);
  });
});

describe('isValidReportingDateKey', () => {
  it.each(['2026-07-19', '2024-02-29', '2026-01-01', '2026-12-31'])('accepts %s', (key) => {
    expect(isValidReportingDateKey(key)).toBe(true);
  });

  it.each([
    '2026-02-31', // impossible calendar date
    '2026-13-01', // impossible month
    '2026-00-10',
    '2025-02-29', // not a leap year
    '2026-7-19', // missing zero padding
    '07-19-2026',
    '2026-07-19T00:00:00Z',
    'not-a-date',
    '',
  ])('rejects %s', (key) => {
    expect(isValidReportingDateKey(key)).toBe(false);
  });
});

describe('resolveSmartFitReportingRange', () => {
  it('returns null for malformed anchors', () => {
    expect(resolveSmartFitReportingRange('weekly', '2026-02-31')).toBeNull();
    expect(resolveSmartFitReportingRange('daily', 'garbage')).toBeNull();
  });

  it('daily: one single-day bucket', () => {
    const range = resolveSmartFitReportingRange('daily', '2026-07-19')!;

    expect(range.startKey).toBe('2026-07-19');
    expect(range.endKeyExclusive).toBe('2026-07-20');
    expect(range.buckets).toHaveLength(1);
    expect(range.buckets[0]!.key).toBe('2026-07-19');
  });

  it('weekly: Sunday-started week containing the anchor, 7 day buckets', () => {
    // 2026-07-15 is a Wednesday; its week starts Sunday 2026-07-12.
    const range = resolveSmartFitReportingRange('weekly', '2026-07-15')!;

    expect(range.startKey).toBe('2026-07-12');
    expect(range.endKeyExclusive).toBe('2026-07-19');
    expect(range.buckets.map(bucket => bucket.key)).toEqual([
      '2026-07-12',
      '2026-07-13',
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
      '2026-07-17',
      '2026-07-18',
    ]);
    expect(range.buckets.map(bucket => bucket.label)).toEqual([
      'Sun',
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
    ]);
  });

  it('weekly: an anchor already on Sunday starts its own week', () => {
    const range = resolveSmartFitReportingRange('weekly', '2026-07-19')!;

    expect(range.startKey).toBe('2026-07-19');
    expect(range.endKeyExclusive).toBe('2026-07-26');
  });

  it('weekly: week crossing a month boundary keeps calendar math intact', () => {
    // 2026-08-01 is a Saturday; its week starts Sunday 2026-07-26.
    const range = resolveSmartFitReportingRange('weekly', '2026-08-01')!;

    expect(range.startKey).toBe('2026-07-26');
    expect(range.endKeyExclusive).toBe('2026-08-02');
  });

  it('monthly: calendar month with one bucket per day', () => {
    const range = resolveSmartFitReportingRange('monthly', '2026-07-19')!;

    expect(range.startKey).toBe('2026-07-01');
    expect(range.endKeyExclusive).toBe('2026-08-01');
    expect(range.buckets).toHaveLength(31);
    expect(range.buckets[0]!.label).toBe('1');
    expect(range.buckets[30]!.key).toBe('2026-07-31');
  });

  it('monthly: February bucket count follows the leap cycle', () => {
    expect(resolveSmartFitReportingRange('monthly', '2024-02-10')!.buckets).toHaveLength(29);
    expect(resolveSmartFitReportingRange('monthly', '2026-02-10')!.buckets).toHaveLength(28);
  });

  it('monthly: December range ends in January of the next year', () => {
    const range = resolveSmartFitReportingRange('monthly', '2026-12-05')!;

    expect(range.startKey).toBe('2026-12-01');
    expect(range.endKeyExclusive).toBe('2027-01-01');
  });

  it('yearly: calendar year with 12 month buckets', () => {
    const range = resolveSmartFitReportingRange('yearly', '2026-07-19')!;

    expect(range.startKey).toBe('2026-01-01');
    expect(range.endKeyExclusive).toBe('2027-01-01');
    expect(range.buckets.map(bucket => bucket.key)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    expect(range.buckets[0]!.label).toBe('Jan');
    expect(range.buckets[11]!.label).toBe('Dec');
  });
});

describe('bucketKeyForDateKey', () => {
  it('maps in-range days to their own bucket for day-bucketed periods', () => {
    const range = resolveSmartFitReportingRange('weekly', '2026-07-15')!;

    expect(bucketKeyForDateKey(range, '2026-07-12')).toBe('2026-07-12');
    expect(bucketKeyForDateKey(range, '2026-07-18')).toBe('2026-07-18');
  });

  it('returns null outside the range (both edges)', () => {
    const range = resolveSmartFitReportingRange('weekly', '2026-07-15')!;

    expect(bucketKeyForDateKey(range, '2026-07-11')).toBeNull();
    expect(bucketKeyForDateKey(range, '2026-07-19')).toBeNull();
  });

  it('maps yearly dates to month buckets', () => {
    const range = resolveSmartFitReportingRange('yearly', '2026-07-19')!;

    expect(bucketKeyForDateKey(range, '2026-03-31')).toBe('2026-03');
    expect(bucketKeyForDateKey(range, '2025-12-31')).toBeNull();
    expect(bucketKeyForDateKey(range, '2027-01-01')).toBeNull();
  });
});
