import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  catalogView: vi.fn(),
  bookingConfig: vi.fn(),
  bookingExperience: vi.fn(),
  bookingPage: vi.fn(),
  bookingPageContent: vi.fn(),
  publicSnapshot: vi.fn(),
  projectCatalog: vi.fn(),
  activeLocations: vi.fn(),
  activeAddOns: vi.fn(),
  publicServiceIds: vi.fn(),
  salonById: vi.fn(),
  services: vi.fn(),
  serviceAddOnRules: vi.fn(),
  quickBook: vi.fn(),
  sharedProfile: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/libs/bookingCatalog', () => ({ resolveCatalogDomainView: mocks.catalogView }));
vi.mock('@/libs/bookingConfig', () => ({ getBookingConfigForSalon: mocks.bookingConfig }));
vi.mock('@/libs/bookingExperience', () => ({ resolveBookingExperience: mocks.bookingExperience }));
vi.mock('@/libs/bookingPageConfig', () => ({ resolveBookingPageConfig: mocks.bookingPage }));
vi.mock('@/libs/bookingPageContent', () => ({ resolveBookingPageContent: mocks.bookingPageContent }));
vi.mock('@/libs/catalogResolver.server', () => ({ resolvePublicCatalogSnapshot: mocks.publicSnapshot }));
vi.mock('@/libs/publicBookingCatalog', () => ({ projectPublicBookingCatalog: mocks.projectCatalog }));
vi.mock('@/libs/queries', () => ({
  getActiveLocationsBySalonId: mocks.activeLocations,
  getActiveAddOnsBySalonId: mocks.activeAddOns,
  getSalonById: mocks.salonById,
  getServicesBySalonId: mocks.services,
  getServiceAddOnRulesBySalonId: mocks.serviceAddOnRules,
}));
vi.mock('@/libs/serviceAssignments', () => ({ getPublicBookableServiceIds: mocks.publicServiceIds }));
vi.mock('@/app/(unauth)/book/service/quickBookProfile', () => ({ resolvePublicQuickBookProfile: mocks.quickBook }));
vi.mock('@/libs/sharedSalonProfile', () => ({ resolveSharedSalonProfile: mocks.sharedProfile }));

const { loadCustomerPublicFacts } = await import('./publicFacts.server');

const salon = {
  id: 'salon-a',
  slug: 'isla',
  name: 'Isla Nail Studio',
  isActive: true,
  status: 'active',
  publicationStatus: 'published',
  deletedAt: null,
  onlineBookingEnabled: true,
  settings: {},
  logoUrl: null,
  phone: '416-555-0100',
  email: 'hello@example.test',
  address: '123 Private Street',
  city: 'Toronto',
  state: 'ON',
  zipCode: 'M1M 1M1',
  businessHours: null,
};

const quickBook = {
  bio: 'Careful nail appointments.',
  location: { name: null, addressLine: null, localityLine: 'Toronto, ON', directionsUrl: 'https://example.test/maps', instructionLines: [] },
  hours: { statusLabel: 'Hours', todayLabel: 'See weekly hours', weekly: [{ day: 'Monday', value: '9:00 AM–5:00 PM' }] },
  contact: { phone: null, email: null },
  policies: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.salonById.mockResolvedValue(salon);
  mocks.bookingConfig.mockResolvedValue({ currency: 'CAD', timezone: 'America/Toronto' });
  mocks.activeLocations.mockResolvedValue([]);
  mocks.publicServiceIds.mockResolvedValue(null);
  mocks.sharedProfile.mockReturnValue({ bookingOnlyContact: true, callEnabled: null, textEnabled: null, textNumber: null });
  mocks.quickBook.mockReturnValue(quickBook);
  mocks.bookingExperience.mockReturnValue({ policy: { enabled: false, showOnServicePage: false, text: null, title: null } });
  mocks.bookingPage.mockReturnValue({ live: { layout: 'quick_book', hiddenSections: [], quickBookProfile: {} } });
  mocks.bookingPageContent.mockReturnValue({ live: { bio: 'Private copy does not matter without a live gate.', locationDisplayMode: 'city_only' } });
  mocks.catalogView.mockReturnValue('legacy');
  mocks.services.mockResolvedValue([]);
  mocks.activeAddOns.mockResolvedValue([]);
  mocks.serviceAddOnRules.mockResolvedValue([]);
});

