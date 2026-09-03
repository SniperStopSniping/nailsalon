import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// `bookingPolicy.ts` imports the real `@/libs/DB` singleton at module scope
// for `loadBookingPolicy`'s default, which this file never calls (only the
// pure `canTechnicianTakeAppointment`) — mocked purely to avoid the module's
// own no-DATABASE_URL console.warn side effect during collection.
vi.mock('@/libs/DB', () => ({ db: {} }));

/* eslint-disable import/first */
import { canTechnicianTakeAppointment } from './bookingPolicy';
import {
  computeRequestApprovalTerms,
  evaluateRequestBookingEligibility,
  expandReviewWindows,
  haveRequestApprovalTermsChanged,
  isRequestBookableLeadTime,
  REQUEST_APPROVAL_MIN_LEAD_TIME_MINUTES,
  REQUEST_APPROVAL_POLICY_REVISION,
  resolveExplicitRequestApprovalActivation,
  resolveRequestApprovalDeadline,
  type ReviewWindowInterval,
} from './requestApprovalReconciliation.server';
/* eslint-enable import/first */

/**
 * Luster L1 PR4 — §14/§15 tests. This module is NOT wired into `route.ts`
 * (see its own doc comment for why); these tests exercise it directly and
 * exhaustively so it is ready for a future PR to wire in without needing to
 * re-derive or re-verify any of this.
 */

const FULL_WEEK = {
  sunday: { start: '09:00', end: '17:00' },
  monday: { start: '09:00', end: '17:00' },
  tuesday: { start: '09:00', end: '17:00' },
  wednesday: { start: '09:00', end: '17:00' },
  thursday: { start: '09:00', end: '17:00' },
  friday: { start: '09:00', end: '17:00' },
  saturday: { start: '09:00', end: '17:00' },
};

describe('§14 — computeRequestApprovalTerms / haveRequestApprovalTermsChanged', () => {
  it('computes the ratified shape: policyRevision, evaluatedAt, requestExpiresAt, selectedLocationId', () => {
    const terms = computeRequestApprovalTerms({
      evaluatedAt: new Date('2026-01-01T00:00:00Z'),
      deadline: new Date('2026-01-05T15:00:00Z'),
      selectedLocationId: 'loc_downtown',
    });

    expect(terms).toEqual({
      policyRevision: REQUEST_APPROVAL_POLICY_REVISION,
      evaluatedAt: '2026-01-01T00:00:00.000Z',
      requestExpiresAt: '2026-01-05T15:00:00.000Z',
      selectedLocationId: 'loc_downtown',
    });
  });

  it('null selectedLocationId is preserved, not coerced to a primary-location guess', () => {
    const terms = computeRequestApprovalTerms({
      evaluatedAt: new Date('2026-01-01T00:00:00Z'),
      deadline: new Date('2026-01-05T15:00:00Z'),
      selectedLocationId: null,
    });

    expect(terms.selectedLocationId).toBeNull();
  });

  it('MATCH: identical terms (ignoring evaluatedAt) report no change', () => {
    const fresh = computeRequestApprovalTerms({
      evaluatedAt: new Date('2026-01-02T00:00:00Z'), // deliberately a DIFFERENT evaluatedAt
      deadline: new Date('2026-01-05T15:00:00Z'),
      selectedLocationId: 'loc_downtown',
    });

    expect(haveRequestApprovalTermsChanged(fresh, {
      policyRevision: REQUEST_APPROVAL_POLICY_REVISION,
      requestExpiresAt: '2026-01-05T15:00:00.000Z',
      selectedLocationId: 'loc_downtown',
    })).toBe(false);
  });

  it('MISMATCH: a different requestExpiresAt (e.g. the appointment time itself changed) is a material change', () => {
    const fresh = computeRequestApprovalTerms({
      evaluatedAt: new Date('2026-01-02T00:00:00Z'),
      deadline: new Date('2026-01-05T16:00:00Z'),
      selectedLocationId: 'loc_downtown',
    });

    expect(haveRequestApprovalTermsChanged(fresh, {
      policyRevision: REQUEST_APPROVAL_POLICY_REVISION,
      requestExpiresAt: '2026-01-05T15:00:00.000Z',
      selectedLocationId: 'loc_downtown',
    })).toBe(true);
  });

  it('MISMATCH: a different policyRevision is a material change', () => {
    const fresh = computeRequestApprovalTerms({
      evaluatedAt: new Date('2026-01-02T00:00:00Z'),
      deadline: new Date('2026-01-05T15:00:00Z'),
      selectedLocationId: 'loc_downtown',
    });

    expect(haveRequestApprovalTermsChanged(fresh, {
      policyRevision: 'request-approval-policy-v0-stale',
      requestExpiresAt: '2026-01-05T15:00:00.000Z',
      selectedLocationId: 'loc_downtown',
    })).toBe(true);
  });

  it('MISMATCH: a different selectedLocationId (client moved locations) is a material change', () => {
    const fresh = computeRequestApprovalTerms({
      evaluatedAt: new Date('2026-01-02T00:00:00Z'),
      deadline: new Date('2026-01-05T15:00:00Z'),
      selectedLocationId: 'loc_downtown',
    });

    expect(haveRequestApprovalTermsChanged(fresh, {
      policyRevision: REQUEST_APPROVAL_POLICY_REVISION,
      requestExpiresAt: '2026-01-05T15:00:00.000Z',
      selectedLocationId: 'loc_uptown',
    })).toBe(true);
  });
});

