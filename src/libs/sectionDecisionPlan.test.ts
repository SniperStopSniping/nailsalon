import { describe, expect, it } from 'vitest';

import type { SectionId } from '@/libs/bookingPageConfig';
import { EMPTY_SALON_CONTENT, type SalonContent } from '@/libs/salonContent';

import { resolveSectionDecisionPlan } from './sectionRegistry';

const ORDER: SectionId[] = ['salonProfile', 'serviceMenu', 'featuredServices', 'policies', 'socialLinks', 'bookingCta'];

function content(overrides: Partial<SalonContent> = {}): SalonContent {
  return {
    ...EMPTY_SALON_CONTENT,
    identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Isla Nail Studio' },
    ...overrides,
  };
}

function plan(value: SalonContent, hiddenSections: SectionId[] = [], announcement?: string | null) {
  return resolveSectionDecisionPlan({ order: ORDER, hiddenSections, content: value, announcement });
}

describe('canonical section decision/readiness plan', () => {
  it('owns a deterministic readiness result for every registered section', () => {
    const complete = content({
      people: {
        technicians: [
          { id: 't1', name: 'Ava', bio: 'Artist', avatarUrl: null, specialties: [], languages: [], rating: null, reviewCount: 0, skillLevel: null, acceptingNewClients: true },
          { id: 't2', name: 'Bea', bio: null, avatarUrl: null, specialties: [], languages: [], rating: null, reviewCount: 0, skillLevel: null, acceptingNewClients: true },
        ],
      },
      catalog: {
        ...EMPTY_SALON_CONTENT.catalog,
        services: [{ id: 's1', name: 'Gel manicure', description: null, durationMinutes: 60, priceCents: 5000, priceDisplayText: null, category: 'manicure', bookingCategory: null, imageUrl: null, featuredOrder: 1 }],
        featuredServices: [{ id: 's1', name: 'Gel manicure', description: null, durationMinutes: 60, priceCents: 5000, priceDisplayText: null, category: 'manicure', bookingCategory: null, imageUrl: null, featuredOrder: 1 }],
      },
      place: {
        ...EMPTY_SALON_CONTENT.place,
        address: { address: '1 Queen St', city: 'Toronto', state: 'ON', zipCode: null },
      },
      policies: {
        policy: { ...EMPTY_SALON_CONTENT.policies.policy, enabled: true, showOnServicePage: true, text: '24-hour notice.' },
        quickFacts: { ...EMPTY_SALON_CONTENT.policies.quickFacts, appointmentOnly: { enabled: true, label: 'Appointment only' } },
      },
      social: { instagram: 'https://instagram.com/isla', facebook: null, tiktok: null },
    });
    const allStoredIds: SectionId[] = [
      'salonProfile',
      'technicianProfile',
      'featuredServices',
      'serviceMenu',
      'whatsIncluded',
      'technicianList',
      'portfolio',
      'reviews',
      'hoursLocation',
      'policies',
      'socialLinks',
      'bookingCta',
    ];
    const resolved = resolveSectionDecisionPlan({
      order: allStoredIds,
      hiddenSections: [],
      content: complete,
      announcement: 'Use the side entrance.',
    });

    expect(Object.fromEntries(Object.entries(resolved.decisions).map(([id, decision]) => [id, decision.readiness]))).toEqual({
      salonProfile: 'ready',
      technicianProfile: 'ready',
      featuredServices: 'ready',
      serviceMenu: 'ready',
      whatsIncluded: 'unsupported',
      technicianList: 'unsupported',
      portfolio: 'unsupported',
      reviews: 'unsupported',
      hoursLocation: 'ready',
      policies: 'ready',
      socialLinks: 'ready',
      bookingCta: 'ready',
      announcement: 'ready',
      bookingFacts: 'ready',
    });
    expect(resolved.unfulfilledCapabilities).toEqual([]);
  });

  it('reports protected capabilities only from providers admitted to the rendered order', () => {
    const resolved = resolveSectionDecisionPlan({
      order: [],
      hiddenSections: [],
      content: content(),
    });

    expect(resolved.orderedIds).toEqual([]);
    expect(resolved.unfulfilledCapabilities).toEqual(['identity', 'serviceDiscovery', 'bookingAccess']);
  });

  it('models all five frozen readiness states and owner-hidden as an explicit final decision', () => {
    const base = plan(content());

    expect(base.decisions.salonProfile.readiness).toBe('ready');
    expect(base.decisions.serviceMenu.readiness).toBe('partial');
    expect(base.decisions.featuredServices.readiness).toBe('missing');
    expect(base.decisions.portfolio.readiness).toBe('unsupported');

    const invalid = plan(EMPTY_SALON_CONTENT);

    expect(invalid.decisions.salonProfile.readiness).toBe('invalid');
    expect(invalid.decisions.salonProfile.publicOutcome).toBe('omit');
    expect(invalid.unfulfilledCapabilities).toContain('identity');

    const hidden = plan(content({ social: { instagram: 'https://instagram.com/isla', facebook: null, tiktok: null } }), ['socialLinks']);

    expect(hidden.decisions.socialLinks).toMatchObject({ readiness: 'ready', ownerHidden: true, publicOutcome: 'omit' });
  });

  it('applies hidden intent through the same owner for every configurable stored section', () => {
    const configurable: SectionId[] = [
      'technicianProfile',
      'featuredServices',
      'whatsIncluded',
      'technicianList',
      'portfolio',
      'reviews',
      'hoursLocation',
      'policies',
      'socialLinks',
    ];
    const resolved = resolveSectionDecisionPlan({
      order: ['salonProfile', ...configurable, 'serviceMenu', 'bookingCta'],
      hiddenSections: configurable,
      content: content(),
    });

    for (const id of configurable) {
      expect(resolved.decisions[id], id).toMatchObject({ ownerHidden: true, publicOutcome: 'omit' });
    }
    for (const id of ['salonProfile', 'serviceMenu', 'bookingCta'] as const) {
      expect(resolved.decisions[id].ownerHidden, id).toBe(false);
    }
  });

  it('prevents empty public frames while preserving the service-discovery fallback', () => {
    const resolved = plan(content({
      policies: {
        ...EMPTY_SALON_CONTENT.policies,
        policy: { ...EMPTY_SALON_CONTENT.policies.policy, enabled: true, text: null },
      },
    }));

    expect(resolved.decisions.policies).toMatchObject({ readiness: 'partial', publicOutcome: 'omit' });
    expect(resolved.decisions.serviceMenu).toMatchObject({ readiness: 'partial', publicOutcome: 'render_partial' });
    expect(resolved.decisions.serviceMenu.capabilities).toContain('serviceDiscovery');
    expect(resolved.unfulfilledCapabilities).toEqual([]);
  });

  it('governs announcement and booking facts without requiring stored IDs or owner controls', () => {
    const authored = plan(content({
      policies: {
        ...EMPTY_SALON_CONTENT.policies,
        quickFacts: {
          ...EMPTY_SALON_CONTENT.policies.quickFacts,
          appointmentOnly: { enabled: true, label: 'Appointment only' },
        },
      },
    }), [], 'Please use the side entrance.');

    expect(authored.decisions.announcement).toMatchObject({ configuredOrder: null, ownerHidden: false, readiness: 'ready', publicOutcome: 'render' });
    expect(authored.decisions.bookingFacts).toMatchObject({ configuredOrder: null, ownerHidden: false, readiness: 'ready', publicOutcome: 'render' });
    expect(authored.orderedIds).toEqual(['salonProfile', 'serviceMenu', 'bookingCta']);
    expect(authored.orderedIds).not.toContain('announcement');
    expect(authored.orderedIds).not.toContain('bookingFacts');

    const absent = plan(content());

    expect(absent.decisions.announcement.publicOutcome).toBe('omit');
    expect(absent.decisions.bookingFacts.publicOutcome).toBe('omit');
  });

  it('renders only honest booking-fact fragments when authored facts are incomplete', () => {
    const resolved = plan(content({
      policies: {
        ...EMPTY_SALON_CONTENT.policies,
        quickFacts: {
          appointmentOnly: { enabled: true, label: 'Appointment only' },
          depositNotice: { enabled: true, label: '   ' },
          cancellationNotice: { enabled: false, label: null },
        },
      },
    }));

    expect(resolved.decisions.bookingFacts).toMatchObject({ readiness: 'partial', publicOutcome: 'render_partial' });
  });

  it('classifies the symbolic bookingCta as system compatibility while retaining booking access metadata', () => {
    expect(plan(content()).decisions.bookingCta).toMatchObject({
      classification: 'systemCompatibility',
      capabilities: ['bookingAccess'],
      readiness: 'ready',
    });
  });
});
