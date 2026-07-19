// @vitest-environment jsdom
// (the dismissal/refresh helpers exercise sessionStorage)
import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildSmartFitExpectationFields,
  buildSmartFitSuggestionContextKey,
  consumeSmartFitAvailabilityRefresh,
  describeSmartFitTimeDifference,
  dismissSmartFitSuggestion,
  isSmartFitOutrankedForSession,
  markSmartFitAvailabilityRefresh,
  markSmartFitOutrankedForSession,
  parseCustomerSmartFitOffer,
  parseSmartFitCentsParam,
  parseSmartFitStaleBreakdown,
  parseTimeToMinutes,
  resolveSmartFitReviewOffer,
  selectNearbySmartFitSuggestion,
  SMART_FIT_STALE_FALLBACK_MESSAGE,
  smartFitReplacedByHigherPriorityDiscount,
  splitSmartFitSlots,
  syncSmartFitSuggestionDismissal,
} from './smartFitCustomer';

const OFFER = {
  discountAmountCents: 650,
  originalPriceCents: 6500,
  discountedPriceCents: 5850,
};

const slot = (time: string, smartFit: typeof OFFER | null = null) => ({ time, smartFit });

describe('parseCustomerSmartFitOffer', () => {
  it('keeps only the customer-facing money fields from a valid annotation', () => {
    const parsed = parseCustomerSmartFitOffer({
      eligible: true,
      discountType: 'percent',
      discountValue: 10,
      discountAmountCents: 650,
      originalPriceCents: 6500,
      discountedPriceCents: 5850,
      qualifyingSides: ['before'],
      improvementMinutes: 30,
      consolidatedMinutes: 20,
    });

    // Evaluator internals and config details must not survive into client state.
    expect(parsed).toEqual(OFFER);
  });

  it('rejects non-objects, ineligible entries, and malformed numbers', () => {
    expect(parseCustomerSmartFitOffer(null)).toBeNull();
    expect(parseCustomerSmartFitOffer('offer')).toBeNull();
    expect(parseCustomerSmartFitOffer({ ...OFFER })).toBeNull(); // missing eligible
    expect(parseCustomerSmartFitOffer({ ...OFFER, eligible: 'yes' })).toBeNull();
    expect(parseCustomerSmartFitOffer({ ...OFFER, eligible: true, discountAmountCents: 0 })).toBeNull();
    expect(parseCustomerSmartFitOffer({ ...OFFER, eligible: true, discountAmountCents: 6.5 })).toBeNull();
    expect(parseCustomerSmartFitOffer({ ...OFFER, eligible: true, originalPriceCents: -1 })).toBeNull();
  });

  it('rejects an annotation whose prices do not reconcile', () => {
    expect(parseCustomerSmartFitOffer({
      eligible: true,
      discountAmountCents: 650,
      originalPriceCents: 6500,
      discountedPriceCents: 6000,
    })).toBeNull();
  });
});

describe('parseSmartFitCentsParam', () => {
  it('parses plain non-negative integers only', () => {
    expect(parseSmartFitCentsParam('650')).toBe(650);
    expect(parseSmartFitCentsParam('0')).toBe(0);
    expect(parseSmartFitCentsParam(null)).toBeNull();
    expect(parseSmartFitCentsParam('')).toBeNull();
    expect(parseSmartFitCentsParam('-650')).toBeNull();
    expect(parseSmartFitCentsParam('6.5')).toBeNull();
    expect(parseSmartFitCentsParam('65e2')).toBeNull();
    expect(parseSmartFitCentsParam('abc')).toBeNull();
  });
});

