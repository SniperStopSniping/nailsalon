import 'server-only';

import {
  canTechnicianTakeAppointment,
  type TechnicianBookingDecision,
} from '@/libs/bookingPolicy';
import { getDateKeyInTimeZone, zonedTimeToUtc } from '@/libs/timeZone';
import type {
  RequestApprovalScheduleSettings,
  RequestApprovalWindowRange,
} from '@/types/salonPolicy';

/**
 * Luster L1 PR4 — §14 (request-approval terms) and §15 (request eligibility
 * / time). Now WIRED into `route.ts` (see the "EXPLICIT REQUEST-APPROVAL
 * ACTIVATION" section below and route.ts's own call site), after a first
 * pass of this PR shipped it deliberately unwired pending two decisions:
 *
 *   1. The ratified deadline algorithm (`resolveRequestApprovalDeadline`,
 *      below) — supplied by the coordinator after review; REPLACES this
 *      module's original `requestExpiresAt = startTime` placeholder.
 *   2. How an accepted request-approval booking interacts with deposits,
 *      Stripe, and notifications — resolved as: EXPLICIT request-approval
 *      activation is checked ONLY when the existing deposit-charge decision
 *      is ABSENT (`depositCharge` falsy in route.ts). If a deposit IS
 *      required, current main's existing status/deposit logic wins
 *      UNCHANGED and this module's activation never fires for that
 *      submission — "current main wins" applied literally, not a guess.
 *      PR5's expiry finalization/sweep/decline lifecycle is still NOT
 *      implemented here; this module only ever CREATES a correctly-dated
 *      request.
 *
 * NOT EVERY EXPORT OF THIS MODULE IS WIRED. `resolveExplicitRequestApprovalActivation`
 * (eligibility + `resolveRequestApprovalDeadline`) is. `computeRequestApprovalTerms`
 * / `haveRequestApprovalTermsChanged` — the client-shown-terms comparison
 * that would return `REQUEST_APPROVAL_TERMS_CHANGED` — is NOT: no public UI
 * exists yet to show a customer these terms or send one back (PR7 is out of
 * scope), so there is nothing for a comparison to run against. Built and
 * tested, ready for that PR to wire in.
 *
 * STAYS DARK FOR EVERY REAL SALON TODAY, for two independent reasons: (a)
 * `resolveCatalogDomainView` gates the whole catalog resolver path off
 * unless a salon has explicitly opted into a dark `catalog.*` feature key
 * (unreachable by any preset); (b) even on a gated fixture salon, this only
 * activates when a service/variant's `confirmation_mode` is explicitly
 * `'request_approval'`. S6 (Stage 1) correction: this previously added "since
 * no owner editor exists to set it (PR6)". That half is now false — PR6 shipped
 * the editor and the value persists. Reason (a) alone still makes the path
 * unreachable for every real salon.
 *
 * WHAT THIS MODULE REUSES, NOT REINVENTS: `canTechnicianTakeAppointment`
 * (`bookingPolicy.ts`) — the EXACT SAME weekly-schedule / override / time-off
 * / blocked-slot / location authority instant booking already uses, for
 * TECHNICIAN eligibility. `zonedTimeToUtc` / `getDateKeyInTimeZone`
 * (`@/libs/timeZone`) — the same DST-safe zone conversion the rest of the
 * booking path uses — for expanding a LOCATION's business hours into
 * concrete review windows, since no existing reader in this codebase
 * expands `business_hours` into overnight/split-aware intervals (confirmed
 * by search before writing `expandReviewWindows`).
 */

// =============================================================================
// §14 — REQUEST-APPROVAL TERMS
// =============================================================================

/**
 * Static version identifier for the request-approval ELIGIBILITY RULES this
 * module implements — NOT a per-salon configurable value; the RULES
 * (lead cap, nominal window, minimum reviewable minutes, the window-source
 * precedence) are code, even though their NUMERIC KNOBS are now overridable
 * per salon via `settings.catalog.requestApproval` (`types/salonPolicy.ts`).
 * Bump this string if the rules themselves ever change in a way that should
 * invalidate a client's already-displayed terms. Confirmed acceptable as a
 * static constant, not a hash over mutable schedule data, per coordinator
 * review.
 */
export const REQUEST_APPROVAL_POLICY_REVISION = 'request-approval-policy-v1';

