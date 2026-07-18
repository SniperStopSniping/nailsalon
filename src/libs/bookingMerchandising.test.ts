import { describe, expect, it } from 'vitest';

import { getFeaturedServices, LUSTER_MANICURE_TEMPLATE_KEY } from './bookingMerchandising';

describe('bookingMerchandising', () => {
  it('sorts featured services by category priority, then sort order, then stable name/id fallback', () => {
    const featured = getFeaturedServices([
      { id: 'svc-z', name: 'Gel X Overlay', category: 'extensions', sortOrder: 4 },
      { id: 'svc-b', name: 'Builder Gel Infill', category: 'builder_gel', sortOrder: 2 },
      { id: 'svc-a2', name: 'BIAB + Classic Pedicure', category: 'combo', sortOrder: 1 },
      { id: 'svc-a1', name: 'BIAB + Classic Pedicure', category: 'combo', sortOrder: 1 },
      { id: 'svc-non', name: 'Colour Change', category: 'manicure', sortOrder: 0 },
      { id: 'svc-c', name: 'Extensions Removal', category: 'extensions', sortOrder: 4 },
    ]);

    expect(featured.map(service => service.id)).toEqual([
      'svc-a1',
      'svc-a2',
      'svc-c',
      'svc-z',
      'svc-b',
    ]);
  });

  it('puts the active Luster Manicure first when featuring is enabled', () => {
    const featured = getFeaturedServices(
      [
        { id: 'svc-combo', name: 'Combo', category: 'combo', sortOrder: 1 },
        {
          id: 'svc-luster',
          name: 'Luster Manicure',
          category: 'manicure',
          sortOrder: 9,
          templateKey: LUSTER_MANICURE_TEMPLATE_KEY,
        },
      ],
      { lusterFeaturingEnabled: true },
    );

    expect(featured.map(service => service.id)).toEqual(['svc-luster', 'svc-combo']);
  });

  it('defaults to Luster featuring enabled when no option is passed', () => {
    const featured = getFeaturedServices([
      { id: 'svc-combo', name: 'Combo', category: 'combo', sortOrder: 1 },
      {
        id: 'svc-luster',
        name: 'Luster Manicure',
        category: 'manicure',
        sortOrder: 9,
        templateKey: LUSTER_MANICURE_TEMPLATE_KEY,
      },
    ]);

    expect(featured[0]?.id).toBe('svc-luster');
  });

  it('demotes (not hides) Luster when featuring is disabled', () => {
    const featured = getFeaturedServices(
      [
        { id: 'svc-combo', name: 'Combo', category: 'combo', sortOrder: 1 },
        {
          id: 'svc-luster',
          name: 'Luster Manicure',
          category: 'manicure',
          sortOrder: 9,
          featuredOrder: 2,
          templateKey: LUSTER_MANICURE_TEMPLATE_KEY,
        },
      ],
      { lusterFeaturingEnabled: false },
    );

    // Still present via its manual featured position, just not forced first.
    expect(featured.map(service => service.id)).toEqual(['svc-luster', 'svc-combo']);
  });

  it('drops a manicure Luster entirely from featured when disabled and not manually featured', () => {
    const featured = getFeaturedServices(
      [
        { id: 'svc-combo', name: 'Combo', category: 'combo', sortOrder: 1 },
        {
          id: 'svc-luster',
          name: 'Luster Manicure',
          category: 'manicure',
          sortOrder: 9,
          templateKey: LUSTER_MANICURE_TEMPLATE_KEY,
        },
      ],
      { lusterFeaturingEnabled: false },
    );

    expect(featured.map(service => service.id)).toEqual(['svc-combo']);
  });

  it('orders manually featured services by featuredOrder ahead of the category fallback', () => {
    const featured = getFeaturedServices([
      { id: 'svc-combo', name: 'Combo', category: 'combo', sortOrder: 1 },
      { id: 'svc-second', name: 'Spa Pedicure', category: 'pedicure', sortOrder: 5, featuredOrder: 2 },
      { id: 'svc-first', name: 'Gel Manicure', category: 'manicure', sortOrder: 8, featuredOrder: 1 },
    ]);

    expect(featured.map(service => service.id)).toEqual([
      'svc-first',
      'svc-second',
      'svc-combo',
    ]);
  });

  it('dedupes a Luster service that also has a manual featured position', () => {
    const featured = getFeaturedServices(
      [
        { id: 'svc-combo', name: 'Combo', category: 'combo', sortOrder: 1 },
        {
          id: 'svc-luster',
          name: 'Luster Manicure',
          category: 'manicure',
          sortOrder: 9,
          featuredOrder: 3,
          templateKey: LUSTER_MANICURE_TEMPLATE_KEY,
        },
      ],
      { lusterFeaturingEnabled: true },
    );

    expect(featured.map(service => service.id)).toEqual(['svc-luster', 'svc-combo']);
  });

  it('dedupes manually featured services that also match the category fallback', () => {
    const featured = getFeaturedServices([
      { id: 'svc-combo', name: 'Combo', category: 'combo', sortOrder: 1, featuredOrder: 1 },
      { id: 'svc-ext', name: 'Gel X', category: 'extensions', sortOrder: 2 },
    ]);

    expect(featured.map(service => service.id)).toEqual(['svc-combo', 'svc-ext']);
  });

  it('never features inactive services', () => {
    const featured = getFeaturedServices(
      [
        { id: 'svc-combo', name: 'Combo', category: 'combo', sortOrder: 1, isActive: false },
        {
          id: 'svc-luster',
          name: 'Luster Manicure',
          category: 'manicure',
          sortOrder: 9,
          isActive: false,
          templateKey: LUSTER_MANICURE_TEMPLATE_KEY,
        },
        { id: 'svc-manual', name: 'Spa Day', category: 'pedicure', featuredOrder: 1, isActive: false },
        { id: 'svc-live', name: 'Builder Gel', category: 'builder_gel', sortOrder: 3 },
      ],
      { lusterFeaturingEnabled: true },
    );

    expect(featured.map(service => service.id)).toEqual(['svc-live']);
  });

  it('returns an empty list without placeholders when nothing qualifies', () => {
    const featured = getFeaturedServices([
      { id: 'svc-mani', name: 'Classic Manicure', category: 'manicure', sortOrder: 1 },
    ]);

    expect(featured).toEqual([]);
  });
});