describe('§15 — isRequestBookableLeadTime (the preserved 120-minute edge)', () => {
  const NOW = new Date('2099-01-01T12:00:00Z');

  it('one instant AFTER the 120-minute edge: request-bookable', () => {
    const startTime = new Date(NOW.getTime() + 120 * 60_000 + 1);

    expect(isRequestBookableLeadTime({ startTime, now: NOW })).toBe(true);
  });

  it('EXACTLY at the 120-minute edge: NOT request-bookable (zero actionable review minutes)', () => {
    const startTime = new Date(NOW.getTime() + 120 * 60_000);

    expect(isRequestBookableLeadTime({ startTime, now: NOW })).toBe(false);
  });

  it('one instant BEFORE the 120-minute edge: NOT request-bookable', () => {
    const startTime = new Date(NOW.getTime() + 120 * 60_000 - 1);

    expect(isRequestBookableLeadTime({ startTime, now: NOW })).toBe(false);
  });

  it('well past the edge (a week out): request-bookable', () => {
    const startTime = new Date(NOW.getTime() + 7 * 24 * 60 * 60_000);

    expect(isRequestBookableLeadTime({ startTime, now: NOW })).toBe(true);
  });

  it('differs from instant booking at exactly the edge: instant ALLOWS it, request-approval does not', () => {
    // Mirrors route.ts's own instant-booking check: `startTime < minimumStartTime` (strict) is
    // the REJECTION condition, so `startTime === minimumStartTime` is ALLOWED for instant.
    const startTime = new Date(NOW.getTime() + REQUEST_APPROVAL_MIN_LEAD_TIME_MINUTES * 60_000);
    const minimumStartTime = new Date(NOW.getTime() + REQUEST_APPROVAL_MIN_LEAD_TIME_MINUTES * 60_000);
    const instantWouldReject = startTime.getTime() < minimumStartTime.getTime();

    expect(instantWouldReject).toBe(false); // instant: allowed
    expect(isRequestBookableLeadTime({ startTime, now: NOW })).toBe(false); // request-approval: rejected
  });
});

describe('§15 — minimum-notice structural parity with the platform fallback', () => {
  it.each([
    'src/app/api/appointments/route.ts',
    'src/app/api/appointments/availability/route.ts',
  ])('%s consumes the salon booking configuration', (relativePath) => {
    const source = readFileSync(path.join(process.cwd(), relativePath), 'utf8');

    expect(source).toContain('bookingConfig.minimumNoticeMinutes');
  });

  it('keeps the established 120-minute fallback for legacy salon settings', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/libs/bookingConfig.ts'), 'utf8');

    expect(source).toMatch(/minimumNoticeMinutes:\s*120/);
  });

  it('REQUEST_APPROVAL_MIN_LEAD_TIME_MINUTES equals the platform value', () => {
    expect(REQUEST_APPROVAL_MIN_LEAD_TIME_MINUTES).toBe(120);
  });
});

