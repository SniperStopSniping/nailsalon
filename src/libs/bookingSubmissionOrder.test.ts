import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BOOKING_RECONCILIATION_ORDER } from './bookingSubmissionOrder';

/**
 * Luster L1 PR4 — §12. Gives `BOOKING_RECONCILIATION_ORDER` a real importer
 * and a real check, so it can never again drift into being a documented-but-
 * unverified claim about `route.ts`.
 *
 * Two layers, deliberately weighted the way the coordinator asked:
 *
 *   1. STRUCTURAL (this file) — source-text positions of one marker per
 *      step, cross-checked against the constant's own declared order. Cheap
 *      and total (covers all six steps), but a source-text position is not
 *      a behavioural guarantee — a refactor that preserves order but moves
 *      text could break it, and one that changes order while preserving
 *      text positions could evade it. Treated here as SECONDARY signal.
 *   2. BEHAVIOURAL (the authoritative layer) — lives where it can actually
 *      run the real `POST` handler:
 *        - catalogSelection before availability:
 *          `route.catalogReconciliation.integration.test.ts`, "§12 ORDER —
 *          BEHAVIOURAL proof" — a genuine slot conflict loses to a stale
 *          catalog acknowledgment, provably only possible if catalog
 *          reconciliation runs first.
 *        - requestApprovalTerms after availability: not merely tested but
 *          COMPILER-ENFORCED — see the dedicated check below, which pins
 *          the specific fact that makes reordering impossible, not just
 *          unwise: `resolveExplicitRequestApprovalActivation`'s call site
 *          reads `finalPolicy`, a `const` declared by the availability
 *          step itself. Referencing a `const` before its declaration in the
 *          same scope is a language-level error, not a convention.
 */

const ROOT = process.cwd();

function readRouteSource(): string {
  return readFileSync(path.join(ROOT, 'src/app/api/appointments/route.ts'), 'utf8');
}

describe('BOOKING_RECONCILIATION_ORDER — shape', () => {
  it('is the corrected six-step order, matching what route.ts actually does', () => {
    expect(BOOKING_RECONCILIATION_ORDER).toEqual([
      'catalogSelection',
      'policyAcknowledgment',
      'financialQuote',
      'availability',
      'requestApprovalTerms',
      'persistence',
    ]);
  });

  it('has no duplicate steps', () => {
    expect(new Set(BOOKING_RECONCILIATION_ORDER).size).toBe(BOOKING_RECONCILIATION_ORDER.length);
  });
});

describe('BOOKING_RECONCILIATION_ORDER — structural (secondary) cross-check against route.ts', () => {
  // One source-text marker per step. Each is the FIRST occurrence of a
  // sufficiently specific, unique-in-context string — not a claim that no
  // other mention of these terms exists anywhere in a 4000+ line file, only
  // that this exact anchor names the real call/declaration site.
  const MARKERS: Record<typeof BOOKING_RECONCILIATION_ORDER[number], string> = {
    catalogSelection: 'const catalogOutcome = await reconcileCatalogSelection(',
    policyAcknowledgment: 'const preliminaryRequiredPolicy = isNewPublicBooking',
    financialQuote: 'const validatedSelection = await validatePublicBookingSelection({',
    availability: 'const finalDecision = canTechnicianTakeAppointment({',
    requestApprovalTerms: 'resolveExplicitRequestApprovalActivation({',
    persistence: '.insert(appointmentSchema)',
  };

  it('the matcher is non-vacuous: every marker actually appears in route.ts, exactly where claimed', () => {
    const source = readRouteSource();

    for (const step of BOOKING_RECONCILIATION_ORDER) {
      const index = source.indexOf(MARKERS[step]);

      expect(index, `marker for "${step}" (${MARKERS[step]}) not found`).toBeGreaterThan(-1);
    }
  });

  /** True iff every consecutive pair in `order` appears in strictly increasing source position. */
  function isInOrder(source: string, order: readonly string[]): boolean {
    const indices = order.map(step => source.indexOf(MARKERS[step as typeof BOOKING_RECONCILIATION_ORDER[number]]));
    return indices.every((index, i) => i === 0 || index > indices[i - 1]!);
  }

  it('every marker appears in the SAME order BOOKING_RECONCILIATION_ORDER declares', () => {
    const source = readRouteSource();

    expect(isInOrder(source, BOOKING_RECONCILIATION_ORDER)).toBe(true);
  });

  it('the order-checking logic itself is non-vacuous: a deliberately WRONG order is correctly rejected', () => {
    const source = readRouteSource();
    // requestApprovalTerms's real marker sits textually AFTER
    // catalogSelection's — asserting the reverse must fail this same logic.
    const deliberatelyWrong = ['requestApprovalTerms', 'catalogSelection'] as const;

    expect(isInOrder(source, deliberatelyWrong)).toBe(false);
  });
});

describe('requestApprovalTerms after availability — the compiler-enforced dependency, checked directly', () => {
  it('finalPolicy (declared by the availability step) is declared BEFORE resolveExplicitRequestApprovalActivation reads it — the ONLY order TypeScript accepts in this scope', () => {
    const source = readRouteSource();

    const finalPolicyDeclIndex = source.indexOf('const finalPolicy = await loadBookingPolicy({');
    const activationCallIndex = source.indexOf('resolveExplicitRequestApprovalActivation({');

    expect(finalPolicyDeclIndex).toBeGreaterThan(-1);
    expect(activationCallIndex).toBeGreaterThan(-1);
    expect(finalPolicyDeclIndex).toBeLessThan(activationCallIndex);

    // And the activation call site genuinely reads `finalPolicy` — not a
    // coincidental ordering with no real dependency behind it.
    const callSiteEnd = source.indexOf('});', activationCallIndex);
    const callSiteText = source.slice(activationCallIndex, callSiteEnd);

    expect(callSiteText).toContain('finalPolicy.overridesByTechnician');
  });

  it('technician (resolved by the availability step\'s auto-pick / null-guard) is settled BEFORE the same call site reads it', () => {
    const source = readRouteSource();

    const nullGuardIndex = source.indexOf('if (!technician) {');
    const activationCallIndex = source.indexOf('resolveExplicitRequestApprovalActivation({');

    expect(nullGuardIndex).toBeGreaterThan(-1);
    expect(activationCallIndex).toBeGreaterThan(-1);
    expect(nullGuardIndex).toBeLessThan(activationCallIndex);
  });
});
