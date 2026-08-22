/**
 * Pure unit tests for the bookingPage modular config contract. No DB access
 * — updateBookingPageDraft touches the database, so `server-only` and
 * `@/libs/DB` are mocked purely so the module under test can be imported
 * (mirrors the pattern in src/libs/bookingQuote.addOnGating.test.ts); no
 * test here exercises updateBookingPageDraft itself.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

/* eslint-disable import/first */
import {
  BOOKING_PAGE_CONFIG_DEFAULTS,
  BOOKING_PAGE_CONFIG_SIDE_DEFAULTS,
  bookingPageDraftPatchSchema,
  createDefaultBookingPageConfig,
  foldLegacyAppearanceInputs,
  resolveBookingPageConfig,
  SECTION_IDS,
  validateSectionOrder,
} from './bookingPageConfig';
import { EMPTY_SALON_CONTENT } from './salonContent';
import { resolveSectionPresentation } from './sectionPresentation';
import { resolveVisibleSectionOrder } from './sectionRegistry';
/* eslint-enable import/first */

describe('bookingPageConfig defaults', () => {
  it('reproduces current rendering exactly', () => {
    expect(BOOKING_PAGE_CONFIG_SIDE_DEFAULTS).toEqual({
      layout: 'quick_book',
      stylePack: 'default',
      tokenOverrides: null,
      sectionOrder: [
        'salonProfile',
        'serviceMenu',
        'featuredServices',
        'policies',
        'socialLinks',
        'bookingCta',
      ],
      sectionVariants: {},
      hiddenSections: [],
      businessMode: 'solo',
      startMode: 'services_first',
    });
  });

  it('has draft and live both start equal to the defaults', () => {
    const config = createDefaultBookingPageConfig();

    expect(config.version).toBe(1);
    expect(config.draft).toEqual(BOOKING_PAGE_CONFIG_SIDE_DEFAULTS);
    expect(config.live).toEqual(BOOKING_PAGE_CONFIG_SIDE_DEFAULTS);
  });

  it('exposes exactly the 12 registered section ids', () => {
    expect(SECTION_IDS).toEqual([
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
    ]);
  });
});

describe('bookingPageDraftPatchSchema Stage 4 section-variant writes', () => {
  it('accepts canonical variants only on the section that owns them', () => {
    const sectionVariants = {
      salonProfile: 'hero_image',
      technicianProfile: 'full',
      featuredServices: 'signature',
      serviceMenu: 'list',
      hoursLocation: 'full',
      policies: 'inline',
      socialLinks: 'icons',
      bookingCta: 'sticky',
    };

    const result = bookingPageDraftPatchSchema.safeParse({ sectionVariants });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.sectionVariants).toEqual(sectionVariants);
    }
  });

  it.each([
    ['a canonical variant assigned to the wrong section', { salonProfile: 'list' }],
    ['a second cross-section canonical variant', { policies: 'signature' }],
    ['the legacy pre-Stage-4 alias', { salonProfile: 'hero' }],
    ['an unknown future variant', { serviceMenu: 'future_menu' }],
    ['a variant on a section with no variant contract', { reviews: 'card' }],
    ['an unknown section id', { notASection: 'list' }],
  ])('rejects %s on new writes', (_caseName, sectionVariants) => {
    expect(bookingPageDraftPatchSchema.safeParse({ sectionVariants }).success).toBe(false);
  });
});

