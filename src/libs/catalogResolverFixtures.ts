import type {
  CatalogCorruptionCode,
  CatalogEligibilityInput,
  CatalogRuleCoreInput,
  CatalogSelectionInput,
} from '@/libs/catalogDomain';
import type { BuildPublicCatalogSnapshotInput } from '@/libs/catalogResolverCore';
import type {
  AddOn,
  AddOnGroup,
  Service,
  ServiceAddOn,
} from '@/models/Schema';

/**
 * Luster L1 PR3 — a REUSABLE, NON-PRODUCTION fixture harness for the catalog
 * resolver core.
 *
 * Nothing in this file touches a database, a request, or a production code
 * path. It exists so PR3's own tests, and PR4/PR7 after it, share ONE set of
 * fixture factories and ONE catalogue of the 16 scenarios the Owner named,
 * instead of every PR growing its own ad hoc test data. It deliberately does
 * NOT re-implement any resolution logic — every scenario is raw input data
 * (`BuildPublicCatalogSnapshotInput` / `CatalogSelectionInput` /
 * `CatalogEligibilityInput`) for the real `buildPublicCatalogSnapshot` /
 * `resolveCatalogSelection` from `catalogResolverCore.ts` to run against;
 * this file never computes a price, a duration, a violation, or an
 * explanation itself.
 */

export const FIXTURE_SALON_ID = 'salon_fixture';
export const FIXTURE_DATE = new Date('2024-06-01T00:00:00Z');

// =============================================================================
// FACTORIES — every column present, matching the real Drizzle row shape.
// =============================================================================

export function makeFixtureService(overrides: Partial<Service> = {}): Service {
  return {
    id: 'svc_fixture',
    salonId: FIXTURE_SALON_ID,
    name: 'Classic Manicure',
    description: null,
    descriptionItems: null,
    slug: 'classic-manicure',
    price: 4500,
    priceDisplayText: null,
    durationMinutes: 45,
    preparationBufferMinutes: 0,
    cleanupBufferMinutes: 0,
    isIntroPrice: false,
    introPriceLabel: null,
    introPriceExpiresAt: null,
    bookingQuestions: null,
    category: 'manicure',
    bookingCategory: 'manicure',
    templateKey: null,
    imageUrl: null,
    sortOrder: 0,
    featuredOrder: null,
    isActive: true,
    parentServiceId: null,
    variantLabel: null,
    variantKind: null,
    selectionMode: null,
    confirmationMode: null,
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
    ...overrides,
  } as Service;
}

export function makeFixtureAddOn(overrides: Partial<AddOn> = {}): AddOn {
  return {
    id: 'addon_fixture',
    salonId: FIXTURE_SALON_ID,
    name: 'Gel Polish',
    slug: 'gel-polish',
    category: 'nail_art',
    templateKey: null,
    descriptionItems: null,
    priceCents: 1000,
    priceDisplayText: null,
    durationMinutes: 15,
    pricingType: 'fixed',
    unitLabel: null,
    maxQuantity: null,
    isActive: true,
    displayOrder: 0,
    groupId: null,
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
    ...overrides,
  } as AddOn;
}

export function makeFixtureAddOnGroup(overrides: Partial<AddOnGroup> = {}): AddOnGroup {
  return {
    id: 'group_fixture',
    salonId: FIXTURE_SALON_ID,
    name: 'Nail Shape',
    slug: 'nail-shape',
    description: null,
    minSelections: 0,
    maxSelections: null,
    sortOrder: 0,
    isActive: true,
    templateKey: null,
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
    ...overrides,
  } as AddOnGroup;
}

export function makeFixtureBinding(overrides: Partial<ServiceAddOn> = {}): ServiceAddOn {
  return {
    id: 'sao_fixture',
    salonId: FIXTURE_SALON_ID,
    serviceId: 'svc_fixture',
    addOnId: 'addon_fixture',
    selectionMode: 'optional',
    conditions: null,
    defaultQuantity: null,
    maxQuantityOverride: null,
    displayOrder: 0,
    createdAt: FIXTURE_DATE,
    updatedAt: FIXTURE_DATE,
    ...overrides,
  } as ServiceAddOn;
}

export function makeFixtureRule(overrides: Partial<CatalogRuleCoreInput> = {}): CatalogRuleCoreInput {
  return {
    id: 'rule_fixture',
    ruleType: 'requires',
    serviceScopeId: null,
    subjectServiceId: null,
    subjectAddOnId: null,
    objectAddOnId: null,
    hasCapabilityRequirement: false,
    params: {},
    priority: 0,
    isActive: true,
    ...overrides,
  };
}

