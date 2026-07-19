import { describe, expect, it } from 'vitest';

import type { AutomaticBookingDiscountResult } from '@/libs/firstVisitDiscount';
import {
  applySmartFitOverlay,
  evaluateSmartFitSlot,
  SMART_FIT_DISCOUNT_LABEL,
  SMART_FIT_DISCOUNT_TYPE,
  type SmartFitEvaluation,
} from '@/libs/smartFit';
import { DISABLED_SMART_FIT_CONFIG, type ResolvedSmartFitConfig } from '@/libs/smartFitConfig';

// ---------------------------------------------------------------------------
// applySmartFitOverlay (P7.2) — winner-take-all precedence on top of the
// existing resolver: campaign > reward > first_visit > smart_fit. Campaign
// precedence is structural (the booking route never invokes the overlay for
// campaign bookings — asserted by the booking integration suite); the overlay
// itself must leave every non-'none' resolver result untouched.
// ---------------------------------------------------------------------------

const DAY0 = 1_800_000_000_000;
const t = (hours: number, minutes = 0) => DAY0 + (hours * 60 + minutes) * 60_000;

const ENABLED: ResolvedSmartFitConfig = {
  enabled: true,
  discountType: 'percent',
  value: 10,
  maxRemainingGapMinutes: 10,
  minImprovementMinutes: 20,
  eligibleServiceIds: [],
  eligibleTechnicianIds: [],
};

/** A genuinely eligible evaluation, produced by the real evaluator. */
function eligibleEvaluation(): SmartFitEvaluation {
  const evaluation = evaluateSmartFitSlot({
    config: ENABLED,
    candidate: {
      startMs: t(10),
      visibleDurationMinutes: 75,
      bufferMinutes: 10,
      serviceId: 'srv_biab-short',
      technicianId: 'tech_daniela',
      locationId: null,
      clientKeys: ['phone:4165550000'],
    },
    day: {
      technicianId: 'tech_daniela',
      locationId: null,
      workStartMs: t(9),
      workEndMs: t(18),
      blocks: [
        { id: 'appt_prev', kind: 'appointment', startMs: t(9), endMs: t(10), clientKeys: ['phone:4165559999'] },
      ],
      slotIntervalMinutes: 15,
      gridAnchorMs: DAY0,
      nowMs: t(6),
    },
  });

  expect(evaluation.eligible).toBe(true);

  return evaluation;
}

function ineligibleEvaluation(): SmartFitEvaluation {
  const evaluation = evaluateSmartFitSlot({
    config: ENABLED,
    candidate: {
      startMs: t(14),
      visibleDurationMinutes: 75,
      bufferMinutes: 10,
      serviceId: 'srv_biab-short',
      technicianId: 'tech_daniela',
      locationId: null,
    },
    day: {
      technicianId: 'tech_daniela',
      locationId: null,
      workStartMs: t(9),
      workEndMs: t(18),
      blocks: [],
      slotIntervalMinutes: 15,
      gridAnchorMs: DAY0,
      nowMs: t(6),
    },
  });

  expect(evaluation.eligible).toBe(false);

  return evaluation;
}

function noneResult(subtotalCents = 8000): AutomaticBookingDiscountResult {
  return {
    kind: 'none',
    subtotalBeforeDiscountCents: subtotalCents,
    discountAmountCents: 0,
    finalTotalCents: subtotalCents,
    reward: null,
    firstVisit: null,
  };
}

function rewardResult(): AutomaticBookingDiscountResult {
  return {
    kind: 'reward',
    subtotalBeforeDiscountCents: 8000,
    discountAmountCents: 500,
    finalTotalCents: 7500,
    reward: { id: 'reward_1', discountAmountCents: 500, discountedServiceId: null },
    firstVisit: null,
  };
}

function firstVisitResult(): AutomaticBookingDiscountResult {
  return {
    kind: 'first_visit',
    subtotalBeforeDiscountCents: 8000,
    discountAmountCents: 2000,
    finalTotalCents: 6000,
    reward: null,
    firstVisit: {
      subtotalBeforeDiscountCents: 8000,
      discountAmountCents: 2000,
      discountType: 'first_visit_25',
      discountLabel: 'First visit discount',
      discountPercent: 25,
      discountAppliedAt: new Date(t(0)),
      finalTotalCents: 6000,
    },
  };
}

