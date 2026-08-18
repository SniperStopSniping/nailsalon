import { describe, expect, it } from 'vitest';

import type { CatalogRuleCoreInput } from '@/libs/catalogDomain';
import { hashCatalogFingerprintWebCrypto } from '@/libs/catalogFingerprint';
import type { BuildPublicCatalogSnapshotInput } from '@/libs/catalogResolverCore';
import {
  buildPublicCatalogSnapshot,
  finalizeCatalogRevision,
  resolveCatalogSelection,
} from '@/libs/catalogResolverCore';
import type {
  AddOn,
  AddOnGroup,
  Service,
  ServiceAddOn,
} from '@/models/Schema';

// =============================================================================
// FIXTURE FACTORIES — every column present, matching the real Drizzle row
// shapes exactly (buildPublicCatalogSnapshot takes the same types the DB
// would return).
// =============================================================================

const FIXED_DATE = new Date('2024-01-01T00:00:00Z');

function makeService(overrides: Partial<Service> = {}): Service {
  return {
    id: 'svc_default',
    salonId: 'salon_1',
    name: 'Default Service',
    description: null,
    descriptionItems: null,
    slug: 'default-service',
    price: 5000,
    priceDisplayText: null,
    durationMinutes: 60,
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
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  } as Service;
}

function makeAddOn(overrides: Partial<AddOn> = {}): AddOn {
  return {
    id: 'addon_default',
    salonId: 'salon_1',
    name: 'Default Add-on',
    slug: 'default-add-on',
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
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  } as AddOn;
}

function makeAddOnGroup(overrides: Partial<AddOnGroup> = {}): AddOnGroup {
  return {
    id: 'group_default',
    salonId: 'salon_1',
    name: 'Default Group',
    slug: 'default-group',
    description: null,
    minSelections: 0,
    maxSelections: null,
    sortOrder: 0,
    isActive: true,
    templateKey: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  } as AddOnGroup;
}

function makeBinding(overrides: Partial<ServiceAddOn> = {}): ServiceAddOn {
  return {
    id: 'sao_default',
    salonId: 'salon_1',
    serviceId: 'svc_default',
    addOnId: 'addon_default',
    selectionMode: 'optional',
    conditions: null,
    defaultQuantity: null,
    maxQuantityOverride: null,
    displayOrder: 0,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  } as ServiceAddOn;
}

function makeRule(overrides: Partial<CatalogRuleCoreInput> = {}): CatalogRuleCoreInput {
  return {
    id: 'rule_default',
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

function baseSnapshotInput(overrides: Partial<BuildPublicCatalogSnapshotInput> = {}): BuildPublicCatalogSnapshotInput {
  return {
    salonSettings: null,
    services: [],
    addOnGroups: [],
    addOns: [],
    serviceAddOnBindings: [],
    rules: [],
    now: FIXED_DATE,
    ...overrides,
  };
}

function expectOk<T extends { ok: boolean }>(result: T): asserts result is T & { ok: true } {
  if (!result.ok) {
    throw new Error(`expected ok:true, got ok:false: ${JSON.stringify(result)}`);
  }
}

// =============================================================================
// IDENTITY — legacy / parent / child, deterministic ordering
// =============================================================================

describe('identity', () => {
  it('a legacy ungrouped service is representable as itself, no synthetic wrapper', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc_legacy' })],
    }));
    expectOk(result);

    expect(result.snapshot.services).toHaveLength(1);
    expect(result.snapshot.services[0]).toMatchObject({
      id: 'svc_legacy',
      kind: 'legacy',
      parentServiceId: null,
      rangeSummary: null,
    });
  });

  it('a service with active children is kind "parent" with a computed range summary', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [
        makeService({ id: 'svc_parent', price: 4000, durationMinutes: 40 }),
        makeService({ id: 'svc_child_short', parentServiceId: 'svc_parent', variantLabel: 'Short', price: 3000, durationMinutes: 30 }),
        makeService({ id: 'svc_child_long', parentServiceId: 'svc_parent', variantLabel: 'Long', price: 6000, durationMinutes: 50 }),
      ],
    }));
    expectOk(result);
    const parent = result.snapshot.services.find(s => s.id === 'svc_parent')!;

    expect(parent.kind).toBe('parent');
    expect(parent.rangeSummary).toEqual({
      minPriceCents: 3000,
      maxPriceCents: 6000,
      minDurationMinutes: 30,
      maxDurationMinutes: 50,
    });
  });

  it('a variant child is kind "child" and carries its parent id and label', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [
        makeService({ id: 'svc_parent' }),
        makeService({ id: 'svc_child', parentServiceId: 'svc_parent', variantLabel: 'Short' }),
      ],
    }));
    expectOk(result);
    const child = result.snapshot.services.find(s => s.id === 'svc_child')!;

    expect(child.kind).toBe('child');
    expect(child.parentServiceId).toBe('svc_parent');
    expect(child.variantLabel).toBe('Short');
  });

  it('a service whose only children are inactive is "legacy", not "parent"', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [
        makeService({ id: 'svc_a' }),
        makeService({ id: 'svc_child', parentServiceId: 'svc_a', variantLabel: 'X', isActive: false }),
      ],
    }));
    expectOk(result);
    const a = result.snapshot.services.find(s => s.id === 'svc_a')!;

    expect(a.kind).toBe('legacy');
  });

  it('services are ordered deterministically (sortOrder, then id) with a stable tiebreak on ties', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [
        makeService({ id: 'svc_c', sortOrder: 0 }),
        makeService({ id: 'svc_a', sortOrder: 0 }),
        makeService({ id: 'svc_b', sortOrder: 0 }),
      ],
    }));
    expectOk(result);

    expect(result.snapshot.services.map(s => s.id)).toEqual(['svc_a', 'svc_b', 'svc_c']);
  });

  it('ordering is independent of input array order (same output for reversed input)', () => {
    const services = [
      makeService({ id: 'svc_1', sortOrder: 2 }),
      makeService({ id: 'svc_2', sortOrder: 1 }),
      makeService({ id: 'svc_3', sortOrder: 3 }),
    ];
    const forward = buildPublicCatalogSnapshot(baseSnapshotInput({ services }));
    const reversed = buildPublicCatalogSnapshot(baseSnapshotInput({ services: [...services].reverse() }));
    expectOk(forward);
    expectOk(reversed);

    expect(forward.snapshot.services.map(s => s.id)).toEqual(reversed.snapshot.services.map(s => s.id));
  });

  it('an inactive service never appears in the public output', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc_hidden', isActive: false })],
    }));
    expectOk(result);

    expect(result.snapshot.services).toHaveLength(0);
  });
});