describe('loadCustomerPublicFacts', () => {
  it('returns only public legacy catalogue facts and reuses the redacted public profile', async () => {
    mocks.services.mockResolvedValue([{
      id: 'gel',
      isActive: true,
      name: 'Gel Manicure',
      description: 'Legacy description',
      descriptionItems: null,
      category: 'manicure',
      durationMinutes: 60,
      price: 4000,
      priceDisplayText: 'From $40',
    }]);
    mocks.activeAddOns.mockResolvedValue([{
      id: 'french',
      isActive: true,
      name: 'French',
      descriptionItems: ['White tips'],
      category: 'art',
      pricingType: 'flat',
      durationMinutes: 15,
      priceCents: 1200,
      priceDisplayText: null,
    }]);

    mocks.serviceAddOnRules.mockResolvedValue([{ serviceId: 'gel', addOnId: 'french' }]);

    const result = await loadCustomerPublicFacts({ salonId: 'salon-a', salonSlug: 'isla', features: null, locale: 'en-CA' });

    expect(result).toEqual({
      salon: {
        name: 'Isla Nail Studio',
        description: 'Careful nail appointments.',
        location: { locality: 'Toronto, ON' },
        hours: { today: 'See weekly hours', weekly: [{ day: 'Monday', value: '9:00 AM–5:00 PM' }] },
      },
      catalogue: {
        currency: 'CAD',
        services: [{
          id: 'gel',
          name: 'Gel Manicure',
          description: 'Legacy description',
          category: 'manicure',
          durationMinutes: 60,
          price: { baseCents: 4000, baseDisplay: '$40.00', displayLabel: 'From $40', range: null },
        }],
        addOns: [{
          id: 'french',
          name: 'French',
          description: 'White tips',
          category: 'art',
          pricingType: 'flat',
          durationMinutes: 15,
          price: { baseCents: 1200, baseDisplay: '$12.00', displayLabel: null, range: null },
        }],
      },
    });
    expect(mocks.quickBook.mock.calls[0]?.[0].salon.address).toBe('123 Private Street');
    expect(result.salon.location).not.toHaveProperty('address');
    expect(result.salon).not.toHaveProperty('contact');
  });

  it('excludes inactive services and add-ons that cannot be reached from the public menu', async () => {
    const service = { id: 'gel', isActive: true, name: 'Gel', description: null, category: 'nails', durationMinutes: 60, price: 4000 };
    const addOn = { id: 'french', isActive: true, name: 'French', category: 'art', pricingType: 'flat', durationMinutes: 10, priceCents: 1000 };
    mocks.services.mockResolvedValue([service, { ...service, id: 'hidden', isActive: false }]);
    mocks.activeAddOns.mockResolvedValue([addOn, { ...addOn, id: 'unbound' }, { ...addOn, id: 'inactive', isActive: false }]);
    mocks.serviceAddOnRules.mockResolvedValue([{ serviceId: 'gel', addOnId: 'french' }, { serviceId: 'hidden', addOnId: 'unbound' }, { serviceId: 'gel', addOnId: 'inactive' }]);

    const result = await loadCustomerPublicFacts({ salonId: 'salon-a', salonSlug: 'isla', features: null, locale: 'en-CA' });

    expect(result.catalogue.services.map(item => item.id)).toEqual(['gel']);
    expect(result.catalogue.addOns.map(item => item.id)).toEqual(['french']);
  });

  it('uses the L1 public projection, preserves a family range, and fails closed for a mismatched tenant', async () => {
    mocks.catalogView.mockReturnValue('l1');
    mocks.publicSnapshot.mockResolvedValue({ ok: true, snapshot: { private: 'never serialized' } });
    mocks.projectCatalog.mockReturnValue({
      currency: 'CAD',
      services: [{
        id: 'gel-x',
        name: 'Gel-X',
        parentServiceId: null,
        variantLabel: null,
        descriptionItems: ['Extensions'],
        category: 'extensions',
        durationMinutes: 90,
        priceCents: 7000,
        priceDisplayText: null,
        rangeSummary: { minPriceCents: 7000, maxPriceCents: 8500 },
      }],
      addOns: [],
    });

    const result = await loadCustomerPublicFacts({ salonId: 'salon-a', salonSlug: 'isla', features: {} as never, locale: 'en-CA' });

    expect(result.catalogue.services[0]?.price).toEqual({
      baseCents: 7000,
      baseDisplay: '$70.00',
      displayLabel: null,
      range: { minCents: 7000, maxCents: 8500, display: '$70.00–$85.00' },
    });
    expect(result.catalogue.services[0]).not.toHaveProperty('private');

    mocks.salonById.mockResolvedValue({ ...salon, slug: 'another-salon' });

    await expect(loadCustomerPublicFacts({ salonId: 'salon-a', salonSlug: 'isla', features: null, locale: 'en-CA' }))
      .rejects.toThrow('CUSTOMER_PUBLIC_FACTS_UNAVAILABLE');
  });

  it('uses the live editorial section gate while still redacting a city-only address', async () => {
    mocks.bookingPage.mockReturnValue({
      live: {
        layout: 'editorial',
        hiddenSections: [],
        quickBookProfile: {},
      },
    });
    mocks.bookingPageContent.mockReturnValue({
      live: {
        bio: 'Editorial studio bio.',
        locationDisplayMode: 'city_only',
      },
    });
    mocks.quickBook.mockReturnValue({ ...quickBook, location: null, hours: null });
    mocks.salonById.mockResolvedValue({
      ...salon,
      businessHours: { monday: { open: '09:00', close: '17:00' } },
    });
    mocks.services.mockResolvedValue([]);

    const result = await loadCustomerPublicFacts({ salonId: 'salon-a', salonSlug: 'isla', features: null, locale: 'en-CA' });

    expect(result.salon).toMatchObject({
      description: 'Editorial studio bio.',
      location: { locality: 'Toronto, ON' },
    });
    expect(result.salon.location).not.toHaveProperty('address');
    expect(result.salon.hours?.weekly[0]).toEqual({ day: 'Monday', value: '9:00 AM–5:00 PM' });
  });

  it('omits malformed public hours rather than presenting an invented closed schedule', async () => {
    mocks.bookingPage.mockReturnValue({
      live: {
        layout: 'editorial',
        hiddenSections: [],
        quickBookProfile: {},
      },
    });
    mocks.bookingPageContent.mockReturnValue({
      live: { bio: null, locationDisplayMode: 'full_address' },
    });
    mocks.quickBook.mockReturnValue({ ...quickBook, location: null, hours: null });
    mocks.salonById.mockResolvedValue({
      ...salon,
      businessHours: { monday: { open: 'not-a-time', close: '17:00' } },
    });

    const result = await loadCustomerPublicFacts({ salonId: 'salon-a', salonSlug: 'isla', features: null, locale: 'en-CA' });

    expect(result.salon).not.toHaveProperty('hours');
  });
});
