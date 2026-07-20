import { describe, expect, it } from 'vitest';

import type { AutomaticBookingDiscountResult } from '@/libs/firstVisitDiscount';
import type { SmartFitEvaluation } from '@/libs/smartFit';
import type { ResolvedSmartFitConfig } from '@/libs/smartFitConfig';

import {
  hasCommittedSmartFitDiscount,
  isPricingUnchangedForReschedule,
  type ReschedulePricingInputs,
  resolveSmartFitRescheduleDiscount,
} from './smartFitReschedulePolicy';

const SUBTOTAL = 5000;

const CONFIG: ResolvedSmartFitConfig = {
  enabled: true,
  discountType: 'percent',
  value: 10,
  eligibleServiceIds: [],
  eligibleTechnicianIds: [],
  maxRemainingGapMinutes: 30,
  minImprovementMinutes: 15,
} as ResolvedSmartFitConfig;

function noneBase(subtotal = SUBTOTAL): AutomaticBookingDiscountResult {
  return {
    kind: 'none',
    subtotalBeforeDiscountCents: subtotal,
    discountAmountCents: 0,
    finalTotalCents: subtotal,
    reward: null,
    firstVisit: null,
  };
}

function rewardBase(): AutomaticBookingDiscountResult {
  return {
    kind: 'reward',
    subtotalBeforeDiscountCents: SUBTOTAL,
    discountAmountCents: 1000,
    finalTotalCents: 4000,
    reward: { id: 'reward_1', discountAmountCents: 1000, discountedServiceId: null },
    firstVisit: null,
  };
}

function pricing(overrides: Partial<ReschedulePricingInputs> = {}): ReschedulePricingInputs {
  return {
    subtotalBeforeDiscountCents: SUBTOTAL,
    serviceIds: ['svc_gel'],
    addOns: [{ addOnId: 'addon_chrome', quantity: 1 }],
    ...overrides,
  };
}

const COMMITTED_SMART_FIT = {
  discountType: 'smart_fit',
  discountAmountCents: 500,
  subtotalBeforeDiscountCents: SUBTOTAL,
  discountPercent: 10,
};

const ELIGIBLE: SmartFitEvaluation = { eligible: true } as SmartFitEvaluation;
const INELIGIBLE: SmartFitEvaluation = { eligible: false } as SmartFitEvaluation;

describe('isPricingUnchangedForReschedule', () => {
  it('ignores ordering of services and add-ons', () => {
    expect(isPricingUnchangedForReschedule(
      pricing({ serviceIds: ['a', 'b'], addOns: [{ addOnId: 'x', quantity: 1 }, { addOnId: 'y', quantity: 2 }] }),
      pricing({ serviceIds: ['b', 'a'], addOns: [{ addOnId: 'y', quantity: 2 }, { addOnId: 'x', quantity: 1 }] }),
    )).toBe(true);
  });

  it.each([
    ['a swapped service', pricing({ serviceIds: ['svc_other'] })],
    ['an added add-on', pricing({ addOns: [{ addOnId: 'addon_chrome', quantity: 1 }, { addOnId: 'addon_art', quantity: 1 }] })],
    ['a removed add-on', pricing({ addOns: [] })],
    ['a changed quantity', pricing({ addOns: [{ addOnId: 'addon_chrome', quantity: 2 }] })],
    ['a changed base price', pricing({ subtotalBeforeDiscountCents: 6000 })],
  ])('treats %s as a pricing change', (_label, next) => {
    expect(isPricingUnchangedForReschedule(pricing(), next)).toBe(false);
  });
});

describe('hasCommittedSmartFitDiscount', () => {
  it('requires both the smart_fit type and a non-zero amount', () => {
    expect(hasCommittedSmartFitDiscount(COMMITTED_SMART_FIT)).toBe(true);
    expect(hasCommittedSmartFitDiscount({ ...COMMITTED_SMART_FIT, discountAmountCents: 0 })).toBe(false);
    expect(hasCommittedSmartFitDiscount({ ...COMMITTED_SMART_FIT, discountType: 'first_visit' })).toBe(false);
    expect(hasCommittedSmartFitDiscount(null)).toBe(false);
  });
});

