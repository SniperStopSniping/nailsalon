import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ services: vi.fn(), addOns: vi.fn(), rules: vi.fn(), bookable: vi.fn(), validate: vi.fn(), config: vi.fn(), snapshot: vi.fn(), view: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/queries', () => ({ getServicesBySalonId: mocks.services, getActiveAddOnsBySalonId: mocks.addOns, getServiceAddOnRulesBySalonId: mocks.rules }));
vi.mock('@/libs/serviceAssignments', () => ({ getPublicBookableServiceIds: mocks.bookable }));
vi.mock('@/libs/bookingQuote', () => ({ validatePublicBookingSelection: mocks.validate }));
vi.mock('@/libs/catalogResolver.server', () => ({ resolvePublicCatalogSnapshot: mocks.snapshot }));
vi.mock('@/libs/bookingCatalog', () => ({ resolveCatalogDomainView: mocks.view }));
vi.mock('@/libs/bookingConfig', () => ({ getBookingConfigForSalon: mocks.config }));

const { buildCustomerProposal, loadCustomerMenu, validateCustomerMenuSelection } = await import('./catalogue.server');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.view.mockReturnValue('legacy');
  mocks.services.mockResolvedValue([{ id: 'gelx', name: 'Gel-X', isActive: true, category: 'extensions', description: 'Soft gel extensions', privateNote: 'CANARY' }]);
  mocks.addOns.mockResolvedValue([{ id: 'french', name: 'French', category: 'art', pricingType: 'fixed', isActive: true }]);
  mocks.rules.mockResolvedValue([{ serviceId: 'gelx', addOnId: 'french', selectionMode: 'optional' }]);
  mocks.bookable.mockResolvedValue(new Set(['gelx']));
  mocks.config.mockResolvedValue({ currency: 'CAD', timezone: 'America/Toronto' });
  mocks.validate.mockResolvedValue({ quote: {
    baseService: { id: 'gelx', name: 'Gel-X', priceCents: 6500 },
    addOns: [{ addOnId: 'french', name: 'French', quantity: 1, unitPriceCents: 1500, lineTotalCents: 1500 }],
    subtotalCents: 8000,
    visibleDurationMinutes: 100,
  }, baseServiceRecord: { privateNote: 'NEVER_RETURN' } });
});