function baseInput(overrides: Partial<BuildPublicCatalogSnapshotInput> = {}): BuildPublicCatalogSnapshotInput {
  return {
    salonSettings: null,
    services: [],
    addOnGroups: [],
    addOns: [],
    serviceAddOnBindings: [],
    rules: [],
    now: FIXTURE_DATE,
    ...overrides,
  };
}

// =============================================================================
// THE 16 SCENARIOS
// =============================================================================

export type CatalogFixtureScenario =
  | {
    key: string;
    label: string;
    kind: 'snapshot';
    buildSnapshotInput: () => BuildPublicCatalogSnapshotInput;
  }
  | {
    key: string;
    label: string;
    kind: 'selection';
    buildSnapshotInput: () => BuildPublicCatalogSnapshotInput;
    selection: CatalogSelectionInput;
    eligibility?: CatalogEligibilityInput;
  }
  | {
    key: string;
    label: string;
    kind: 'material-change';
    buildBeforeSnapshotInput: () => BuildPublicCatalogSnapshotInput;
    buildAfterSnapshotInput: () => BuildPublicCatalogSnapshotInput;
  }
  | {
    key: string;
    label: string;
    kind: 'corrupt';
    buildSnapshotInput: () => BuildPublicCatalogSnapshotInput;
    expectedFailureCode: CatalogCorruptionCode;
  };

// 1. Legacy ungrouped service ------------------------------------------------
const legacyUngroupedService = {
  key: 'legacy_ungrouped_service',
  label: 'A legacy service with one ungrouped add-on — every L1 field NULL',
  kind: 'snapshot',
  buildSnapshotInput: () => baseInput({
    services: [makeFixtureService({ id: 'svc_legacy' })],
    addOns: [makeFixtureAddOn({ id: 'addon_legacy', groupId: null })],
    serviceAddOnBindings: [makeFixtureBinding({ id: 'sao_legacy', serviceId: 'svc_legacy', addOnId: 'addon_legacy' })],
  }),
} satisfies CatalogFixtureScenario;

// 2. Parent + three variants -------------------------------------------------
const parentWithThreeVariants = {
  key: 'parent_with_three_variants',
  label: 'A parent service with three priced/duration variant children',
  kind: 'snapshot',
  buildSnapshotInput: () => baseInput({
    services: [
      makeFixtureService({ id: 'svc_parent', name: 'Acrylic Set', price: 5500, durationMinutes: 60 }),
      makeFixtureService({ id: 'svc_short', parentServiceId: 'svc_parent', variantLabel: 'Short', variantKind: 'length', price: 5500, durationMinutes: 60 }),
      makeFixtureService({ id: 'svc_medium', parentServiceId: 'svc_parent', variantLabel: 'Medium', variantKind: 'length', price: 6500, durationMinutes: 75 }),
      makeFixtureService({ id: 'svc_long', parentServiceId: 'svc_parent', variantLabel: 'Long', variantKind: 'length', price: 8000, durationMinutes: 90 }),
    ],
  }),
} satisfies CatalogFixtureScenario;

// 3. Required single-select group --------------------------------------------
const requiredSingleSelectGroup = {
  key: 'required_single_select_group',
  label: 'A required (min 1, max 1) single-select add-on group',
  kind: 'selection',
  buildSnapshotInput: () => baseInput({
    services: [makeFixtureService({ id: 'svc_shape' })],
    addOnGroups: [makeFixtureAddOnGroup({ id: 'group_shape', name: 'Shape', minSelections: 1, maxSelections: 1 })],
    addOns: [
      makeFixtureAddOn({ id: 'addon_square', name: 'Square', groupId: 'group_shape' }),
      makeFixtureAddOn({ id: 'addon_oval', name: 'Oval', groupId: 'group_shape' }),
    ],
    serviceAddOnBindings: [
      makeFixtureBinding({ id: 'sao_square', serviceId: 'svc_shape', addOnId: 'addon_square' }),
      makeFixtureBinding({ id: 'sao_oval', serviceId: 'svc_shape', addOnId: 'addon_oval' }),
    ],
  }),
  // Selecting NEITHER group member violates the required minimum — the
  // caller decides how to react (e.g. block "Continue"); resolution itself
  // never picks a default on the client's behalf.
  selection: { serviceId: 'svc_shape', selectedAddOns: [] },
} satisfies CatalogFixtureScenario;