describe('§15 — evaluateRequestBookingEligibility', () => {
  const NOW = new Date('2099-06-01T12:00:00Z'); // a Monday

  it('rejects with lead_time_too_soon before the eligibility-vs-schedule check even runs', () => {
    const startTime = new Date(NOW.getTime() + 60 * 60_000); // 1 hour out
    const decision = evaluateRequestBookingEligibility({
      startTime,
      endTime: new Date(startTime.getTime() + 30 * 60_000),
      weeklySchedule: FULL_WEEK,
      existingAppointments: [],
      now: NOW,
    });

    expect(decision).toEqual({ eligible: false, reason: 'lead_time_too_soon' });
  });

  it('eligible once past the lead time AND within the existing schedule authority', () => {
    const startTime = new Date('2099-06-03T15:00:00Z'); // Wednesday, well past lead time
    const decision = evaluateRequestBookingEligibility({
      startTime,
      endTime: new Date(startTime.getTime() + 30 * 60_000),
      weeklySchedule: FULL_WEEK,
      existingAppointments: [],
      now: NOW,
    });

    expect(decision).toEqual({ eligible: true });
  });

  it('DST: a slot past the lead time but outside the (unaffected) weekly window is still correctly evaluated across a DST transition', () => {
    // 2026-03-08 is the US/Canada spring-forward DST date. A slot the
    // following day at a normal daytime hour must still resolve exactly as
    // any other day — proving no DST-related off-by-one leaks through the
    // reused schedule authority.
    const now = new Date('2026-03-08T12:00:00Z');
    const startTime = new Date('2026-03-09T15:00:00Z'); // the Monday after, 09:00-10:00 local-ish
    const decision = evaluateRequestBookingEligibility({
      startTime,
      endTime: new Date(startTime.getTime() + 30 * 60_000),
      weeklySchedule: FULL_WEEK,
      existingAppointments: [],
      now,
    });

    expect(decision).toEqual({ eligible: true });
  });

  it('OVERNIGHT schedule: delegates to canTechnicianTakeAppointment unchanged — differential proof, not a re-assertion of its (pre-existing, unowned-by-this-PR) overnight semantics', () => {
    const overnightSchedule = { ...FULL_WEEK, wednesday: { start: '22:00', end: '02:00' } };
    const startTime = new Date('2099-06-03T23:00:00Z'); // well past the lead time
    const callArgs = {
      startTime,
      endTime: new Date(startTime.getTime() + 30 * 60_000),
      weeklySchedule: overnightSchedule,
      existingAppointments: [],
    };

    const directDecision = canTechnicianTakeAppointment(callArgs);
    const wrapperDecision = evaluateRequestBookingEligibility({ ...callArgs, now: NOW });

    // Whatever the existing authority decides for an overnight window, this
    // wrapper must report EXACTLY that decision once the lead-time gate
    // (already proven separately above) is satisfied — never a second,
    // divergent opinion about the same schedule.
    if (directDecision.available) {
      expect(wrapperDecision).toEqual({ eligible: true });
    } else {
      expect(wrapperDecision).toEqual({ eligible: false, reason: directDecision.reason });
    }
  });

  it('SPLIT WINDOWS and NON-PRIMARY LOCATION: delegates to canTechnicianTakeAppointment unchanged (day_off / blocked_slot / location_unavailable all pass through as the reason)', () => {
    const startTime = new Date('2099-06-03T15:00:00Z');
    const dayOff = evaluateRequestBookingEligibility({
      startTime,
      endTime: new Date(startTime.getTime() + 30 * 60_000),
      weeklySchedule: { ...FULL_WEEK, wednesday: undefined },
      existingAppointments: [],
      now: NOW,
    });

    expect(dayOff).toEqual({ eligible: false, reason: 'day_off' });

    const blockedSlot = evaluateRequestBookingEligibility({
      startTime,
      endTime: new Date(startTime.getTime() + 30 * 60_000),
      weeklySchedule: FULL_WEEK,
      existingAppointments: [],
      // startTime is 15:00 UTC = 11:00 America/Toronto (EDT, UTC-4) in June.
      blockedSlots: [{ startTime: '11:00', endTime: '11:30', label: 'Lunch' }],
      now: NOW,
    });

    expect(blockedSlot).toEqual({ eligible: false, reason: 'blocked_slot' });

    const nonPrimaryLocation = evaluateRequestBookingEligibility({
      startTime,
      endTime: new Date(startTime.getTime() + 30 * 60_000),
      weeklySchedule: FULL_WEEK,
      existingAppointments: [],
      primaryLocationId: 'loc_a',
      locationId: 'loc_b',
      now: NOW,
    });

    expect(nonPrimaryLocation).toEqual({ eligible: false, reason: 'location_unavailable' });
  });

  it('exact boundary: still gated by the buffered-conflict check inherited from the existing authority', () => {
    const startTime = new Date('2099-06-03T15:00:00Z');
    const decision = evaluateRequestBookingEligibility({
      startTime,
      endTime: new Date(startTime.getTime() + 30 * 60_000),
      weeklySchedule: FULL_WEEK,
      existingAppointments: [{
        id: 'appt_existing',
        startTime: new Date('2099-06-03T14:30:00Z'),
        endTime: new Date('2099-06-03T15:00:00Z'),
      }],
      now: NOW,
    });

    // hasBufferedConflict applies DEFAULT_BUFFER_MINUTES after the existing
    // appointment's end — this pins that the reused authority's own buffer
    // logic still applies unmodified through this wrapper.
    expect(decision).toEqual({ eligible: false, reason: 'time_conflict' });
  });
});

// =============================================================================
// THE RATIFIED DEADLINE ALGORITHM
// =============================================================================

