import type { AutomaticBookingDiscountResult } from '@/libs/firstVisitDiscount';
import type { ResolvedSmartFitConfig, SmartFitDiscountType } from '@/libs/smartFitConfig';

/**
 * Smart Fit eligibility evaluator (P7.1) — pure, deterministic, side-effect
 * free. No database access, no Date.now(), no timezone math: every input is a
 * UTC epoch-milliseconds instant that the CALLER has already resolved on the
 * slot-grid basis (`zonedTimeToUtc` + `bookingConfig.timezone` — deliberately
 * NOT bookingPolicy.ts's Toronto-hardcoded minutes math; see the P6 section of
 * docs/luster-implementation-handoff.md).
 *
 * The evaluator answers ONE question: does this candidate slot objectively
 * pack the technician's schedule tightly against real busy time? It never
 * prices, never suggests alternatives, and never touches discount precedence —
 * those are later P7 phases. It is designed to slot UNDER the approved
 * winner-take-all precedence (campaign > reward > first_visit > smart_fit):
 * the future overlay only consults it when no higher discount applied.
 *
 * Privacy: results carry only internal block ids and kinds. Client identity
 * enters ONLY as opaque `clientKeys` used for self-adjacency exclusion and is
 * never copied into the result.
 */

// ---------------------------------------------------------------------------
// Input model
// ---------------------------------------------------------------------------

export const SMART_FIT_BLOCK_KINDS = ['appointment', 'break', 'time_off', 'google_busy'] as const;
export type SmartFitBlockKind = (typeof SMART_FIT_BLOCK_KINDS)[number];

/**
 * Kinds that can QUALIFY adjacency (real salon-side busy time). Google busy
 * windows are shrink-only per the approved architecture: freeBusy is
 * salon-wide, not per-technician, so packing "against" one may be fictitious —
 * they reduce free spans but never create eligibility.
 */
const QUALIFYING_BLOCK_KINDS: ReadonlySet<SmartFitBlockKind> = new Set([
  'appointment',
  'break',
  'time_off',
]);

export type SmartFitBlock = {
  /** Internal identifier (appointment id, blocked-slot id, …) — safe to echo. */
  id: string;
  kind: SmartFitBlockKind;
  /** Blocked-window start (UTC ms). For appointments: startTime. */
  startMs: number;
  /**
   * Blocked-window end (UTC ms). For appointments this is the BLOCKED end
   * (visible duration + that appointment's buffer), mirroring
   * hasBufferedConflict/lockTechnicianAndAssertSlotFree — gaps are measured
   * blocked-edge to blocked-edge.
   */
  endMs: number;
  /**
   * Opaque identity keys of the block's client (salonClientId, normalized
   * phone variants) — appointments only. Used solely for self-adjacency
   * exclusion; never emitted in results.
   */
  clientKeys?: string[];
};

export type SmartFitDayContext = {
  /** The concrete technician this day context belongs to. */
  technicianId: string;
  locationId: string | null;
  /** Effective working window (overrides/weekly + location hours), UTC ms. */
  workStartMs: number;
  workEndMs: number;
  /**
   * Every busy block on this technician's day (statuses pending|confirmed|
   * in_progress for appointments), EXCLUDING nothing — reschedule exclusion is
   * expressed via `candidate.excludeAppointmentId`.
   */
  blocks: SmartFitBlock[];
  /** Salon slot grid (5|10|15|30). */
  slotIntervalMinutes: number;
  /**
   * Grid anchor (UTC ms of the salon-local midnight the slot grid counts
   * from — the same basis availability's getAllSlots uses).
   */
  gridAnchorMs: number;
  /** "Now" supplied by the caller — keeps the evaluator deterministic. */
  nowMs: number;
  /** Defaults to SMART_FIT_MIN_LEAD_TIME_MINUTES (the platform's 120-min rule). */
  minLeadTimeMinutes?: number;
};

