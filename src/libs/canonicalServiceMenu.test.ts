/**
 * Canonical service/add-on menu contract.
 *
 * These pin the customer-visible outcomes reported as broken in production:
 * services with missing or incompatible add-ons, Shellac / Gel Toes offering
 * only a removal, and Luster not leading its category.
 */
import { describe, expect, it } from 'vitest';

import { getFeaturedServices, sortServicesForCategory } from '@/libs/bookingMerchandising';
import { getTemplateByKey, SERVICE_TEMPLATES } from '@/libs/serviceTemplateCatalog';

function addOnKeys(serviceKey: string): string[] {
  const template = getTemplateByKey(serviceKey);
  if (!template) {
    throw new Error(`Missing template: ${serviceKey}`);
  }
  return template.compatibleAddOnKeys ?? [];
}

describe('canonical service templates', () => {
  it.each([
    ['luster_manicure', 5500, 60, 'manicure'],
    ['gel_manicure', 4500, 60, 'manicure'],
    ['russian_manicure_no_colour', 4500, 60, 'manicure'],
    ['builder_gel_overlay', 6500, 90, 'manicure'],
    ['builder_gel_refill', 5000, 90, 'manicure'],
    ['luster_pedicure', 6500, 75, 'pedicure'],
    ['classic_pedicure', 5000, 60, 'pedicure'],
    ['gel_pedicure', 5500, 60, 'pedicure'],
    ['shellac_gel_toes', 3000, 45, 'pedicure'],
  ])('%s has the canonical price, duration and category', (key, cents, minutes, category) => {
    const template = getTemplateByKey(key as string);

    expect(template).toBeDefined();
    expect(template!.defaultPriceCents).toBe(cents);
    expect(template!.defaultDurationMinutes).toBe(minutes);
    expect(template!.bookingCategory).toBe(category);
  });

  it('gives every canonical service a real description, never a generic placeholder', () => {
    for (const key of ['luster_manicure', 'luster_pedicure', 'gel_manicure', 'builder_gel_overlay', 'builder_gel_refill', 'russian_manicure_no_colour', 'classic_pedicure', 'gel_pedicure', 'shellac_gel_toes']) {
      const template = getTemplateByKey(key)!;

      expect(template.description, key).toBeTruthy();
      expect(template.description, key).not.toMatch(/bookable base service/i);
      expect(template.description!.length, key).toBeGreaterThan(30);
    }
  });

  it('keeps starting-price display text alongside a real numeric price', () => {
    for (const template of SERVICE_TEMPLATES) {
      if (template.priceDisplayText) {
        expect(template.defaultPriceCents, template.systemKey).toBeGreaterThan(0);
      }
    }
  });
});