describe('resolveRequestApprovalDeadline — exact boundary / one instant before / 120-minute edge', () => {
  const NOW = new Date('2099-06-01T12:00:00Z'); // Monday
  const BUSINESS_HOURS_WINDOWS: ReviewWindowInterval[] = [
    { start: new Date('2099-06-01T09:00:00Z'), end: new Date('2099-06-01T17:00:00Z') }, // Mon
    { start: new Date('2099-06-02T09:00:00Z'), end: new Date('2099-06-02T17:00:00Z') }, // Tue
    { start: new Date('2099-06-03T09:00:00Z'), end: new Date('2099-06-03T17:00:00Z') }, // Wed
  ];

  it('EXACT DEADLINE: a deterministic scenario produces the exact expected instant', () => {
    // startTime far out (Wed 10:00) -> hardDeadline = Wed 08:00. Nominal
    // candidate = min(now+12h = Mon 24:00, Wed08:00) = Tue 00:00 -> outside
    // every window -> snaps back to the latest window end at/before it:
    // Monday's 17:00. Reviewable minutes from now(Mon12:00) to Mon17:00 =
    // 300min >= the 60min minimum, so no further extension is needed.
    const result = resolveRequestApprovalDeadline({
      now: NOW,
      startTime: new Date('2099-06-03T10:00:00Z'),
      reviewWindows: BUSINESS_HOURS_WINDOWS,
    });

    expect(result).toEqual({ ok: true, deadline: new Date('2099-06-01T17:00:00Z') });
  });

  it('the preserved 120-minute edge: EXACTLY now+120min -> capped_before_now, not bookable', () => {
    const result = resolveRequestApprovalDeadline({
      now: NOW,
      startTime: new Date(NOW.getTime() + 120 * 60_000),
      reviewWindows: BUSINESS_HOURS_WINDOWS,
    });

    expect(result).toEqual({ ok: false, reason: 'capped_before_now' });
  });

  it('one instant BEFORE the 120-minute edge: still not bookable', () => {
    const result = resolveRequestApprovalDeadline({
      now: NOW,
      startTime: new Date(NOW.getTime() + 120 * 60_000 - 1),
      reviewWindows: BUSINESS_HOURS_WINDOWS,
    });

    expect(result).toEqual({ ok: false, reason: 'capped_before_now' });
  });

  it('one instant AFTER the 120-minute edge, but with insufficient reviewable time: no_reviewable_window', () => {
    // now is deep in a closed period (Mon 23:00, hours close at 17:00) and
    // the hard cap lands only 3 minutes later, still inside the closed gap.
    const closedNow = new Date('2099-06-01T23:00:00Z');
    const result = resolveRequestApprovalDeadline({
      now: closedNow,
      startTime: new Date(closedNow.getTime() + 120 * 60_000 + 3 * 60_000 + 1),
      reviewWindows: BUSINESS_HOURS_WINDOWS,
    });

    expect(result).toEqual({ ok: false, reason: 'no_reviewable_window' });
  });

  it('a fully-closed range (zero windows) fails closed, never invents a deadline', () => {
    const result = resolveRequestApprovalDeadline({
      now: NOW,
      startTime: new Date('2099-06-03T10:00:00Z'),
      reviewWindows: [],
    });

    expect(result).toEqual({ ok: false, reason: 'no_reviewable_window' });
  });

  it('every ok result satisfies the invariant: inside/at a window boundary, strictly after now, strictly before startTime, at or before the cap', () => {
    const startTime = new Date('2099-06-03T10:00:00Z');
    const result = resolveRequestApprovalDeadline({ now: NOW, startTime, reviewWindows: BUSINESS_HOURS_WINDOWS });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error('expected ok');
    }
    const hardDeadline = new Date(startTime.getTime() - 120 * 60_000);

    expect(result.deadline.getTime()).toBeGreaterThan(NOW.getTime());
    expect(result.deadline.getTime()).toBeLessThan(startTime.getTime());
    expect(result.deadline.getTime()).toBeLessThanOrEqual(hardDeadline.getTime());

    const insideOrAtBoundary = BUSINESS_HOURS_WINDOWS.some(
      w => result.deadline.getTime() >= w.start.getTime() && result.deadline.getTime() <= w.end.getTime(),
    );

    expect(insideOrAtBoundary).toBe(true);
  });
});

