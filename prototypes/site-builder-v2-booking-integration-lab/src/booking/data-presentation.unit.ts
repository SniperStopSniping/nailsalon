import {
  exportSiteBuilderDocument,
  initializeStarter,
  parseSiteBuilderDocument,
} from '../model';
import {
  CANONICAL_SERVICE_IDS,
  CANONICAL_SERVICES,
} from './data';
import {
  createEmptyBookingSession,
  createMenuFixture,
  normalizeSessionForLayoutChange,
} from './helpers';
import {
  createDefaultBookingPresentationSettings,
  parseBookingPresentationSettings,
  switchBookingLayout,
  validateBookingPresentationSettings,
} from './presentation';
import type {
  BookingMenuLayout,
  MockService,
} from './types';

const EXPECTED_CANONICAL_SERVICE_IDS = [
  'svc-manicure-russian',
  'svc-manicure-gel',
  'svc-manicure-classic',
  'svc-builder-overlay',
  'svc-builder-gel-colour',
  'svc-builder-refill',
  'svc-builder-full-set',
  'svc-gelx-full-set',
  'svc-gelx-refill',
  'svc-gelx-removal',
  'svc-pedicure-classic',
  'svc-pedicure-gel',
  'svc-pedicure-spa',
  'svc-art-tier-one',
  'svc-art-tier-two',
  'svc-art-tier-three',
  'svc-art-tier-four',
  'svc-combo-gel',
  'svc-combo-biab',
  'svc-addon-french',
  'svc-addon-chrome',
  'svc-addon-simple-art',
  'svc-addon-detailed-art',
  'svc-addon-consultation',
] as const;

const APPROVED_LAYOUTS: readonly BookingMenuLayout[] = [
  'visual_grid',
  'clean_list',
  'editorial_cards',
  'category_menu',
  'editorial_price_list',
];

function bookingBusinessFingerprint(services: readonly MockService[]) {
  return services.map(service => ({
    id: service.id,
    name: service.name,
    category: service.category,
    shortDescription: service.shortDescription,
    longDescription: service.longDescription,
    price: service.price,
    durationMinutes: service.durationMinutes,
    featured: service.featured,
    badge: service.badge,
    compatibleAddOnIds: [...service.compatibleAddOnIds],
  }));
}

type ExportedSection = Record<string, unknown> & {
  sectionType?: unknown;
};

type ExportedDocument = {
  pages: Array<{ sections: ExportedSection[] }>;
};

function exportedBookingRecord(): {
  booking: ExportedSection;
  payload: ExportedDocument;
} {
  const payload = JSON.parse(
    exportSiteBuilderDocument(initializeStarter('quick_book')),
  ) as ExportedDocument;
  const booking = payload.pages
    .flatMap(page => page.sections)
    .find(section => section.sectionType === 'booking');
  if (!booking) {
    throw new Error('Quick Book export did not contain Booking.');
  }
  return { booking, payload };
}

describe('approved Booking data adapter', () => {
  it('preserves accepted service identities before the shared Product library and Isla fixture', () => {
    const fixture = createMenuFixture();

    expect(fixture.salon).toMatchObject({
      id: 'salon-isla-nail-studio',
      name: 'Isla Nail Studio',
      slug: 'isla-nail-studio',
    });
    expect(CANONICAL_SERVICE_IDS.slice(0, EXPECTED_CANONICAL_SERVICE_IDS.length))
      .toEqual(EXPECTED_CANONICAL_SERVICE_IDS);
    expect(fixture.services.map(service => service.id))
      .toEqual(CANONICAL_SERVICE_IDS);
    expect(fixture.services).toBe(CANONICAL_SERVICES);
    expect(Object.isFrozen(CANONICAL_SERVICES)).toBe(true);
    expect(CANONICAL_SERVICES.every(service => Object.isFrozen(service)))
      .toBe(true);
    expect(fixture.addOns.slice(0, 4).map(addOn => addOn.id)).toEqual([
      'addon-french',
      'addon-chrome',
      'addon-simple-art',
      'addon-detailed-art',
    ]);
  });

  it('changes only image presentation across rich, partial, and no-image variants', () => {
    const rich = createMenuFixture({ imageFixture: 'image_rich' });
    const partial = createMenuFixture({ imageFixture: 'partial_images' });
    const none = createMenuFixture({ imageFixture: 'no_images' });
    const canonicalBusinessData = bookingBusinessFingerprint(rich.services);

    expect(partial.services.filter(service => service.image)).toHaveLength(12);
    expect(none.services.filter(service => service.image)).toHaveLength(0);
    expect(bookingBusinessFingerprint(partial.services)).toEqual(canonicalBusinessData);
    expect(bookingBusinessFingerprint(none.services)).toEqual(canonicalBusinessData);
    expect(partial.salon).toBe(rich.salon);
    expect(none.addOns).toBe(rich.addOns);
  });

  it('builds and caches the same deterministic 100-service long-content fixture', () => {
    const first = createMenuFixture({ menuSize: 'stress_100' });
    const second = createMenuFixture({ menuSize: 'stress_100' });
    const withoutImages = createMenuFixture({
      imageFixture: 'no_images',
      menuSize: 'stress_100',
    });
    const categoryCounts = Object.fromEntries(first.categories.map(category => [
      category.id,
      first.services.filter(service => service.category === category.id).length,
    ]));

    expect(first).toBe(second);
    expect(first.services).toHaveLength(100);
    expect(new Set(first.services.map(service => service.id))).toHaveLength(100);
    expect(categoryCounts).toEqual({
      manicure: 30,
      builder_gel: 20,
      gel_x: 18,
      pedicure: 16,
      nail_art: 10,
      combos: 1,
      add_ons: 5,
    });
    expect(first.services.some(service => service.name.startsWith(
      'The Complete Structured Manicure with Precision Cuticle Care',
    ))).toBe(true);
    expect(first.services.some(service => service.longDescription?.includes(
      'This deliberately long fixture copy tests narrow layouts',
    ))).toBe(true);
    expect(bookingBusinessFingerprint(withoutImages.services))
      .toEqual(bookingBusinessFingerprint(first.services));
    expect(Object.isFrozen(first.services)).toBe(true);
  });
});

