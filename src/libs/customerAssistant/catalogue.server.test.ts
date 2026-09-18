import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ services: vi.fn(), addOns: vi.fn(), rules: vi.fn(), bookable: vi.fn(), validate: vi.fn(), config: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/queries', () => ({ getServicesBySalonId: mocks.services, getActiveAddOnsBySalonId: mocks.addOns, getServiceAddOnRulesBySalonId: mocks.rules }));
vi.mock('@/libs/serviceAssignments', () => ({ getPublicBookableServiceIds: mocks.bookable }));
vi.mock('@/libs/bookingQuote', () => ({ validatePublicBookingSelection: mocks.validate }));
vi.mock('@/libs/bookingConfig', () => ({ getBookingConfigForSalon: mocks.config }));

const { buildCustomerProposal, loadCustomerMenu, validateCustomerMenuSelection } = await import('./catalogue.server');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.services.mockResolvedValue([{ id: 'gelx', name: 'Gel-X', isActive: true, category: 'extensions', description: 'Soft gel extensions', privateNote: 'CANARY' }]);
  mocks.addOns.mockResolvedValue([{ id: 'french', name: 'French', category: 'art', pricingType: 'fixed', isActive: true }]);
  mocks.rules.mockResolvedValue([{ serviceId: 'gelx', addOnId: 'french', selectionMode: 'optional' }]);
  mocks.bookable.mockResolvedValue(new Set(['gelx']));
  mocks.config.mockResolvedValue({ currency: 'CAD', timezone: 'America/Toronto' });
  mocks.validate.mockResolvedValue({ quote: {
    baseService: { id: 'gelx', name: 'Gel-X', priceCents: 6500 },
    addOns: [{ addOnId: 'french', name: 'French', quantity: 1, lineTotalCents: 1500 }],
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
    expect(JSON.stringify(first)).not.toContain('NEVER_RETURN');

    mocks.validate.mockResolvedValue({ quote: { baseService: { id: 'gelx', name: 'Gel-X', priceCents: 7000 }, addOns: [], subtotalCents: 7000, visibleDurationMinutes: 90 } });
    const changed = await buildCustomerProposal('salon-a', null, selection);

    expect(changed.fingerprint).not.toEqual(first.fingerprint);
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