describe('resolveBookingPageConfig', () => {
  it('resolves absent settings to the defaults', () => {
    expect(resolveBookingPageConfig(null)).toEqual(BOOKING_PAGE_CONFIG_DEFAULTS);
    expect(resolveBookingPageConfig(undefined)).toEqual(BOOKING_PAGE_CONFIG_DEFAULTS);
    expect(resolveBookingPageConfig({})).toEqual(BOOKING_PAGE_CONFIG_DEFAULTS);
  });

  it('never throws and falls back for malformed settings', () => {
    const malformedInputs: unknown[] = [
      'not an object',
      42,
      [],
      { bookingPage: 'not an object' },
      { bookingPage: { draft: 'nope', live: null } },
      { bookingPage: { draft: { sectionOrder: 'not-an-array' } } },
      { bookingPage: { draft: { tokenOverrides: { accentColor: 'not-a-hex-color' } } } },
    ];

    for (const input of malformedInputs) {
      expect(() => resolveBookingPageConfig(input)).not.toThrow();

      const resolved = resolveBookingPageConfig(input);

      expect(resolved.draft.layout).toBeTruthy();
      expect(resolved.draft.sectionOrder).toContain('serviceMenu');
      expect(resolved.draft.sectionOrder).toContain('bookingCta');
    }
  });

  it('resolves an unknown layout to the fallback default layout', () => {
    const resolved = resolveBookingPageConfig({
      bookingPage: {
        draft: { layout: 'not_a_real_layout' },
      },
    });

    expect(resolved.draft.layout).toBe(BOOKING_PAGE_CONFIG_SIDE_DEFAULTS.layout);
  });

  it('reads and respects the version field when it is the supported value', () => {
    const resolved = resolveBookingPageConfig({
      bookingPage: {
        version: 1,
        draft: { layout: 'editorial' },
        live: { layout: 'quick_book' },
      },
    });

    expect(resolved.version).toBe(1);
    expect(resolved.draft.layout).toBe('editorial');
  });

  it('falls back to version 1 for an unsupported/missing version', () => {
    expect(resolveBookingPageConfig({ bookingPage: { version: 99 } }).version).toBe(1);
    expect(resolveBookingPageConfig({ bookingPage: {} }).version).toBe(1);
  });

  it('strips an unknown section ID from sectionOrder', () => {
    const resolved = resolveBookingPageConfig({
      bookingPage: {
        draft: {
          sectionOrder: ['salonProfile', 'not_a_real_section', 'serviceMenu', 'bookingCta'],
        },
      },
    });

    expect(resolved.draft.sectionOrder).toEqual(['salonProfile', 'serviceMenu', 'bookingCta']);
  });

  it('restores serviceMenu when sectionOrder omits it', () => {
    const resolved = resolveBookingPageConfig({
      bookingPage: {
        draft: {
          sectionOrder: ['salonProfile', 'bookingCta'],
        },
      },
    });

    expect(resolved.draft.sectionOrder).toContain('serviceMenu');
  });

  it('restores bookingCta when sectionOrder omits it', () => {
    const resolved = resolveBookingPageConfig({
      bookingPage: {
        draft: {
          sectionOrder: ['salonProfile', 'serviceMenu'],
        },
      },
    });

    expect(resolved.draft.sectionOrder).toContain('bookingCta');
  });

  it('unhides serviceMenu and bookingCta when hiddenSections contains either', () => {
    const resolved = resolveBookingPageConfig({
      bookingPage: {
        draft: {
          hiddenSections: ['serviceMenu', 'bookingCta', 'policies'],
        },
      },
    });

    expect(resolved.draft.hiddenSections).not.toContain('serviceMenu');
    expect(resolved.draft.hiddenSections).not.toContain('bookingCta');
    expect(resolved.draft.hiddenSections).toContain('policies');
  });

  it('resolves editorial to its own default section order when sectionOrder is absent', () => {
    const resolved = resolveBookingPageConfig({
      bookingPage: {
        draft: { layout: 'editorial' },
      },
    });

    expect(resolved.draft.sectionOrder).toEqual([
      'salonProfile',
      'featuredServices',
      'technicianProfile',
      'portfolio',
      'reviews',
      'serviceMenu',
      'hoursLocation',
      'policies',
      'socialLinks',
      'bookingCta',
    ]);
  });

  it('preserves raw legacy/unknown known-section strings on read, then resolves them safely', () => {
    const resolved = resolveBookingPageConfig({
      bookingPage: {
        draft: {
          layout: 'editorial',
          sectionVariants: {
            salonProfile: 'hero',
            serviceMenu: 'future_menu',
            policies: 'signature',
            socialLinks: '',
            reviews: 42,
            notASection: 'list',
          },
        },
      },
    });

    // Reads preserve non-empty strings for known sections so old/future data
    // can be interpreted by the compatibility layer instead of being erased.
    expect(resolved.draft.sectionVariants).toEqual({
      salonProfile: 'hero',
      serviceMenu: 'future_menu',
      policies: 'signature',
    });

    const presentation = resolveSectionPresentation({
      layout: resolved.draft.layout,
      sectionVariants: resolved.draft.sectionVariants,
      content: {
        ...EMPTY_SALON_CONTENT,
        identity: {
          ...EMPTY_SALON_CONTENT.identity,
          name: 'Luster',
          heroImageUrl: 'https://example.com/hero.jpg',
        },
      },
    });

    expect(presentation.variants.salonProfile).toBe('hero_image');
    expect(presentation.variants.serviceMenu).toBe('list');
    expect(presentation.variants.policies).toBe('inline');
  });

  it.each(['tech_profile', 'portfolio', 'catalogue'] as const)(
    'preserves legacy layout %s while the presentation layer safely selects Quick Book behavior',
    (layout) => {
      const resolved = resolveBookingPageConfig({
        bookingPage: {
          draft: {
            layout,
            sectionVariants: { salonProfile: 'hero' },
          },
        },
      });

      expect(resolved.draft.layout).toBe(layout);
      expect(resolved.draft.sectionVariants).toEqual({ salonProfile: 'hero' });

      const presentation = resolveSectionPresentation({
        layout: resolved.draft.layout,
        sectionVariants: resolved.draft.sectionVariants,
        content: {
          ...EMPTY_SALON_CONTENT,
          identity: {
            ...EMPTY_SALON_CONTENT.identity,
            name: 'Luster',
            heroImageUrl: 'https://example.com/hero.jpg',
          },
        },
      });

      expect(presentation.layout).toBe('quick_book');
      expect(presentation.variants.salonProfile).toBe('compact');
    },
  );

  it('falls back editorial + staff_first to services_first (PR 6: editorial requires services_first)', () => {
    const resolved = resolveBookingPageConfig({
      bookingPage: {
        draft: { layout: 'editorial', startMode: 'staff_first' },
        live: { layout: 'editorial', startMode: 'staff_first' },
      },
    });

    expect(resolved.draft.layout).toBe('editorial');
    expect(resolved.draft.startMode).toBe('services_first');
    expect(resolved.live.layout).toBe('editorial');
    expect(resolved.live.startMode).toBe('services_first');
  });

  it('leaves staff_first untouched for non-editorial layouts', () => {
    const resolved = resolveBookingPageConfig({
      bookingPage: {
        draft: { layout: 'quick_book', startMode: 'staff_first' },
      },
    });

    expect(resolved.draft.startMode).toBe('staff_first');
  });

  it('dedupes duplicate IDs in sectionOrder, keeping the first occurrence', () => {
    const resolved = resolveBookingPageConfig({
      bookingPage: {
        draft: {
          sectionOrder: ['salonProfile', 'serviceMenu', 'salonProfile', 'bookingCta', 'serviceMenu'],
        },
      },
    });

    expect(resolved.draft.sectionOrder).toEqual(['salonProfile', 'serviceMenu', 'bookingCta']);
  });
});

