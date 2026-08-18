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
  createDefaultBookingPageConfig,
  foldLegacyAppearanceInputs,
  resolveBookingPageConfig,
  SECTION_IDS,
  validateSectionOrder,
} from './bookingPageConfig';
import { EMPTY_SALON_CONTENT } from './salonContent';
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
      'bookingCta',
    ]);
  });

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
      'bookingCta',
    ]);
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
});