// 4. Optional multi-select group ----------------------------------------------
const optionalMultiSelectGroup = {
  key: 'optional_multi_select_group',
  label: 'An optional (min 0, max 2) multi-select add-on group, over-selected',
  kind: 'selection',
  buildSnapshotInput: () => baseInput({
    services: [makeFixtureService({ id: 'svc_accent' })],
    addOnGroups: [makeFixtureAddOnGroup({ id: 'group_accent', name: 'Accents', minSelections: 0, maxSelections: 2 })],
    addOns: [
      makeFixtureAddOn({ id: 'addon_glitter', name: 'Glitter', groupId: 'group_accent' }),
      makeFixtureAddOn({ id: 'addon_chrome', name: 'Chrome', groupId: 'group_accent' }),
      makeFixtureAddOn({ id: 'addon_matte', name: 'Matte Top Coat', groupId: 'group_accent' }),
    ],
    serviceAddOnBindings: [
      makeFixtureBinding({ id: 'sao_glitter', serviceId: 'svc_accent', addOnId: 'addon_glitter' }),
      makeFixtureBinding({ id: 'sao_chrome', serviceId: 'svc_accent', addOnId: 'addon_chrome' }),
      makeFixtureBinding({ id: 'sao_matte', serviceId: 'svc_accent', addOnId: 'addon_matte' }),
    ],
  }),
  selection: {
    serviceId: 'svc_accent',
    selectedAddOns: [{ addOnId: 'addon_glitter' }, { addOnId: 'addon_chrome' }, { addOnId: 'addon_matte' }],
  },
} satisfies CatalogFixtureScenario;

// 5. Quantity add-on (per-unit, unset ceiling) -------------------------------
const quantityAddOn = {
  key: 'quantity_add_on',
  label: 'A per_unit add-on with NO explicit maxQuantity, requested at 11',
  kind: 'selection',
  buildSnapshotInput: () => baseInput({
    services: [makeFixtureService({ id: 'svc_repair' })],
    addOns: [makeFixtureAddOn({ id: 'addon_nail_repair', name: 'Nail Repair', pricingType: 'per_unit', maxQuantity: null, priceCents: 500, durationMinutes: 5 })],
    serviceAddOnBindings: [makeFixtureBinding({ id: 'sao_repair', serviceId: 'svc_repair', addOnId: 'addon_nail_repair' })],
  }),
  // The MANDATORY "no explicit max -> effective max 10" assertion is made
  // against this scenario's snapshot directly (see the test file); this
  // selection additionally proves requesting past that inherited ceiling
  // (11) is a typed, un-clamped violation.
  selection: { serviceId: 'svc_repair', selectedAddOns: [{ addOnId: 'addon_nail_repair', quantity: 11 }] },
} satisfies CatalogFixtureScenario;

// 6. Auto-add rule ------------------------------------------------------------
const autoAddRule = {
  key: 'auto_add_rule',
  label: 'An include rule with autoAdd:true bundles a base coat automatically',
  kind: 'selection',
  buildSnapshotInput: () => baseInput({
    services: [makeFixtureService({ id: 'svc_gel' })],
    addOns: [makeFixtureAddOn({ id: 'addon_base_coat', name: 'Base Coat', priceCents: 0, durationMinutes: 5 })],
    rules: [makeFixtureRule({
      id: 'rule_auto_add_base_coat',
      ruleType: 'include',
      subjectServiceId: 'svc_gel',
      objectAddOnId: 'addon_base_coat',
      params: { autoAdd: true },
    })],
  }),
  selection: { serviceId: 'svc_gel', selectedAddOns: [] },
} satisfies CatalogFixtureScenario;

// 7. Mutually-exclusive rule ---------------------------------------------------
const mutuallyExclusiveRule = {
  key: 'mutually_exclusive_rule',
  label: 'Gel polish and regular polish are mutually exclusive',
  kind: 'selection',
  buildSnapshotInput: () => baseInput({
    services: [makeFixtureService({ id: 'svc_polish' })],
    addOns: [
      makeFixtureAddOn({ id: 'addon_gel_polish', name: 'Gel Polish' }),
      makeFixtureAddOn({ id: 'addon_regular_polish', name: 'Regular Polish' }),
    ],
    serviceAddOnBindings: [
      makeFixtureBinding({ id: 'sao_gel', serviceId: 'svc_polish', addOnId: 'addon_gel_polish' }),
      makeFixtureBinding({ id: 'sao_regular', serviceId: 'svc_polish', addOnId: 'addon_regular_polish' }),
    ],
    rules: [makeFixtureRule({
      id: 'rule_polish_conflict',
      ruleType: 'mutually_exclusive',
      subjectAddOnId: 'addon_gel_polish',
      objectAddOnId: 'addon_regular_polish',
    })],
  }),
  selection: { serviceId: 'svc_polish', selectedAddOns: [{ addOnId: 'addon_gel_polish' }, { addOnId: 'addon_regular_polish' }] },
} satisfies CatalogFixtureScenario;