// =============================================================================
// INHERITANCE — price/duration are the child's own; confirmationMode and
// add-on bindings inherit from the parent when the child has none of its own.
// =============================================================================

describe('inheritance', () => {
  it('a child\'s own price and duration are used as-is, never overwritten by the parent\'s', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [
        makeService({ id: 'svc_parent', price: 9999, durationMinutes: 99 }),
        makeService({ id: 'svc_child', parentServiceId: 'svc_parent', variantLabel: 'X', price: 1234, durationMinutes: 12 }),
      ],
    }));
    expectOk(result);
    const child = result.snapshot.services.find(s => s.id === 'svc_child')!;

    expect(child.priceCents).toBe(1234);
    expect(child.durationMinutes).toBe(12);
  });

  it('a child with no confirmationMode of its own inherits the parent\'s', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [
        makeService({ id: 'svc_parent', confirmationMode: 'consultation' }),
        makeService({ id: 'svc_child', parentServiceId: 'svc_parent', variantLabel: 'X', confirmationMode: null }),
      ],
    }));
    expectOk(result);
    const child = result.snapshot.services.find(s => s.id === 'svc_child')!;

    expect(child.effectiveConfirmationMode).toBe('consultation');
  });

  it('a child\'s own confirmationMode overrides the parent\'s', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [
        makeService({ id: 'svc_parent', confirmationMode: 'consultation' }),
        makeService({ id: 'svc_child', parentServiceId: 'svc_parent', variantLabel: 'X', confirmationMode: 'instant' }),
      ],
    }));
    expectOk(result);
    const child = result.snapshot.services.find(s => s.id === 'svc_child')!;

    expect(child.effectiveConfirmationMode).toBe('instant');
  });

  it('a child with no add-on bindings of its own inherits the parent\'s, re-attributed to the child', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [
        makeService({ id: 'svc_parent' }),
        makeService({ id: 'svc_child', parentServiceId: 'svc_parent', variantLabel: 'X' }),
      ],
      addOns: [makeAddOn({ id: 'addon_1' })],
      serviceAddOnBindings: [makeBinding({ id: 'sao_1', serviceId: 'svc_parent', addOnId: 'addon_1' })],
    }));
    expectOk(result);
    const childBindings = result.snapshot.serviceAddOnBindings.filter(b => b.serviceId === 'svc_child');

    expect(childBindings).toHaveLength(1);
    expect(childBindings[0]!.addOnId).toBe('addon_1');
  });

  it('a child with its own add-on bindings is authoritative — the parent\'s never merge in', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [
        makeService({ id: 'svc_parent' }),
        makeService({ id: 'svc_child', parentServiceId: 'svc_parent', variantLabel: 'X' }),
      ],
      addOns: [makeAddOn({ id: 'addon_parent_only' }), makeAddOn({ id: 'addon_child_only' })],
      serviceAddOnBindings: [
        makeBinding({ id: 'sao_p', serviceId: 'svc_parent', addOnId: 'addon_parent_only' }),
        makeBinding({ id: 'sao_c', serviceId: 'svc_child', addOnId: 'addon_child_only' }),
      ],
    }));
    expectOk(result);
    const childBindings = result.snapshot.serviceAddOnBindings.filter(b => b.serviceId === 'svc_child');

    expect(childBindings.map(b => b.addOnId)).toEqual(['addon_child_only']);
  });
});

// =============================================================================
// GROUPS
// =============================================================================

describe('groups', () => {
  it('maxSelections: 1 is recognized as single-select', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      addOnGroups: [makeAddOnGroup({ id: 'g1', minSelections: 1, maxSelections: 1 })],
    }));
    expectOk(result);

    expect(result.snapshot.addOnGroups[0]!.isSingleSelect).toBe(true);
  });

  it('an unlimited group (maxSelections: null) is not single-select', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      addOnGroups: [makeAddOnGroup({ id: 'g1', maxSelections: null })],
    }));
    expectOk(result);

    expect(result.snapshot.addOnGroups[0]!.isSingleSelect).toBe(false);
  });

  it('selecting fewer than the group minimum is a violation with a group anchor', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOnGroups: [makeAddOnGroup({ id: 'g1', minSelections: 1, maxSelections: 3 })],
      addOns: [makeAddOn({ id: 'a1', groupId: 'g1' }), makeAddOn({ id: 'a2', groupId: 'g1' })],
      serviceAddOnBindings: [makeBinding({ id: 'sao1', serviceId: 'svc1', addOnId: 'a1' })],
    }));
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [] });
    expectOk(resolution);

    expect(resolution.selection.violations).toContainEqual({
      code: 'group_selection_below_minimum',
      anchor: { kind: 'group', groupId: 'g1' },
      minimum: 1,
      selected: 0,
    });
  });

  it('selecting more than the group maximum (multi-select) is a violation', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOnGroups: [makeAddOnGroup({ id: 'g1', minSelections: 0, maxSelections: 1 })],
      addOns: [makeAddOn({ id: 'a1', groupId: 'g1' }), makeAddOn({ id: 'a2', groupId: 'g1' })],
      serviceAddOnBindings: [
        makeBinding({ id: 'sao1', serviceId: 'svc1', addOnId: 'a1' }),
        makeBinding({ id: 'sao2', serviceId: 'svc1', addOnId: 'a2' }),
      ],
    }));
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(snapshot.snapshot, {
      serviceId: 'svc1',
      selectedAddOns: [{ addOnId: 'a1' }, { addOnId: 'a2' }],
    });
    expectOk(resolution);

    expect(resolution.selection.violations).toContainEqual({
      code: 'group_selection_above_maximum',
      anchor: { kind: 'group', groupId: 'g1' },
      maximum: 1,
      selected: 2,
    });
  });

  it('a selection within group bounds produces no group violation', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOnGroups: [makeAddOnGroup({ id: 'g1', minSelections: 1, maxSelections: 2 })],
      addOns: [makeAddOn({ id: 'a1', groupId: 'g1' })],
      serviceAddOnBindings: [makeBinding({ id: 'sao1', serviceId: 'svc1', addOnId: 'a1' })],
    }));
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [{ addOnId: 'a1' }] });
    expectOk(resolution);

    expect(resolution.selection.violations).toHaveLength(0);
  });
});

