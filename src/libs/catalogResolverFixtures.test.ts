import { describe, expect, it } from 'vitest';

import { mapAddOnToCatalogSummary, mapServiceToCatalogSummary } from '@/libs/bookingCatalog';
import { buildBookingQuote, getPublicTechnicianCompatibility } from '@/libs/bookingQuote';
import type { CatalogResolutionResult, CatalogSnapshotResult } from '@/libs/catalogDomain';
import { buildPublicCatalogSnapshot, resolveCatalogSelection } from '@/libs/catalogResolverCore';
import {
  autoAddRule,
  capabilityDrivenServerOutcome,
  CATALOG_FIXTURE_SCENARIOS,
  corruptRuleReference,
  disabledReasonOutcome,
  explicitRequestApprovalPresentation,
  legacyParity,
  legacyUngroupedService,
  longLabels,
  mutuallyExclusiveRule,
  optionalMultiSelectGroup,
  parentWithThreeVariants,
  priceAndDurationChanges,
  quantityAddOn,
  requestIneligibleRepresentation,
  requiredSingleSelectGroup,
} from '@/libs/catalogResolverFixtures';

function expectOk<T extends { ok: boolean }>(result: T): asserts result is T & { ok: true } {
  if (!result.ok) {
    throw new Error(`expected ok:true, got ok:false: ${JSON.stringify(result)}`);
  }
}

function expectFail<T extends { ok: boolean }>(result: T): asserts result is T & { ok: false } {
  if (result.ok) {
    throw new Error(`expected ok:false, got ok:true`);
  }
}

// =============================================================================
// SANITY — the harness itself is exactly the 16 scenarios the Owner named,
// and every scenario is at least buildable (or, for the corrupt one,
// deliberately fails closed) without throwing.
// =============================================================================

describe('catalog fixture harness', () => {
  it('names exactly the 16 Owner-specified scenarios', () => {
    expect(CATALOG_FIXTURE_SCENARIOS).toHaveLength(16);
    expect(new Set(CATALOG_FIXTURE_SCENARIOS.map(s => s.key)).size).toBe(16);
  });

  it('every scenario builds (or deliberately fails) without throwing', () => {
    for (const scenario of CATALOG_FIXTURE_SCENARIOS) {
      const input = scenario.kind === 'material-change'
        ? scenario.buildBeforeSnapshotInput()
        : scenario.buildSnapshotInput();
      const result: CatalogSnapshotResult = buildPublicCatalogSnapshot(input);

      if (scenario.kind === 'corrupt') {
        expectFail(result);

        expect(result.failure.code, scenario.key).toBe(scenario.expectedFailureCode);
      } else {
        expectOk(result);
      }
    }
  });
});

// =============================================================================
// 1. Legacy ungrouped service
// =============================================================================

describe('scenario: legacy ungrouped service', () => {
  it('is representable as itself, with no synthetic family wrapper, and an ungrouped add-on', () => {
    const result = buildPublicCatalogSnapshot(legacyUngroupedService.buildSnapshotInput());
    expectOk(result);

    expect(result.snapshot.services).toEqual([
      expect.objectContaining({ id: 'svc_legacy', kind: 'legacy', parentServiceId: null, rangeSummary: null }),
    ]);
    expect(result.snapshot.addOns[0]).toMatchObject({ id: 'addon_legacy', groupId: null });
  });
});

// =============================================================================
// 2. Parent + three variants
// =============================================================================

describe('scenario: parent + three variants', () => {
  it('the parent carries a range summary spanning itself and every child', () => {
    const result = buildPublicCatalogSnapshot(parentWithThreeVariants.buildSnapshotInput());
    expectOk(result);
    const parent = result.snapshot.services.find(s => s.id === 'svc_parent')!;

    expect(parent.kind).toBe('parent');
    expect(parent.rangeSummary).toEqual({
      minPriceCents: 5500,
      maxPriceCents: 8000,
      minDurationMinutes: 60,
      maxDurationMinutes: 90,
    });
  });

  it('each child is kind "child" with its own label and price/duration', () => {
    const result = buildPublicCatalogSnapshot(parentWithThreeVariants.buildSnapshotInput());
    expectOk(result);
    const long = result.snapshot.services.find(s => s.id === 'svc_long')!;

    expect(long).toMatchObject({ kind: 'child', parentServiceId: 'svc_parent', variantLabel: 'Long', priceCents: 8000, durationMinutes: 90 });
  });
});