export type RequestApprovalTerms = {
  policyRevision: string;
  /** ISO-8601 instant these terms were computed. Never compared for equality — it is expected to differ on every recompute. */
  evaluatedAt: string;
  /**
   * ISO-8601 deadline by which the salon must act before the request lapses
   * — the `resolveRequestApprovalDeadline` output, ALWAYS supplied by the
   * caller (never derived from `startTime` here; see that function for the
   * ratified algorithm). No PR5 sweep/finalization logic is implemented or
   * implied by computing this value — see `appointmentBlocking.ts` for how
   * a persisted expiry stops blocking once past.
   */
  requestExpiresAt: string;
  selectedLocationId: string | null;
};

export function computeRequestApprovalTerms(args: {
  evaluatedAt: Date;
  deadline: Date;
  selectedLocationId: string | null;
}): RequestApprovalTerms {
  return {
    policyRevision: REQUEST_APPROVAL_POLICY_REVISION,
    evaluatedAt: args.evaluatedAt.toISOString(),
    requestExpiresAt: args.deadline.toISOString(),
    selectedLocationId: args.selectedLocationId,
  };
}

/** What a client submits back as "the terms I was shown and accepted" — the same shape minus `evaluatedAt`, which is never compared. */
export type ClientAcknowledgedRequestApprovalTerms = {
  policyRevision: string;
  requestExpiresAt: string;
  selectedLocationId: string | null;
};

/**
 * True when `fresh` differs from what the client acknowledged in any field
 * that matters — the caller's cue to return `REQUEST_APPROVAL_TERMS_CHANGED`
 * with the fresh terms rather than proceed. `evaluatedAt` is deliberately
 * excluded: it always differs (a fresh recompute has a fresh timestamp), and
 * comparing it would make this function permanently report "changed."
 */
export function haveRequestApprovalTermsChanged(
  fresh: RequestApprovalTerms,
  acknowledged: ClientAcknowledgedRequestApprovalTerms,
): boolean {
  return fresh.policyRevision !== acknowledged.policyRevision
    || fresh.requestExpiresAt !== acknowledged.requestExpiresAt
    || fresh.selectedLocationId !== acknowledged.selectedLocationId;
}

// =============================================================================
// §15 — REQUEST ELIGIBILITY / TIME
// =============================================================================

/**
 * Mirrors (does not import — no shared module currently exports it) the
 * platform's existing 2-hour instant-booking lead time, redeclared in three
 * places today: `src/app/api/appointments/route.ts`,
 * `src/app/api/appointments/availability/route.ts`, and
 * `src/app/(unauth)/change-appointment/ChangeAppointmentContent.tsx` (all
 * `const MIN_LEAD_TIME_MINUTES = 120`). A structural test in this module's
 * test file pins this constant equal to all three, so a future change to
 * one without the others fails the suite instead of silently diverging.
 */
export const REQUEST_APPROVAL_MIN_LEAD_TIME_MINUTES = 120;

/**
 * The preserved 120-minute edge (§15): a slot at EXACTLY the ordinary
 * instant-booking lead-time edge (`now + 120min`) has zero ADDITIONAL
 * minutes beyond what instant booking already requires — no runway for
 * staff to actually review a request before it would otherwise begin. So
 * unlike instant booking's `startTime < minimumStartTime` (which ALLOWS
 * exactly-120-minutes-out), request-bookability requires a STRICTLY LATER
 * start: `startTime > minimumStartTime`. At the exact boundary, or any
 * instant before it, this returns `false`.
 */
export function isRequestBookableLeadTime(args: { startTime: Date; now: Date }): boolean {
  const minimumStartTime = new Date(
    args.now.getTime() + REQUEST_APPROVAL_MIN_LEAD_TIME_MINUTES * 60_000,
  );
  return args.startTime.getTime() > minimumStartTime.getTime();
}

type UnavailableReason = Extract<TechnicianBookingDecision, { available: false }>['reason'];

export type RequestEligibilityDecision =
  | { eligible: true }
  | { eligible: false; reason: 'lead_time_too_soon' | UnavailableReason };

/**
 * The full §15 eligibility decision for one candidate slot: the lead-time
 * edge above, THEN (only if that passes) the existing location/schedule
 * authority — weekly hours, day/time-off overrides, blocked slots
 * ("split windows" within a day), buffered conflicts, and non-primary
 * location support — via `canTechnicianTakeAppointment`
 * (`bookingPolicy.ts`), UNCHANGED. This function adds no new schedule logic
 * of its own; it only adds the stricter lead-time gate ahead of the
 * existing one.
 */
