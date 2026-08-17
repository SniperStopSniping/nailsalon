/**
 * Monthly credit-window mathematics — pure functions.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §6.
 *
 * Billing cadence (monthly | annual) and SMS-grant cadence are different
 * clocks: EVERY subscription receives monthly credit windows computed from
 * the ORIGINAL activation anchor. Window N is
 *
 *   [ anchor + N months , anchor + (N+1) months )      (half-open)
 *
 * where "+ N months" is always computed FROM THE ORIGINAL ANCHOR with the
 * day-of-month clamped independently to the target month's final valid day
 * (contract §6.3): a January 31 anchor yields Feb 28/29, Mar 31, Apr 30 —
 * never a permanent drift to the 28th. Time-of-day is preserved from the
 * anchor. All arithmetic is UTC instant arithmetic; salon display timezones
 * are presentation concerns and never move a billing window.
 *
 * Grant eligibility (contract §6.4, Rev 2.2 binding correction): a window
 * may be granted ONLY when paid entitlement covers the ENTIRE window —
 * `paid_through >= window_end`. Equality of paid_through with window_start
 * must never authorize the new month.
 *
 * This module is pure: no Env, no database, no I/O.
 */

export type CreditWindow = {
  index: number;
  /** Inclusive start instant. */
  start: Date;
  /** Exclusive end instant — the window is [start, end). */
  end: Date;
};

function daysInUtcMonth(year: number, monthIndex: number): number {
  // Day 0 of the following month is the last day of `monthIndex`.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * anchor + `months` calendar months, with the anchor's day-of-month clamped
 * independently to the target month and the anchor's time-of-day preserved.
 */
export function addMonthsClamped(anchor: Date, months: number): Date {
  const year = anchor.getUTCFullYear();
  const monthIndex = anchor.getUTCMonth() + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const clampedDay = Math.min(anchor.getUTCDate(), daysInUtcMonth(targetYear, targetMonth));
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    clampedDay,
    anchor.getUTCHours(),
    anchor.getUTCMinutes(),
    anchor.getUTCSeconds(),
    anchor.getUTCMilliseconds(),
  ));
}

export function computeCreditWindow(anchor: Date, index: number): CreditWindow {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`credit window index must be a non-negative integer, got ${index}`);
  }
  return {
    index,
    start: addMonthsClamped(anchor, index),
    end: addMonthsClamped(anchor, index + 1),
  };
}

/** The window whose half-open range contains `at`, or null before the anchor. */
export function findCreditWindowIndexAt(anchor: Date, at: Date): number | null {
  if (at.getTime() < anchor.getTime()) {
    return null;
  }
  // Months elapsed is a tight first guess; clamping can only shift window
  // boundaries EARLIER within the month, so at most one step of correction
  // in each direction is needed.
  const guess = Math.max(
    0,
    (at.getUTCFullYear() - anchor.getUTCFullYear()) * 12
    + (at.getUTCMonth() - anchor.getUTCMonth())
    - 1,
  );
  for (let index = guess; index <= guess + 2; index += 1) {
    const window = computeCreditWindow(anchor, index);
    if (at.getTime() >= window.start.getTime() && at.getTime() < window.end.getTime()) {
      return index;
    }
  }
  // Unreachable for valid inputs; fail loudly rather than mis-grant.
  throw new Error('credit window search failed to converge');
}

/**
 * Contract §6.4: grant only when paid entitlement covers the FULL window.
 * `paid_through >= window_end` — strictly-greater-or-equal against the
 * EXCLUSIVE end bound.
 */
export function isWindowFullyPaid(window: CreditWindow, paidThrough: Date): boolean {
  return paidThrough.getTime() >= window.end.getTime();
}

export type WindowEvaluation =
  | { action: 'grant'; window: CreditWindow }
  | { action: 'skip_unpaid'; window: CreditWindow }
  | { action: 'skip_missed'; window: CreditWindow };

/**
 * Evaluate a single window at instant `now` (contract §6.4-§6.5):
 * - a window that already ENDED and was never granted is skipped as missed
 *   (never backfilled, regardless of payment);
 * - the currently active window is granted only when fully paid, else
 *   skipped-unpaid (late payment during the window may re-evaluate it to a
 *   grant while it is still active — the caller re-runs evaluation);
 * - future windows are not evaluated.
 */
export function evaluateCreditWindow(
  window: CreditWindow,
  paidThrough: Date,
  now: Date,
): WindowEvaluation | null {
  if (now.getTime() < window.start.getTime()) {
    return null;
  }
  if (now.getTime() >= window.end.getTime()) {
    return { action: 'skip_missed', window };
  }
  if (isWindowFullyPaid(window, paidThrough)) {
    return { action: 'grant', window };
  }
  return { action: 'skip_unpaid', window };
}