describe('splitSmartFitSlots', () => {
  it('separates server-marked slots from regular ones without duplication', () => {
    const slots = [slot('9:00'), slot('10:30', OFFER), slot('11:00'), slot('13:30', OFFER)];
    const { smartFitSlots, regularSlots } = splitSmartFitSlots(slots);

    expect(smartFitSlots.map(s => s.time)).toEqual(['10:30', '13:30']);
    expect(regularSlots.map(s => s.time)).toEqual(['9:00', '11:00']);
    expect(smartFitSlots.length + regularSlots.length).toBe(slots.length);
  });

  it('preserves chronological input order inside both groups', () => {
    const slots = [slot('8:00', OFFER), slot('9:00'), slot('9:30', OFFER), slot('12:00'), slot('15:00', OFFER)];
    const { smartFitSlots, regularSlots } = splitSmartFitSlots(slots);

    expect(smartFitSlots.map(s => s.time)).toEqual(['8:00', '9:30', '15:00']);
    expect(regularSlots.map(s => s.time)).toEqual(['9:00', '12:00']);
  });

  it('returns an empty Smart Fit group when nothing qualifies', () => {
    const { smartFitSlots, regularSlots } = splitSmartFitSlots([slot('9:00'), slot('10:00')]);

    expect(smartFitSlots).toEqual([]);
    expect(regularSlots.map(s => s.time)).toEqual(['9:00', '10:00']);
  });

  it('keeps unavailable annotated slots in the regular group', () => {
    const slots = [slot('10:30', OFFER), slot('11:00', OFFER)];
    const { smartFitSlots, regularSlots } = splitSmartFitSlots(slots, {
      isSlotUnavailable: s => s.time === '10:30',
    });

    expect(smartFitSlots.map(s => s.time)).toEqual(['11:00']);
    expect(regularSlots.map(s => s.time)).toEqual(['10:30']);
  });
});

describe('parseTimeToMinutes', () => {
  it('parses the grid time formats', () => {
    expect(parseTimeToMinutes('9:00')).toBe(540);
    expect(parseTimeToMinutes('09:30')).toBe(570);
    expect(parseTimeToMinutes('13:45')).toBe(825);
    expect(parseTimeToMinutes('0:00')).toBe(0);
  });

  it('rejects invalid values', () => {
    expect(parseTimeToMinutes('25:00')).toBeNull();
    expect(parseTimeToMinutes('9:60')).toBeNull();
    expect(parseTimeToMinutes('soon')).toBeNull();
    expect(parseTimeToMinutes('9')).toBeNull();
  });
});

describe('selectNearbySmartFitSuggestion', () => {
  it('picks the smallest absolute time difference', () => {
    const suggestion = selectNearbySmartFitSuggestion({
      selectedTime: '11:00',
      slots: [slot('9:00', OFFER), slot('10:30', OFFER), slot('14:00', OFFER), slot('11:30')],
    });

    expect(suggestion?.time).toBe('10:30');
  });

  it('prefers the earlier slot on an exact distance tie', () => {
    const suggestion = selectNearbySmartFitSuggestion({
      selectedTime: '11:00',
      slots: [slot('10:30', OFFER), slot('11:30', OFFER)],
    });

    expect(suggestion?.time).toBe('10:30');
  });

  it('never suggests the selected slot itself', () => {
    const suggestion = selectNearbySmartFitSuggestion({
      selectedTime: '10:30',
      slots: [slot('10:30', OFFER)],
    });

    expect(suggestion).toBeNull();
  });

  it('returns null when no qualifying slot exists', () => {
    const suggestion = selectNearbySmartFitSuggestion({
      selectedTime: '11:00',
      slots: [slot('9:00'), slot('10:30'), slot('nonsense', OFFER)],
    });

    expect(suggestion).toBeNull();
  });

  it('only ever returns a single slot', () => {
    const suggestion = selectNearbySmartFitSuggestion({
      selectedTime: '12:00',
      slots: [slot('11:30', OFFER), slot('12:30', OFFER), slot('13:00', OFFER)],
    });

    expect(suggestion).toEqual(slot('11:30', OFFER));
  });
});

describe('describeSmartFitTimeDifference', () => {
  it('describes earlier and later deltas in plain language', () => {
    expect(describeSmartFitTimeDifference('11:00', '10:30')).toBe('30 minutes earlier');
    expect(describeSmartFitTimeDifference('11:00', '11:30')).toBe('30 minutes later');
    expect(describeSmartFitTimeDifference('11:00', '10:00')).toBe('1 hour earlier');
    expect(describeSmartFitTimeDifference('11:00', '12:15')).toBe('1 hour 15 minutes later');
    expect(describeSmartFitTimeDifference('11:00', '8:00')).toBe('3 hours earlier');
    expect(describeSmartFitTimeDifference('11:00', '11:01')).toBe('1 minute later');
  });

  it('returns null for unparseable or identical times', () => {
    expect(describeSmartFitTimeDifference('11:00', '11:00')).toBeNull();
    expect(describeSmartFitTimeDifference('11:00', 'later')).toBeNull();
    expect(describeSmartFitTimeDifference('nope', '10:30')).toBeNull();
  });
});