describe('service → add-on compatibility', () => {
  it('gives Builder Gel Overlay its full add-on set including builder removal', () => {
    const keys = addOnKeys('builder_gel_overlay');

    for (const expected of ['french_tips', 'chrome', 'cat_eye', 'simple_nail_art', 'detailed_nail_art', 'three_d_art_charms', 'nail_repair', 'builder_gel_removal', 'removal_from_another_salon', 'russian_cuticle_upgrade', 'paraffin_hands', 'extended_hand_massage', 'special_shape', 'luster_product_upgrade']) {
      expect(keys, expected).toContain(expected);
    }
  });

  it('gives BIAB Refill the refill-safe set — no routine full removal', () => {
    const keys = addOnKeys('builder_gel_refill');

    expect(keys).toContain('removal_from_another_salon');
    expect(keys).toContain('major_reshape');
    expect(keys).toContain('nail_repair');
    // A refill must not advertise removing the very set being refilled.
    expect(keys).not.toContain('builder_gel_removal');
    expect(keys).not.toContain('gel_removal');
  });

  it('limits Russian Manicure — No Colour to non-design add-ons', () => {
    const keys = addOnKeys('russian_manicure_no_colour');

    expect(keys).toContain('add_gel_colour');
    expect(keys).toContain('nail_repair');

    for (const design of ['french_tips', 'chrome', 'cat_eye', 'simple_nail_art', 'detailed_nail_art', 'three_d_art_charms']) {
      expect(keys, design).not.toContain(design);
    }
  });

  it('gives Shellac / Gel Toes the full toe set it was missing', () => {
    const keys = addOnKeys('shellac_gel_toes');

    for (const expected of ['french_toes', 'chrome_toes', 'cat_eye_toes', 'simple_toe_art', 'detailed_toe_art', 'three_d_toe_art_charms', 'toenail_repair', 'gel_removal_toes', 'outside_salon_removal_toes']) {
      expect(keys, expected).toContain(expected);
    }
  });

  it('keeps full-pedicure treatments off polish-only toe services', () => {
    const keys = addOnKeys('shellac_gel_toes');

    for (const treatment of ['callus_treatment', 'paraffin_wax', 'extended_foot_massage']) {
      expect(keys, treatment).not.toContain(treatment);
    }

    // …but a full pedicure does offer them.
    expect(addOnKeys('gel_pedicure')).toContain('callus_treatment');
    expect(addOnKeys('gel_pedicure')).toContain('paraffin_wax');
    expect(addOnKeys('gel_pedicure')).toContain('extended_foot_massage');
  });

  it('offers regular-polish pedicures French and simple art but never chrome or cat eye', () => {
    const keys = addOnKeys('classic_pedicure');

    expect(keys).toContain('french_toes');
    expect(keys).toContain('simple_toe_art');
    expect(keys).not.toContain('chrome_toes');
    expect(keys).not.toContain('cat_eye_toes');
  });

  it('never offers the Luster product upgrade on Luster services', () => {
    expect(addOnKeys('luster_manicure')).not.toContain('luster_product_upgrade');
    expect(addOnKeys('luster_pedicure')).not.toContain('luster_product_upgrade');
    // Regular gel services may upsell it.
    expect(addOnKeys('gel_manicure')).toContain('luster_product_upgrade');
  });

  it('never maps a hand service to toe add-ons or vice versa', () => {
    const toeOnly = ['french_toes', 'chrome_toes', 'cat_eye_toes', 'simple_toe_art', 'detailed_toe_art', 'three_d_toe_art_charms', 'toenail_repair', 'gel_removal_toes', 'outside_salon_removal_toes'];
    const handOnly = ['french_tips', 'chrome', 'cat_eye', 'simple_nail_art', 'detailed_nail_art', 'nail_repair', 'gel_removal'];

    for (const handService of ['luster_manicure', 'gel_manicure', 'builder_gel_overlay', 'builder_gel_refill']) {
      for (const toeKey of toeOnly) {
        expect(addOnKeys(handService), `${handService}/${toeKey}`).not.toContain(toeKey);
      }
    }
    for (const toeService of ['luster_pedicure', 'gel_pedicure', 'shellac_gel_toes', 'classic_pedicure']) {
      for (const handKey of handOnly) {
        expect(addOnKeys(toeService), `${toeService}/${handKey}`).not.toContain(handKey);
      }
    }
  });

  it('references only add-on templates that exist, and keeps repair per-unit', () => {
    const addOnTemplates = new Map(SERVICE_TEMPLATES.filter(t => t.serviceType === 'addon').map(t => [t.systemKey, t]));
    for (const template of SERVICE_TEMPLATES) {
      for (const key of template.compatibleAddOnKeys ?? []) {
        expect(addOnTemplates.has(key), `${template.systemKey} → ${key}`).toBe(true);
      }
    }

    for (const repairKey of ['nail_repair', 'toenail_repair']) {
      const repair = addOnTemplates.get(repairKey)!;

      expect(repair.pricingType).toBe('per_unit');
      expect(repair.unitLabel).toBe('nail');
      expect(repair.maxQuantity).toBe(10);
      expect(repair.defaultPriceCents).toBe(500);
    }
  });

  it('declares add-ons in a deterministic order', () => {
    const keys = addOnKeys('gel_pedicure');

    expect(keys.indexOf('french_toes')).toBeLessThan(keys.indexOf('toenail_repair'));
    expect(keys.indexOf('toenail_repair')).toBeLessThan(keys.indexOf('callus_treatment'));
    expect(new Set(keys).size, 'no duplicate add-ons').toBe(keys.length);
  });
});