describe('validateSectionOrder', () => {
  it('is real enforced logic: strips unknown IDs, dedupes, and guarantees the required pair', () => {
    const result = validateSectionOrder(
      ['bogus', 'salonProfile', 'salonProfile', 'reviews'],
      ['serviceMenu', 'reviews'],
      'quick_book',
    );

    expect(result.sectionOrder).toEqual(['salonProfile', 'reviews', 'serviceMenu', 'bookingCta']);
    expect(result.hiddenSections).toEqual(['reviews']);
  });

  it('falls back entirely to the layout default order when the cleaned order is unusable', () => {
    const result = validateSectionOrder(['bogus', 'also_bogus'], [], 'quick_book');

    expect(result.sectionOrder).toEqual(BOOKING_PAGE_CONFIG_SIDE_DEFAULTS.sectionOrder);
  });

  it('falls back entirely to editorial\'s own default order when the cleaned order is unusable for layout editorial', () => {
    const result = validateSectionOrder(['bogus', 'also_bogus'], [], 'editorial');

    expect(result.sectionOrder).toEqual([
      'salonProfile',
      'featuredServices',
      'technicianProfile',
      'portfolio',
      'reviews',
      'serviceMenu',
      'hoursLocation',
      'policies',
      'socialLinks',
      'bookingCta',
    ]);
  });

  it('repairs the exact pre-Stage-4 Editorial default by inserting socialLinks before bookingCta', () => {
    const result = validateSectionOrder(
      [
        'salonProfile',
        'featuredServices',
        'technicianProfile',
        'portfolio',
        'reviews',
        'serviceMenu',
        'hoursLocation',
        'policies',
        'bookingCta',
      ],
      [],
      'editorial',
    );

    expect(result.sectionOrder).toEqual([
      'salonProfile',
      'featuredServices',
      'technicianProfile',
      'portfolio',
      'reviews',
      'serviceMenu',
      'hoursLocation',
      'policies',
      'socialLinks',
      'bookingCta',
    ]);
  });

  it('does not rewrite a customized Editorial order merely because socialLinks is absent', () => {
    const customizedOrder = [
      'salonProfile',
      'featuredServices',
      'serviceMenu',
      'hoursLocation',
      'policies',
      'bookingCta',
    ];

    const result = validateSectionOrder(customizedOrder, [], 'editorial');

    expect(result.sectionOrder).toEqual(customizedOrder);
    expect(result.sectionOrder).not.toContain('socialLinks');
  });

  it('falls back entirely to the layout default order for non-array input', () => {
    const result = validateSectionOrder(
      'not-an-array' as unknown as unknown[],
      undefined as unknown as unknown[],
      'quick_book',
    );

    expect(result.sectionOrder).toEqual(BOOKING_PAGE_CONFIG_SIDE_DEFAULTS.sectionOrder);
    expect(result.hiddenSections).toEqual([]);
  });

  // Repair A4: salonProfile joined REQUIRED_SECTION_IDS alongside
  // serviceMenu/bookingCta — it hosts the page's only <h1> on both layouts
  // (BookingStepHeader for Quick Book, the hero heading for Editorial). A
  // crafted PATCH (or stale/legacy stored data written before this repair)
  // that omits it from sectionOrder, or adds it to hiddenSections, must
  // never survive validateSectionOrder.
  describe('salonProfile floor (repair A4)', () => {
    it('strips salonProfile from hiddenSections — a crafted PATCH cannot hide it', () => {
      const result = validateSectionOrder(
        ['salonProfile', 'serviceMenu', 'bookingCta'],
        ['salonProfile', 'policies'],
        'quick_book',
      );

      expect(result.hiddenSections).toEqual(['policies']);
      expect(result.hiddenSections).not.toContain('salonProfile');
    });

    it('inserts a missing salonProfile at the FRONT of sectionOrder, not appended after serviceMenu/bookingCta', () => {
      // A stored/crafted sectionOrder that already omits salonProfile —
      // e.g. stale data written before this repair, or a hand-crafted PATCH.
      // Position-aware hazard: a naive `.push()` (the same repair
      // serviceMenu/bookingCta already use) would land it AFTER bookingCta,
      // rendering the salon header/step-progress below the service menu.
      const result = validateSectionOrder(
        ['serviceMenu', 'featuredServices', 'bookingCta'],
        [],
        'quick_book',
      );

      expect(result.sectionOrder).toEqual(['salonProfile', 'serviceMenu', 'featuredServices', 'bookingCta']);
      expect(result.sectionOrder[0]).toBe('salonProfile');
    });

    it('leaves an already-present salonProfile exactly where it was — repair only inserts when missing', () => {
      const result = validateSectionOrder(
        ['featuredServices', 'salonProfile', 'serviceMenu', 'bookingCta'],
        [],
        'quick_book',
      );

      expect(result.sectionOrder).toEqual(['featuredServices', 'salonProfile', 'serviceMenu', 'bookingCta']);
    });

    it('serviceMenu/bookingCta keep their existing append-at-the-end floor behaviour, unchanged by the salonProfile fix', () => {
      const result = validateSectionOrder(['salonProfile'], [], 'quick_book');

      expect(result.sectionOrder).toEqual(['salonProfile', 'serviceMenu', 'bookingCta']);
    });
  });
});

