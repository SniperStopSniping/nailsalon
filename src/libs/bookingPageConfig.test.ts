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