describe('buildSmartFitExpectationFields', () => {
  it('produces exactly the two approved P7.2 expectation fields', () => {
    const fields = buildSmartFitExpectationFields(OFFER);

    expect(fields).toEqual({
      expectedDiscountType: 'smart_fit',
      expectedTotalCents: 5850,
    });
    expect(Object.keys(fields)).toHaveLength(2);
  });
});

describe('resolveSmartFitReviewOffer', () => {
  it('activates only when the params reconcile with the server subtotal', () => {
    expect(resolveSmartFitReviewOffer({
      subtotalCents: 6500,
      discountCentsParam: 650,
      totalCentsParam: 5850,
      hasOtherDiscount: false,
    })).toEqual(OFFER);
  });

  it('stays inactive when a higher-priority discount applies', () => {
    expect(resolveSmartFitReviewOffer({
      subtotalCents: 6500,
      discountCentsParam: 650,
      totalCentsParam: 5850,
      hasOtherDiscount: true,
    })).toBeNull();
  });

  it('stays inactive on missing, zero, or inconsistent values', () => {
    expect(resolveSmartFitReviewOffer({ subtotalCents: 6500, discountCentsParam: null, totalCentsParam: 5850, hasOtherDiscount: false })).toBeNull();
    expect(resolveSmartFitReviewOffer({ subtotalCents: 6500, discountCentsParam: 650, totalCentsParam: null, hasOtherDiscount: false })).toBeNull();
    expect(resolveSmartFitReviewOffer({ subtotalCents: 6500, discountCentsParam: 0, totalCentsParam: 6500, hasOtherDiscount: false })).toBeNull();
    expect(resolveSmartFitReviewOffer({ subtotalCents: 6500, discountCentsParam: 650, totalCentsParam: 6000, hasOtherDiscount: false })).toBeNull();
    expect(resolveSmartFitReviewOffer({ subtotalCents: 0, discountCentsParam: 650, totalCentsParam: -650, hasOtherDiscount: false })).toBeNull();
  });
});

describe('suggestion dismissal session state', () => {
  const baseContext = {
    salonSlug: 'salon-a',
    dateKey: '2026-03-20',
    techId: 'tech_1',
    locationId: 'loc_1',
    baseServiceId: null,
    serviceIds: ['srv_1'],
    selectedAddOns: [{ addOnId: 'addon_1', quantity: 2 }],
  };
  const keyFor = (overrides: Partial<Parameters<typeof buildSmartFitSuggestionContextKey>[0]> = {}) =>
    buildSmartFitSuggestionContextKey({ ...baseContext, ...overrides });

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('is not dismissed by default and dismisses per context', () => {
    const key = keyFor();

    expect(syncSmartFitSuggestionDismissal(key)).toBe(false);

    dismissSmartFitSuggestion(key);

    expect(syncSmartFitSuggestionDismissal(key)).toBe(true);
    // Stays dismissed on repeated checks within the same context.
    expect(syncSmartFitSuggestionDismissal(key)).toBe(true);
  });

  const contextChanges: Array<[string, Partial<Parameters<typeof buildSmartFitSuggestionContextKey>[0]>]> = [
    ['date', { dateKey: '2026-03-21' }],
    ['service', { serviceIds: ['srv_2'] }],
    ['base service', { baseServiceId: 'srv_base' }],
    ['add-ons', { selectedAddOns: [{ addOnId: 'addon_1', quantity: 1 }] }],
    ['technician', { techId: 'tech_2' }],
    ['location', { locationId: 'loc_2' }],
  ];

  it.each(contextChanges)('resets after a %s change', (_label, overrides) => {
    dismissSmartFitSuggestion(keyFor());

    const changedKey = keyFor(overrides);

    expect(changedKey).not.toBe(keyFor());
    expect(syncSmartFitSuggestionDismissal(changedKey)).toBe(false);
    // The reset clears the stored dismissal entirely: returning to the
    // original context shows the suggestion again.
    expect(syncSmartFitSuggestionDismissal(keyFor())).toBe(false);
  });

  it('treats service order and add-on order as immaterial', () => {
    const key = buildSmartFitSuggestionContextKey({
      ...baseContext,
      serviceIds: ['srv_2', 'srv_1'],
      selectedAddOns: [{ addOnId: 'addon_b' }, { addOnId: 'addon_a', quantity: 2 }],
    });
    const reordered = buildSmartFitSuggestionContextKey({
      ...baseContext,
      serviceIds: ['srv_1', 'srv_2'],
      selectedAddOns: [{ addOnId: 'addon_a', quantity: 2 }, { addOnId: 'addon_b', quantity: 1 }],
    });

    expect(key).toBe(reordered);
  });
});