// =============================================================================
// ALL SIX RULE TYPES — public projection mapping
// =============================================================================

describe('rule type -> public projection effect mapping', () => {
  const services = [makeService({ id: 'svc1' })];
  const addOns = [makeAddOn({ id: 'subject_addon' }), makeAddOn({ id: 'object_addon' })];

  it('include with autoAdd:true projects "auto_add"', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services,
      addOns,
      rules: [makeRule({ id: 'r1', ruleType: 'include', subjectAddOnId: 'subject_addon', objectAddOnId: 'object_addon', params: { autoAdd: true } })],
    }));
    expectOk(result);

    expect(result.snapshot.ruleProjections).toHaveLength(1);
    expect(result.snapshot.ruleProjections[0]).toMatchObject({ effect: 'auto_add', targetAddOnId: 'object_addon' });
  });

  it('include WITHOUT autoAdd (a mere offer) produces no projection at all — unproducible at this layer', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services,
      addOns,
      rules: [makeRule({ id: 'r1', ruleType: 'include', subjectAddOnId: 'subject_addon', objectAddOnId: 'object_addon', params: {} })],
    }));
    expectOk(result);

    expect(result.snapshot.ruleProjections).toHaveLength(0);
  });

  it('exclude projects "disable", NOT "hide" — migration 0073 says the object add-on becomes "unavailable", not vanished, and a hidden element would have nowhere to carry the explanation', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services,
      addOns,
      rules: [makeRule({ id: 'r1', ruleType: 'exclude', subjectAddOnId: 'subject_addon', objectAddOnId: 'object_addon' })],
    }));
    expectOk(result);

    expect(result.snapshot.ruleProjections[0]).toMatchObject({ effect: 'disable', targetAddOnId: 'object_addon' });
  });

  it('requires projects "require" with the required add-on as the target', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services,
      addOns,
      rules: [makeRule({ id: 'r1', ruleType: 'requires', subjectAddOnId: 'subject_addon', objectAddOnId: 'object_addon' })],
    }));
    expectOk(result);

    expect(result.snapshot.ruleProjections[0]).toMatchObject({ effect: 'require', targetAddOnId: 'object_addon', reasonCode: 'required_for_selection' });
  });

  it('mutually_exclusive projects "disable"', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services,
      addOns,
      rules: [makeRule({ id: 'r1', ruleType: 'mutually_exclusive', subjectAddOnId: 'subject_addon', objectAddOnId: 'object_addon' })],
    }));
    expectOk(result);

    expect(result.snapshot.ruleProjections[0]).toMatchObject({ effect: 'disable', targetAddOnId: 'object_addon' });
  });

  it('max_quantity projects "limit_quantity" carrying the numeric cap', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services,
      addOns,
      rules: [makeRule({ id: 'r1', ruleType: 'max_quantity', subjectServiceId: 'svc1', objectAddOnId: 'object_addon', params: { maxQuantity: 4 } })],
    }));
    expectOk(result);

    expect(result.snapshot.ruleProjections[0]).toMatchObject({ effect: 'limit_quantity', targetAddOnId: 'object_addon', maxQuantity: 4 });
  });

  it('requires_capability produces NO public projection at all — capability handling is server-only, never advertised as a hidden gate', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services,
      rules: [makeRule({ id: 'r1', ruleType: 'requires_capability', subjectServiceId: 'svc1', objectAddOnId: null, hasCapabilityRequirement: true })],
    }));
    expectOk(result);

    expect(result.snapshot.ruleProjections).toHaveLength(0);
  });

  it('a stored reasonCode/presentation is honoured; an absent one falls back to the deterministic default', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services,
      addOns,
      rules: [makeRule({
        id: 'r1',
        ruleType: 'exclude',
        subjectAddOnId: 'subject_addon',
        objectAddOnId: 'object_addon',
        params: { presentation: 'silent' },
      })],
    }));
    expectOk(result);

    expect(result.snapshot.ruleProjections[0]).toMatchObject({
      presentation: 'silent',
      reasonCode: 'unavailable_with_selection',
    });
  });

  it('hide is unproduced by every current rule type (kept in the union for a future rule type)', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services,
      addOns,
      rules: [
        makeRule({ id: 'r1', ruleType: 'exclude', subjectAddOnId: 'subject_addon', objectAddOnId: 'object_addon' }),
        makeRule({ id: 'r2', ruleType: 'mutually_exclusive', subjectServiceId: 'svc1', objectAddOnId: 'object_addon' }),
      ],
    }));
    expectOk(result);

    expect(result.snapshot.ruleProjections.map(p => p.effect)).toEqual(['disable', 'disable']);
    expect(result.snapshot.ruleProjections.some(p => p.effect === 'hide')).toBe(false);
  });
});

// =============================================================================
// AUTO-ADD
// =============================================================================

