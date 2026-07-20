/**
 * The shared canonical grouping. Every user-facing surface (public booking,
 * owner My Menu, technician service views, Service Library, admin pickers)
 * routes through resolveVisibleBookingCategory, so this matrix is the
 * single guarantee that public and private views cannot disagree.
 */
import { describe, expect, it } from 'vitest';

import {
  BOOKING_CATEGORY_META,
  deriveBookingCategory,
  resolveVisibleBookingCategory,
  VISIBLE_BOOKING_CATEGORIES,
} from '@/libs/bookingCategory';
import {
  getTemplatesByShelf,
  getTemplateShelf,
  LIBRARY_SHELF_LABELS,
  LIBRARY_SHELVES,
  SERVICE_TEMPLATES,
} from '@/libs/serviceTemplateCatalog';

describe('visible booking categories', () => {
  it('exposes exactly Manicure, Pedicure, and Combos', () => {
    expect(VISIBLE_BOOKING_CATEGORIES).toEqual(['manicure', 'pedicure', 'combo']);
    expect(VISIBLE_BOOKING_CATEGORIES.map(category => BOOKING_CATEGORY_META[category].label))
      .toEqual(['Manicure', 'Pedicure', 'Combos']);
  });

  it('never surfaces an internal category as a visible group', () => {
    const labels = Object.values(BOOKING_CATEGORY_META).map(meta => meta.label);

    expect(labels).not.toContain('Builder Gel');
    expect(labels).not.toContain('Extensions');
    expect(labels).not.toContain('Hands');
    expect(labels).not.toContain('Feet');
    expect(labels).not.toContain('Gel & Natural');
  });
});

describe('resolveVisibleBookingCategory — representative service matrix', () => {
  // Real production shapes: the authoritative bookingCategory wins.
  const matrix = [
    { name: 'Luster Manicure', category: 'manicure', bookingCategory: 'manicure', expected: 'manicure' },
    { name: 'Builder Gel Overlay', category: 'builder_gel', bookingCategory: 'manicure', expected: 'manicure' },
    { name: 'Russian Manicure', category: 'manicure', bookingCategory: 'manicure', expected: 'manicure' },
    { name: 'Gel-X Extensions', category: 'extensions', bookingCategory: 'manicure', expected: 'manicure' },
    { name: 'Hard Gel Extensions', category: 'extensions', bookingCategory: 'manicure', expected: 'manicure' },
    { name: 'Gel Pedicure', category: 'pedicure', bookingCategory: 'pedicure', expected: 'pedicure' },
    { name: 'Shellac / Gel Toes', category: 'pedicure', bookingCategory: 'pedicure', expected: 'pedicure' },
    { name: 'Classic Manicure + Classic Pedicure', category: 'combo', bookingCategory: 'combo', expected: 'combo' },
    { name: 'BIAB / Builder Gel + Gel Pedicure', category: 'combo', bookingCategory: 'combo', expected: 'combo' },
  ] as const;

  it.each(matrix)('maps $name to $expected everywhere', ({ category, bookingCategory, expected }) => {
    expect(resolveVisibleBookingCategory({ category, bookingCategory })).toBe(expected);
  });

  it('derives from the legacy category when bookingCategory is missing', () => {
    // Pre-0056 rows only carry the 7-value category.
    expect(resolveVisibleBookingCategory({ category: 'builder_gel', bookingCategory: null })).toBe('manicure');
    expect(resolveVisibleBookingCategory({ category: 'extensions', bookingCategory: null })).toBe('manicure');
    expect(resolveVisibleBookingCategory({ category: 'hands', bookingCategory: null })).toBe('manicure');
    expect(resolveVisibleBookingCategory({ category: 'feet', bookingCategory: null })).toBe('pedicure');
    expect(resolveVisibleBookingCategory({ category: 'pedicure', bookingCategory: null })).toBe('pedicure');
    expect(resolveVisibleBookingCategory({ category: 'combo', bookingCategory: null })).toBe('combo');
  });

  it('never throws on unknown or malformed records', () => {
    expect(resolveVisibleBookingCategory({ category: 'not_a_category', bookingCategory: null })).toBe('manicure');
    expect(resolveVisibleBookingCategory({ category: '', bookingCategory: undefined })).toBe('manicure');
    // A bogus bookingCategory falls back to the legacy derivation.
    expect(resolveVisibleBookingCategory({
      category: 'pedicure',
      bookingCategory: 'nonsense' as never,
    })).toBe('pedicure');
  });

  it('agrees with deriveBookingCategory for every legacy category value', () => {
    for (const category of ['manicure', 'builder_gel', 'extensions', 'pedicure', 'hands', 'feet', 'combo'] as const) {
      expect(resolveVisibleBookingCategory({ category, bookingCategory: null }))
        .toBe(deriveBookingCategory(category));
    }
  });
});

describe('service library shelves', () => {
  it('exposes only Popular, Manicure, Pedicure, Combos, and Add-ons', () => {
    expect(LIBRARY_SHELVES).toEqual(['popular', 'manicure', 'pedicure', 'combo', 'addon']);
    expect(LIBRARY_SHELVES.map(shelf => LIBRARY_SHELF_LABELS[shelf]))
      .toEqual(['Popular', 'Manicure', 'Pedicure', 'Combos', 'Add-ons']);
  });

  it('places every catalog template on exactly one non-popular shelf', () => {
    const shelves = LIBRARY_SHELVES.filter(shelf => shelf !== 'popular');
    const seen = new Map<string, number>();
    for (const shelf of shelves) {
      for (const template of getTemplatesByShelf(shelf)) {
        seen.set(template.systemKey, (seen.get(template.systemKey) ?? 0) + 1);
      }
    }

    expect(seen.size).toBe(SERVICE_TEMPLATES.length);
    expect([...seen.values()].every(count => count === 1)).toBe(true);
  });

  it('routes add-on templates to the Add-ons shelf and never to a base shelf', () => {
    const addOnShelf = getTemplatesByShelf('addon');

    expect(addOnShelf.every(template => template.serviceType === 'addon')).toBe(true);
    expect(getTemplatesByShelf('manicure').some(template => template.serviceType === 'addon')).toBe(false);
    expect(getTemplatesByShelf('pedicure').some(template => template.serviceType === 'addon')).toBe(false);
    expect(getTemplatesByShelf('combo').some(template => template.serviceType === 'addon')).toBe(false);

    // Representative add-ons the salon actually has.
    for (const key of ['chrome', 'nail_repair', 'french_tips', 'gel_removal']) {
      const template = SERVICE_TEMPLATES.find(candidate => candidate.systemKey === key);

      expect(template).toBeDefined();
      expect(getTemplateShelf(template!)).toBe('addon');
    }
  });

  it('keeps base-service shelves aligned with the booking category clients see', () => {
    for (const shelf of ['manicure', 'pedicure', 'combo'] as const) {
      for (const template of getTemplatesByShelf(shelf)) {
        expect(resolveVisibleBookingCategory({
          category: template.serviceCategory,
          bookingCategory: template.bookingCategory,
        })).toBe(shelf);
      }
    }
  });
});