describe('availability refresh flag', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('is consumed exactly once', () => {
    expect(consumeSmartFitAvailabilityRefresh('salon-a')).toBe(false);

    markSmartFitAvailabilityRefresh('salon-a');

    expect(consumeSmartFitAvailabilityRefresh('salon-a')).toBe(true);
    expect(consumeSmartFitAvailabilityRefresh('salon-a')).toBe(false);
  });

  it('never fires for another salon, and clears the stranded flag', () => {
    markSmartFitAvailabilityRefresh('salon-a');

    expect(consumeSmartFitAvailabilityRefresh('salon-b')).toBe(false);
    // The stranded flag was cleared, not left to fire later.
    expect(consumeSmartFitAvailabilityRefresh('salon-a')).toBe(false);
  });
});

describe('stale breakdown parsing and precedence suppression', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('parses the 409 details breakdown and ignores malformed shapes', () => {
    expect(parseSmartFitStaleBreakdown({
      refreshAvailability: true,
      breakdown: {
        subtotalBeforeDiscountCents: 6500,
        discountAmountCents: 1625,
        discountType: 'first_visit_25',
        discountLabel: 'First visit discount',
        finalTotalCents: 4875,
      },
    })).toEqual({
      discountType: 'first_visit_25',
      discountLabel: 'First visit discount',
      discountAmountCents: 1625,
      finalTotalCents: 4875,
    });
    expect(parseSmartFitStaleBreakdown(null)).toBeNull();
    expect(parseSmartFitStaleBreakdown({})).toBeNull();
    expect(parseSmartFitStaleBreakdown({ breakdown: { finalTotalCents: 'lots' } })).toBeNull();
  });

  it('detects replacement by a higher-priority discount only', () => {
    expect(smartFitReplacedByHigherPriorityDiscount({
      discountType: 'first_visit_25',
      discountLabel: 'First visit discount',
      discountAmountCents: 1625,
      finalTotalCents: 4875,
    })).toBe(true);
    // Plain schedule staleness: no discount applies now.
    expect(smartFitReplacedByHigherPriorityDiscount({
      discountType: null,
      discountLabel: null,
      discountAmountCents: 0,
      finalTotalCents: 6500,
    })).toBe(false);
    // Still smart fit (a value drift, not a precedence replacement).
    expect(smartFitReplacedByHigherPriorityDiscount({
      discountType: 'smart_fit',
      discountLabel: 'Smart Fit Discount',
      discountAmountCents: 500,
      finalTotalCents: 6000,
    })).toBe(false);
    expect(smartFitReplacedByHigherPriorityDiscount(null)).toBe(false);
  });

  it('scopes the outranked suppression per salon session', () => {
    expect(isSmartFitOutrankedForSession('salon-a')).toBe(false);

    markSmartFitOutrankedForSession('salon-a');

    expect(isSmartFitOutrankedForSession('salon-a')).toBe(true);
    expect(isSmartFitOutrankedForSession('salon-b')).toBe(false);
  });
});

describe('approved stale copy', () => {
  it('matches the server message byte for byte', () => {
    expect(SMART_FIT_STALE_FALLBACK_MESSAGE)
      .toBe('This discounted time is no longer available. Please choose from the latest times.');
  });
});