describe('public customer catalogue authority', () => {
  it('scopes every source and exposes only bound public data', async () => {
    const menu = await loadCustomerMenu('salon-a', null);

    for (const source of [mocks.services, mocks.addOns, mocks.rules, mocks.bookable]) {
      expect(source).toHaveBeenCalledWith('salon-a');
    }

    expect(JSON.stringify(menu)).not.toMatch(/CANARY|privateNote|priceCents/);
    expect(menu.bindings).toEqual([{ serviceId: 'gelx', addOnId: 'french', required: false, defaultQuantity: 1, maxQuantity: 10 }]);
  });

  it('projects only reachable L1 menu authority and retains auto-add closure without canonical material', async () => {
    mocks.view.mockReturnValue('l1');
    mocks.bookable.mockResolvedValue(new Set(['bookable-service']));
    mocks.snapshot.mockResolvedValue({ ok: true, snapshot: {
      revision: { canonical: 'CANONICAL_EXCLUDED_ORPHAN_SENTINEL' },
      generatedAt: '2026-09-18T00:00:00.000Z',
      currency: 'CAD',
      services: [
        { id: 'bookable-service', name: 'Bookable', category: 'manicure', parentServiceId: null, variantLabel: null, descriptionItems: null },
        { id: 'excluded-service', name: 'EXCLUDED_SERVICE_SENTINEL', category: 'manicure', parentServiceId: null, variantLabel: null, descriptionItems: null },
      ],
      addOnGroups: [{ id: 'reachable-group', name: 'Reachable' }, { id: 'orphan-group', name: 'ORPHAN_GROUP_SENTINEL' }],
      addOns: [
        { id: 'direct', name: 'Direct', category: 'art', descriptionItems: null, pricingType: 'fixed', baseMaxQuantity: 1, groupId: 'reachable-group' },
        { id: 'auto-one', name: 'Automatic one', category: 'art', descriptionItems: null, pricingType: 'fixed', baseMaxQuantity: 1, groupId: null },
        { id: 'auto-two', name: 'Automatic two', category: 'art', descriptionItems: null, pricingType: 'fixed', baseMaxQuantity: 1, groupId: null },
        { id: 'orphan', name: 'ORPHAN_ADD_ON_SENTINEL', category: 'art', descriptionItems: null, pricingType: 'fixed', baseMaxQuantity: 1, groupId: 'orphan-group' },
      ],
      serviceAddOnBindings: [
        { serviceId: 'bookable-service', addOnId: 'direct', selectionMode: 'optional', defaultQuantity: null, effectiveMaxQuantity: 1 },
        { serviceId: 'excluded-service', addOnId: 'orphan', selectionMode: 'optional', defaultQuantity: null, effectiveMaxQuantity: 1 },
      ],
      ruleProjections: [
        { effect: 'auto_add', targetAddOnId: 'auto-one', trigger: { subjectKind: 'service', subjectId: 'bookable-service' }, serviceScopeId: 'bookable-service' },
        { effect: 'auto_add', targetAddOnId: 'auto-two', trigger: { subjectKind: 'addOn', subjectId: 'auto-one' }, serviceScopeId: 'bookable-service' },
        { effect: 'auto_add', targetAddOnId: 'orphan', trigger: { subjectKind: 'service', subjectId: 'excluded-service' }, serviceScopeId: 'excluded-service' },
      ],
    } });

    const menu = await loadCustomerMenu('salon-a', { catalog: { variantsV1: true } });

    expect(menu.l1).toBeDefined();
    expect(menu.l1?.services.map(service => service.id)).toEqual(['bookable-service']);
    expect(menu.l1?.addOns.map(addOn => addOn.id).sort()).toEqual(['auto-one', 'auto-two', 'direct']);
    expect(menu.l1?.addOnGroups.map(group => group.id)).toEqual(['reachable-group']);
    expect(menu.l1?.ruleProjections).toHaveLength(2);
    expect(JSON.stringify(menu)).not.toMatch(/CANONICAL|EXCLUDED_SERVICE|ORPHAN_/);
  });

  it('rejects foreign services, unbound add-ons and invalid quantities', async () => {
    const menu = await loadCustomerMenu('salon-a', null);

    expect(() => validateCustomerMenuSelection(menu, { baseServiceId: 'salon-b-service', selectedAddOns: [] })).toThrow();
    expect(() => validateCustomerMenuSelection(menu, { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'foreign', quantity: 1 }] })).toThrow();
    expect(() => validateCustomerMenuSelection(menu, { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 2 }] })).toThrow();
  });

  it('renders the existing validator quote and fingerprints material changes', async () => {
    const selection = { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] };
    const first = await buildCustomerProposal('salon-a', null, selection);

    expect(mocks.validate).toHaveBeenCalledWith({ salonId: 'salon-a', selection });
    expect(first).toMatchObject({ subtotalCents: 8000, durationMinutes: 100, currency: 'CAD' });
    expect(first.addOns).toContainEqual({ id: 'french', name: 'French', quantity: 1, unitPriceCents: 1500, priceCents: 1500 });
    expect(JSON.stringify(first)).not.toContain('NEVER_RETURN');

    mocks.validate.mockResolvedValue({ quote: { baseService: { id: 'gelx', name: 'Gel-X', priceCents: 7000 }, addOns: [], subtotalCents: 7000, visibleDurationMinutes: 90 } });
    const changed = await buildCustomerProposal('salon-a', null, selection);

    expect(changed.fingerprint).not.toEqual(first.fingerprint);
  });

  it('separates a salon-authorized manual item from the priced subtotal while retaining its duration', async () => {
    const selection = { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'builder-removal', quantity: 1 }] };
    mocks.addOns.mockResolvedValue([{ id: 'builder-removal', name: 'Builder Gel Removal', category: 'removal', pricingType: 'fixed', isActive: true }]);
    mocks.rules.mockResolvedValue([{ serviceId: 'gelx', addOnId: 'builder-removal', selectionMode: 'optional', priceMode: 'manual_confirmation' }]);
    mocks.validate.mockResolvedValue({ quote: {
      baseService: { id: 'gelx', name: 'Gel Manicure', priceCents: 4000 },
      addOns: [{ addOnId: 'builder-removal', name: 'Builder Gel Removal', quantity: 1, unitPriceCents: 0, lineTotalCents: 0, unitDurationMinutes: 30, lineDurationMinutes: 30, priceMode: 'manual_confirmation' }],
      manualConfirmationItems: [{ addOnId: 'builder-removal', name: 'Builder Gel Removal', category: 'removal', quantity: 1, unitDurationMinutes: 30, lineDurationMinutes: 30, priceStatus: 'to_be_confirmed' }],
      subtotalCents: 4000,
      visibleDurationMinutes: 90,
    } });

    const proposal = await buildCustomerProposal('salon-a', null, selection);

    expect(proposal).toMatchObject({ subtotalCents: 4000, durationMinutes: 90, addOns: [] });
    expect(proposal.manualConfirmationItems).toEqual([{ id: 'builder-removal', name: 'Builder Gel Removal', quantity: 1, durationMinutes: 30, priceStatus: 'to_be_confirmed' }]);
  });

  it('excludes inactive and unassigned services with their orphan options', async () => {
    mocks.bookable.mockResolvedValue(new Set());
    const menu = await loadCustomerMenu('salon-a', null);

    expect(menu).toEqual({ services: [], addOns: [], bindings: [] });
  });

  it('invalidates acceptance when booking timezone authority changes', async () => {
    const selection = { baseServiceId: 'gelx', selectedAddOns: [{ addOnId: 'french', quantity: 1 }] };
    const toronto = await buildCustomerProposal('salon-a', null, selection);
    mocks.config.mockResolvedValue({ currency: 'CAD', timezone: 'America/Vancouver' });

    const vancouver = await buildCustomerProposal('salon-a', null, selection);

    expect(vancouver.fingerprint).not.toEqual(toronto.fingerprint);
  });
});