export function evaluateRequestBookingEligibility(
  args: Parameters<typeof canTechnicianTakeAppointment>[0] & { now: Date },
): RequestEligibilityDecision {
  if (!isRequestBookableLeadTime({ startTime: args.startTime, now: args.now })) {
    return { eligible: false, reason: 'lead_time_too_soon' };
  }

  const decision = canTechnicianTakeAppointment(args);
  if (!decision.available) {
    return { eligible: false, reason: decision.reason };
  }
  return { eligible: true };
}

// =============================================================================
// §14/§15 — THE RATIFIED DEADLINE ALGORITHM (`resolveRequestApprovalDeadline`)
//
// Supplied by the coordinator after the first pass of this module shipped
// with a placeholder (`requestExpiresAt = startTime`). This REPLACES that
// placeholder. Deliberately schema-agnostic: it takes an already-expanded
// list of `ReviewWindowInterval`s (concrete `{start,end}` Date pairs) rather
// than a location's raw weekly-hours JSON, so the hard algorithmic logic is
// testable with synthetic windows independent of exactly how those windows
// get built (see `expandReviewWindows` below for the adapter that builds
// them from a location's business hours, with overnight/split-shift
// support and the `settings.catalog.requestApproval` override).
// =============================================================================

/** One concrete open interval a request could be reviewed in. Not assumed sorted, clipped, or non-overlapping — `resolveRequestApprovalDeadline` normalizes. */
export type ReviewWindowInterval = { start: Date; end: Date };

/** Default: roughly a business day's notice, before any window-shape correction. */
export const REQUEST_APPROVAL_NOMINAL_WINDOW_MINUTES = 12 * 60;

/** Default: below this many ACTUAL open-window minutes between now and the deadline, a request is not meaningfully reviewable. Contract-configurable — see `settings.catalog.requestApproval.minReviewableMinutes`. */
export const REQUEST_APPROVAL_MIN_REVIEWABLE_MINUTES = 60;

export type RequestApprovalDeadlineResult =
  | { ok: true; deadline: Date }
  | {
    ok: false;
    /** Bounded, typed — never a raw computation trace. `capped_before_now`: the 120-minute (or configured) lead cap alone already excludes any deadline. `no_reviewable_window`: the cap leaves room in principle, but no open window (or not enough cumulative open minutes) exists between now and the cap. */
    reason: 'capped_before_now' | 'no_reviewable_window';
  };

type NormalizedWindow = { start: number; end: number };

