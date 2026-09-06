/**
 * Date helpers for the whole-day DATE columns on `time_off_request`
 * (`start_date` / `end_date`).
 *
 * Those columns hold a calendar day, not an instant. Drizzle now models them
 * with `date(..., { mode: 'string' })`, so readers receive 'YYYY-MM-DD'.
 * These helpers keep every reader defensive: a value that cannot be understood
 * degrades to `null` (so the caller can skip the row) instead of producing an
 * Invalid Date that throws inside `toISOString()`.
 */

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalise a whole-day column value to 'YYYY-MM-DD'.
 *
 * Accepts the string the DATE mapper returns, an ISO/Postgres timestamp string
 * (legacy rows read through another mapper), or a Date. Returns `null` for
 * anything that is not a real calendar day.
 */
export function toDateOnlyString(value: unknown): string | null {
  if (typeof value === 'string') {
    const candidate = value.trim().slice(0, 10);

    if (!DATE_ONLY_PATTERN.test(candidate)) {
      return null;
    }

    // Reject impossible days such as 2026-02-30: the pattern allows them and
    // Date rolls them over to the next month rather than failing.
    const parsed = new Date(`${candidate}T00:00:00.000Z`);

    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate) {
      return null;
    }

    return candidate;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }

  return null;
}

/**
 * Midnight UTC on the given calendar day.
 *
 * `technician_time_off.start_date` / `end_date` are real timestamps, and the
 * product writes midnight-UTC into them (ScheduleTab posts
 * `new Date('YYYY-MM-DD').toISOString()`). Approving a request must use the
 * same convention so the availability engine compares like with like.
 */
export function dateOnlyToUtcDate(value: unknown): Date | null {
  const dateOnly = toDateOnlyString(value);

  if (!dateOnly) {
    return null;
  }

  return new Date(`${dateOnly}T00:00:00.000Z`);
}

/**
 * Midnight in the server's local zone on the given calendar day. Used where a
 * calendar day has to be compared against stored appointment instants.
 */
export function dateOnlyToLocalDate(value: unknown): Date | null {
  const dateOnly = toDateOnlyString(value);

  if (!dateOnly) {
    return null;
  }

  const parsed = new Date(`${dateOnly}T00:00:00`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Short human label ('Sep 17') for a whole-day value, zone-drift free. */
export function formatDateOnlyLabel(value: unknown): string | null {
  const utc = dateOnlyToUtcDate(value);

  if (!utc) {
    return null;
  }

  return utc.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
