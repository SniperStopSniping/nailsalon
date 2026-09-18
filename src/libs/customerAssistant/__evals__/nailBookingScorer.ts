import { resolveCatalogSelection } from '@/libs/catalogResolverCore';

import { NAIL_BOOKING_SNAPSHOT, type NailBookingEvalCase, type NailInterpretation } from './nailBookingCases';

export type NailBookingScore = { passed: boolean; category: 'proposal' | 'clarify' | 'no_match'; reason: string };

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && [...left].sort().every((id, index) => id === [...right].sort()[index]);
}

export function scoreNailBookingInterpretation(intent: NailInterpretation, testCase: NailBookingEvalCase): NailBookingScore {
  if (testCase.expected.kind === 'no_match') {
    return { passed: intent.action === 'no_match', category: 'no_match', reason: intent.action === 'no_match' ? 'safe_no_match' : 'expected_safe_no_match' };
  }
  if (testCase.expected.kind === 'clarify') {
    const passed = intent.action === 'clarify' && intent.question === testCase.expected.question && sameIds(intent.optionIds, testCase.expected.optionIds);
    return { passed, category: 'clarify', reason: passed ? 'expected_clarification' : 'wrong_clarification' };
  }
  if (intent.action !== 'propose' || intent.serviceId === null) {
    return { passed: false, category: 'proposal', reason: 'expected_proposal' };
  }
  const expected = testCase.expected.selection;
  const directSelectionMatches = intent.serviceId === expected.serviceId
    && intent.addOns.length === expected.selectedAddOns.length
    && intent.addOns.every(item => expected.selectedAddOns.some(expectedItem => expectedItem.addOnId === item.addOnId && expectedItem.quantity === item.quantity));
  if (!directSelectionMatches) {
    return { passed: false, category: 'proposal', reason: 'selection_mismatch' };
  }
  const resolved = resolveCatalogSelection(NAIL_BOOKING_SNAPSHOT, { serviceId: intent.serviceId, selectedAddOns: intent.addOns });
  if (!resolved.ok || resolved.selection.blocksContinue) {
    return { passed: false, category: 'proposal', reason: 'authoritative_selection_invalid' };
  }
  const totalsMatch = resolved.selection.subtotalCents === testCase.expected.subtotalCents
    && resolved.selection.totalDurationMinutes === testCase.expected.durationMinutes;
  return { passed: totalsMatch, category: 'proposal', reason: totalsMatch ? 'authoritative_parity' : 'authoritative_total_mismatch' };
}
