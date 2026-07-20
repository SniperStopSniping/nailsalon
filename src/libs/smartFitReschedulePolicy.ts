import type { AutomaticBookingDiscountResult } from '@/libs/firstVisitDiscount';
import {
  applySmartFitOverlay,
  SMART_FIT_DISCOUNT_LABEL,
  SMART_FIT_DISCOUNT_TYPE,
  type SmartFitEvaluation,
  type SmartFitOverlaidDiscount,
} from '@/libs/smartFit';
import type { ResolvedSmartFitConfig } from '@/libs/smartFitConfig';

/**
 * Smart Fit reschedule policy — the single decision point shared by BOTH
 * reschedule paths (the manage-link in-place move and the older booking-POST
 * cancel-and-replace), so the two can never drift apart.
 *
 * The rules, in order:
 *
 * 1. A Smart Fit discount already committed to a confirmed appointment is
 *    PRESERVED when only the date, time, or technician changes. The customer
 *    agreed to a price; moving the appointment does not re-open it, and the
 *    new slot does not have to qualify again.
 * 2. It is RECALCULATED (which may mean removed) as soon as a pricing input
 *    changes — service, add-ons, quantity, or subtotal.
 * 3. An appointment that did NOT already carry a Smart Fit discount only gains
 *    one if the new slot qualifies through the normal evaluator.
 * 4. Smart Fit never displaces a reward or first-visit discount, and never
 *    stacks on one — the same winner-take-all precedence `applySmartFitOverlay`
 *    enforces at booking time.
 */

/**
 * The pricing-relevant shape of a booking. Two bookings with equal
 * fingerprints cost the same, so a Smart Fit discount committed against one is
 * still honest against the other.
 */
export type ReschedulePricingInputs = {
  subtotalBeforeDiscountCents: number;
  serviceIds: string[];
  addOns: Array<{ addOnId: string | null; quantity: number }>;
};

/** The discount fields as persisted on the appointment row being moved. */
export type CommittedDiscountSnapshot = {
  discountType: string | null;
  discountAmountCents: number | null;
  subtotalBeforeDiscountCents: number | null;
  discountPercent: number | null;
};

export type SmartFitRescheduleOutcome =
  /** Committed Smart Fit discount carried over untouched. */
  | 'preserved'
  /** Slot qualified through the normal evaluator; a new discount applies. */
  | 'granted'
  /** Pricing changed, so the old Smart Fit discount no longer applies. */
  | 'removed'
  /** Nothing to preserve and nothing granted. */
  | 'none'
  /** A reward or first-visit discount owns this booking; Smart Fit stands down. */
  | 'other_discount';

export type SmartFitRescheduleDecision = {
  outcome: SmartFitRescheduleOutcome;
  discountAmountCents: number;
  finalTotalCents: number;
  discountType: string | null;
  discountLabel: string | null;
  discountPercent: number | null;
  /** True when the caller must not re-run the slot evaluator. */
  preservesCommittedDiscount: boolean;
  /** Customer-facing explanation, safe to render verbatim. */
  customerNote: string | null;
};

function normalizePricingInputs(inputs: ReschedulePricingInputs): string {
  const services = [...inputs.serviceIds].sort();
  const addOns = inputs.addOns
    .map(addOn => `${addOn.addOnId ?? 'custom'}x${addOn.quantity}`)
    .sort();
  return JSON.stringify({
    subtotal: inputs.subtotalBeforeDiscountCents,
    services,
    addOns,
  });
}

/**
 * Whether the reschedule leaves every pricing input untouched. Deliberately
 * strict: anything that could move the price — a swapped service, an added or
 * removed add-on, a changed quantity, a different subtotal (which catches base
 * price edits) — counts as a change and forfeits preservation.
 */
export function isPricingUnchangedForReschedule(
  original: ReschedulePricingInputs,
  next: ReschedulePricingInputs,
): boolean {
  return normalizePricingInputs(original) === normalizePricingInputs(next);
}

export function hasCommittedSmartFitDiscount(
  committed: CommittedDiscountSnapshot | null | undefined,
): boolean {
  return committed?.discountType === SMART_FIT_DISCOUNT_TYPE
    && (committed.discountAmountCents ?? 0) > 0;
}