// 8. Disabled/reason outcome (`exclude`) --------------------------------------
const disabledReasonOutcome = {
  key: 'disabled_reason_outcome',
  label: 'An exclude rule disables the object add-on with a stable reason',
  kind: 'selection',
  buildSnapshotInput: () => baseInput({
    services: [makeFixtureService({ id: 'svc_removal' })],
    addOns: [
      makeFixtureAddOn({ id: 'addon_soak_off', name: 'Soak-Off Removal', category: 'removal' }),
      makeFixtureAddOn({ id: 'addon_fresh_set', name: 'Fresh Set Add-On' }),
    ],
    serviceAddOnBindings: [
      makeFixtureBinding({ id: 'sao_soak_off', serviceId: 'svc_removal', addOnId: 'addon_soak_off' }),
      makeFixtureBinding({ id: 'sao_fresh_set', serviceId: 'svc_removal', addOnId: 'addon_fresh_set' }),
    ],
    rules: [makeFixtureRule({
      id: 'rule_exclude_fresh_set',
      ruleType: 'exclude',
      subjectAddOnId: 'addon_soak_off',
      objectAddOnId: 'addon_fresh_set',
    })],
  }),
  selection: { serviceId: 'svc_removal', selectedAddOns: [{ addOnId: 'addon_soak_off' }, { addOnId: 'addon_fresh_set' }] },
} satisfies CatalogFixtureScenario;

// 9. Capability-driven server outcome (input) ---------------------------------
const capabilityDrivenServerOutcome = {
  key: 'capability_driven_server_outcome',
  label: 'A requires_capability rule, driven by a canned server eligibility INPUT',
  kind: 'selection',
  buildSnapshotInput: () => baseInput({
    services: [makeFixtureService({ id: 'svc_ombre', name: 'Ombré Nail Art' })],
    rules: [makeFixtureRule({
      id: 'rule_requires_ombre_capability',
      ruleType: 'requires_capability',
      subjectServiceId: 'svc_ombre',
      hasCapabilityRequirement: true,
    })],
  }),
  selection: { serviceId: 'svc_ombre', selectedAddOns: [], technicianId: 'tech_no_ombre_skill' },
  // The harness supplies this as a plain INPUT (never a DB lookup) — the
  // real, private capability-to-boolean narrowing is
  // `catalogResolver.server.ts`'s `deriveCatalogEligibility`, which this
  // fixture is deliberately upstream of.
  eligibility: { technicianEligible: false },
} satisfies CatalogFixtureScenario;

// 10. Price + duration changes -------------------------------------------------
function buildPriceChangeBeforeSnapshotInput(): BuildPublicCatalogSnapshotInput {
  return baseInput({
    services: [makeFixtureService({ id: 'svc_seasonal', name: 'Seasonal Special', price: 4000, durationMinutes: 40 })],
  });
}

function buildPriceChangeAfterSnapshotInput(): BuildPublicCatalogSnapshotInput {
  return baseInput({
    services: [makeFixtureService({ id: 'svc_seasonal', name: 'Seasonal Special', price: 5000, durationMinutes: 50 })],
  });
}

const priceAndDurationChanges = {
  key: 'price_and_duration_changes',
  label: 'A revision where a service\'s price and duration change materially',
  kind: 'material-change',
  buildBeforeSnapshotInput: buildPriceChangeBeforeSnapshotInput,
  buildAfterSnapshotInput: buildPriceChangeAfterSnapshotInput,
} satisfies CatalogFixtureScenario;

// 11. Explicit request-approval presentation -----------------------------------
const explicitRequestApprovalPresentation = {
  key: 'explicit_request_approval_presentation',
  label: 'A service whose stored confirmationMode is "request_approval"',
  kind: 'snapshot',
  buildSnapshotInput: () => baseInput({
    services: [makeFixtureService({ id: 'svc_custom_design', name: 'Custom Hand-Painted Design', confirmationMode: 'request_approval' })],
  }),
} satisfies CatalogFixtureScenario;

