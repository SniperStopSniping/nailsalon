import { describe, expect, it } from 'vitest';

import { emptyFacts, mergeFacts, type Patch } from '../semanticFacts';
import {
  candidateForSemanticSelection,
  matchesExpectedSemanticSelection,
  resolveSyntheticSemanticFixture,
  SEMANTIC_EVAL_CASES,
} from './semanticCases';

function patchFor(expected: Record<string, unknown>): Patch {
  return {
    schemaVersion: 1,
    treatment: null,
    desiredApplication: null,
    maintenance: null,
    length: null,
    french: null,
    existingProduct: null,
    origin: null,
    removal: null,
    repairCount: null,
    ...expected,
  } as Patch;
}

describe('customer semantic evaluation cases', () => {
  it('keeps synthetic salon identity and covers critical semantic categories', () => {
    expect(SEMANTIC_EVAL_CASES).toHaveLength(23);
    expect(SEMANTIC_EVAL_CASES.every(testCase => testCase.trustedBookingSalon.slug.startsWith('synthetic-'))).toBe(true);
    expect(SEMANTIC_EVAL_CASES.map(testCase => testCase.id)).toEqual(expect.arrayContaining(['gelx-removal-other-salon', 'gelx-fill-here', 'gel-manicure-french-original-smoke', 'couple-repairs', 'length-correction', 'unsupported-acrylic']));
  });

  it('keeps each clarification distinguishable from a critical proposal failure', () => {
    const clarification = SEMANTIC_EVAL_CASES.find(testCase => testCase.id === 'gelx-length-clarification')!;
    const proposal = SEMANTIC_EVAL_CASES.find(testCase => testCase.id === 'gelx-short-natural')!;

    expect(clarification.turns[0]!).toMatchObject({ expectedAction: 'clarify', critical: false });
    expect(proposal.turns[0]!).toMatchObject({ expectedAction: 'propose', critical: true, expectedSelection: 'gelx_short' });
  });

  it('merges each turn then resolves successful proposals through the synthetic L1 authority', () => {
    for (const testCase of SEMANTIC_EVAL_CASES) {
      let facts = emptyFacts();
      for (const turn of testCase.turns) {
        facts = mergeFacts(facts, patchFor(turn.expectedFacts));

        expect(facts).toMatchObject(turn.expectedFacts);

        const result = resolveSyntheticSemanticFixture({ facts, candidate: candidateForSemanticSelection(turn.expectedSelection) });
        if (turn.expectedAction === 'propose') {
          expect(result.kind, `${testCase.id}: ${turn.message}`).toBe('proposal');
          expect(matchesExpectedSemanticSelection(result, turn.expectedSelection, facts), testCase.id).toBe(true);
        } else if (turn.expectedAction === 'clarify') {
          expect(result.kind, `${testCase.id}: ${turn.message}`).toBe('clarification');
        } else {
          // The fact mapper has no public acrylic service to bind, so it can
          // only return a safe clarification. The real-model scorer still
          // requires a no_match action for this unsupported request.
          expect(['no_match', 'clarification'], `${testCase.id}: ${turn.message}`).toContain(result.kind);
        }
      }
    }
  });

  it('requires the correct public removal binding and never infers removal from natural nails', () => {
    const noInferredRemoval = SEMANTIC_EVAL_CASES.find(testCase => testCase.id === 'gelx-short-natural')!.turns[0]!;

    expect(noInferredRemoval.expectedFacts).not.toHaveProperty('removal');

    const other = SEMANTIC_EVAL_CASES.find(testCase => testCase.id === 'gelx-removal-other-salon')!.turns[0]!;
    const here = SEMANTIC_EVAL_CASES.find(testCase => testCase.id === 'gelx-removal-here')!.turns[0]!;
    const otherFacts = mergeFacts(emptyFacts(), patchFor(other.expectedFacts));
    const hereFacts = mergeFacts(emptyFacts(), patchFor(here.expectedFacts));
    const otherResult = resolveSyntheticSemanticFixture({ facts: otherFacts, candidate: candidateForSemanticSelection(other.expectedSelection) });
    const hereResult = resolveSyntheticSemanticFixture({ facts: hereFacts, candidate: candidateForSemanticSelection(here.expectedSelection) });

    expect(otherResult).toMatchObject({ kind: 'proposal', selection: { selectedAddOns: expect.arrayContaining([{ addOnId: 'addon_semantic_other_salon_gelx_removal', quantity: 1 }]) } });
    expect(hereResult).toMatchObject({ kind: 'proposal', selection: { selectedAddOns: expect.arrayContaining([{ addOnId: 'addon_semantic_gelx_removal', quantity: 1 }]) } });
  });

  it('does not let a model-invented add-on redefine the canonical expected selection', () => {
    const plain = SEMANTIC_EVAL_CASES.find(testCase => testCase.id === 'couple-repairs')!.turns[0]!;
    const goldenFacts = mergeFacts(emptyFacts(), patchFor({ treatment: 'gel_polish', repairCount: 2 }));
    const inventedFrenchFacts = mergeFacts(goldenFacts, patchFor({ french: 'yes' }));
    const actual = resolveSyntheticSemanticFixture({
      facts: inventedFrenchFacts,
      candidate: candidateForSemanticSelection(plain.expectedSelection),
    });

    expect(matchesExpectedSemanticSelection(actual, plain.expectedSelection, goldenFacts)).toBe(false);
  });

  it('keeps the original Gel Manicure plus French smoke request at its canonical synthetic total', () => {
    const smoke = SEMANTIC_EVAL_CASES.find(testCase => testCase.id === 'gel-manicure-french-original-smoke')!.turns[0]!;
    const facts = mergeFacts(emptyFacts(), patchFor(smoke.expectedFacts));
    const result = resolveSyntheticSemanticFixture({ facts, candidate: candidateForSemanticSelection(smoke.expectedSelection) });

    expect(result).toMatchObject({ kind: 'proposal', subtotalCents: 5000, durationMinutes: 75 });
  });
});