// =============================================================================
// 3. Required single-select group
// =============================================================================

describe('scenario: required single-select group', () => {
  it('selecting zero group members violates the required minimum', () => {
    const snapshot = buildPublicCatalogSnapshot(requiredSingleSelectGroup.buildSnapshotInput());
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(
      snapshot.snapshot,
      requiredSingleSelectGroup.kind === 'selection' ? requiredSingleSelectGroup.selection : { serviceId: '', selectedAddOns: [] },
    );
    expectOk(resolution);

    expect(resolution.selection.violations).toContainEqual({
      code: 'group_selection_below_minimum',
      anchor: { kind: 'group', groupId: 'group_shape' },
      minimum: 1,
      selected: 0,
    });
  });

  it('selecting exactly one satisfies min 1 / max 1', () => {
    const snapshot = buildPublicCatalogSnapshot(requiredSingleSelectGroup.buildSnapshotInput());
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(snapshot.snapshot, {
      serviceId: 'svc_shape',
      selectedAddOns: [{ addOnId: 'addon_square' }],
    });
    expectOk(resolution);

    expect(resolution.selection.violations).toHaveLength(0);
  });
});

// =============================================================================
// 4. Optional multi-select group
// =============================================================================

describe('scenario: optional multi-select group', () => {
  it('selecting more than the group maximum is a violation', () => {
    const snapshot = buildPublicCatalogSnapshot(optionalMultiSelectGroup.buildSnapshotInput());
    expectOk(snapshot);
    const resolution: CatalogResolutionResult = resolveCatalogSelection(
      snapshot.snapshot,
      optionalMultiSelectGroup.kind === 'selection' ? optionalMultiSelectGroup.selection : { serviceId: '', selectedAddOns: [] },
    );
    expectOk(resolution);

    expect(resolution.selection.violations).toContainEqual({
      code: 'group_selection_above_maximum',
      anchor: { kind: 'group', groupId: 'group_accent' },
      maximum: 2,
      selected: 3,
    });
  });
});

// =============================================================================
// 5. Quantity add-on — MANDATORY: no explicit max -> effective max 10
// =============================================================================

describe('scenario: quantity add-on', () => {
  it('MANDATORY — a per_unit add-on with no explicit maxQuantity has an effective ceiling of exactly 10', () => {
    const result = buildPublicCatalogSnapshot(quantityAddOn.buildSnapshotInput());
    expectOk(result);

    expect(result.snapshot.serviceAddOnBindings[0]!.effectiveMaxQuantity).toBe(10);
  });

  it('requesting past that inherited ceiling is a typed, un-clamped violation', () => {
    const snapshot = buildPublicCatalogSnapshot(quantityAddOn.buildSnapshotInput());
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(
      snapshot.snapshot,
      quantityAddOn.kind === 'selection' ? quantityAddOn.selection : { serviceId: '', selectedAddOns: [] },
    );
    expectOk(resolution);

    expect(resolution.selection.violations).toContainEqual({
      code: 'quantity_exceeded',
      anchor: { kind: 'quantity', addOnId: 'addon_nail_repair' },
      limit: 10,
      attempted: 11,
    });
    // No silent clamp: the line still reflects exactly what was requested.
    expect(resolution.selection.addOns[0]!.quantity).toBe(11);
  });
});

// =============================================================================
// 6. Auto-add rule
// =============================================================================

describe('scenario: auto-add rule', () => {
  it('bundles the object add-on automatically, with an explanation', () => {
    const snapshot = buildPublicCatalogSnapshot(autoAddRule.buildSnapshotInput());
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(
      snapshot.snapshot,
      autoAddRule.kind === 'selection' ? autoAddRule.selection : { serviceId: '', selectedAddOns: [] },
    );
    expectOk(resolution);

    expect(resolution.selection.addOns).toEqual([
      expect.objectContaining({ addOnId: 'addon_base_coat', autoAdded: true }),
    ]);
    expect(resolution.selection.explanations).toContainEqual(expect.objectContaining({ kind: 'add_on_auto_added' }));
  });
});

// =============================================================================
// 7. Mutually-exclusive rule
// =============================================================================