describe('resolveRequestApprovalDeadline — extension to meet the reviewable-minutes minimum', () => {
  it('extends forward across a gap when the snapped-back candidate has too little reviewable time', () => {
    const now = new Date('2099-06-01T16:50:00Z'); // 10 minutes before Monday's window closes
    const windows: ReviewWindowInterval[] = [
      { start: new Date('2099-06-01T09:00:00Z'), end: new Date('2099-06-01T17:00:00Z') },
      { start: new Date('2099-06-02T09:00:00Z'), end: new Date('2099-06-02T17:00:00Z') },
    ];
    // startTime far enough out that the hard cap doesn't bind.
    const startTime = new Date('2099-06-03T10:00:00Z');

    const result = resolveRequestApprovalDeadline({ now, startTime, reviewWindows: windows, minReviewableMinutes: 60 });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error('expected ok');
    }

    // Only 10 reviewable minutes exist before Monday's close; the algorithm
    // must extend into Tuesday's window to accumulate the remaining 50.
    expect(result.deadline.getTime()).toBeGreaterThan(new Date('2099-06-02T09:00:00Z').getTime());
    expect(result.deadline).toEqual(new Date('2099-06-02T09:50:00Z'));
  });

  it('never extends past the hard cap, even if that means insufficient reviewable time -> not bookable', () => {
    const now = new Date('2099-06-01T16:55:00Z');
    const windows: ReviewWindowInterval[] = [
      { start: new Date('2099-06-01T09:00:00Z'), end: new Date('2099-06-01T17:00:00Z') },
    ];
    // hardDeadline = startTime - 120min = Mon 17:02 — only 2 minutes past
    // the only window this fixture defines, nowhere near the 60-minute
    // minimum, and there is no second window to extend into.
    const startTime = new Date('2099-06-01T19:02:00Z');

    const result = resolveRequestApprovalDeadline({ now, startTime, reviewWindows: windows, minReviewableMinutes: 60 });

    expect(result).toEqual({ ok: false, reason: 'no_reviewable_window' });
  });
});