function normalizeReviewWindows(
  raw: ReviewWindowInterval[],
  rangeStartMs: number,
  rangeEndMs: number,
): NormalizedWindow[] {
  const clipped = raw
    .map(w => ({ start: Math.max(w.start.getTime(), rangeStartMs), end: Math.min(w.end.getTime(), rangeEndMs) }))
    .filter(w => w.end > w.start)
    .sort((a, b) => a.start - b.start);

  const merged: NormalizedWindow[] = [];
  for (const window of clipped) {
    const last = merged.at(-1);
    if (last && window.start <= last.end) {
      last.end = Math.max(last.end, window.end);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

function isInsideAnyWindow(ms: number, windows: NormalizedWindow[]): boolean {
  return windows.some(w => ms >= w.start && ms <= w.end);
}

/** The latest window END at or before `ms` — the "snap back to the trailing edge of the last open period" step. */
function latestWindowEndAtOrBefore(ms: number, windows: NormalizedWindow[]): number | null {
  let best: number | null = null;
  for (const window of windows) {
    if (window.end <= ms && (best === null || window.end > best)) {
      best = window.end;
    }
  }
  return best;
}

/** Total open-window milliseconds overlapping [startMs, endMs]. */
function sumOverlapMs(startMs: number, endMs: number, windows: NormalizedWindow[]): number {
  if (endMs <= startMs) {
    return 0;
  }
  let total = 0;
  for (const window of windows) {
    const overlapStart = Math.max(window.start, startMs);
    const overlapEnd = Math.min(window.end, endMs);
    if (overlapEnd > overlapStart) {
      total += overlapEnd - overlapStart;
    }
  }
  return total;
}

/** Walks windows forward from `fromMs`, accumulating open minutes, and returns the earliest instant at which the running total reaches `targetMs` — or `null` if the windows never accumulate that much. */
function earliestInstantAccumulating(
  targetMs: number,
  fromMs: number,
  windows: NormalizedWindow[],
): number | null {
  let accumulated = 0;
  for (const window of windows) {
    if (window.end <= fromMs) {
      continue;
    }
    const segmentStart = Math.max(window.start, fromMs);
    const segmentLength = window.end - segmentStart;
    if (segmentLength <= 0) {
      continue;
    }
    if (accumulated + segmentLength >= targetMs) {
      return segmentStart + (targetMs - accumulated);
    }
    accumulated += segmentLength;
  }
  return null;
}

/**
 * THE RATIFIED ALGORITHM:
 *
 *   1. `hardDeadline = startTime - leadCap` (leadCap defaults to the same
 *      120 minutes as `REQUEST_APPROVAL_MIN_LEAD_TIME_MINUTES`). If this is
 *      already at/before `now`, nothing downstream matters — not bookable.
 *      This is the preserved 120-minute edge: a slot exactly `now + 120min`
 *      out has `hardDeadline === now`, zero actionable review room.
 *   2. `initialCandidate = min(now + nominalWindow, hardDeadline)` — roughly
 *      12 hours' notice, capped at the hard deadline.
 *   3. If that candidate falls OUTSIDE every review window, it is pulled
 *      BACK to the latest window END at or before it — a deadline must
 *      never sit in a dead (closed) gap; it snaps to the trailing edge of
 *      the last period the salon was actually open. If no window has ended
 *      by then at all (the salon hasn't opened yet since `now`), it falls
 *      back to `now` itself, letting step 4 extend forward from there.
 *   4. If the total OPEN minutes between `now` and that candidate is below
 *      `minReviewableMinutes`, the candidate is pushed FORWARD to the
 *      earliest instant that accumulates enough open minutes — but never
 *      past `hardDeadline`.
 *   5. If step 4 cannot reach `minReviewableMinutes` without exceeding
 *      `hardDeadline` (including the degenerate case of zero review windows
 *      between `now` and `hardDeadline` at all — a fully-closed week, or an
 *      empty/malformed schedule), the slot is NOT request-bookable. This
 *      must fail closed, never silently produce a deadline: a caller with a
 *      malformed schedule must not activate the request lifecycle on a
 *      guess.
 *
 * The result, when `ok: true`, is always inside/at a review-window
 * boundary, strictly after `now`, strictly before `startTime`, and at or
 * before `hardDeadline` — asserted defensively here (not just by the
 * algorithm's construction) so a future edit that breaks the invariant
 * fails loudly instead of silently producing a bad deadline.
 */
export function resolveRequestApprovalDeadline(args: {
  now: Date;
  startTime: Date;
  reviewWindows: ReviewWindowInterval[];
  leadCapMinutes?: number;
  nominalWindowMinutes?: number;
  minReviewableMinutes?: number;
}): RequestApprovalDeadlineResult {
  const leadCapMs = (args.leadCapMinutes ?? REQUEST_APPROVAL_MIN_LEAD_TIME_MINUTES) * 60_000;
  const nominalMs = (args.nominalWindowMinutes ?? REQUEST_APPROVAL_NOMINAL_WINDOW_MINUTES) * 60_000;
  const minReviewableMs = (args.minReviewableMinutes ?? REQUEST_APPROVAL_MIN_REVIEWABLE_MINUTES) * 60_000;

  const nowMs = args.now.getTime();
  const hardDeadlineMs = args.startTime.getTime() - leadCapMs;
  if (hardDeadlineMs <= nowMs) {
    return { ok: false, reason: 'capped_before_now' };
  }

  const windows = normalizeReviewWindows(args.reviewWindows, nowMs, hardDeadlineMs);
  if (windows.length === 0) {
    return { ok: false, reason: 'no_reviewable_window' };
  }

  const nominalCandidateMs = Math.min(nowMs + nominalMs, hardDeadlineMs);

  let candidateMs = nominalCandidateMs;
  if (!isInsideAnyWindow(candidateMs, windows)) {
    candidateMs = latestWindowEndAtOrBefore(candidateMs, windows) ?? nowMs;
  }

  const reviewableMs = sumOverlapMs(nowMs, candidateMs, windows);
  if (reviewableMs < minReviewableMs) {
    const extended = earliestInstantAccumulating(minReviewableMs, nowMs, windows);
    if (extended === null || extended > hardDeadlineMs) {
      return { ok: false, reason: 'no_reviewable_window' };
    }
    candidateMs = extended;
  }

  // Defensive invariant check — see the doc comment above.
  if (
    candidateMs <= nowMs
    || candidateMs >= args.startTime.getTime()
    || candidateMs > hardDeadlineMs
    || !isInsideAnyWindow(candidateMs, windows)
  ) {
    return { ok: false, reason: 'no_reviewable_window' };
  }

  return { ok: true, deadline: new Date(candidateMs) };
}

// =============================================================================
// REVIEW-WINDOW SOURCE — expands a location's business hours (or the
// settings override) into the `ReviewWindowInterval[]` the algorithm above
// consumes. NEW logic: no existing reader in this codebase expands
// `business_hours` past a single same-day `{start,end}` pair (confirmed by
// search) — `getLocationScheduleForWindow` (`bookingPolicy.ts`) is reused
// for TECHNICIAN eligibility elsewhere in this module, but it is a
// same-day-only reader and is not reused here, deliberately: it cannot
// express what this function must (overnight + split).
// =============================================================================

const REVIEW_WINDOW_DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
type ReviewWindowDayName = typeof REVIEW_WINDOW_DAY_NAMES[number];

/** Mirrors `salon_location.business_hours` / `salon.business_hours`'s stored JSON shape (`Schema.ts`) — one `{open,close}` pair per day, every day optional/nullable. */
export type LocationBusinessHours = Partial<Record<ReviewWindowDayName, { open: string; close: string } | null>> | null | undefined;

const HH_MM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesOfDay(time: string): number | null {
  const match = HH_MM_PATTERN.exec(time);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/** `"2026-03-08"` -> `"2026-03-09"`. Pure calendar-date arithmetic (UTC-anchored parsing is intentional here — it is never used as a real instant, only to walk calendar dates). */
function nextDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return [next.getUTCFullYear(), String(next.getUTCMonth() + 1).padStart(2, '0'), String(next.getUTCDate()).padStart(2, '0')].join('-');
}

function previousDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number];
  const prev = new Date(Date.UTC(year, month - 1, day - 1));
  return [prev.getUTCFullYear(), String(prev.getUTCMonth() + 1).padStart(2, '0'), String(prev.getUTCDate()).padStart(2, '0')].join('-');
}

/** A calendar date's weekday is timezone-independent once you already have the LOCAL date key — parsing it as UTC midnight purely to read `getUTCDay()` is correct regardless of the salon's real timezone. */
function dayNameForDateKey(dateKey: string): ReviewWindowDayName {
  const weekdayIndex = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return REVIEW_WINDOW_DAY_NAMES[weekdayIndex]!;
}

function rangesForDay(
  dayName: ReviewWindowDayName,
  businessHours: LocationBusinessHours,
  overrideWindows: RequestApprovalScheduleSettings['reviewWindows'] | undefined,
): RequestApprovalWindowRange[] {
  if (overrideWindows) {
    return overrideWindows[dayName] ?? [];
  }
  const pair = businessHours?.[dayName];
  return pair ? [{ start: pair.open, end: pair.close }] : [];
}

/**
 * Expands a location's `business_hours` (or, when present, the
 * `settings.catalog.requestApproval.reviewWindows` override, which REPLACES
 * business-hours entirely rather than merging with it) into concrete
 * `ReviewWindowInterval`s overlapping `[rangeStart, rangeEnd]`.
 *
 * OVERNIGHT: a day whose `close` is at or before its `start` (in
 * minutes-of-day) is treated as spanning into the NEXT calendar day —
 * `{open:'22:00', close:'02:00'}` becomes one interval from that day's
 * 22:00 to the FOLLOWING day's 02:00, not an empty/closed window (unlike
 * `smartFitBooking.ts`'s technician-side reader, which collapses this case
 * to closed — a different, pre-existing, unrelated tradeoff this function
 * does not inherit).
 *
 * SPLIT WINDOWS: only expressible via the settings override today (`salon_location.business_hours` structurally holds one pair per day) —
 * `reviewWindows: { monday: [{start:'09:00',end:'13:00'}, {start:'14:00',end:'18:00'}] }` produces two distinct intervals for Monday.
 *
 * MALFORMED / EMPTY: an unparseable `HH:MM` string is skipped (never thrown,
 * never guessed) — the day simply contributes no window, which composes
 * correctly with the caller's fail-closed handling of an empty result.
 */
export function expandReviewWindows(args: {
  rangeStart: Date;
  rangeEnd: Date;
  timeZone: string;
  businessHours: LocationBusinessHours;
  overrideWindows?: RequestApprovalScheduleSettings['reviewWindows'];
}): ReviewWindowInterval[] {
  const { rangeStart, rangeEnd, timeZone, businessHours, overrideWindows } = args;
  if (rangeEnd.getTime() <= rangeStart.getTime()) {
    return [];
  }

  const windows: ReviewWindowInterval[] = [];
  // Start one calendar day BEFORE rangeStart's local date: an overnight
  // window opened the prior day can still spill into rangeStart.
  let cursor = previousDateKey(getDateKeyInTimeZone(rangeStart, timeZone));
  const endKey = getDateKeyInTimeZone(rangeEnd, timeZone);

  // Defensive iteration cap (~14 months of days) so a caller mistake (e.g. a
  // multi-year range) can never spin this into an unbounded loop.
  for (let guard = 0; guard < 430; guard++) {
    const dayName = dayNameForDateKey(cursor);
    const ranges = rangesForDay(dayName, businessHours, overrideWindows);

    for (const range of ranges) {
      const startMinutes = minutesOfDay(range.start);
      const endMinutes = minutesOfDay(range.end);
      if (startMinutes === null || endMinutes === null) {
        continue;
      }
      const startInstant = zonedTimeToUtc({ date: cursor, time: range.start, timeZone });
      const isOvernight = endMinutes <= startMinutes;
      const endInstant = zonedTimeToUtc({
        date: isOvernight ? nextDateKey(cursor) : cursor,
        time: range.end,
        timeZone,
      });
      if (endInstant.getTime() > startInstant.getTime()) {
        windows.push({ start: startInstant, end: endInstant });
      }
    }

    if (cursor === endKey) {
      break;
    }
    cursor = nextDateKey(cursor);
  }

  return windows.filter(w => w.end.getTime() > rangeStart.getTime() && w.start.getTime() < rangeEnd.getTime());
}

// =============================================================================
// EXPLICIT REQUEST-APPROVAL ACTIVATION — the single entry point route.ts
// calls. Composes technician eligibility (§15, existing schedule authority)
// with the review-window deadline algorithm above into one decision.
// =============================================================================

export type ExplicitRequestApprovalActivationResult =
  | { activates: true; deadline: Date }
  | {
    activates: false;
    reason: 'lead_time_too_soon' | UnavailableReason | 'capped_before_now' | 'no_reviewable_window';
  };

/**
 * The full activation decision for one candidate booking: technician
 * eligibility (reusing `canTechnicianTakeAppointment`'s existing schedule
 * authority, via `evaluateRequestBookingEligibility`) AND a valid deadline
 * (`resolveRequestApprovalDeadline`, fed by `expandReviewWindows`). Both
 * must succeed — a technician who is nominally available but for whom no
 * valid review deadline exists (e.g. the salon location is never open
 * between now and the hard cap) is NOT request-bookable either.
 *
 * Fails closed on a fully-closed week or empty/malformed schedule: an empty
 * `expandReviewWindows` result flows straight into
 * `resolveRequestApprovalDeadline`'s own `no_reviewable_window` result —
 * there is no code path here that invents a deadline when the schedule data
 * cannot support one.
 */
export function resolveExplicitRequestApprovalActivation(
  args: Parameters<typeof canTechnicianTakeAppointment>[0] & {
    now: Date;
    timeZone: string;
    locationBusinessHoursForReview: LocationBusinessHours;
    scheduleSettings?: RequestApprovalScheduleSettings;
  },
): ExplicitRequestApprovalActivationResult {
  const eligibility = evaluateRequestBookingEligibility(args);
  if (!eligibility.eligible) {
    return { activates: false, reason: eligibility.reason };
  }

  const hardDeadlineMs = args.startTime.getTime()
    - (args.scheduleSettings?.leadCapMinutes ?? REQUEST_APPROVAL_MIN_LEAD_TIME_MINUTES) * 60_000;
  const reviewWindows = expandReviewWindows({
    rangeStart: args.now,
    rangeEnd: new Date(Math.max(hardDeadlineMs, args.now.getTime())),
    timeZone: args.timeZone,
    businessHours: args.locationBusinessHoursForReview,
    overrideWindows: args.scheduleSettings?.reviewWindows,
  });

  const deadlineResult = resolveRequestApprovalDeadline({
    now: args.now,
    startTime: args.startTime,
    reviewWindows,
    leadCapMinutes: args.scheduleSettings?.leadCapMinutes,
    nominalWindowMinutes: args.scheduleSettings?.nominalWindowMinutes,
    minReviewableMinutes: args.scheduleSettings?.minReviewableMinutes,
  });
  if (!deadlineResult.ok) {
    return { activates: false, reason: deadlineResult.reason };
  }

  return { activates: true, deadline: deadlineResult.deadline };
}