describe('scenario: mutually-exclusive rule', () => {
  it('selecting both conflicting add-ons produces a conflict violation', () => {
    const snapshot = buildPublicCatalogSnapshot(mutuallyExclusiveRule.buildSnapshotInput());
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(
      snapshot.snapshot,
      mutuallyExclusiveRule.kind === 'selection' ? mutuallyExclusiveRule.selection : { serviceId: '', selectedAddOns: [] },
    );
    expectOk(resolution);

    expect(resolution.selection.violations).toContainEqual(expect.objectContaining({ code: 'mutually_exclusive_conflict' }));
  });
});

// =============================================================================
// 8. Disabled/reason outcome — MANDATORY: exclude => disabled + stable reason
// =============================================================================

describe('scenario: disabled/reason outcome (exclude)', () => {
  it('MANDATORY — exclude disables the object add-on with a stable, typed reason', () => {
    const snapshot = buildPublicCatalogSnapshot(disabledReasonOutcome.buildSnapshotInput());
    expectOk(snapshot);
    const selection = disabledReasonOutcome.kind === 'selection' ? disabledReasonOutcome.selection : { serviceId: '', selectedAddOns: [] };

    const first = resolveCatalogSelection(snapshot.snapshot, selection);
    const second = resolveCatalogSelection(snapshot.snapshot, selection);
    expectOk(first);
    expectOk(second);

    const expectedViolation = {
      code: 'mutually_exclusive_conflict' as const,
      anchor: { kind: 'addOn' as const, addOnId: 'addon_fresh_set' },
    };

    expect(first.selection.violations).toContainEqual(expectedViolation);
    // Stable: repeated resolution of the identical input produces the
    // identical reason, not just the identical violation code.
    expect(second.selection).toEqual(first.selection);

    const explanation = first.selection.explanations.find(e => e.kind === 'add_on_unavailable');

    expect(explanation).toMatchObject({ reasonCode: 'unavailable_with_selection' });
  });
});

// =============================================================================
// 9. Capability-driven server outcome (input)
// =============================================================================

describe('scenario: capability-driven server outcome (input)', () => {
  it('an ineligible technician (per the supplied eligibility INPUT) blocks the selection, with no capability id ever appearing', () => {
    const snapshot = buildPublicCatalogSnapshot(capabilityDrivenServerOutcome.buildSnapshotInput());
    expectOk(snapshot);
    if (capabilityDrivenServerOutcome.kind !== 'selection') {
      throw new Error('expected a selection scenario');
    }
    const resolution = resolveCatalogSelection(
      snapshot.snapshot,
      capabilityDrivenServerOutcome.selection,
      capabilityDrivenServerOutcome.eligibility,
    );
    expectOk(resolution);

    expect(resolution.selection.violations).toContainEqual({
      code: 'capability_unavailable',
      anchor: { kind: 'technician', technicianId: 'tech_no_ombre_skill' },
    });
    expect(snapshot.snapshot.ruleProjections).toHaveLength(0);
    expect(JSON.stringify(snapshot.snapshot)).not.toContain('capabilityId');
  });
});

// =============================================================================
// 10. Price + duration changes
// =============================================================================

describe('scenario: price + duration changes', () => {
  it('the range/price/duration figures move between before and after', () => {
    if (priceAndDurationChanges.kind !== 'material-change') {
      throw new Error('expected a material-change scenario');
    }
    const before = buildPublicCatalogSnapshot(priceAndDurationChanges.buildBeforeSnapshotInput());
    const after = buildPublicCatalogSnapshot(priceAndDurationChanges.buildAfterSnapshotInput());
    expectOk(before);
    expectOk(after);

    expect(before.snapshot.services[0]!.priceCents).toBe(4000);
    expect(after.snapshot.services[0]!.priceCents).toBe(5000);
    expect(before.snapshot.services[0]!.durationMinutes).toBe(40);
    expect(after.snapshot.services[0]!.durationMinutes).toBe(50);
  });
});

// =============================================================================
// 11 & 12. Confirmation mode representation (request_approval / consultation)
// =============================================================================

describe('scenario: explicit request-approval presentation', () => {
  it('a stored confirmationMode of "request_approval" is resolved and represented as such', () => {
    const result = buildPublicCatalogSnapshot(explicitRequestApprovalPresentation.buildSnapshotInput());
    expectOk(result);

    expect(result.snapshot.services[0]!.effectiveConfirmationMode).toBe('request_approval');
  });
});