describe('resolveRequestApprovalDeadline — SPLIT WINDOWS (accumulation across a same-day gap)', () => {
  it('accumulates across two short same-day windows, then finishes mid-window on a later day', () => {
    const now = new Date('2099-06-01T08:00:00Z'); // Monday
    // Monday split shift: two short windows (30min each), nowhere near the
    // 5h minimum on their own — then Tuesday opens 09:00-18:00.
    const windows: ReviewWindowInterval[] = [
      { start: new Date('2099-06-01T09:00:00Z'), end: new Date('2099-06-01T09:30:00Z') },
      { start: new Date('2099-06-01T14:00:00Z'), end: new Date('2099-06-01T14:30:00Z') },
      { start: new Date('2099-06-02T09:00:00Z'), end: new Date('2099-06-02T18:00:00Z') },
    ];
    const startTime = new Date('2099-06-05T10:00:00Z'); // hard cap far away, doesn't bind

    // The NOMINAL 12h-out candidate (Mon 20:00) is past both Monday windows
    // and snaps back to Monday 14:30 — which only has 60 reviewable minutes
    // behind it (30 + 30), well under the 300-minute ask, forcing extension.
    const result = resolveRequestApprovalDeadline({
      now,
      startTime,
      reviewWindows: windows,
      minReviewableMinutes: 300,
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error('expected ok');
    }

    // 30 + 30 = 60 from Monday's two windows, then 240 more minutes (4h)
    // into Tuesday's window: Tue 09:00 + 4h = Tue 13:00.
    expect(result.deadline).toEqual(new Date('2099-06-02T13:00:00Z'));
  });
});

// =============================================================================
// REVIEW-WINDOW EXPANSION — business hours -> concrete intervals
// =============================================================================

describe('expandReviewWindows — overnight (midnight-crossing) hours', () => {
  it('a close time at/before the open time spans into the NEXT calendar day', () => {
    const windows = expandReviewWindows({
      rangeStart: new Date('2099-06-05T00:00:00Z'), // Friday, well before the window
      rangeEnd: new Date('2099-06-07T00:00:00Z'),
      timeZone: 'UTC',
      businessHours: { friday: { open: '22:00', close: '02:00' } },
    });

    // Exactly one Friday-night window, spanning into Saturday.
    const fridayNight = windows.filter(w => w.start.getUTCDate() === 5 || w.end.getUTCDate() === 6);

    expect(fridayNight).toHaveLength(1);
    expect(fridayNight[0]).toEqual({
      start: new Date('2099-06-05T22:00:00Z'),
      end: new Date('2099-06-06T02:00:00Z'),
    });
    expect(fridayNight[0]!.end.getTime()).toBeGreaterThan(fridayNight[0]!.start.getTime());
  });

  it('a same-day close after open produces a SAME-day window, not an overnight one', () => {
    const windows = expandReviewWindows({
      rangeStart: new Date('2099-06-01T00:00:00Z'),
      rangeEnd: new Date('2099-06-02T00:00:00Z'),
      timeZone: 'UTC',
      businessHours: { monday: { open: '09:00', close: '17:00' } },
    });

    expect(windows).toEqual([{ start: new Date('2099-06-01T09:00:00Z'), end: new Date('2099-06-01T17:00:00Z') }]);
  });
});

describe('expandReviewWindows — SPLIT WINDOWS via the settings override', () => {
  it('produces two distinct intervals for a day with two override ranges', () => {
    const windows = expandReviewWindows({
      rangeStart: new Date('2099-06-01T00:00:00Z'),
      rangeEnd: new Date('2099-06-02T00:00:00Z'),
      timeZone: 'UTC',
      businessHours: null,
      overrideWindows: {
        monday: [
          { start: '09:00', end: '13:00' },
          { start: '14:00', end: '18:00' },
        ],
      },
    });

    expect(windows).toEqual([
      { start: new Date('2099-06-01T09:00:00Z'), end: new Date('2099-06-01T13:00:00Z') },
      { start: new Date('2099-06-01T14:00:00Z'), end: new Date('2099-06-01T18:00:00Z') },
    ]);
  });

  it('the override REPLACES business hours entirely — a day absent from the override is closed even if business hours has it', () => {
    const windows = expandReviewWindows({
      rangeStart: new Date('2099-06-01T00:00:00Z'),
      rangeEnd: new Date('2099-06-02T00:00:00Z'),
      timeZone: 'UTC',
      businessHours: { monday: { open: '09:00', close: '17:00' } },
      overrideWindows: { tuesday: [{ start: '09:00', end: '17:00' }] },
    });

    expect(windows).toEqual([]);
  });
});

describe('expandReviewWindows — DST (spring-forward)', () => {
  it('correctly converts local hours to UTC on both sides of a DST transition', () => {
    // 2026-03-08 is the US/Canada spring-forward date (clocks 2:00am -> 3:00am).
    const windows = expandReviewWindows({
      rangeStart: new Date('2026-03-07T00:00:00Z'),
      rangeEnd: new Date('2026-03-10T00:00:00Z'),
      timeZone: 'America/Toronto',
      businessHours: {
        saturday: { open: '09:00', close: '17:00' }, // Mar 7, still EST (UTC-5)
        sunday: { open: '09:00', close: '17:00' }, // Mar 8, DST begins mid-day -> EDT by 09:00
        monday: { open: '09:00', close: '17:00' }, // Mar 9, EDT (UTC-4)
      },
    });

    const bySaturday = windows.find(w => w.start.toISOString().startsWith('2026-03-07'));
    const bySunday = windows.find(w => w.start.toISOString().startsWith('2026-03-08'));
    const byMonday = windows.find(w => w.start.toISOString().startsWith('2026-03-09'));

    // Pre-DST: 09:00 EST = 14:00 UTC.
    expect(bySaturday).toEqual({ start: new Date('2026-03-07T14:00:00Z'), end: new Date('2026-03-07T22:00:00Z') });
    // Post-DST: 09:00 EDT = 13:00 UTC — the UTC instant shifts an hour earlier.
    expect(bySunday).toEqual({ start: new Date('2026-03-08T13:00:00Z'), end: new Date('2026-03-08T21:00:00Z') });
    expect(byMonday).toEqual({ start: new Date('2026-03-09T13:00:00Z'), end: new Date('2026-03-09T21:00:00Z') });
  });
});

describe('expandReviewWindows — DST (fall-back, the ambiguous repeated hour)', () => {
  it('correctly converts local hours to UTC on both sides of a DST fall-back transition', () => {
    // 2026-11-01 is the US/Canada fall-back date (clocks 2:00am EDT -> 1:00am EST).
    const windows = expandReviewWindows({
      rangeStart: new Date('2026-10-31T00:00:00Z'),
      rangeEnd: new Date('2026-11-03T00:00:00Z'),
      timeZone: 'America/Toronto',
      businessHours: {
        saturday: { open: '09:00', close: '17:00' }, // Oct 31, still EDT (UTC-4)
        sunday: { open: '09:00', close: '17:00' }, // Nov 1, DST already ended by 09:00 -> EST
        monday: { open: '09:00', close: '17:00' }, // Nov 2, EST (UTC-5)
      },
    });

    const bySaturday = windows.find(w => w.start.toISOString().startsWith('2026-10-31'));
    const bySunday = windows.find(w => w.start.toISOString().startsWith('2026-11-01'));
    const byMonday = windows.find(w => w.start.toISOString().startsWith('2026-11-02'));

    // Pre-fall-back: 09:00 EDT = 13:00 UTC.
    expect(bySaturday).toEqual({ start: new Date('2026-10-31T13:00:00Z'), end: new Date('2026-10-31T21:00:00Z') });
    // Post-fall-back: 09:00 EST = 14:00 UTC — the UTC instant shifts an hour later.
    expect(bySunday).toEqual({ start: new Date('2026-11-01T14:00:00Z'), end: new Date('2026-11-01T22:00:00Z') });
    expect(byMonday).toEqual({ start: new Date('2026-11-02T14:00:00Z'), end: new Date('2026-11-02T22:00:00Z') });
  });

  it('a window spanning the ambiguous repeated hour (01:00-02:00 local occurs twice) resolves deterministically and is one UTC hour LONGER than its local-clock span suggests', () => {
    // 00:30-02:00 local reads as 1.5 hours on a wall clock, but the clock
    // actually runs 00:30 EDT -> 01:00 EDT -> [falls back] -> 01:00 EST ->
    // 02:00 EST that morning — 2.5 REAL hours elapse. A naive "just subtract
    // the local times" implementation would silently produce the wrong
    // duration here; going through `zonedTimeToUtc` for BOTH endpoints (as
    // `expandReviewWindows` does) cannot make that mistake, because it
    // never computes a duration from local strings at all — only from the
    // two resolved UTC instants.
    const windows = expandReviewWindows({
      rangeStart: new Date('2026-11-01T00:00:00Z'),
      rangeEnd: new Date('2026-11-01T12:00:00Z'),
      timeZone: 'America/Toronto',
      businessHours: {
        sunday: { open: '00:30', close: '02:00' },
      },
    });

    expect(windows).toHaveLength(1);

    const [window] = windows;

    // 00:30 EDT (pre-transition, UTC-4) = 04:30 UTC.
    expect(window!.start).toEqual(new Date('2026-11-01T04:30:00Z'));
    // 02:00 is unambiguous — the fall-back has already happened by then —
    // EST (UTC-5): 07:00 UTC.
    expect(window!.end).toEqual(new Date('2026-11-01T07:00:00Z'));
    // 2.5 hours of REAL elapsed time, not the 1.5 a naive local-clock
    // subtraction would compute.
    expect(window!.end.getTime() - window!.start.getTime()).toBe(2.5 * 60 * 60_000);
  });

  it('resolveRequestApprovalDeadline composes correctly across the fall-back transition: reviewable minutes reflect REAL elapsed time, not local wall-clock arithmetic', () => {
    // `now` sits just before the ambiguous hour begins; the deadline
    // algorithm must be able to accumulate the true 2.5 real hours in the
    // 00:30-02:00 window above to satisfy a minimum that a naive
    // (wrong) 1.5-hour reading would fail.
    const now = new Date('2026-11-01T00:00:00Z'); // 2026-10-31T20:00 EDT — before the window opens
    const startTime = new Date('2026-11-03T00:00:00Z'); // days out; the hard cap does not bind
    const windows = expandReviewWindows({
      rangeStart: now,
      rangeEnd: new Date('2026-11-01T12:00:00Z'),
      timeZone: 'America/Toronto',
      businessHours: { sunday: { open: '00:30', close: '02:00' } },
    });

    // 140 minutes: reachable only by crediting the full 2.5 real hours
    // (150 min) the ambiguous-hour window actually spans — impossible under
    // a naive 90-minute (1.5h) local-clock reading.
    const result = resolveRequestApprovalDeadline({
      now,
      startTime,
      reviewWindows: windows,
      minReviewableMinutes: 140,
    });

    expect(result.ok).toBe(true);
  });
});

describe('expandReviewWindows — malformed / empty schedule fails closed', () => {
  it('a null businessHours with no override produces zero windows', () => {
    const windows = expandReviewWindows({
      rangeStart: new Date('2099-06-01T00:00:00Z'),
      rangeEnd: new Date('2099-06-08T00:00:00Z'),
      timeZone: 'UTC',
      businessHours: null,
    });

    expect(windows).toEqual([]);
  });

  it('a fully-closed week (every day null) produces zero windows', () => {
    const windows = expandReviewWindows({
      rangeStart: new Date('2099-06-01T00:00:00Z'),
      rangeEnd: new Date('2099-06-08T00:00:00Z'),
      timeZone: 'UTC',
      businessHours: {
        sunday: null,
        monday: null,
        tuesday: null,
        wednesday: null,
        thursday: null,
        friday: null,
        saturday: null,
      },
    });

    expect(windows).toEqual([]);
  });

  it('malformed HH:MM strings are skipped, not thrown, and do not corrupt other days', () => {
    const windows = expandReviewWindows({
      rangeStart: new Date('2099-06-01T00:00:00Z'),
      rangeEnd: new Date('2099-06-03T00:00:00Z'),
      timeZone: 'UTC',
      businessHours: {
        monday: { open: 'nine am', close: '17:00' },
        tuesday: { open: '09:00', close: '17:00' },
      },
    });

    expect(windows).toEqual([{ start: new Date('2099-06-02T09:00:00Z'), end: new Date('2099-06-02T17:00:00Z') }]);
  });
});

// =============================================================================
// resolveExplicitRequestApprovalActivation — the wired-in entry point
// =============================================================================

describe('resolveExplicitRequestApprovalActivation', () => {
  const NOW = new Date('2099-06-01T08:00:00Z'); // Monday

  it('activates with a computed deadline when the technician is eligible and a valid deadline exists', () => {
    const startTime = new Date('2099-06-03T15:00:00Z');
    const result = resolveExplicitRequestApprovalActivation({
      startTime,
      endTime: new Date(startTime.getTime() + 30 * 60_000),
      weeklySchedule: FULL_WEEK,
      existingAppointments: [],
      now: NOW,
      timeZone: 'UTC',
      locationBusinessHoursForReview: { monday: { open: '09:00', close: '17:00' }, tuesday: { open: '09:00', close: '17:00' } },
    });

    expect(result.activates).toBe(true);
  });

  it('does NOT activate when the technician itself is ineligible (schedule authority), independent of review windows', () => {
    const startTime = new Date('2099-06-03T15:00:00Z');
    const result = resolveExplicitRequestApprovalActivation({
      startTime,
      endTime: new Date(startTime.getTime() + 30 * 60_000),
      weeklySchedule: { ...FULL_WEEK, wednesday: undefined },
      existingAppointments: [],
      now: NOW,
      timeZone: 'UTC',
      locationBusinessHoursForReview: { monday: { open: '09:00', close: '17:00' } },
    });

    expect(result).toEqual({ activates: false, reason: 'day_off' });
  });

  it('does NOT activate when the technician is eligible but the location is never open (fully closed schedule) — fails safely, no deadline invented', () => {
    const startTime = new Date('2099-06-03T15:00:00Z');
    const result = resolveExplicitRequestApprovalActivation({
      startTime,
      endTime: new Date(startTime.getTime() + 30 * 60_000),
      weeklySchedule: FULL_WEEK,
      existingAppointments: [],
      now: NOW,
      timeZone: 'UTC',
      locationBusinessHoursForReview: null,
    });

    expect(result).toEqual({ activates: false, reason: 'no_reviewable_window' });
  });

  it('a scheduleSettings.minReviewableMinutes override reaches the deadline algorithm end to end', () => {
    // A tiny 5-minute window on Monday, then closed until Wednesday. With
    // the DEFAULT 60min minimum this would fail (`no_reviewable_window`);
    // overriding the minimum down to 5 makes the same tiny window sufficient.
    const startTime = new Date('2099-06-03T20:00:00Z'); // hard cap far away, doesn't bind
    const businessHours = { monday: { open: '08:00', close: '08:05' } };

    const withDefaultMinimum = resolveExplicitRequestApprovalActivation({
      startTime,
      endTime: new Date(startTime.getTime() + 30 * 60_000),
      weeklySchedule: FULL_WEEK,
      existingAppointments: [],
      now: NOW,
      timeZone: 'UTC',
      locationBusinessHoursForReview: businessHours,
    });

    expect(withDefaultMinimum).toEqual({ activates: false, reason: 'no_reviewable_window' });

    const withOverride = resolveExplicitRequestApprovalActivation({
      startTime,
      endTime: new Date(startTime.getTime() + 30 * 60_000),
      weeklySchedule: FULL_WEEK,
      existingAppointments: [],
      now: NOW,
      timeZone: 'UTC',
      locationBusinessHoursForReview: businessHours,
      scheduleSettings: { minReviewableMinutes: 5 },
    });

    expect(withOverride.activates).toBe(true);
  });
});

describe('resolveRequestApprovalDeadline — leadCapMinutes override', () => {
  it('a tighter override cap moves the hard deadline earlier, independent of the platform default', () => {
    const now = new Date('2099-06-01T08:00:00Z');
    const startTime = new Date('2099-06-01T09:00:00Z'); // 60 minutes out
    const windows: ReviewWindowInterval[] = [
      { start: new Date('2099-06-01T00:00:00Z'), end: new Date('2099-06-01T23:59:00Z') },
    ];

    // Default 120min cap: hardDeadline (Mon 07:00) is already before `now` -> not bookable.
    const withDefault = resolveRequestApprovalDeadline({ now, startTime, reviewWindows: windows });

    expect(withDefault).toEqual({ ok: false, reason: 'capped_before_now' });

    // Overridden 30min cap: hardDeadline = Mon 08:30, after `now` -> bookable.
    const withOverride = resolveRequestApprovalDeadline({
      now,
      startTime,
      reviewWindows: windows,
      leadCapMinutes: 30,
      minReviewableMinutes: 5,
    });

    expect(withOverride.ok).toBe(true);
  });
});
