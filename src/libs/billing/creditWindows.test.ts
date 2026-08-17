import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  addMonthsClamped,
  computeCreditWindow,
  evaluateCreditWindow,
  findCreditWindowIndexAt,
  isWindowFullyPaid,
} = await import('./creditWindows');

const utc = (iso: string) => new Date(iso);

describe('addMonthsClamped — original-anchor month math', () => {
  it('clamps a January 31 anchor independently per month (never permanent drift to the 28th)', () => {
    const anchor = utc('2026-01-31T10:00:00.000Z');

    expect(addMonthsClamped(anchor, 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonthsClamped(anchor, 2).toISOString()).toBe('2026-03-31T10:00:00.000Z');
    expect(addMonthsClamped(anchor, 3).toISOString()).toBe('2026-04-30T10:00:00.000Z');
    expect(addMonthsClamped(anchor, 4).toISOString()).toBe('2026-05-31T10:00:00.000Z');
  });

  it('uses February 29 in leap years and February 28 otherwise', () => {
    const anchor = utc('2027-12-31T23:59:59.000Z');

    expect(addMonthsClamped(anchor, 2).toISOString()).toBe('2028-02-29T23:59:59.000Z');

    const nonLeapAnchor = utc('2026-01-30T00:00:00.000Z');

    expect(addMonthsClamped(nonLeapAnchor, 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });

  it('preserves the anchor time-of-day to the millisecond and crosses year boundaries', () => {
    const anchor = utc('2026-11-15T04:30:15.123Z');

    expect(addMonthsClamped(anchor, 3).toISOString()).toBe('2027-02-15T04:30:15.123Z');
    expect(addMonthsClamped(anchor, 14).toISOString()).toBe('2028-01-15T04:30:15.123Z');
  });

  it('is unaffected by daylight-saving transitions (pure UTC instant arithmetic)', () => {
    // The 2026 North American spring-forward is Mar 8; a window boundary
    // crossing it must move by exact calendar months in UTC, not shift by an
    // hour of wall-clock accounting.
    const anchor = utc('2026-02-08T18:00:00.000Z');

    expect(addMonthsClamped(anchor, 1).toISOString()).toBe('2026-03-08T18:00:00.000Z');

    const fallAnchor = utc('2026-10-01T12:00:00.000Z');

    expect(addMonthsClamped(fallAnchor, 1).toISOString()).toBe('2026-11-01T12:00:00.000Z');
  });
});

describe('computeCreditWindow', () => {
  it('produces contiguous half-open windows from the original anchor', () => {
    const anchor = utc('2026-01-31T10:00:00.000Z');
    const w0 = computeCreditWindow(anchor, 0);
    const w1 = computeCreditWindow(anchor, 1);
    const w2 = computeCreditWindow(anchor, 2);

    expect(w0.start.toISOString()).toBe('2026-01-31T10:00:00.000Z');
    expect(w0.end.toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(w1.start.toISOString()).toBe(w0.end.toISOString());
    expect(w2.start.toISOString()).toBe(w1.end.toISOString());
    expect(w2.end.toISOString()).toBe('2026-04-30T10:00:00.000Z');
  });

  it('rejects negative or fractional indices loudly', () => {
    const anchor = utc('2026-01-01T00:00:00.000Z');

    expect(() => computeCreditWindow(anchor, -1)).toThrow(RangeError);
    expect(() => computeCreditWindow(anchor, 1.5)).toThrow(RangeError);
  });
});

describe('findCreditWindowIndexAt', () => {
  const anchor = utc('2026-01-31T10:00:00.000Z');

  it('locates the containing window incl. clamped-month edges', () => {
    expect(findCreditWindowIndexAt(anchor, utc('2026-01-31T10:00:00.000Z'))).toBe(0);
    expect(findCreditWindowIndexAt(anchor, utc('2026-02-28T09:59:59.999Z'))).toBe(0);
    expect(findCreditWindowIndexAt(anchor, utc('2026-02-28T10:00:00.000Z'))).toBe(1);
    expect(findCreditWindowIndexAt(anchor, utc('2026-03-31T09:59:59.999Z'))).toBe(1);
    expect(findCreditWindowIndexAt(anchor, utc('2026-03-31T10:00:00.000Z'))).toBe(2);
    expect(findCreditWindowIndexAt(anchor, utc('2027-01-31T10:00:00.000Z'))).toBe(12);
  });

  it('returns null before the anchor', () => {
    expect(findCreditWindowIndexAt(anchor, utc('2026-01-31T09:59:59.999Z'))).toBeNull();
  });
});

describe('isWindowFullyPaid — the paid-through boundary (Rev 2.2 binding correction)', () => {
  const anchor = utc('2026-08-16T10:00:00.000Z');
  const window = computeCreditWindow(anchor, 1); // [Sep 16, Oct 16)

  it('paid_through == window_start must NOT authorize the window', () => {
    expect(isWindowFullyPaid(window, window.start)).toBe(false);
  });

  it('paid_through one second before window_end is unpaid; at window_end it is paid', () => {
    expect(isWindowFullyPaid(window, new Date(window.end.getTime() - 1000))).toBe(false);
    expect(isWindowFullyPaid(window, window.end)).toBe(true);
    expect(isWindowFullyPaid(window, new Date(window.end.getTime() + 1000))).toBe(true);
  });
});

describe('evaluateCreditWindow — grant / skip semantics', () => {
  const anchor = utc('2026-08-16T10:00:00.000Z');
  const w1 = computeCreditWindow(anchor, 1); // [Sep 16, Oct 16)
  const paidThroughW1 = w1.end;

  it('grants an active, fully covered window', () => {
    const during = new Date(w1.start.getTime() + 1000);

    expect(evaluateCreditWindow(w1, paidThroughW1, during)).toEqual({ action: 'grant', window: w1 });
  });

  it('skips an active but not fully covered window as unpaid (late payment can re-evaluate)', () => {
    const during = new Date(w1.start.getTime() + 1000);
    const shortPaid = new Date(w1.end.getTime() - 1);

    expect(evaluateCreditWindow(w1, shortPaid, during)).toEqual({ action: 'skip_unpaid', window: w1 });
    // Payment arrives while the window is still active: re-evaluation grants.
    expect(evaluateCreditWindow(w1, w1.end, during)).toEqual({ action: 'grant', window: w1 });
  });

  it('a fully elapsed window is skipped as missed even when payment would have covered it', () => {
    const after = new Date(w1.end.getTime() + 1);

    expect(evaluateCreditWindow(w1, new Date(w1.end.getTime() + 86400000), after))
      .toEqual({ action: 'skip_missed', window: w1 });
  });

  it('future windows are not evaluated', () => {
    const before = new Date(w1.start.getTime() - 1);

    expect(evaluateCreditWindow(w1, paidThroughW1, before)).toBeNull();
  });

  it('a scheduler outage spanning multiple complete windows never backfills', () => {
    const w2 = computeCreditWindow(anchor, 2);
    const w3 = computeCreditWindow(anchor, 3);
    const nowInsideW3 = new Date(w3.start.getTime() + 1000);
    const paidForever = utc('2030-01-01T00:00:00.000Z');

    expect(evaluateCreditWindow(w1, paidForever, nowInsideW3)!.action).toBe('skip_missed');
    expect(evaluateCreditWindow(w2, paidForever, nowInsideW3)!.action).toBe('skip_missed');
    expect(evaluateCreditWindow(w3, paidForever, nowInsideW3)!.action).toBe('grant');
  });
});