describe('scenario: request-ineligible representation (consultation-only)', () => {
  it('a consultation-only service resolves to "consultation" — distinct from both instant and request_approval', () => {
    const result = buildPublicCatalogSnapshot(requestIneligibleRepresentation.buildSnapshotInput());
    expectOk(result);

    expect(result.snapshot.services[0]!.effectiveConfirmationMode).toBe('consultation');
    expect(result.snapshot.services[0]!.effectiveConfirmationMode).not.toBe('instant');
    expect(result.snapshot.services[0]!.effectiveConfirmationMode).not.toBe('request_approval');
  });
});

// =============================================================================
// 14. Long labels
// =============================================================================

describe('scenario: long labels', () => {
  it('unusually long names/descriptions round-trip without truncation or corruption', () => {
    const result = buildPublicCatalogSnapshot(longLabels.buildSnapshotInput());
    expectOk(result);

    expect(result.snapshot.services[0]!.name).toHaveLength(180);
    expect(result.snapshot.addOns[0]!.name).toHaveLength(180);
    expect(result.snapshot.addOns[0]!.descriptionItems).toHaveLength(10);
  });
});

// =============================================================================
// 15. Corrupt rule/reference
// =============================================================================

describe('scenario: corrupt rule/reference', () => {
  it('fails closed with a typed corruption code, never a thrown exception or a guess', () => {
    const result = buildPublicCatalogSnapshot(corruptRuleReference.buildSnapshotInput());

    expectFail(result);

    expect(result.failure).toEqual({
      code: 'missing_referenced_object',
      anchor: { kind: 'addOn', addOnId: 'addon_does_not_exist' },
    });
  });
});

// =============================================================================
// 16. Legacy parity — MANDATORY: NULL new fields + no groups/rules/
// capabilities resolve identically to today's contract (bookingQuote.ts)
// =============================================================================

describe('scenario: legacy parity', () => {
  it('MANDATORY — the L1 resolver and the LEGACY bookingQuote.ts pipeline agree on price/duration for the identical legacy-shaped input', () => {
    const input = legacyParity.buildSnapshotInput();
    const snapshot = buildPublicCatalogSnapshot(input);
    expectOk(snapshot);
    if (legacyParity.kind !== 'selection') {
      throw new Error('expected a selection scenario');
    }
    const resolution = resolveCatalogSelection(snapshot.snapshot, legacyParity.selection);
    expectOk(resolution);

    // The LEGACY path, computed independently via bookingQuote.ts's own
    // pure helpers over the SAME raw rows — never modified, only read.
    const legacyService = mapServiceToCatalogSummary(input.services[0]!);
    const legacyAddOn = mapAddOnToCatalogSummary(input.addOns[0]!);
    const requestedQuantity = legacyParity.selection.selectedAddOns[0]!.quantity!;
    const legacyQuote = buildBookingQuote({
      baseService: legacyService,
      addOns: [{ ...legacyAddOn, quantity: requestedQuantity }],
      bufferMinutes: 0,
      resolvedIntroPriceLabel: null,
    });

    expect(resolution.selection.basePriceCents).toBe(legacyQuote.baseService.priceCents);
    expect(resolution.selection.baseDurationMinutes).toBe(legacyQuote.baseDurationMinutes);
    expect(resolution.selection.subtotalCents).toBe(legacyQuote.subtotalCents);
    expect(resolution.selection.totalDurationMinutes).toBe(legacyQuote.visibleDurationMinutes);
    expect(resolution.selection.addOns[0]!.lineTotalCents).toBe(legacyQuote.addOns[0]!.lineTotalCents);
    expect(resolution.selection.addOns[0]!.lineDurationMinutes).toBe(legacyQuote.addOns[0]!.lineDurationMinutes);
    expect(resolution.selection.violations).toHaveLength(0);

    // Sanity: `getPublicTechnicianCompatibility` (also untouched, also
    // legacy) is unaffected by anything this PR ships — no technician
    // requested, so the legacy helper reports bookable-by-default.
    const compatibility = getPublicTechnicianCompatibility({
      selectionMode: 'legacy',
      technician: { enabledServiceIds: [], serviceIds: [], specialties: [] },
      requestedServices: [],
    });

    expect(compatibility.bookable).toBe(true);
  });
});
