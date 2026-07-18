import { describe, expect, it } from 'vitest';

import {
  getStarterTemplates,
  getTemplateByKey,
  getTemplatesByLibraryCategory,
  searchTemplates,
  SERVICE_TEMPLATES,
} from './serviceTemplateCatalog';

describe('serviceTemplateCatalog', () => {
  it('has globally unique system keys', () => {
    const keys = SERVICE_TEMPLATES.map(template => template.systemKey);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('contains the recommended starter menu: 14 services and 16 add-ons, Luster first', () => {
    const starters = getStarterTemplates();
    const services = starters.filter(template => template.serviceType !== 'addon');
    const addOns = starters.filter(template => template.serviceType === 'addon');

    expect(services).toHaveLength(14);
    expect(addOns).toHaveLength(16);
    expect(services[0]?.systemKey).toBe('luster_manicure');
    expect(services[0]?.defaultPriceCents).toBe(4500);
    expect(services[0]?.defaultDurationMinutes).toBe(60);
  });

  it('never marks acrylic or dip templates as recommended starters', () => {
    const acrylicStarters = SERVICE_TEMPLATES.filter(
      template => template.templateCategory === 'acrylic_dip' && template.isRecommendedStarter,
    );

    expect(acrylicStarters).toEqual([]);
    // The shelf itself still exists in the library.
    expect(getTemplatesByLibraryCategory('acrylic_dip').length).toBeGreaterThan(10);
  });

  it('curates Popular as a rank-sorted view over the same records, not duplicates', () => {
    const popular = getTemplatesByLibraryCategory('popular');

    expect(popular.length).toBe(12);
    expect(popular[0]?.systemKey).toBe('luster_manicure');

    // Same object references as the master list — no duplicate records.
    for (const template of popular) {
      expect(getTemplateByKey(template.systemKey)).toBe(template);
    }
  });

  it('finds builder gel templates when searching BIAB and vice versa', () => {
    const biab = searchTemplates('BIAB').map(template => template.systemKey);
    const builderGel = searchTemplates('builder gel').map(template => template.systemKey);

    expect(biab).toContain('builder_gel_overlay');
    expect(builderGel).toContain('builder_gel_overlay');
  });

  it('finds gel polish services when searching shellac, and tip services when searching tips', () => {
    const shellac = searchTemplates('shellac').map(template => template.systemKey);
    const tips = searchTemplates('tips').map(template => template.systemKey);

    expect(shellac).toContain('gel_manicure');
    expect(shellac).toContain('shellac_gel_toes');
    expect(tips).toContain('gel_x_extensions');
    expect(tips).toContain('acrylic_full_set_short');
  });

  it('gives every add-on template an add-on category and every combo the combo booking category', () => {
    for (const template of SERVICE_TEMPLATES) {
      if (template.serviceType === 'addon') {
        expect(template.addOnCategory, template.systemKey).toBeTruthy();
      }
      if (template.serviceType === 'combo') {
        expect(template.bookingCategory, template.systemKey).toBe('combo');
      }
    }
  });
});