describe('auto-add', () => {
  it('auto-adds the object add-on when the subject service is selected, with a reason', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'included_addon', priceCents: 500, durationMinutes: 5 })],
      rules: [makeRule({ id: 'r1', ruleType: 'include', subjectServiceId: 'svc1', objectAddOnId: 'included_addon', params: { autoAdd: true } })],
    }));
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [] });
    expectOk(resolution);

    expect(resolution.selection.addOns).toEqual([
      expect.objectContaining({ addOnId: 'included_addon', quantity: 1, autoAdded: true, lineTotalCents: 500 }),
    ]);
    expect(resolution.selection.explanations).toContainEqual(expect.objectContaining({
      kind: 'add_on_auto_added',
      anchor: { kind: 'addOn', addOnId: 'included_addon' },
    }));
  });

  it('the explanation is present even when the rule\'s presentation is "silent" (no-silent-material-change invariant)', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'included_addon' })],
      rules: [makeRule({ id: 'r1', ruleType: 'include', subjectServiceId: 'svc1', objectAddOnId: 'included_addon', params: { autoAdd: true, presentation: 'silent' } })],
    }));
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [] });
    expectOk(resolution);
    const explanation = resolution.selection.explanations.find(e => e.kind === 'add_on_auto_added');

    expect(explanation).toBeDefined();
    expect(explanation!.presentation).toBe('silent');
  });

  it('does not duplicate a line when the client already explicitly selected the auto-add target', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'included_addon' })],
      rules: [makeRule({ id: 'r1', ruleType: 'include', subjectServiceId: 'svc1', objectAddOnId: 'included_addon', params: { autoAdd: true } })],
    }));
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(snapshot.snapshot, {
      serviceId: 'svc1',
      selectedAddOns: [{ addOnId: 'included_addon', quantity: 2 }],
    });
    expectOk(resolution);

    expect(resolution.selection.addOns).toHaveLength(1);
    expect(resolution.selection.addOns[0]).toMatchObject({ addOnId: 'included_addon', quantity: 2, autoAdded: false });
  });

  it('is deterministic across repeated resolutions of the same input', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'a' }), makeAddOn({ id: 'b' })],
      rules: [
        makeRule({ id: 'r1', ruleType: 'include', subjectServiceId: 'svc1', objectAddOnId: 'a', params: { autoAdd: true } }),
        makeRule({ id: 'r2', ruleType: 'include', subjectAddOnId: 'a', objectAddOnId: 'b', params: { autoAdd: true } }),
      ],
    }));
    expectOk(snapshot);
    const first = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [] });
    const second = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [] });
    expectOk(first);
    expectOk(second);

    expect(first.selection).toEqual(second.selection);
    expect(first.selection.addOns.map(l => l.addOnId)).toEqual(['a', 'b']);
  });

  it('a chained auto-add (subject -> a -> b) expands transitively', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'a' }), makeAddOn({ id: 'b' })],
      rules: [
        makeRule({ id: 'r1', ruleType: 'include', subjectServiceId: 'svc1', objectAddOnId: 'a', params: { autoAdd: true } }),
        makeRule({ id: 'r2', ruleType: 'include', subjectAddOnId: 'a', objectAddOnId: 'b', params: { autoAdd: true } }),
      ],
    }));
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [] });
    expectOk(resolution);

    expect(resolution.selection.addOns.map(l => l.addOnId).sort()).toEqual(['a', 'b']);
  });

  it('a cyclic auto-add graph (a includes b, b includes a) is rejected as a typed failure at snapshot build time', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'a' }), makeAddOn({ id: 'b' })],
      rules: [
        makeRule({ id: 'r1', ruleType: 'include', subjectAddOnId: 'a', objectAddOnId: 'b', params: { autoAdd: true } }),
        makeRule({ id: 'r2', ruleType: 'include', subjectAddOnId: 'b', objectAddOnId: 'a', params: { autoAdd: true } }),
      ],
    }));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.failure.code).toBe('cyclic_auto_add');
    }
  });

  it('`requires` never auto-adds — only `include` does (Owner ruling)', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'required_addon' })],
      rules: [makeRule({ id: 'r1', ruleType: 'requires', subjectServiceId: 'svc1', objectAddOnId: 'required_addon' })],
    }));
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [] });
    expectOk(resolution);

    expect(resolution.selection.addOns).toHaveLength(0);
    expect(resolution.selection.violations).toContainEqual({
      code: 'required_dependency_unmet',
      anchor: { kind: 'addOn', addOnId: 'required_addon' },
    });
  });
});

// =============================================================================
// QUANTITY
// =============================================================================

