import { SMART_FIT_DISCOUNT_TYPE } from '@/libs/smartFit';

/**
 * Smart Fit reporting semantics (P7.5) — shared by the reporting API, its
 * tests, and any UI copy that must agree with the numbers.
 *
 * Attribution: an appointment "used Smart Fit" exactly when its PERSISTED
 * booking snapshot says so (`discount_type = 'smart_fit'`, written once inside
 * the P7.2 booking transaction and never recalculated). First-visit
 * ('first_visit_25'), reward ('reward'), retention ('retention_*'), and
 * checkout-time manual discounts (final_discount_cents) are different values /
 * different columns and can never match. Appointments that were merely SHOWN
 * an offer but booked regularly persist a different (or null) discount_type,
 * so they are excluded by construction.
 *
 * Status semantics: pending / confirmed / in_progress / completed count toward
 * every primary metric; cancelled and no_show are excluded from all primary
 * metrics and surfaced only as separate exclusion counts.
 *
 * Range membership: an appointment belongs to a range when its START TIME
 * falls inside the range's day bounds resolved in the SALON timezone
 * (settings.booking.timezone, the operational convention used by the admin
 * Today view and appointment-list filters). Range shapes mirror the analytics
 * dashboard: daily = the anchor day, weekly = the Sunday-started week
 * containing the anchor, monthly = calendar month, yearly = calendar year.
 */

export const SMART_FIT_REPORTING_PERIODS = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type SmartFitReportingPeriod = (typeof SMART_FIT_REPORTING_PERIODS)[number];

/** Statuses included in every primary Smart Fit metric. */
export const SMART_FIT_REPORTED_STATUSES = ['pending', 'confirmed', 'in_progress', 'completed'] as const;

/** Statuses reported only as exclusions, never in the primary metrics. */
export const SMART_FIT_EXCLUDED_STATUSES = ['cancelled', 'no_show'] as const;

/**
 * The ONE Smart Fit attribution predicate: persisted snapshot metadata only.
 */
export function isSmartFitAppointment(appointment: { discountType: string | null }): boolean {
  return appointment.discountType === SMART_FIT_DISCOUNT_TYPE;
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Strict YYYY-MM-DD validation, including real-calendar-date round-trip. */
export function isValidReportingDateKey(key: string): boolean {
  if (!DATE_KEY_PATTERN.test(key)) {
    return false;
  }
  const [year = 0, month = 0, day = 0] = key.split('-').map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

// Calendar-date arithmetic on date keys. Keys are salon-local calendar days;
// the math is timezone-free (UTC is only an internal representation) and the
// caller converts boundary keys to instants with getZonedDayBounds.
function keyToUtc(key: string): Date {
  const [year = 0, month = 0, day = 0] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function utcToKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(key: string, days: number): string {
  const date = keyToUtc(key);
  date.setUTCDate(date.getUTCDate() + days);
  return utcToKey(date);
}

function formatBucketLabel(key: string, period: SmartFitReportingPeriod): string {
  if (period === 'yearly') {
    // key is YYYY-MM
    const monthIndex = Number(key.slice(5, 7)) - 1;
    return new Date(Date.UTC(2000, monthIndex, 1))
      .toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  }
  const date = keyToUtc(key);
  if (period === 'weekly') {
    return date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  }
  if (period === 'monthly') {
    return String(date.getUTCDate());
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export type SmartFitReportingBucket = {
  /** YYYY-MM-DD (daily/weekly/monthly buckets) or YYYY-MM (yearly buckets). */
  key: string;
  label: string;
};

export type SmartFitReportingRange = {
  period: SmartFitReportingPeriod;
  /** First salon-local day of the range (inclusive). */
  startKey: string;
  /** First salon-local day AFTER the range (exclusive). */
  endKeyExclusive: string;
  buckets: SmartFitReportingBucket[];
};

/**
 * Resolve the reporting range for a period + anchor date key. Pure calendar
 * math — returns null for a malformed or impossible anchor.
 */
export function resolveSmartFitReportingRange(
  period: SmartFitReportingPeriod,
  anchorKey: string,
): SmartFitReportingRange | null {
  if (!isValidReportingDateKey(anchorKey)) {
    return null;
  }

  const anchor = keyToUtc(anchorKey);

  if (period === 'daily') {
    return {
      period,
      startKey: anchorKey,
      endKeyExclusive: addDays(anchorKey, 1),
      buckets: [{ key: anchorKey, label: formatBucketLabel(anchorKey, period) }],
    };
  }

  if (period === 'weekly') {
    const startKey = addDays(anchorKey, -anchor.getUTCDay());
    const buckets = Array.from({ length: 7 }, (_, index) => {
      const key = addDays(startKey, index);
      return { key, label: formatBucketLabel(key, period) };
    });
    return { period, startKey, endKeyExclusive: addDays(startKey, 7), buckets };
  }

  if (period === 'monthly') {
    const year = anchor.getUTCFullYear();
    const month = anchor.getUTCMonth();
    const startKey = utcToKey(new Date(Date.UTC(year, month, 1)));
    const endKeyExclusive = utcToKey(new Date(Date.UTC(year, month + 1, 1)));
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const buckets = Array.from({ length: daysInMonth }, (_, index) => {
      const key = addDays(startKey, index);
      return { key, label: formatBucketLabel(key, period) };
    });
    return { period, startKey, endKeyExclusive, buckets };
  }

  const year = anchor.getUTCFullYear();
  const buckets = Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, '0')}`;
    return { key, label: formatBucketLabel(key, period) };
  });
  return {
    period,
    startKey: `${year}-01-01`,
    endKeyExclusive: `${year + 1}-01-01`,
    buckets,
  };
}

/**
 * Map a salon-local appointment date key to its bucket key within a range.
 * Returns null when the date falls outside the range.
 */
export function bucketKeyForDateKey(
  range: SmartFitReportingRange,
  dateKey: string,
): string | null {
  if (dateKey < range.startKey || dateKey >= range.endKeyExclusive) {
    return null;
  }
  return range.period === 'yearly' ? dateKey.slice(0, 7) : dateKey;
}

/**
 * Response contract of GET /api/admin/analytics/smart-fit. Lives here (not in
 * the route file) so the client card can import the type without pulling in
 * server-only modules.
 */
export type SmartFitReportResponse = {
  config: { enabled: boolean };
  metrics: {
    appointments: number;
    discountGivenCents: number;
    bookedRevenueCents: number;
    averageDiscountCents: number;
    completedCount: number;
    upcomingCount: number;
    cancelledCount: number;
    noShowCount: number;
  };
  series: Array<{
    key: string;
    label: string;
    appointments: number;
    discountCents: number;
    revenueCents: number;
  }>;
  services: Array<{
    name: string;
    appointments: number;
    revenueCents: number;
    discountCents: number;
  }>;
  technicians: Array<{
    name: string;
    appointments: number;
    revenueCents: number;
    discountCents: number;
  }>;
  recent: Array<{
    startTime: string;
    clientName: string | null;
    serviceName: string;
    technicianName: string;
    subtotalCents: number;
    discountCents: number;
    finalCents: number;
    status: string;
  }>;
  period: string;
  anchor: string;
  dateRange: { start: string; end: string };
  timezone: string;
  currency: string;
};
