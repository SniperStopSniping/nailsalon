import { describe, expect, it } from 'vitest';

import type { SectionId } from '@/libs/bookingPageConfig';
import { EMPTY_SALON_CONTENT, type SalonContent } from '@/libs/salonContent';

import { REGISTERED_SECTION_IDS, resolveVisibleSectionOrder, resolveVisitContent, SECTION_REGISTRY } from './sectionRegistry';

// Kept independent of `SECTION_IDS` from bookingPageConfig.ts (which pulls in
// a server-only DB import chain this test file does not want) — this is the
// same 12-id literal list the plan's section registry table enumerates.
const ALL_SECTION_IDS: SectionId[] = [
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

const QUICK_BOOK_ORDER: SectionId[] = [
  'salonProfile',
  'serviceMenu',
  'featuredServices',
  'policies',
  'socialLinks',
  'bookingCta',
];

function withContent(overrides: Partial<SalonContent>): SalonContent {
  return { ...EMPTY_SALON_CONTENT, ...overrides };
}

describe('SECTION_REGISTRY', () => {
  it('covers exactly the 12 SectionId values', () => {
    expect(Object.keys(SECTION_REGISTRY).sort()).toEqual([...ALL_SECTION_IDS].sort());
    expect(REGISTERED_SECTION_IDS.slice().sort()).toEqual([...ALL_SECTION_IDS].sort());
  });

  it('never renders a section as an empty frame — canRender omits, it never allows an empty placeholder', () => {
    expect(SECTION_REGISTRY.salonProfile.canRender(EMPTY_SALON_CONTENT)).toBe(false);
    expect(SECTION_REGISTRY.technicianProfile.canRender(EMPTY_SALON_CONTENT)).toBe(false);
    expect(SECTION_REGISTRY.featuredServices.canRender(EMPTY_SALON_CONTENT)).toBe(false);
    expect(SECTION_REGISTRY.whatsIncluded.canRender(EMPTY_SALON_CONTENT)).toBe(false);
    expect(SECTION_REGISTRY.technicianList.canRender(EMPTY_SALON_CONTENT)).toBe(false);
    expect(SECTION_REGISTRY.portfolio.canRender(EMPTY_SALON_CONTENT)).toBe(false);
    expect(SECTION_REGISTRY.reviews.canRender(EMPTY_SALON_CONTENT)).toBe(false);
    expect(SECTION_REGISTRY.hoursLocation.canRender(EMPTY_SALON_CONTENT)).toBe(false);
    expect(SECTION_REGISTRY.policies.canRender(EMPTY_SALON_CONTENT)).toBe(false);
    expect(SECTION_REGISTRY.socialLinks.canRender(EMPTY_SALON_CONTENT)).toBe(false);
  });

  it('serviceMenu and bookingCta are always renderable — the only non-removable sections', () => {
    expect(SECTION_REGISTRY.serviceMenu.canRender(EMPTY_SALON_CONTENT)).toBe(true);
    expect(SECTION_REGISTRY.bookingCta.canRender(EMPTY_SALON_CONTENT)).toBe(true);
  });

  it('salonProfile renders once a name is present', () => {
    const content = withContent({ identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Isla Nail Studio' } });

    expect(SECTION_REGISTRY.salonProfile.canRender(content)).toBe(true);
  });

  it('technicianProfile requires at least one technician with a bio or an avatar', () => {
    const withBioOnly = withContent({
      people: { technicians: [{ id: 't1', name: 'Ava', bio: 'Nail art specialist', avatarUrl: null, specialties: [], languages: [], rating: null, reviewCount: 0, skillLevel: null, acceptingNewClients: true }] },
    });

    expect(SECTION_REGISTRY.technicianProfile.canRender(withBioOnly)).toBe(true);

    const withNeither = withContent({
      people: { technicians: [{ id: 't1', name: 'Ava', bio: null, avatarUrl: null, specialties: [], languages: [], rating: null, reviewCount: 0, skillLevel: null, acceptingNewClients: true }] },
    });

    expect(SECTION_REGISTRY.technicianProfile.canRender(withNeither)).toBe(false);
  });

  it('featuredServices requires at least one featured service', () => {
    const content = withContent({
      catalog: {
        ...EMPTY_SALON_CONTENT.catalog,
        featuredServices: [{ id: 'svc-1', name: 'Gel-X', description: null, durationMinutes: 60, priceCents: 6500, priceDisplayText: null, category: 'extensions', bookingCategory: null, imageUrl: null, featuredOrder: null }],
      },
    });

    expect(SECTION_REGISTRY.featuredServices.canRender(content)).toBe(true);
  });

  it('technicianList requires at least two technicians', () => {
    const oneTech = withContent({
      people: { technicians: [{ id: 't1', name: 'Ava', bio: null, avatarUrl: null, specialties: [], languages: [], rating: null, reviewCount: 0, skillLevel: null, acceptingNewClients: true }] },
    });

    expect(SECTION_REGISTRY.technicianList.canRender(oneTech)).toBe(false);

    const twoTechs = withContent({
      people: {
        technicians: [
          { id: 't1', name: 'Ava', bio: null, avatarUrl: null, specialties: [], languages: [], rating: null, reviewCount: 0, skillLevel: null, acceptingNewClients: true },
          { id: 't2', name: 'Bea', bio: null, avatarUrl: null, specialties: [], languages: [], rating: null, reviewCount: 0, skillLevel: null, acceptingNewClients: true },
        ],
      },
    });

    expect(SECTION_REGISTRY.technicianList.canRender(twoTechs)).toBe(true);
  });

  it('policies mirrors bookingExperience.policy.enabled — placement, not a second content switch', () => {
    const disabled = withContent({ policies: { ...EMPTY_SALON_CONTENT.policies, policy: { ...EMPTY_SALON_CONTENT.policies.policy, enabled: false } } });

    expect(SECTION_REGISTRY.policies.canRender(disabled)).toBe(false);

    const enabled = withContent({ policies: { ...EMPTY_SALON_CONTENT.policies, policy: { ...EMPTY_SALON_CONTENT.policies.policy, enabled: true } } });

    expect(SECTION_REGISTRY.policies.canRender(enabled)).toBe(true);
  });

  it('socialLinks requires at least one link', () => {
    const none = withContent({ social: { instagram: null, facebook: null, tiktok: null } });

    expect(SECTION_REGISTRY.socialLinks.canRender(none)).toBe(false);

    const one = withContent({ social: { instagram: 'https://instagram.com/x', facebook: null, tiktok: null } });

    expect(SECTION_REGISTRY.socialLinks.canRender(one)).toBe(true);
  });

  it('portfolio and reviews are always omitted in this PR — proof groups are always empty', () => {
    expect(SECTION_REGISTRY.portfolio.canRender(EMPTY_SALON_CONTENT)).toBe(false);
    expect(SECTION_REGISTRY.reviews.canRender(EMPTY_SALON_CONTENT)).toBe(false);
  });

  it('whatsIncluded is always omitted — no inclusions field exists in SalonContent (data gap 17)', () => {
    expect(SECTION_REGISTRY.whatsIncluded.canRender(EMPTY_SALON_CONTENT)).toBe(false);

    const fullyPopulated = withContent({
      catalog: {
        ...EMPTY_SALON_CONTENT.catalog,
        services: [{ id: 's1', name: 'Gel', description: 'Prep, cuticle care', durationMinutes: 60, priceCents: 4500, priceDisplayText: null, category: 'manicure', bookingCategory: null, imageUrl: null, featuredOrder: null }],
      },
    });

    expect(SECTION_REGISTRY.whatsIncluded.canRender(fullyPopulated)).toBe(false);
  });

  // Post-launch fix: hoursLocation.canRender used to accept `hours !== null`
  // or `locations.length > 0` on their own, even though no renderer in
  // either layout puts raw `hours` on the page and a location can exist with
  // both `address`/`city` null (e.g. a location entry carrying only a
  // name/phone) — either case let this canRender pass while there was
  // nothing for the Visit section's editorial renderer to actually show,
  // producing an `<h2>Visit</h2>` frame with no address/entrance paragraph
  // beneath it. resolveVisitContent (shared with the renderer) is now the
  // one predicate both agree on.
  describe('hoursLocation — resolveVisitContent parity (no empty Visit frame)', () => {
    it('omits when there is hours but no address and no entrance instructions', () => {
      const content = withContent({
        place: {
          locations: [],
          address: null,
          hours: { monday: { open: '10:00', close: '18:00' } },
          entranceInstructions: null,
        },
      });

      expect(resolveVisitContent(content).hasVisitableContent).toBe(false);
      expect(SECTION_REGISTRY.hoursLocation.canRender(content)).toBe(false);
    });

    it('omits when a location exists but neither its address nor city is set', () => {
      const content = withContent({
        place: {
          locations: [{ id: 'loc-1', name: 'Studio', address: null, city: null, state: null, zipCode: null, phone: '555-0100', isPrimary: true, hours: null }],
          address: null,
          hours: null,
          entranceInstructions: null,
        },
      });

      expect(resolveVisitContent(content).hasVisitableContent).toBe(false);
      expect(SECTION_REGISTRY.hoursLocation.canRender(content)).toBe(false);
    });

    it('renders when address and hours are both present', () => {
      const content = withContent({
        place: {
          locations: [],
          address: { address: '123 Queen St W', city: 'Toronto', state: 'ON', zipCode: 'M5V 1A1' },
          hours: { monday: { open: '10:00', close: '18:00' } },
          entranceInstructions: null,
        },
      });

      expect(resolveVisitContent(content)).toEqual({
        resolvedAddress: '123 Queen St W',
        resolvedCity: 'Toronto',
        hasVisitableContent: true,
      });
      expect(SECTION_REGISTRY.hoursLocation.canRender(content)).toBe(true);
    });

    it('renders on address alone, with no hours', () => {
      const content = withContent({
        place: {
          locations: [],
          address: { address: '123 Queen St W', city: 'Toronto', state: 'ON', zipCode: 'M5V 1A1' },
          hours: null,
          entranceInstructions: null,
        },
      });

      expect(SECTION_REGISTRY.hoursLocation.canRender(content)).toBe(true);
    });

    it('omits when neither address, hours, locations, nor entrance instructions are present', () => {
      expect(resolveVisitContent(EMPTY_SALON_CONTENT).hasVisitableContent).toBe(false);
      expect(SECTION_REGISTRY.hoursLocation.canRender(EMPTY_SALON_CONTENT)).toBe(false);
    });

    it('city_only: street address is nulled but city survives — still renders (home/private studios stay coherent)', () => {
      const content = withContent({
        place: {
          locations: [],
          // Mirrors applyLocationDisplayMode's city_only projection
          // (@/libs/salonContent): address/zipCode nulled, city untouched.
          address: { address: null, city: 'Toronto', state: 'ON', zipCode: null },
          hours: { monday: { open: '10:00', close: '18:00' } },
          entranceInstructions: null,
        },
      });

      const resolved = resolveVisitContent(content);

      expect(resolved.hasVisitableContent).toBe(true);
      expect(resolved.resolvedAddress).toBeNull();
      expect(resolved.resolvedCity).toBe('Toronto');
      expect(SECTION_REGISTRY.hoursLocation.canRender(content)).toBe(true);
    });

    it('full_address: street, city, state, and zip all present — renders', () => {
      const content = withContent({
        place: {
          locations: [],
          address: { address: '123 Queen St W', city: 'Toronto', state: 'ON', zipCode: 'M5V 1A1' },
          hours: null,
          entranceInstructions: null,
        },
      });

      const resolved = resolveVisitContent(content);

      expect(resolved.hasVisitableContent).toBe(true);
      expect(resolved.resolvedAddress).toBe('123 Queen St W');
      expect(SECTION_REGISTRY.hoursLocation.canRender(content)).toBe(true);
    });
  });

  // Post-launch fix: policies.canRender used to mirror only
  // bookingExperience.policy.enabled, ignoring showOnServicePage entirely —
  // Quick Book's own embedded policy card already checked showOnServicePage,
  // so an owner who turned it off was obeyed on Quick Book and ignored on
  // Editorial (whose dedicated `policies` renderer is gated by this entry).
  describe('policies — showOnServicePage parity', () => {
    it('omits when showOnServicePage is false, even with enabled + text', () => {
      const content = withContent({
        policies: {
          ...EMPTY_SALON_CONTENT.policies,
          policy: { ...EMPTY_SALON_CONTENT.policies.policy, enabled: true, showOnServicePage: false, text: '24h cancellation notice.' },
        },
      });

      expect(SECTION_REGISTRY.policies.canRender(content)).toBe(false);
    });

    it('renders when enabled and showOnServicePage are both true', () => {
      const content = withContent({
        policies: {
          ...EMPTY_SALON_CONTENT.policies,
          policy: { ...EMPTY_SALON_CONTENT.policies.policy, enabled: true, showOnServicePage: true, text: '24h cancellation notice.' },
        },
      });

      expect(SECTION_REGISTRY.policies.canRender(content)).toBe(true);
    });
  });
});

describe('resolveVisibleSectionOrder', () => {
  it('renders the full Quick Book order against a fully populated SalonContent when nothing is hidden', () => {
    const content = withContent({
      identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Isla Nail Studio' },
      policies: { ...EMPTY_SALON_CONTENT.policies, policy: { ...EMPTY_SALON_CONTENT.policies.policy, enabled: true } },
      social: { instagram: 'https://instagram.com/isla', facebook: null, tiktok: null },
      catalog: {
        ...EMPTY_SALON_CONTENT.catalog,
        featuredServices: [{ id: 'svc-1', name: 'Luster Manicure', description: null, durationMinutes: 75, priceCents: 6500, priceDisplayText: null, category: 'manicure', bookingCategory: null, imageUrl: null, featuredOrder: null }],
      },
    });

    expect(resolveVisibleSectionOrder(QUICK_BOOK_ORDER, [], content)).toEqual(QUICK_BOOK_ORDER);
  });

  it('omits every optional section that fails canRender against a minimally populated SalonContent, but still leaves a bookable page', () => {
    // Only salonProfile (name present), serviceMenu and bookingCta
    // (non-removable) are satisfiable — featuredServices/policies/socialLinks
    // all fail canRender against an otherwise-empty SalonContent.
    const content = withContent({
      identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Bare Salon' },
    });

    const visible = resolveVisibleSectionOrder(QUICK_BOOK_ORDER, [], content);

    expect(visible).toEqual(['salonProfile', 'serviceMenu', 'bookingCta']);
    // The page is still bookable: the booking engine's host and its only
    // entry point both survive, regardless of what else got omitted.
    expect(visible).toContain('serviceMenu');
    expect(visible).toContain('bookingCta');
  });

  it('still renders a bookable page even when salonProfile itself fails canRender (no name)', () => {
    const visible = resolveVisibleSectionOrder(QUICK_BOOK_ORDER, [], EMPTY_SALON_CONTENT);

    expect(visible).toEqual(['serviceMenu', 'bookingCta']);
  });

  it('drops unregistered ids defensively rather than throwing', () => {
    const visible = resolveVisibleSectionOrder(
      ['salonProfile', 'not-a-real-section' as SectionId, 'bookingCta'],
      [],
      withContent({ identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Salon' } }),
    );

    expect(visible).toEqual(['salonProfile', 'bookingCta']);
  });

  // Regression coverage for the shipped bug this PR fixes: hiddenSections
  // used to be written by the admin surface, validated by
  // validateSectionOrder, and round-tripped through publish/revert — but
  // nothing in the render path ever read it. Every fixture above uses `[]`
  // deliberately to prove the "nothing hidden" baseline; these use a
  // NON-EMPTY hiddenSections, which is exactly the case that shipped broken.
  it('omits a hidden section even though it passes canRender', () => {
    const content = withContent({
      identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Isla Nail Studio' },
      policies: { ...EMPTY_SALON_CONTENT.policies, policy: { ...EMPTY_SALON_CONTENT.policies.policy, enabled: true } },
      social: { instagram: 'https://instagram.com/isla', facebook: null, tiktok: null },
    });

    const visible = resolveVisibleSectionOrder(QUICK_BOOK_ORDER, ['policies'], content);

    expect(visible).not.toContain('policies');
    expect(visible).toEqual(['salonProfile', 'serviceMenu', 'socialLinks', 'bookingCta']);
  });

  it('omits multiple hidden sections at once, independent of canRender', () => {
    const content = withContent({
      identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Isla Nail Studio' },
      policies: { ...EMPTY_SALON_CONTENT.policies, policy: { ...EMPTY_SALON_CONTENT.policies.policy, enabled: true } },
      social: { instagram: 'https://instagram.com/isla', facebook: null, tiktok: null },
      catalog: {
        ...EMPTY_SALON_CONTENT.catalog,
        featuredServices: [{ id: 'svc-1', name: 'Luster Manicure', description: null, durationMinutes: 75, priceCents: 6500, priceDisplayText: null, category: 'manicure', bookingCategory: null, imageUrl: null, featuredOrder: null }],
      },
    });

    const visible = resolveVisibleSectionOrder(QUICK_BOOK_ORDER, ['featuredServices', 'socialLinks'], content);

    expect(visible).toEqual(['salonProfile', 'serviceMenu', 'policies', 'bookingCta']);
  });

  it('hiding a section that already fails canRender changes nothing observable — still omitted, for the same reason', () => {
    // policies fails canRender here (policy.enabled is false); hiding it too
    // must not throw or double-omit in an observable way.
    const content = withContent({ identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Isla Nail Studio' } });

    const visible = resolveVisibleSectionOrder(QUICK_BOOK_ORDER, ['policies'], content);

    expect(visible).toEqual(['salonProfile', 'serviceMenu', 'bookingCta']);
  });

  it('hiding an id absent from hiddenSections has no effect (positive control)', () => {
    const content = withContent({
      identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Isla Nail Studio' },
      social: { instagram: 'https://instagram.com/isla', facebook: null, tiktok: null },
    });

    const visible = resolveVisibleSectionOrder(QUICK_BOOK_ORDER, ['reviews'], content);

    expect(visible).toEqual(['salonProfile', 'serviceMenu', 'socialLinks', 'bookingCta']);
  });
});