describe('quantity precedence', () => {
  it('base semantics: a fixed-priced add-on always has an effective ceiling of 1', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'a1', pricingType: 'fixed' })],
      serviceAddOnBindings: [makeBinding({ id: 'sao1', serviceId: 'svc1', addOnId: 'a1' })],
    }));
    expectOk(result);

    expect(result.snapshot.serviceAddOnBindings[0]!.effectiveMaxQuantity).toBe(1);
  });

  it('an unset per_unit ceiling defaults to 10 — bookingQuote.ts:470-481\'s own inherited default, mirrored exactly rather than left unbounded', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'a1', pricingType: 'per_unit', maxQuantity: null })],
      serviceAddOnBindings: [makeBinding({ id: 'sao1', serviceId: 'svc1', addOnId: 'a1' })],
    }));
    expectOk(result);

    expect(result.snapshot.serviceAddOnBindings[0]!.effectiveMaxQuantity).toBe(10);
  });

  it('the add-on\'s own baseMaxQuantity (no binding context) follows the same server-parity rule: 10 for an unset per_unit ceiling, 1 for fixed', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      addOns: [
        makeAddOn({ id: 'a1', pricingType: 'per_unit', maxQuantity: null }),
        makeAddOn({ id: 'a2', pricingType: 'per_unit', maxQuantity: 6 }),
        makeAddOn({ id: 'a3', pricingType: 'fixed' }),
      ],
    }));
    expectOk(result);

    const byId = new Map(result.snapshot.addOns.map(a => [a.id, a]));

    expect(byId.get('a1')!.baseMaxQuantity).toBe(10);
    expect(byId.get('a2')!.baseMaxQuantity).toBe(6);
    expect(byId.get('a3')!.baseMaxQuantity).toBe(1);
  });

  it('service_add_on.maxQuantityOverride replaces the add-on\'s own base ceiling', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'a1', pricingType: 'per_unit', maxQuantity: 5 })],
      serviceAddOnBindings: [makeBinding({ id: 'sao1', serviceId: 'svc1', addOnId: 'a1', maxQuantityOverride: 8 })],
    }));
    expectOk(result);

    expect(result.snapshot.serviceAddOnBindings[0]!.effectiveMaxQuantity).toBe(8);
  });

  it('a service-conditioned max_quantity rule tightens the ceiling below the override', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'a1', pricingType: 'per_unit', maxQuantity: 10 })],
      serviceAddOnBindings: [makeBinding({ id: 'sao1', serviceId: 'svc1', addOnId: 'a1', maxQuantityOverride: 8 })],
      rules: [makeRule({ id: 'r1', ruleType: 'max_quantity', subjectServiceId: 'svc1', objectAddOnId: 'a1', params: { maxQuantity: 3 } })],
    }));
    expectOk(result);

    expect(result.snapshot.serviceAddOnBindings[0]!.effectiveMaxQuantity).toBe(3);
  });

  it('a max_quantity rule can never LOOSEN the ceiling — a cap higher than the override is ignored', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'a1', pricingType: 'per_unit', maxQuantity: 10 })],
      serviceAddOnBindings: [makeBinding({ id: 'sao1', serviceId: 'svc1', addOnId: 'a1', maxQuantityOverride: 3 })],
      rules: [makeRule({ id: 'r1', ruleType: 'max_quantity', subjectServiceId: 'svc1', objectAddOnId: 'a1', params: { maxQuantity: 7 } })],
    }));
    expectOk(result);

    // Strictest wins: min(override=3, rule=7) = 3, never raised to 7.
    expect(result.snapshot.serviceAddOnBindings[0]!.effectiveMaxQuantity).toBe(3);
  });

  it('requesting more than the effective ceiling is a typed violation with limit/attempted, and the line is NEVER silently clamped', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'a1', pricingType: 'per_unit', maxQuantity: 3, priceCents: 100, durationMinutes: 10 })],
      serviceAddOnBindings: [makeBinding({ id: 'sao1', serviceId: 'svc1', addOnId: 'a1' })],
    }));
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(snapshot.snapshot, {
      serviceId: 'svc1',
      selectedAddOns: [{ addOnId: 'a1', quantity: 5 }],
    });
    expectOk(resolution);

    expect(resolution.selection.violations).toContainEqual({
      code: 'quantity_exceeded',
      anchor: { kind: 'quantity', addOnId: 'a1' },
      limit: 3,
      attempted: 5,
    });

    // No silent clamp: the line still reflects exactly what was requested.
    const line = resolution.selection.addOns.find(l => l.addOnId === 'a1')!;

    expect(line.quantity).toBe(5);
    expect(line.lineTotalCents).toBe(500);
    expect(resolution.selection.blocksContinue).toBe(true);
  });

  it('a fixed-price add-on requires EXACTLY 1 — bookingQuote.ts\'s `else if (quantity !== 1) throw` — both too many and too few (0) are violations, mirrored via limit: 1', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'a1', pricingType: 'fixed', priceCents: 200 })],
      serviceAddOnBindings: [makeBinding({ id: 'sao1', serviceId: 'svc1', addOnId: 'a1' })],
    }));
    expectOk(snapshot);

    const tooMany = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [{ addOnId: 'a1', quantity: 2 }] });
    expectOk(tooMany);

    expect(tooMany.selection.violations).toContainEqual({
      code: 'quantity_exceeded',
      anchor: { kind: 'quantity', addOnId: 'a1' },
      limit: 1,
      attempted: 2,
    });
    // No silent clamp here either.
    expect(tooMany.selection.addOns.find(l => l.addOnId === 'a1')!.quantity).toBe(2);

    const tooFew = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [{ addOnId: 'a1', quantity: 0 }] });
    expectOk(tooFew);

    expect(tooFew.selection.violations).toContainEqual({
      code: 'quantity_exceeded',
      anchor: { kind: 'quantity', addOnId: 'a1' },
      limit: 1,
      attempted: 0,
    });

    const exactlyOne = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [{ addOnId: 'a1', quantity: 1 }] });
    expectOk(exactlyOne);

    expect(exactlyOne.selection.violations).toHaveLength(0);
  });

  it('a per_unit add-on also rejects a non-integer or sub-1 quantity, not just one above its ceiling — full parity with bookingQuote.ts\'s `!Number.isInteger(quantity) || quantity < 1` guard', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'a1', pricingType: 'per_unit', maxQuantity: 10 })],
      serviceAddOnBindings: [makeBinding({ id: 'sao1', serviceId: 'svc1', addOnId: 'a1' })],
    }));
    expectOk(snapshot);

    const fractional = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [{ addOnId: 'a1', quantity: 1.5 }] });
    expectOk(fractional);

    expect(fractional.selection.violations).toContainEqual(expect.objectContaining({ code: 'quantity_exceeded', attempted: 1.5 }));

    const zero = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [{ addOnId: 'a1', quantity: 0 }] });
    expectOk(zero);

    expect(zero.selection.violations).toContainEqual(expect.objectContaining({ code: 'quantity_exceeded', attempted: 0 }));

    const negative = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [{ addOnId: 'a1', quantity: -3 }] });
    expectOk(negative);

    expect(negative.selection.violations).toContainEqual(expect.objectContaining({ code: 'quantity_exceeded', attempted: -3 }));

    const valid = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [{ addOnId: 'a1', quantity: 4 }] });
    expectOk(valid);

    expect(valid.selection.violations).toHaveLength(0);
  });

  it('an auto-added add-on with no service_add_on binding at all still gets the correct server-parity ceiling from its own baseMaxQuantity', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [
        makeAddOn({ id: 'trigger', pricingType: 'fixed' }),
        // Deliberately per_unit with a real configured ceiling of 4, and NO
        // service_add_on row binding it to svc1 — only reachable via auto-add.
        makeAddOn({ id: 'freebie', pricingType: 'per_unit', maxQuantity: 4 }),
      ],
      serviceAddOnBindings: [makeBinding({ id: 'sao_t', serviceId: 'svc1', addOnId: 'trigger' })],
      rules: [makeRule({ id: 'r1', ruleType: 'include', subjectServiceId: 'svc1', objectAddOnId: 'freebie', params: { autoAdd: true } })],
    }));
    expectOk(snapshot);

    const resolution = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [] });
    expectOk(resolution);
    const line = resolution.selection.addOns.find(l => l.addOnId === 'freebie')!;

    expect(line.autoAdded).toBe(true);
    expect(line.quantity).toBe(1);
    expect(resolution.selection.violations).toHaveLength(0);
  });

  it('a dynamic (add-on-subject) max_quantity rule only tightens once its trigger add-on is also selected', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [
        makeAddOn({ id: 'trigger_addon', pricingType: 'fixed' }),
        makeAddOn({ id: 'capped_addon', pricingType: 'per_unit', maxQuantity: null }),
      ],
      serviceAddOnBindings: [
        makeBinding({ id: 'sao_t', serviceId: 'svc1', addOnId: 'trigger_addon' }),
        makeBinding({ id: 'sao_c', serviceId: 'svc1', addOnId: 'capped_addon' }),
      ],
      rules: [makeRule({ id: 'r1', ruleType: 'max_quantity', subjectAddOnId: 'trigger_addon', objectAddOnId: 'capped_addon', params: { maxQuantity: 2 } })],
    }));
    expectOk(snapshot);

    const withoutTrigger = resolveCatalogSelection(snapshot.snapshot, {
      serviceId: 'svc1',
      selectedAddOns: [{ addOnId: 'capped_addon', quantity: 5 }],
    });
    expectOk(withoutTrigger);

    expect(withoutTrigger.selection.violations).toHaveLength(0);

    const withTrigger = resolveCatalogSelection(snapshot.snapshot, {
      serviceId: 'svc1',
      selectedAddOns: [{ addOnId: 'trigger_addon' }, { addOnId: 'capped_addon', quantity: 5 }],
    });
    expectOk(withTrigger);

    expect(withTrigger.selection.violations).toContainEqual(expect.objectContaining({ code: 'quantity_exceeded', limit: 2, attempted: 5 }));
    expect(withTrigger.selection.explanations).toContainEqual(expect.objectContaining({ kind: 'quantity_limited' }));
  });
});