export type SmartFitCandidate = {
  /** Proposed visible start (UTC ms). */
  startMs: number;
  /** Service + add-on minutes (customer-facing). */
  visibleDurationMinutes: number;
  /** Booking buffer minutes — blocked window = visible + buffer. */
  bufferMinutes: number;
  serviceId: string;
  /**
   * Requested technician. `null` means "any" already resolved to the day
   * context's technician — only an EXPLICIT different id mismatches.
   */
  technicianId: string | null;
  /** Requested location; `null` = unscoped. Only an explicit mismatch fails. */
  locationId: string | null;
  /** Booking client's opaque identity keys (for self-adjacency exclusion). */
  clientKeys?: string[];
  /** Reschedule: the client's own current appointment — ignored entirely. */
  excludeAppointmentId?: string | null;
};

// ---------------------------------------------------------------------------
// Result model
// ---------------------------------------------------------------------------

/** Stable, machine-consumable reason codes (later API/UI phases key off these). */
export const SMART_FIT_REASONS = [
  'ELIGIBLE',
  'SMART_FIT_DISABLED',
  'SERVICE_NOT_ELIGIBLE',
  'TECHNICIAN_NOT_ELIGIBLE',
  'TECHNICIAN_MISMATCH',
  'LOCATION_MISMATCH',
  'MINIMUM_NOTICE',
  'OUTSIDE_WORKING_HOURS',
  'OVERLAPS_BLOCK',
  'INSUFFICIENT_IMPROVEMENT',
  'SELF_ADJACENCY',
  'NOT_TIGHTEST_SLOT',
  'GAP_TOO_LARGE',
  'NO_QUALIFYING_NEIGHBOR',
] as const;
export type SmartFitReason = (typeof SMART_FIT_REASONS)[number];

export type SmartFitSide = 'before' | 'after';

export type SmartFitSideDetail = {
  /** What forms this side's edge: a busy block, the working-window boundary, or nothing (open span). */
  edge: 'block' | 'boundary' | 'none';
  /** Present when edge==='block'. Non-sensitive internal reference only. */
  neighbor: { id: string; kind: SmartFitBlockKind } | null;
  /** Gap between the candidate's blocked window and the edge, in minutes. Null when edge==='none'. */
  gapMinutes: number | null;
  /** Candidate is the tightest FEASIBLE grid slot against this edge. */
  tightest: boolean;
  /** Every qualifying-kind block at this edge belongs to the booking client. */
  selfOnly: boolean;
  qualifies: boolean;
};

export type SmartFitEvaluation = {
  eligible: boolean;
  reason: SmartFitReason;
  sides: Record<SmartFitSide, SmartFitSideDetail>;
  qualifyingSides: SmartFitSide[];
  /** Gap on the tightest qualifying side (minutes); null when not eligible. */
  remainingGapMinutes: number | null;
  /**
   * Anti-trivial-switch slack: lead-time-clamped free-span length minus the
   * candidate's blocked duration, in minutes (>= 0 once the candidate fits).
   */
  improvementMinutes: number | null;
  /**
   * Contiguous free minutes the schedule keeps after this tight placement:
   * improvementMinutes − remainingGapMinutes (the far side stays one usable
   * span instead of two fragments). Null when not eligible.
   */
  consolidatedMinutes: number | null;
  /** maxRemainingGap after the grid-quantization clamp — normalized for later phases. */
  effectiveMaxGapMinutes: number;
};

// ---------------------------------------------------------------------------
// Constants & small helpers
// ---------------------------------------------------------------------------

/** Mirrors the platform's hardcoded 120-minute booking lead time. */
export const SMART_FIT_MIN_LEAD_TIME_MINUTES = 120;

/**
 * Grid-quantization clamp (approved formula):
 *
 *   effectiveMaxGap = max(configuredMaxGap, slotIntervalMinutes − 5)
 *
 * Rationale: existing blocked windows end off-grid (blocked = visible +
 * max(bufferConfig, prep+cleanup)), so on a coarse grid the best REACHABLE gap
 * beside a block can exceed the configured maximum through rounding alone —
 * e.g. a block ending 11:05 on a 30-minute grid makes 11:30 (gap 25) the
 * tightest possible fit. Without the clamp such salons could never grant a
 * Smart Fit discount. The companion tightest-feasible-slot rule prevents the
 * clamp from rewarding loose fits.
 */