describe('foldLegacyAppearanceInputs', () => {
  it('does NOT apply the legacy primary colour when an explicit accentColor is already set', () => {
    const config = resolveBookingPageConfig({
      bookingPage: {
        draft: { tokenOverrides: { accentColor: '#123456' } },
      },
    });

    const folded = foldLegacyAppearanceInputs(config, '#ABCDEF');

    expect(folded.draft.tokenOverrides?.accentColor).toBe('#123456');
  });

  it('folds the legacy primary colour in when accentColor is absent', () => {
    const config = createDefaultBookingPageConfig();

    const folded = foldLegacyAppearanceInputs(config, '#abcdef');

    expect(folded.draft.tokenOverrides?.accentColor).toBe('#ABCDEF');
    expect(folded.live.tokenOverrides?.accentColor).toBe('#ABCDEF');
  });

  it('leaves tokenOverrides untouched when there is no legacy colour to fold', () => {
    const config = createDefaultBookingPageConfig();

    const folded = foldLegacyAppearanceInputs(config, null);

    expect(folded.draft.tokenOverrides).toBeNull();
  });
});

describe('full pipeline: resolveBookingPageConfig -> resolveVisibleSectionOrder', () => {
  // Proves the floor lives in ONE place (validateSectionOrder, exercised via
  // resolveBookingPageConfig) and that resolveVisibleSectionOrder
  // (@/libs/sectionRegistry) — the render-path choke point — never has to
  // reimplement it: by the time a malicious/stale stored hiddenSections
  // reaches the render path, it has already been stripped of
  // serviceMenu/bookingCta, so this never-hidden invariant holds end to end
  // without a second rule anywhere downstream.
  it('a malicious stored hiddenSections attempting to hide serviceMenu/bookingCta never actually hides them at render time', () => {
    const maliciousSettings = {
      bookingPage: {
        draft: {
          layout: 'quick_book',
          sectionOrder: ['salonProfile', 'serviceMenu', 'bookingCta'],
          // A hand-crafted request (bypassing the owner UI, which never
          // offers a toggle for either — see admin/booking-page/page.tsx)
          // trying to hide the two non-removable sections.
          hiddenSections: ['serviceMenu', 'bookingCta', 'policies'],
        },
      },
    };

    const resolved = resolveBookingPageConfig(maliciousSettings);

    // The floor: validateSectionOrder already stripped both out.
    expect(resolved.draft.hiddenSections).not.toContain('serviceMenu');
    expect(resolved.draft.hiddenSections).not.toContain('bookingCta');

    const content = { ...EMPTY_SALON_CONTENT, identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Salon' } };
    const visible = resolveVisibleSectionOrder(
      resolved.draft.sectionOrder,
      resolved.draft.hiddenSections,
      content,
    );

    expect(visible).toContain('serviceMenu');
    expect(visible).toContain('bookingCta');
  });

  // Repair A4: same end-to-end proof, for the newly-required salonProfile —
  // both the "crafted PATCH" shape (an authenticated write attempting
  // `hiddenSections: ['salonProfile']`) and the "stale/poisoned data" shape
  // (a sectionOrder saved before this repair existed, which never had
  // salonProfile in it at all) are exercised through the exact same
  // resolveBookingPageConfig entry point every real read goes through — so
  // this also proves the fix protects data already sitting in the database,
  // not just new writes.
  it('a crafted stored hiddenSections attempting to hide salonProfile never actually hides it at render time', () => {
    const maliciousSettings = {
      bookingPage: {
        draft: {
          layout: 'quick_book',
          sectionOrder: ['salonProfile', 'serviceMenu', 'bookingCta'],
          hiddenSections: ['salonProfile', 'policies'],
        },
      },
    };

    const resolved = resolveBookingPageConfig(maliciousSettings);

    expect(resolved.draft.hiddenSections).not.toContain('salonProfile');
    expect(resolved.draft.sectionOrder).toContain('salonProfile');

    const content = { ...EMPTY_SALON_CONTENT, identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Salon' } };
    const visible = resolveVisibleSectionOrder(
      resolved.draft.sectionOrder,
      resolved.draft.hiddenSections,
      content,
    );

    expect(visible).toContain('salonProfile');
  });

  it('stale sectionOrder saved before salonProfile was required is repaired on read, at the front, and stays visible', () => {
    // No hiddenSections trickery here — this stored sectionOrder simply
    // predates the repair and never had salonProfile in it.
    const staleSettings = {
      bookingPage: {
        draft: {
          layout: 'quick_book',
          sectionOrder: ['serviceMenu', 'featuredServices', 'policies', 'bookingCta'],
          hiddenSections: [],
        },
      },
    };

    const resolved = resolveBookingPageConfig(staleSettings);

    expect(resolved.draft.sectionOrder[0]).toBe('salonProfile');

    const content = { ...EMPTY_SALON_CONTENT, identity: { ...EMPTY_SALON_CONTENT.identity, name: 'Salon' } };
    const visible = resolveVisibleSectionOrder(
      resolved.draft.sectionOrder,
      resolved.draft.hiddenSections,
      content,
    );

    expect(visible[0]).toBe('salonProfile');
  });
});