// =============================================================================
// PUBLIC PROJECTION ALLOWLIST + PRIVATE EXCLUSIONS
// =============================================================================

describe('privacy — public projection allowlist', () => {
  it('never projects the internal rule id, priority, note, or raw params', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'a1' })],
      rules: [makeRule({
        id: 'super_secret_rule_id_123',
        ruleType: 'exclude',
        subjectServiceId: 'svc1',
        objectAddOnId: 'a1',
        priority: 42,
        params: { presentation: 'surface' },
      })],
    }));
    expectOk(result);
    const serialized = JSON.stringify(result.snapshot);

    expect(serialized).not.toContain('super_secret_rule_id_123');

    const projection = result.snapshot.ruleProjections[0]!;

    expect(Object.keys(projection).sort()).toEqual(
      ['effect', 'maxQuantity', 'presentation', 'projectionKey', 'reasonCode', 'reasonText', 'serviceScopeId', 'targetAddOnId', 'trigger']
        .filter(key => key in projection)
        .sort(),
    );
    expect(projection).not.toHaveProperty('priority');
    expect(projection).not.toHaveProperty('note');
    expect(projection).not.toHaveProperty('params');
    expect(projection).not.toHaveProperty('ruleId');
    expect(projection).not.toHaveProperty('id');
  });

  it('the projectionKey is opaque and is never the internal rule id', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'a1' })],
      rules: [makeRule({ id: 'rule_abc', ruleType: 'exclude', subjectServiceId: 'svc1', objectAddOnId: 'a1' })],
    }));
    expectOk(result);

    expect(result.snapshot.ruleProjections[0]!.projectionKey).not.toBe('rule_abc');
    expect(result.snapshot.ruleProjections[0]!.projectionKey).not.toContain('rule_abc');
  });

  it('requires_capability never exposes a capability id — the resolver structurally never receives one', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      rules: [makeRule({ id: 'r1', ruleType: 'requires_capability', subjectServiceId: 'svc1', hasCapabilityRequirement: true })],
    }));
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(
      snapshot.snapshot,
      { serviceId: 'svc1', selectedAddOns: [] },
      { technicianEligible: false },
    );
    expectOk(resolution);
    const serialized = JSON.stringify(resolution.selection);

    expect(serialized).not.toContain('capabilityId');
    expect(resolution.selection.violations).toContainEqual({
      code: 'capability_unavailable',
      anchor: { kind: 'technician', technicianId: null },
    });
  });

  it('an eligible technician (or an unevaluated eligibility) produces no capability violation', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      rules: [makeRule({ id: 'r1', ruleType: 'requires_capability', subjectServiceId: 'svc1', hasCapabilityRequirement: true })],
    }));
    expectOk(snapshot);

    const eligible = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [] }, { technicianEligible: true });
    expectOk(eligible);

    expect(eligible.selection.violations).toHaveLength(0);

    const unevaluated = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [] });
    expectOk(unevaluated);

    expect(unevaluated.selection.violations).toHaveLength(0);
  });

  it('the capability check is driven ENTIRELY by the wrapper\'s eligibility answer, never by scanning ruleProjections — it fires even with zero catalog rules at all', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      rules: [],
    }));
    expectOk(snapshot);

    expect(snapshot.snapshot.ruleProjections).toHaveLength(0);

    const resolution = resolveCatalogSelection(
      snapshot.snapshot,
      { serviceId: 'svc1', selectedAddOns: [] },
      { technicianEligible: false },
    );
    expectOk(resolution);

    expect(resolution.selection.violations).toContainEqual({
      code: 'capability_unavailable',
      anchor: { kind: 'technician', technicianId: null },
    });
  });
});

// =============================================================================
// VIOLATIONS — stable semantic anchors, never positional indexes
// =============================================================================