describe('strict Booking presentation and import boundary', () => {
  it('validates every discriminated layout without mutating canonical services', () => {
    const canonicalBefore = JSON.stringify(CANONICAL_SERVICES);
    let settings = createDefaultBookingPresentationSettings();

    for (const layout of APPROVED_LAYOUTS) {
      settings = switchBookingLayout(settings, layout);
      const result = validateBookingPresentationSettings(settings);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.settings.layout).toBe(layout);
      }
    }

    expect(JSON.stringify(CANONICAL_SERVICES)).toBe(canonicalBefore);
    expect(createMenuFixture().services).toBe(CANONICAL_SERVICES);
  });

  it('rejects incompatible active and remembered controls rather than coercing them', () => {
    const valid = createDefaultBookingPresentationSettings();
    const incompatibleActive = {
      ...valid,
      layoutSettings: {
        density: 'comfortable',
        mobileNavigation: 'tabs',
        desktopNavigation: 'sidebar',
        showDescriptions: true,
        showCategoryCounts: true,
      },
    };
    const incompatibleMemory = {
      ...valid,
      layoutMemory: {
        ...valid.layoutMemory,
        editorial_price_list: valid.layoutSettings,
      },
    };

    expect(parseBookingPresentationSettings(incompatibleActive)).toBeNull();
    expect(parseBookingPresentationSettings(incompatibleMemory)).toBeNull();
    expect(parseBookingPresentationSettings({
      ...valid,
      tokenPreset: 'neutral',
    })).toBeNull();
  });

  it('rejects incompatible settings and customer/business injection in site imports', () => {
    const first = exportedBookingRecord();
    const validSettings = first.booking.settings;
    first.booking.settings = {
      ...(validSettings as Record<string, unknown>),
      layout: 'visual_grid',
      layoutSettings: {
        density: 'comfortable',
        mobileNavigation: 'tabs',
        desktopNavigation: 'sidebar',
        showDescriptions: true,
        showCategoryCounts: true,
      },
    };
    const incompatible = parseSiteBuilderDocument(JSON.stringify(first.payload));
    expect(incompatible.success).toBe(false);
    if (!incompatible.success) {
      expect(incompatible.issues.join(' ')).toMatch(/layoutSettings|desktopNavigation/);
    }

    const second = exportedBookingRecord();
    second.booking.services = CANONICAL_SERVICES;
    second.booking.customerSession = {
      serviceId: 'svc-manicure-russian',
      addOnIds: ['addon-french'],
    };
    const injected = parseSiteBuilderDocument(JSON.stringify(second.payload));
    expect(injected.success).toBe(false);
    if (!injected.success) {
      expect(injected.issues.join(' ')).toMatch(/services|customerSession/);
    }
  });

  it('preserves committed selection while clearing transient layout discovery state', () => {
    const session = {
      ...createEmptyBookingSession(),
      selection: {
        serviceId: 'svc-manicure-russian',
        addOnIds: ['addon-french'],
      },
      query: 'russian',
      activeCategory: 'manicure' as const,
      detailServiceId: 'svc-manicure-russian',
      draftAddOnIds: ['addon-french'],
      handoffOpen: true,
    };

    expect(normalizeSessionForLayoutChange(session)).toEqual({
      ...session,
      query: '',
      activeCategory: 'all',
      detailServiceId: null,
      draftAddOnIds: [],
      handoffOpen: false,
    });
  });
});