describe('category ordering', () => {
  const services = [
    { id: 'a', name: 'Gel Manicure', category: 'manicure' as const, templateKey: 'gel_manicure', sortOrder: 1, bookingCategory: 'manicure' },
    { id: 'b', name: 'Luster Manicure', category: 'manicure' as const, templateKey: 'luster_manicure', sortOrder: 99, bookingCategory: 'manicure' },
    { id: 'c', name: 'Gel Pedicure', category: 'pedicure' as const, templateKey: 'gel_pedicure', sortOrder: 1, bookingCategory: 'pedicure' },
    { id: 'd', name: 'Luster Pedicure', category: 'pedicure' as const, templateKey: 'luster_pedicure', sortOrder: 99, bookingCategory: 'pedicure' },
  ];

  it('puts Luster Manicure first in Manicure even with a later sortOrder', () => {
    const ordered = sortServicesForCategory(services.filter(s => s.bookingCategory === 'manicure'), 'manicure');

    expect(ordered[0]?.templateKey).toBe('luster_manicure');
  });

  it('puts Luster Pedicure first in Pedicure even with a later sortOrder', () => {
    const ordered = sortServicesForCategory(services.filter(s => s.bookingCategory === 'pedicure'), 'pedicure');

    expect(ordered[0]?.templateKey).toBe('luster_pedicure');
  });

  it('does not force a Luster service to the front of Combos', () => {
    const combos = [
      { id: 'x', name: 'Gel Mani + Gel Pedi', category: 'combo' as const, templateKey: 'gel_mani_gel_pedi_combo', sortOrder: 10, bookingCategory: 'combo' },
      { id: 'y', name: 'Classic Mani + Classic Pedi', category: 'combo' as const, templateKey: 'classic_mani_classic_pedi_combo', sortOrder: 5, bookingCategory: 'combo' },
    ];
    const ordered = sortServicesForCategory(combos, 'combo');

    expect(ordered[0]?.templateKey).toBe('classic_mani_classic_pedi_combo');
    expect(SERVICE_TEMPLATES.some(t => t.serviceType === 'combo' && /luster/i.test(t.name) && t.systemKey.includes('luster_combo'))).toBe(false);
  });

  it('leaves an inactive Luster service out of the lead position', () => {
    const ordered = sortServicesForCategory([
      { id: 'a', name: 'Gel Manicure', category: 'manicure' as const, templateKey: 'gel_manicure', sortOrder: 1, bookingCategory: 'manicure', isActive: true },
      { id: 'b', name: 'Luster Manicure', category: 'manicure' as const, templateKey: 'luster_manicure', sortOrder: 99, bookingCategory: 'manicure', isActive: false },
    ], 'manicure');

    expect(ordered[0]?.templateKey).toBe('gel_manicure');
  });

  it('features Luster Manicure then Luster Pedicure, and no Luster combo', () => {
    const featured = getFeaturedServices([
      { id: 'c', name: 'Gel Pedicure', category: 'pedicure', templateKey: 'gel_pedicure', featuredOrder: 1 },
      { id: 'd', name: 'Luster Pedicure', category: 'pedicure', templateKey: 'luster_pedicure' },
      { id: 'b', name: 'Luster Manicure', category: 'manicure', templateKey: 'luster_manicure' },
    ], { lusterFeaturingEnabled: true });

    expect(featured[0]?.templateKey).toBe('luster_manicure');
    expect(featured[1]?.templateKey).toBe('luster_pedicure');
  });
});