describe('violation anchors', () => {
  it('a quantity violation is anchored to the add-on id, not an array index', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'z_addon', pricingType: 'per_unit', maxQuantity: 1 }), makeAddOn({ id: 'a_addon' })],
      serviceAddOnBindings: [
        makeBinding({ id: 'sao1', serviceId: 'svc1', addOnId: 'z_addon' }),
        makeBinding({ id: 'sao2', serviceId: 'svc1', addOnId: 'a_addon' }),
      ],
    }));
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(snapshot.snapshot, {
      serviceId: 'svc1',
      selectedAddOns: [{ addOnId: 'a_addon' }, { addOnId: 'z_addon', quantity: 4 }],
    });
    expectOk(resolution);
    const violation = resolution.selection.violations.find(v => v.code === 'quantity_exceeded');

    expect(violation?.anchor).toEqual({ kind: 'quantity', addOnId: 'z_addon' });
  });

  it('the same violation is produced regardless of the order add-ons were selected in (survives reorder)', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'a1' }), makeAddOn({ id: 'a2' })],
      rules: [makeRule({ id: 'r1', ruleType: 'mutually_exclusive', subjectAddOnId: 'a1', objectAddOnId: 'a2' })],
    }));
    expectOk(snapshot);
    const orderA = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [{ addOnId: 'a1' }, { addOnId: 'a2' }] });
    const orderB = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [{ addOnId: 'a2' }, { addOnId: 'a1' }] });
    expectOk(orderA);
    expectOk(orderB);

    expect(orderA.selection.violations).toEqual(orderB.selection.violations);
  });

  it('an unavailable client-selected add-on id produces an addOn-anchored violation, not a corruption failure', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
    }));
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(snapshot.snapshot, {
      serviceId: 'svc1',
      selectedAddOns: [{ addOnId: 'does_not_exist' }],
    });
    expectOk(resolution);

    expect(resolution.selection.violations).toContainEqual({
      code: 'addon_unavailable',
      anchor: { kind: 'addOn', addOnId: 'does_not_exist' },
    });
  });
});

// =============================================================================
// CORRUPTION / FAIL-CLOSED
// =============================================================================

describe('fail-closed on corrupt catalog data', () => {
  it('rejects an unknown rule type', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      rules: [makeRule({ id: 'r1', ruleType: 'adjust_price' as never, subjectServiceId: 'svc1', objectAddOnId: 'x' })],
    }));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.failure.code).toBe('unknown_rule_type');
    }
  });

  it('rejects a rule with no subject at all', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      rules: [makeRule({ id: 'r1', ruleType: 'exclude', subjectServiceId: null, subjectAddOnId: null, objectAddOnId: 'x' })],
    }));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.failure.code).toBe('invalid_subject_shape');
    }
  });

  it('rejects a rule with two subjects', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'a1' }), makeAddOn({ id: 'x' })],
      rules: [makeRule({ id: 'r1', ruleType: 'exclude', subjectServiceId: 'svc1', subjectAddOnId: 'a1', objectAddOnId: 'x' })],
    }));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.failure.code).toBe('invalid_subject_shape');
    }
  });

  it('rejects requires_capability with no capability assigned', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      rules: [makeRule({ id: 'r1', ruleType: 'requires_capability', subjectServiceId: 'svc1', hasCapabilityRequirement: false })],
    }));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.failure.code).toBe('invalid_object_shape');
    }
  });

  it('rejects a non-capability rule that carries hasCapabilityRequirement:true', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'a1' })],
      rules: [makeRule({ id: 'r1', ruleType: 'exclude', subjectServiceId: 'svc1', objectAddOnId: 'a1', hasCapabilityRequirement: true })],
    }));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.failure.code).toBe('invalid_object_shape');
    }
  });

  it('rejects an add-on pointed at itself', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      addOns: [makeAddOn({ id: 'a1' })],
      rules: [makeRule({ id: 'r1', ruleType: 'exclude', subjectAddOnId: 'a1', objectAddOnId: 'a1' })],
    }));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.failure.code).toBe('invalid_object_shape');
    }
  });

  it('rejects malformed params (max_quantity with no maxQuantity)', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'a1' })],
      rules: [makeRule({ id: 'r1', ruleType: 'max_quantity', subjectServiceId: 'svc1', objectAddOnId: 'a1', params: {} })],
    }));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.failure.code).toBe('invalid_rule_params');
    }
  });

  it('rejects a rule referencing a service/add-on id that does not exist', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      addOns: [makeAddOn({ id: 'a1' })],
      rules: [makeRule({ id: 'r1', ruleType: 'requires', subjectServiceId: 'svc_does_not_exist', objectAddOnId: 'a1' })],
    }));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.failure.code).toBe('missing_referenced_object');
      expect(result.failure.anchor).toEqual({ kind: 'service', serviceId: 'svc_does_not_exist' });
    }
  });

  it('rejects a rule referencing an INACTIVE service/add-on', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1', isActive: false })],
      addOns: [makeAddOn({ id: 'a1' })],
      rules: [makeRule({ id: 'r1', ruleType: 'requires', subjectServiceId: 'svc1', objectAddOnId: 'a1' })],
    }));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.failure.code).toBe('inactive_referenced_object');
    }
  });

  it('an INACTIVE rule with structurally corrupt data does not fail the build — deactivation is the intended escape hatch', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      rules: [makeRule({ id: 'r1', ruleType: 'adjust_price' as never, subjectServiceId: 'svc1', objectAddOnId: 'ghost', isActive: false })],
    }));

    expect(result.ok).toBe(true);
  });

  it('resolveCatalogSelection fails closed for a serviceId absent from the snapshot', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({ services: [makeService({ id: 'svc1' })] }));
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc_missing', selectedAddOns: [] });

    expect(resolution.ok).toBe(false);

    if (!resolution.ok) {
      expect(resolution.failure.code).toBe('missing_referenced_object');
    }
  });
});

// =============================================================================
// MONEY / DURATION ARITHMETIC — integer minor units, matches bookingQuote.ts
// =============================================================================

describe('money and duration arithmetic', () => {
  it('lineTotalCents = unitPriceCents * quantity and lineDurationMinutes = unitDurationMinutes * quantity', () => {
    const snapshot = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1', price: 4000, durationMinutes: 40 })],
      addOns: [makeAddOn({ id: 'a1', pricingType: 'per_unit', maxQuantity: 10, priceCents: 300, durationMinutes: 7 })],
      serviceAddOnBindings: [makeBinding({ id: 'sao1', serviceId: 'svc1', addOnId: 'a1' })],
    }));
    expectOk(snapshot);
    const resolution = resolveCatalogSelection(snapshot.snapshot, { serviceId: 'svc1', selectedAddOns: [{ addOnId: 'a1', quantity: 3 }] });
    expectOk(resolution);
    const line = resolution.selection.addOns[0]!;

    expect(line.lineTotalCents).toBe(900);
    expect(line.lineDurationMinutes).toBe(21);
    expect(resolution.selection.subtotalCents).toBe(4900);
    expect(resolution.selection.totalDurationMinutes).toBe(61);
  });
});

