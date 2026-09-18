import { describe, expect, it } from 'vitest';

import { NAIL_BOOKING_EVAL_CASES, NAIL_BOOKING_SNAPSHOT, SYNTHETIC_NAIL_BOOKING_MENU, SYNTHETIC_NAIL_IDS } from './nailBookingCases';
import { scoreNailBookingInterpretation } from './nailBookingScorer';

describe('synthetic L1 nail-booking interpretation evaluation', () => {
  it('contains the representative natural-language cases and only public menu IDs', () => {
    expect(NAIL_BOOKING_EVAL_CASES.map(item => item.id)).toEqual(expect.arrayContaining([
      'gel-manicure-french-paraphrase-1',
      'biab-natural-language',
      'gelx-removal-french-short',
      'gelx-length-is-genuine-clarification',
      'repairs-count',
      'simple-art',
      'gel-nails-genuine-ambiguity',
    ]));
    expect(SYNTHETIC_NAIL_BOOKING_MENU.services.map(item => item.id)).toContain(SYNTHETIC_NAIL_IDS.gelManicure);
    expect(JSON.stringify(SYNTHETIC_NAIL_BOOKING_MENU)).not.toContain('priceCents');
  });

  it('scores exact direct selections through the shared L1 resolver, including automatic additions', () => {
    const testCase = NAIL_BOOKING_EVAL_CASES.find(item => item.id === 'gel-manicure-french-paraphrase-1')!;
    const score = scoreNailBookingInterpretation({ action: 'propose', serviceId: SYNTHETIC_NAIL_IDS.gelManicure, addOns: [{ addOnId: SYNTHETIC_NAIL_IDS.french, quantity: 1 }], question: 'details', optionIds: [], datePreference: null }, testCase);

    expect(score).toEqual({ passed: true, category: 'proposal', reason: 'authoritative_parity' });

    const resolved = NAIL_BOOKING_SNAPSHOT;

    expect(resolved.ruleProjections.some(rule => rule.effect === 'auto_add')).toBe(true);
  });

  it('keeps every proposal expectation aligned with the authoritative L1 totals', () => {
    for (const testCase of NAIL_BOOKING_EVAL_CASES) {
      if (testCase.expected.kind !== 'proposal') {
        continue;
      }
      const score = scoreNailBookingInterpretation({
        action: 'propose',
        serviceId: testCase.expected.selection.serviceId,
        addOns: testCase.expected.selection.selectedAddOns.map(item => ({ addOnId: item.addOnId, quantity: item.quantity ?? 1 })),
        question: 'details',
        optionIds: [],
        datePreference: null,
      }, testCase);

      expect(score, testCase.id).toEqual({ passed: true, category: 'proposal', reason: 'authoritative_parity' });
    }
  });

  it('rejects a scorer false positive when quantity differs despite matching add-on identity', () => {
    const testCase = NAIL_BOOKING_EVAL_CASES.find(item => item.id === 'repairs-count')!;
    const score = scoreNailBookingInterpretation({ action: 'propose', serviceId: SYNTHETIC_NAIL_IDS.gelManicure, addOns: [{ addOnId: SYNTHETIC_NAIL_IDS.french, quantity: 1 }, { addOnId: SYNTHETIC_NAIL_IDS.repair, quantity: 2 }], question: 'details', optionIds: [], datePreference: null }, testCase);

    expect(score).toMatchObject({ passed: false, reason: 'selection_mismatch' });
  });

  it('requires the intended clarification question and exact public options', () => {
    const testCase = NAIL_BOOKING_EVAL_CASES.find(item => item.id === 'gelx-length-is-genuine-clarification')!;

    expect(scoreNailBookingInterpretation({ action: 'clarify', serviceId: SYNTHETIC_NAIL_IDS.gelx, addOns: [], question: 'length', optionIds: [SYNTHETIC_NAIL_IDS.short, SYNTHETIC_NAIL_IDS.medium, SYNTHETIC_NAIL_IDS.long], datePreference: null }, testCase).passed).toBe(true);
    expect(scoreNailBookingInterpretation({ action: 'clarify', serviceId: SYNTHETIC_NAIL_IDS.gelx, addOns: [], question: 'finish', optionIds: [SYNTHETIC_NAIL_IDS.short], datePreference: null }, testCase).passed).toBe(false);
  });
});