describe('resolveSmartFitRescheduleDiscount', () => {
  it('preserves a committed discount for a time-only change without re-qualifying', () => {
    const decision = resolveSmartFitRescheduleDiscount({
      base: noneBase(),
      config: CONFIG,
      committed: COMMITTED_SMART_FIT,
      originalPricing: pricing(),
      nextPricing: pricing(),
      // The new slot does NOT qualify — preservation must not depend on it.
      newSlotEvaluation: INELIGIBLE,
    });

    expect(decision.outcome).toBe('preserved');
    expect(decision.discountAmountCents).toBe(500);
    expect(decision.finalTotalCents).toBe(4500);
    expect(decision.discountType).toBe('smart_fit');
    expect(decision.preservesCommittedDiscount).toBe(true);
    expect(decision.customerNote).toMatch(/stays applied/i);
  });

  it('preserves even when the evaluator was never run', () => {
    const decision = resolveSmartFitRescheduleDiscount({
      base: noneBase(),
      config: CONFIG,
      committed: COMMITTED_SMART_FIT,
      originalPricing: pricing(),
      nextPricing: pricing(),
      newSlotEvaluation: null,
    });

    expect(decision.outcome).toBe('preserved');
    expect(decision.discountAmountCents).toBe(500);
  });

  it('removes the discount when a pricing input changed', () => {
    const decision = resolveSmartFitRescheduleDiscount({
      base: noneBase(6000),
      config: CONFIG,
      committed: COMMITTED_SMART_FIT,
      originalPricing: pricing(),
      nextPricing: pricing({ subtotalBeforeDiscountCents: 6000, addOns: [{ addOnId: 'addon_chrome', quantity: 2 }] }),
      newSlotEvaluation: INELIGIBLE,
    });

    expect(decision.outcome).toBe('removed');
    expect(decision.discountAmountCents).toBe(0);
    expect(decision.finalTotalCents).toBe(6000);
    expect(decision.discountType).toBeNull();
    expect(decision.customerNote).toMatch(/ended the Smart Fit discount/i);
  });

  it('recalculates rather than preserves when pricing changed and the new slot qualifies', () => {
    const decision = resolveSmartFitRescheduleDiscount({
      base: noneBase(6000),
      config: CONFIG,
      committed: COMMITTED_SMART_FIT,
      originalPricing: pricing(),
      nextPricing: pricing({ subtotalBeforeDiscountCents: 6000 }),
      newSlotEvaluation: ELIGIBLE,
    });

    expect(decision.outcome).toBe('granted');
    // 10% of the NEW subtotal, not the old committed 500.
    expect(decision.discountAmountCents).toBe(600);
    expect(decision.finalTotalCents).toBe(5400);
  });

  it('grants a discount to an undiscounted booking only when the new slot qualifies', () => {
    const granted = resolveSmartFitRescheduleDiscount({
      base: noneBase(),
      config: CONFIG,
      committed: { discountType: null, discountAmountCents: 0, subtotalBeforeDiscountCents: SUBTOTAL, discountPercent: null },
      originalPricing: pricing(),
      nextPricing: pricing(),
      newSlotEvaluation: ELIGIBLE,
    });

    expect(granted.outcome).toBe('granted');
    expect(granted.discountAmountCents).toBe(500);

    const notGranted = resolveSmartFitRescheduleDiscount({
      base: noneBase(),
      config: CONFIG,
      committed: { discountType: null, discountAmountCents: 0, subtotalBeforeDiscountCents: SUBTOTAL, discountPercent: null },
      originalPricing: pricing(),
      nextPricing: pricing(),
      newSlotEvaluation: INELIGIBLE,
    });

    expect(notGranted.outcome).toBe('none');
    expect(notGranted.discountAmountCents).toBe(0);
    expect(notGranted.finalTotalCents).toBe(SUBTOTAL);
  });

  it('never grants when the evaluator was not run for an undiscounted booking', () => {
    const decision = resolveSmartFitRescheduleDiscount({
      base: noneBase(),
      config: CONFIG,
      committed: null,
      originalPricing: pricing(),
      nextPricing: pricing(),
      newSlotEvaluation: null,
    });

    expect(decision.outcome).toBe('none');
    expect(decision.discountAmountCents).toBe(0);
  });

  it('stands down for a reward booking instead of stacking or replacing', () => {
    const decision = resolveSmartFitRescheduleDiscount({
      base: rewardBase(),
      config: CONFIG,
      committed: COMMITTED_SMART_FIT,
      originalPricing: pricing(),
      nextPricing: pricing(),
      newSlotEvaluation: ELIGIBLE,
    });

    expect(decision.outcome).toBe('other_discount');
    expect(decision.discountAmountCents).toBe(1000);
    expect(decision.finalTotalCents).toBe(4000);
    expect(decision.discountType).toBe('reward');
    expect(decision.preservesCommittedDiscount).toBe(false);
  });

  it('never returns a discount larger than the subtotal', () => {
    const decision = resolveSmartFitRescheduleDiscount({
      base: noneBase(300),
      config: CONFIG,
      committed: { ...COMMITTED_SMART_FIT, discountAmountCents: 5000 },
      originalPricing: pricing({ subtotalBeforeDiscountCents: 300 }),
      nextPricing: pricing({ subtotalBeforeDiscountCents: 300 }),
      newSlotEvaluation: null,
    });

    expect(decision.discountAmountCents).toBe(300);
    expect(decision.finalTotalCents).toBe(0);
  });

  it('is disabled cleanly when the salon turned Smart Fit off', () => {
    const decision = resolveSmartFitRescheduleDiscount({
      base: noneBase(),
      config: { ...CONFIG, enabled: false },
      committed: { discountType: null, discountAmountCents: 0, subtotalBeforeDiscountCents: SUBTOTAL, discountPercent: null },
      originalPricing: pricing(),
      nextPricing: pricing(),
      newSlotEvaluation: ELIGIBLE,
    });

    expect(decision.outcome).toBe('none');
    expect(decision.discountAmountCents).toBe(0);
  });

  it('still honors a committed discount after the salon disables Smart Fit', () => {
    const decision = resolveSmartFitRescheduleDiscount({
      base: noneBase(),
      config: { ...CONFIG, enabled: false },
      committed: COMMITTED_SMART_FIT,
      originalPricing: pricing(),
      nextPricing: pricing(),
      newSlotEvaluation: null,
    });

    expect(decision.outcome).toBe('preserved');
    expect(decision.discountAmountCents).toBe(500);
  });
});