// 12. Request-ineligible representation (consultation-only) --------------------
const requestIneligibleRepresentation = {
  key: 'request_ineligible_representation',
  label: 'A consultation-only service — NOT eligible for the lighter request-approval flow, distinctly represented from both instant and request_approval',
  kind: 'snapshot',
  buildSnapshotInput: () => baseInput({
    services: [makeFixtureService({ id: 'svc_consult', name: 'Nail Health Consultation', confirmationMode: 'consultation' })],
  }),
} satisfies CatalogFixtureScenario;

// 13. Stale-catalog material change (fingerprint) -------------------------------
const staleCatalogMaterialChange = {
  key: 'stale_catalog_material_change',
  label: 'The same service before/after a price bump — the concurrency-gate fingerprint must move',
  kind: 'material-change',
  // Deliberately the SAME before/after pair as scenario 10 — "the numbers
  // changed" and "the fingerprint that gates a stale submission changed"
  // are two assertions about ONE fixture, not two different fixtures.
  buildBeforeSnapshotInput: buildPriceChangeBeforeSnapshotInput,
  buildAfterSnapshotInput: buildPriceChangeAfterSnapshotInput,
} satisfies CatalogFixtureScenario;

// 14. Long labels ---------------------------------------------------------------
const LONG_SERVICE_NAME = 'A'.repeat(180);
const LONG_ADD_ON_NAME = 'B'.repeat(180);
const longLabels = {
  key: 'long_labels',
  label: 'A service and add-on with unusually long owner-authored names/descriptions',
  kind: 'snapshot',
  buildSnapshotInput: () => baseInput({
    services: [makeFixtureService({
      id: 'svc_long_label',
      name: LONG_SERVICE_NAME,
      descriptionItems: ['A very long description line that a nervous owner might type. '.repeat(3)],
    })],
    addOns: [makeFixtureAddOn({
      id: 'addon_long_label',
      name: LONG_ADD_ON_NAME,
      descriptionItems: Array.from({ length: 10 }, (_, i) => `Description bullet number ${i + 1} with some real length to it.`),
    })],
    serviceAddOnBindings: [makeFixtureBinding({ id: 'sao_long_label', serviceId: 'svc_long_label', addOnId: 'addon_long_label' })],
  }),
} satisfies CatalogFixtureScenario;

// 15. Corrupt rule/reference ------------------------------------------------------
const corruptRuleReference = {
  key: 'corrupt_rule_reference',
  label: 'An active rule referencing an add-on id that does not exist — fails closed',
  kind: 'corrupt',
  buildSnapshotInput: () => baseInput({
    services: [makeFixtureService({ id: 'svc_corrupt' })],
    rules: [makeFixtureRule({
      id: 'rule_dangling_reference',
      ruleType: 'requires',
      subjectServiceId: 'svc_corrupt',
      objectAddOnId: 'addon_does_not_exist',
    })],
  }),
  expectedFailureCode: 'missing_referenced_object',
} satisfies CatalogFixtureScenario;

// 16. Legacy parity ------------------------------------------------------------
const legacyParity = {
  key: 'legacy_parity',
  label: 'NULL new fields + no groups/rules/capabilities — must resolve identically to today\'s flat contract',
  kind: 'selection',
  buildSnapshotInput: () => baseInput({
    services: [makeFixtureService({ id: 'svc_parity', price: 6000, durationMinutes: 50 })],
    addOns: [makeFixtureAddOn({ id: 'addon_parity', pricingType: 'per_unit', maxQuantity: 5, priceCents: 800, durationMinutes: 10 })],
    serviceAddOnBindings: [makeFixtureBinding({ id: 'sao_parity', serviceId: 'svc_parity', addOnId: 'addon_parity' })],
  }),
  selection: { serviceId: 'svc_parity', selectedAddOns: [{ addOnId: 'addon_parity', quantity: 3 }] },
} satisfies CatalogFixtureScenario;

export const CATALOG_FIXTURE_SCENARIOS: CatalogFixtureScenario[] = [
  legacyUngroupedService,
  parentWithThreeVariants,
  requiredSingleSelectGroup,
  optionalMultiSelectGroup,
  quantityAddOn,
  autoAddRule,
  mutuallyExclusiveRule,
  disabledReasonOutcome,
  capabilityDrivenServerOutcome,
  priceAndDurationChanges,
  explicitRequestApprovalPresentation,
  requestIneligibleRepresentation,
  staleCatalogMaterialChange,
  longLabels,
  corruptRuleReference,
  legacyParity,
];

// Named re-exports for callers (this file, PR4, PR7) that want one scenario
// directly rather than searching the array by key.
export {
  autoAddRule,
  capabilityDrivenServerOutcome,
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
  staleCatalogMaterialChange,
};