// =============================================================================
// CURRENCY
// =============================================================================

describe('currency', () => {
  it('defaults to CAD when no salon settings are provided', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({ salonSettings: null }));
    expectOk(result);

    expect(result.snapshot.currency).toBe('CAD');
  });

  it('resolves the salon-configured currency, uppercased', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      salonSettings: { booking: { currency: 'USD' } },
    }));
    expectOk(result);

    expect(result.snapshot.currency).toBe('USD');
  });
});

// =============================================================================
// REVISION FINGERPRINT
// =============================================================================

describe('revision fingerprint', () => {
  it('revision.canonical is stable across two builds of identical data, independent of `now`, and revision.fingerprint is absent until finalized', () => {
    const input = baseSnapshotInput({ services: [makeService({ id: 'svc1' })] });
    const first = buildPublicCatalogSnapshot({ ...input, now: new Date('2024-01-01T00:00:00Z') });
    const second = buildPublicCatalogSnapshot({ ...input, now: new Date('2025-06-01T00:00:00Z') });
    expectOk(first);
    expectOk(second);

    expect(first.snapshot.revision.canonical).toBe(second.snapshot.revision.canonical);
    expect(first.snapshot.generatedAt).not.toBe(second.snapshot.generatedAt);
    // The synchronous core never hashes — see `finalizeCatalogRevision` below.
    expect(first.snapshot.revision.fingerprint).toBeUndefined();
  });

  it('revision.canonical changes when the underlying data changes', () => {
    const first = buildPublicCatalogSnapshot(baseSnapshotInput({ services: [makeService({ id: 'svc1' })] }));
    const second = buildPublicCatalogSnapshot(baseSnapshotInput({ services: [makeService({ id: 'svc1', name: 'Renamed' })] }));
    expectOk(first);
    expectOk(second);

    expect(first.snapshot.revision.canonical).not.toBe(second.snapshot.revision.canonical);
  });

  it('finalizeCatalogRevision computes a 64-character hex SHA-256 fingerprint from the canonical bytes, asynchronously, via an injected hasher', async () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({ services: [makeService({ id: 'svc1' })] }));
    expectOk(result);

    const finalized = await finalizeCatalogRevision(result.snapshot, hashCatalogFingerprintWebCrypto);

    expect(finalized.revision.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(finalized.revision.canonical).toBe(result.snapshot.revision.canonical);
    // Original snapshot is untouched — finalizeCatalogRevision returns a new object.
    expect(result.snapshot.revision.fingerprint).toBeUndefined();
  });

  it('finalizeCatalogRevision is deterministic: the same canonical snapshot always finalizes to the same fingerprint', async () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({ services: [makeService({ id: 'svc1' })] }));
    expectOk(result);

    const first = await finalizeCatalogRevision(result.snapshot, hashCatalogFingerprintWebCrypto);
    const second = await finalizeCatalogRevision(result.snapshot, hashCatalogFingerprintWebCrypto);

    expect(first.revision.fingerprint).toBe(second.revision.fingerprint);
  });

  it('finalizeCatalogRevision\'s fingerprint changes exactly when the canonical content changes', async () => {
    const first = buildPublicCatalogSnapshot(baseSnapshotInput({ services: [makeService({ id: 'svc1' })] }));
    const second = buildPublicCatalogSnapshot(baseSnapshotInput({ services: [makeService({ id: 'svc1', name: 'Renamed' })] }));
    expectOk(first);
    expectOk(second);

    const firstFinalized = await finalizeCatalogRevision(first.snapshot, hashCatalogFingerprintWebCrypto);
    const secondFinalized = await finalizeCatalogRevision(second.snapshot, hashCatalogFingerprintWebCrypto);

    expect(firstFinalized.revision.fingerprint).not.toBe(secondFinalized.revision.fingerprint);
  });
});

// =============================================================================
// SERVICE -> ADD-ON BINDING TIEBREAK
// =============================================================================

describe('service add-on binding display order tiebreak', () => {
  it('imposes a deterministic order by add-on id when stored displayOrder ties at 0 (the reconcile-add-on-side bug)', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'z_addon' }), makeAddOn({ id: 'a_addon' }), makeAddOn({ id: 'm_addon' })],
      serviceAddOnBindings: [
        makeBinding({ id: 'sao_z', serviceId: 'svc1', addOnId: 'z_addon', displayOrder: 0 }),
        makeBinding({ id: 'sao_a', serviceId: 'svc1', addOnId: 'a_addon', displayOrder: 0 }),
        makeBinding({ id: 'sao_m', serviceId: 'svc1', addOnId: 'm_addon', displayOrder: 0 }),
      ],
    }));
    expectOk(result);
    const bindings = result.snapshot.serviceAddOnBindings;

    expect(bindings.map(b => b.addOnId)).toEqual(['a_addon', 'm_addon', 'z_addon']);
    // The output displayOrder is a freshly assigned dense rank, safe to sort by directly.
    expect(bindings.map(b => b.displayOrder)).toEqual([0, 1, 2]);
  });

  it('a real (non-tied) displayOrder is still honoured over id order', () => {
    const result = buildPublicCatalogSnapshot(baseSnapshotInput({
      services: [makeService({ id: 'svc1' })],
      addOns: [makeAddOn({ id: 'z_addon' }), makeAddOn({ id: 'a_addon' })],
      serviceAddOnBindings: [
        makeBinding({ id: 'sao_z', serviceId: 'svc1', addOnId: 'z_addon', displayOrder: 1 }),
        makeBinding({ id: 'sao_a', serviceId: 'svc1', addOnId: 'a_addon', displayOrder: 2 }),
      ],
    }));
    expectOk(result);

    expect(result.snapshot.serviceAddOnBindings.map(b => b.addOnId)).toEqual(['z_addon', 'a_addon']);
  });
});