export function effectiveMaxGapMinutes(
  configuredMaxGapMinutes: number,
  slotIntervalMinutes: number,
): number {
  return Math.max(configuredMaxGapMinutes, slotIntervalMinutes - 5);
}

const MINUTE_MS = 60_000;

function toMinutes(ms: number): number {
  return ms / MINUTE_MS;
}

function hasSharedClientKey(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a?.length || !b?.length) {
    return false;
  }
  const keys = new Set(a);
  return b.some(key => keys.has(key));
}

/** First grid instant >= atMs. */
function ceilToGrid(atMs: number, gridAnchorMs: number, intervalMs: number): number {
  return gridAnchorMs + Math.ceil((atMs - gridAnchorMs) / intervalMs) * intervalMs;
}

/** Last grid instant <= atMs. */
function floorToGrid(atMs: number, gridAnchorMs: number, intervalMs: number): number {
  return gridAnchorMs + Math.floor((atMs - gridAnchorMs) / intervalMs) * intervalMs;
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

type SideComputation = {
  detail: SmartFitSideDetail;
  /** How close this side got, for picking the most informative overall reason. */
  failure: 'none' | 'self' | 'not_tightest' | 'gap' | 'no_neighbor';
};

function buildResult(
  reason: SmartFitReason,
  sides: Record<SmartFitSide, SmartFitSideDetail>,
  effectiveMaxGap: number,
  extras: Partial<Pick<SmartFitEvaluation, 'qualifyingSides' | 'remainingGapMinutes' | 'improvementMinutes' | 'consolidatedMinutes'>> = {},
): SmartFitEvaluation {
  return {
    eligible: reason === 'ELIGIBLE',
    reason,
    sides,
    qualifyingSides: extras.qualifyingSides ?? [],
    remainingGapMinutes: extras.remainingGapMinutes ?? null,
    improvementMinutes: extras.improvementMinutes ?? null,
    consolidatedMinutes: extras.consolidatedMinutes ?? null,
    effectiveMaxGapMinutes: effectiveMaxGap,
  };
}

const EMPTY_SIDE: SmartFitSideDetail = {
  edge: 'none',
  neighbor: null,
  gapMinutes: null,
  tightest: false,
  selfOnly: false,
  qualifies: false,
};

const EMPTY_SIDES: Record<SmartFitSide, SmartFitSideDetail> = {
  before: EMPTY_SIDE,
  after: EMPTY_SIDE,
};

/**
 * Evaluate one candidate slot against one technician's resolved day.
 *
 * Full approved rule set (P6 architecture):
 *  1. Gate checks: enabled, service/technician eligibility, context match,
 *     minimum notice, working window, no overlap (buffers included on BOTH
 *     sides — the candidate's blocked window vs each block's blocked window).
 *  2. Free span L = (prevEdge, nextEdge) around the candidate, where
 *     prevEdge = max(workStart, latest block end <= candidate start) and
 *     nextEdge = min(workEnd, earliest block start >= candidate blocked end);
 *     ALL block kinds shrink the span (Google included). L is then clamped to
 *     [now + lead time, ∞) so slack counts only genuinely bookable room.
 *  3. Anti-trivial-switch guard (slack rule): clampedSpan − blockedDuration
 *     must be >= minImprovementMinutes. Exact fill (slack 0) never qualifies —
 *     the client had no placement freedom to reward.
 *  4. Exists-side rule: at least ONE side must have (a) an edge formed by a
 *     qualifying block (appointment/break/time_off — never a boundary, never
 *     Google), (b) gap <= effectiveMaxGap (grid clamp above), (c) the
 *     candidate as the tightest FEASIBLE grid slot on that side, and (d) a
 *     non-self qualifying block at that edge (self-adjacency exclusion —
 *     a client's own appointment cannot mint their discount).
 */
export function evaluateSmartFitSlot(args: {
  config: ResolvedSmartFitConfig;
  candidate: SmartFitCandidate;
  day: SmartFitDayContext;
}): SmartFitEvaluation {
  const { config, candidate, day } = args;
  const effectiveMaxGap = effectiveMaxGapMinutes(
    config.maxRemainingGapMinutes,
    day.slotIntervalMinutes,
  );
  const fail = (reason: SmartFitReason) => buildResult(reason, EMPTY_SIDES, effectiveMaxGap);

  // 1. Gates ---------------------------------------------------------------
  if (!config.enabled) {
    return fail('SMART_FIT_DISABLED');
  }
  if (config.eligibleServiceIds.length > 0 && !config.eligibleServiceIds.includes(candidate.serviceId)) {
    return fail('SERVICE_NOT_ELIGIBLE');
  }
  if (config.eligibleTechnicianIds.length > 0 && !config.eligibleTechnicianIds.includes(day.technicianId)) {
    return fail('TECHNICIAN_NOT_ELIGIBLE');
  }
  if (candidate.technicianId !== null && candidate.technicianId !== day.technicianId) {
    return fail('TECHNICIAN_MISMATCH');
  }
  if (candidate.locationId !== null && day.locationId !== null && candidate.locationId !== day.locationId) {
    return fail('LOCATION_MISMATCH');
  }

  const blockedDurationMs = (candidate.visibleDurationMinutes + candidate.bufferMinutes) * MINUTE_MS;
  if (blockedDurationMs <= 0) {
    return fail('OUTSIDE_WORKING_HOURS');
  }
  const candStartMs = candidate.startMs;
  const candBlockedEndMs = candStartMs + blockedDurationMs;

  const leadBoundaryMs = day.nowMs
    + (day.minLeadTimeMinutes ?? SMART_FIT_MIN_LEAD_TIME_MINUTES) * MINUTE_MS;
  if (candStartMs < leadBoundaryMs) {
    return fail('MINIMUM_NOTICE');
  }

  if (candStartMs < day.workStartMs || candBlockedEndMs > day.workEndMs) {
    return fail('OUTSIDE_WORKING_HOURS');
  }

  const blocks = candidate.excludeAppointmentId
    ? day.blocks.filter(block => block.id !== candidate.excludeAppointmentId)
    : day.blocks;

  const overlaps = blocks.some(
    block => block.startMs < candBlockedEndMs && block.endMs > candStartMs,
  );
  if (overlaps) {
    return fail('OVERLAPS_BLOCK');
  }

  // 2. Free span ------------------------------------------------------------
  // Every remaining block is entirely before or entirely after the candidate
  // (overlap was rejected), so the surrounding free span is exactly:
  let prevEdgeMs = day.workStartMs;
  let nextEdgeMs = day.workEndMs;
  for (const block of blocks) {
    if (block.endMs <= candStartMs) {
      prevEdgeMs = Math.max(prevEdgeMs, block.endMs);
    }
    if (block.startMs >= candBlockedEndMs) {
      nextEdgeMs = Math.min(nextEdgeMs, block.startMs);
    }
  }

  // 3. Slack rule (lead-time-clamped) ---------------------------------------
  // candStart >= leadBoundary was already enforced, so the clamped span still
  // contains the candidate: span = [max(prevEdge, leadBoundary), nextEdge).
  const clampedSpanStartMs = Math.max(prevEdgeMs, leadBoundaryMs);
  const slackMs = (nextEdgeMs - clampedSpanStartMs) - blockedDurationMs;
  const improvementMinutes = toMinutes(slackMs);
  if (slackMs < config.minImprovementMinutes * MINUTE_MS) {
    return buildResult('INSUFFICIENT_IMPROVEMENT', EMPTY_SIDES, effectiveMaxGap, {
      improvementMinutes,
    });
  }

  // 4. Exists-side rule ------------------------------------------------------
  const intervalMs = day.slotIntervalMinutes * MINUTE_MS;

  const computeSide = (side: SmartFitSide): SideComputation => {
    const edgeMs = side === 'before' ? prevEdgeMs : nextEdgeMs;
    const gapMs = side === 'before' ? candStartMs - prevEdgeMs : nextEdgeMs - candBlockedEndMs;

    // Which raw blocks form this edge?
    const edgeOwners = blocks.filter(block =>
      side === 'before' ? block.endMs === edgeMs && block.endMs <= candStartMs : block.startMs === edgeMs && block.startMs >= candBlockedEndMs,
    );
    const isBoundaryOnly = edgeOwners.length === 0;
    const qualifyingOwners = edgeOwners.filter(block => QUALIFYING_BLOCK_KINDS.has(block.kind));
    const nonSelfQualifying = qualifyingOwners.filter(
      block => !(block.kind === 'appointment' && hasSharedClientKey(block.clientKeys, candidate.clientKeys)),
    );

    // Tightest FEASIBLE grid slot against this edge (feasible = bookable, i.e.
    // grid-aligned and not below the minimum-notice boundary):
    //   before-side: candidate start == ceilToGrid(max(prevEdge, leadBoundary))
    //   after-side:  candidate start == floorToGrid(nextEdge − blockedDuration)
    const tightestStartMs = side === 'before'
      ? ceilToGrid(Math.max(edgeMs, leadBoundaryMs), day.gridAnchorMs, intervalMs)
      : floorToGrid(nextEdgeMs - blockedDurationMs, day.gridAnchorMs, intervalMs);
    const tightest = candStartMs === tightestStartMs;

    const neighborBlock = nonSelfQualifying[0] ?? qualifyingOwners[0] ?? edgeOwners[0] ?? null;
    const detail: SmartFitSideDetail = {
      edge: isBoundaryOnly ? 'boundary' : 'block',
      neighbor: neighborBlock ? { id: neighborBlock.id, kind: neighborBlock.kind } : null,
      gapMinutes: toMinutes(gapMs),
      tightest,
      selfOnly: qualifyingOwners.length > 0 && nonSelfQualifying.length === 0,
      qualifies: false,
    };

    if (qualifyingOwners.length === 0) {
      return { detail, failure: 'no_neighbor' };
    }
    if (gapMs > effectiveMaxGap * MINUTE_MS) {
      return { detail, failure: 'gap' };
    }
    if (!tightest) {
      return { detail, failure: 'not_tightest' };
    }
    if (nonSelfQualifying.length === 0) {
      return { detail, failure: 'self' };
    }
    return { detail: { ...detail, qualifies: true }, failure: 'none' };
  };

  const before = computeSide('before');
  const after = computeSide('after');
  const sides: Record<SmartFitSide, SmartFitSideDetail> = {
    before: before.detail,
    after: after.detail,
  };

  const qualifyingSides: SmartFitSide[] = [
    ...(before.detail.qualifies ? (['before'] as const) : []),
    ...(after.detail.qualifies ? (['after'] as const) : []),
  ];

  if (qualifyingSides.length === 0) {
    // Most informative reason wins: a side blocked ONLY by self-adjacency got
    // furthest, then not-tightest, then gap-too-large, then no real neighbor.
    const failures = [before.failure, after.failure];
    const reason: SmartFitReason = failures.includes('self')
      ? 'SELF_ADJACENCY'
      : failures.includes('not_tightest')
        ? 'NOT_TIGHTEST_SLOT'
        : failures.includes('gap')
          ? 'GAP_TOO_LARGE'
          : 'NO_QUALIFYING_NEIGHBOR';
    return buildResult(reason, sides, effectiveMaxGap, { improvementMinutes });
  }

  const remainingGapMinutes = Math.min(
    ...qualifyingSides.map(side => sides[side].gapMinutes ?? Number.POSITIVE_INFINITY),
  );

  return buildResult('ELIGIBLE', sides, effectiveMaxGap, {
    qualifyingSides,
    remainingGapMinutes,
    improvementMinutes,
    consolidatedMinutes: improvementMinutes - remainingGapMinutes,
  });
}

// ---------------------------------------------------------------------------
// Discount amount (money helper for later phases; mirrors calculateRetentionDiscount)
// ---------------------------------------------------------------------------

/**
 * Smart Fit discount in cents against the approved pre-tax booking subtotal.
 * Percent floors (never rounds up); both modes clamp to [0, subtotal] so the
 * taxable base can never go negative. Disabled config → 0.
 */
export function calculateSmartFitDiscountCents(
  config: Pick<ResolvedSmartFitConfig, 'enabled' | 'discountType' | 'value'>,
  subtotalBeforeDiscountCents: number,
): number {
  if (!config.enabled || config.value <= 0 || subtotalBeforeDiscountCents <= 0) {
    return 0;
  }
  const requested: Record<SmartFitDiscountType, number> = {
    percent: Math.floor(subtotalBeforeDiscountCents * Math.min(config.value, 100) / 100),
    fixed: config.value,
  };
  return Math.min(subtotalBeforeDiscountCents, Math.max(0, requested[config.discountType]));
}

// ---------------------------------------------------------------------------
// Overlay (P7.2) — winner-take-all precedence on top of the existing resolver
// ---------------------------------------------------------------------------

/** Snapshot `discountType` value persisted on smart-fit appointments. */
export const SMART_FIT_DISCOUNT_TYPE = 'smart_fit';
/** Snapshot `discountLabel` shown at checkout and on receipts. */
export const SMART_FIT_DISCOUNT_LABEL = 'Smart Fit Discount';

export type SmartFitAppliedDiscount = {
  kind: 'smart_fit';
  subtotalBeforeDiscountCents: number;
  discountAmountCents: number;
  finalTotalCents: number;
  reward: null;
  firstVisit: null;
  smartFit: {
    discountType: typeof SMART_FIT_DISCOUNT_TYPE;
    discountLabel: typeof SMART_FIT_DISCOUNT_LABEL;
    /** The salon's configured mode/value that produced the amount. */
    configDiscountType: SmartFitDiscountType;
    configValue: number;
    /** Percent snapshot column value: the percent in percent mode, null in fixed mode. */
    discountPercent: number | null;
    discountAppliedAt: Date;
    evaluation: SmartFitEvaluation;
  };
};

export type SmartFitOverlaidDiscount = AutomaticBookingDiscountResult | SmartFitAppliedDiscount;

/**
 * Upgrade a `kind:'none'` automatic-discount result to a Smart Fit discount
 * when the server-evaluated slot qualifies. Precedence is structural and
 * winner-take-all (campaign > reward > first_visit > smart_fit): campaign
 * bookings never reach this overlay (the booking route overrides the resolver
 * result before pricing), and any reward/first-visit result is returned
 * UNCHANGED — Smart Fit never stacks and never replaces a higher offer.
 *
 * Inputs are never mutated; the smart-fit branch returns a fresh object. The
 * discount amount is clamped to [0, subtotal] by
 * `calculateSmartFitDiscountCents`, and checkout later re-clamps through the
 * central pricing engine (`computeCheckoutTotals`).
 */
export function applySmartFitOverlay(args: {
  base: AutomaticBookingDiscountResult;
  config: ResolvedSmartFitConfig;
  evaluation: SmartFitEvaluation | null | undefined;
  /** Booking-time stamp for the snapshot; defaults to now. */
  appliedAt?: Date;
}): SmartFitOverlaidDiscount {
  const { base, config, evaluation } = args;

  if (base.kind !== 'none') {
    return base;
  }
  if (!config.enabled || !evaluation?.eligible) {
    return base;
  }

  const discountAmountCents = calculateSmartFitDiscountCents(
    config,
    base.subtotalBeforeDiscountCents,
  );
  if (discountAmountCents <= 0) {
    return base;
  }

  return {
    kind: 'smart_fit',
    subtotalBeforeDiscountCents: base.subtotalBeforeDiscountCents,
    discountAmountCents,
    finalTotalCents: Math.max(0, base.subtotalBeforeDiscountCents - discountAmountCents),
    reward: null,
    firstVisit: null,
    smartFit: {
      discountType: SMART_FIT_DISCOUNT_TYPE,
      discountLabel: SMART_FIT_DISCOUNT_LABEL,
      configDiscountType: config.discountType,
      configValue: config.value,
      discountPercent: config.discountType === 'percent' ? config.value : null,
      discountAppliedAt: args.appliedAt ?? new Date(),
      evaluation,
    },
  };
}