/**
 * Resolve the discount state for a reschedule.
 *
 * `base` is the automatic-discount resolution for the booking as it stands
 * (reward / first-visit / none). `newSlotEvaluation` is the normal evaluator's
 * verdict for the slot being moved to — pass `null` when the caller has not
 * evaluated it, which is safe: without an evaluation nothing is ever granted,
 * only preserved.
 */
export function resolveSmartFitRescheduleDiscount(args: {
  base: AutomaticBookingDiscountResult;
  config: ResolvedSmartFitConfig;
  committed: CommittedDiscountSnapshot | null | undefined;
  originalPricing: ReschedulePricingInputs | null;
  nextPricing: ReschedulePricingInputs;
  newSlotEvaluation: SmartFitEvaluation | null | undefined;
  appliedAt?: Date;
}): SmartFitRescheduleDecision {
  const { base, config, committed, originalPricing, nextPricing } = args;
  const subtotal = nextPricing.subtotalBeforeDiscountCents;

  // Rule 4: a higher-precedence discount owns this booking. Smart Fit neither
  // stacks nor replaces, on a reschedule exactly as at booking time.
  if (base.kind !== 'none') {
    return {
      outcome: 'other_discount',
      discountAmountCents: base.discountAmountCents,
      finalTotalCents: base.finalTotalCents,
      discountType: base.kind === 'reward' ? 'reward' : base.firstVisit?.discountType ?? null,
      discountLabel: base.kind === 'reward' ? 'Reward applied' : base.firstVisit?.discountLabel ?? null,
      discountPercent: base.kind === 'reward' ? null : base.firstVisit?.discountPercent ?? null,
      preservesCommittedDiscount: false,
      customerNote: null,
    };
  }

  const pricingUnchanged = originalPricing
    ? isPricingUnchangedForReschedule(originalPricing, nextPricing)
    : false;

  // Rule 1: preserve a committed Smart Fit discount across a pure
  // date/time/technician change. No re-qualification required.
  if (hasCommittedSmartFitDiscount(committed) && pricingUnchanged) {
    const discountAmountCents = Math.min(
      Math.max(0, committed!.discountAmountCents ?? 0),
      subtotal,
    );
    return {
      outcome: 'preserved',
      discountAmountCents,
      finalTotalCents: Math.max(0, subtotal - discountAmountCents),
      discountType: SMART_FIT_DISCOUNT_TYPE,
      discountLabel: SMART_FIT_DISCOUNT_LABEL,
      discountPercent: committed!.discountPercent ?? null,
      preservesCommittedDiscount: true,
      customerNote: 'Your Smart Fit discount stays applied at this new time.',
    };
  }

  // Rules 2 and 3 share the evaluator: whatever the new slot honestly earns.
  const overlaid: SmartFitOverlaidDiscount = applySmartFitOverlay({
    base,
    config,
    evaluation: args.newSlotEvaluation,
    appliedAt: args.appliedAt,
  });

  if (overlaid.kind === 'smart_fit') {
    return {
      outcome: 'granted',
      discountAmountCents: overlaid.discountAmountCents,
      finalTotalCents: overlaid.finalTotalCents,
      discountType: SMART_FIT_DISCOUNT_TYPE,
      discountLabel: SMART_FIT_DISCOUNT_LABEL,
      discountPercent: overlaid.smartFit.discountPercent,
      preservesCommittedDiscount: false,
      customerNote: 'This time qualifies for a Smart Fit discount.',
    };
  }

  // Nothing granted. If a Smart Fit discount had been committed, the pricing
  // change is what took it away — say so rather than letting the total move
  // silently.
  const lostToPricingChange = hasCommittedSmartFitDiscount(committed) && !pricingUnchanged;
  return {
    outcome: lostToPricingChange ? 'removed' : 'none',
    discountAmountCents: 0,
    finalTotalCents: subtotal,
    discountType: null,
    discountLabel: null,
    discountPercent: null,
    preservesCommittedDiscount: false,
    customerNote: lostToPricingChange
      ? 'Changing the services on this booking ended the Smart Fit discount.'
      : null,
  };
}