describe('applySmartFitOverlay — precedence', () => {
  // Matrix 18: reward beats Smart Fit.
  it('returns a reward result unchanged even when the slot qualifies', () => {
    const base = rewardResult();
    const result = applySmartFitOverlay({
      base,
      config: ENABLED,
      evaluation: eligibleEvaluation(),
    });

    expect(result).toBe(base);
    expect(result.kind).toBe('reward');
    expect(result.discountAmountCents).toBe(500);
  });

  // Matrix 19: first visit beats Smart Fit.
  it('returns a first-visit result unchanged even when the slot qualifies', () => {
    const base = firstVisitResult();
    const result = applySmartFitOverlay({
      base,
      config: ENABLED,
      evaluation: eligibleEvaluation(),
    });

    expect(result).toBe(base);
    expect(result.kind).toBe('first_visit');
    expect(result.discountAmountCents).toBe(2000);
  });

  // Matrix 20: Smart Fit applies when no higher offer exists.
  it('upgrades a none result to smart_fit when the evaluation is eligible', () => {
    const appliedAt = new Date(t(7));
    const result = applySmartFitOverlay({
      base: noneResult(),
      config: ENABLED,
      evaluation: eligibleEvaluation(),
      appliedAt,
    });

    expect(result.kind).toBe('smart_fit');

    if (result.kind !== 'smart_fit') {
      throw new Error('expected smart_fit');
    }

    expect(result.subtotalBeforeDiscountCents).toBe(8000);
    expect(result.discountAmountCents).toBe(800); // floor(8000 * 10%)
    expect(result.finalTotalCents).toBe(7200);
    expect(result.reward).toBeNull();
    expect(result.firstVisit).toBeNull();
    expect(result.smartFit.discountType).toBe(SMART_FIT_DISCOUNT_TYPE);
    expect(result.smartFit.discountLabel).toBe(SMART_FIT_DISCOUNT_LABEL);
    expect(result.smartFit.discountLabel).toBe('Smart Fit Discount');
    expect(result.smartFit.discountPercent).toBe(10);
    expect(result.smartFit.discountAppliedAt).toBe(appliedAt);
    expect(result.smartFit.evaluation.eligible).toBe(true);
  });

  // Matrix 21: no stacking — the smart_fit result is the ONLY discount.
  it('never stacks: the smart_fit result carries no reward or first-visit component', () => {
    const result = applySmartFitOverlay({
      base: noneResult(),
      config: ENABLED,
      evaluation: eligibleEvaluation(),
    });

    if (result.kind !== 'smart_fit') {
      throw new Error('expected smart_fit');
    }

    expect(result.reward).toBeNull();
    expect(result.firstVisit).toBeNull();
    expect(result.subtotalBeforeDiscountCents - result.discountAmountCents)
      .toBe(result.finalTotalCents);
  });

  it('returns the base unchanged when the evaluation is ineligible, missing, or config disabled', () => {
    const base = noneResult();

    expect(applySmartFitOverlay({ base, config: ENABLED, evaluation: ineligibleEvaluation() })).toBe(base);
    expect(applySmartFitOverlay({ base, config: ENABLED, evaluation: null })).toBe(base);
    expect(applySmartFitOverlay({ base, config: DISABLED_SMART_FIT_CONFIG, evaluation: eligibleEvaluation() })).toBe(base);
  });
});

describe('applySmartFitOverlay — amounts', () => {
  // Matrix 22: percent discount correct (floors, never rounds up).
  it('computes a percent discount with flooring', () => {
    const result = applySmartFitOverlay({
      base: noneResult(9999),
      config: ENABLED,
      evaluation: eligibleEvaluation(),
    });

    if (result.kind !== 'smart_fit') {
      throw new Error('expected smart_fit');
    }

    expect(result.discountAmountCents).toBe(999); // floor(9999 * 10%)
    expect(result.finalTotalCents).toBe(9000);
  });

  // Matrix 23: fixed discount correct and clamped at the subtotal.
  it('clamps a fixed discount to the subtotal and prices fixed mode with a null percent', () => {
    const fixedConfig: ResolvedSmartFitConfig = {
      ...ENABLED,
      discountType: 'fixed',
      value: 10_000,
    };
    const result = applySmartFitOverlay({
      base: noneResult(8000),
      config: fixedConfig,
      evaluation: eligibleEvaluation(),
    });

    if (result.kind !== 'smart_fit') {
      throw new Error('expected smart_fit');
    }

    expect(result.discountAmountCents).toBe(8000); // clamped to subtotal
    expect(result.finalTotalCents).toBe(0);
    expect(result.smartFit.discountPercent).toBeNull();
    expect(result.smartFit.configDiscountType).toBe('fixed');
  });

  it('declines to apply when the clamp produces a zero discount', () => {
    const base = noneResult(0);
    const result = applySmartFitOverlay({
      base,
      config: ENABLED,
      evaluation: eligibleEvaluation(),
    });

    expect(result).toBe(base);
  });
});

describe('applySmartFitOverlay — immutability', () => {
  // Matrix 24: input objects are never mutated.
  it('does not mutate the base result, the config, or the evaluation', () => {
    const base = noneResult();
    const config = { ...ENABLED };
    const evaluation = eligibleEvaluation();
    const baseSnapshot = structuredClone(base);
    const configSnapshot = structuredClone(config);
    const evaluationSnapshot = structuredClone(evaluation);

    const result = applySmartFitOverlay({ base, config, evaluation });

    expect(result.kind).toBe('smart_fit');
    expect(base).toEqual(baseSnapshot);
    expect(config).toEqual(configSnapshot);
    expect(evaluation).toEqual(evaluationSnapshot);
  });
});
