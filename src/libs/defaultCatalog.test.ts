import { describe, expect, it } from 'vitest';

import { getDefaultComboCatalogTemplate } from './defaultCatalog';

describe('default combo catalog template', () => {
  it('includes the six launch combo services with combo-only small add-on mappings', () => {
    const template = getDefaultComboCatalogTemplate();

    expect(template.services.map(service => service.slug)).toEqual([
      'biab-classic-pedicure',
      'biab-lavender-spa-pedicure',
      'biab-deluxe-lavender-pedicure',
      'gel-x-hard-gel-extensions-classic-pedicure',
      'gel-x-hard-gel-extensions-lavender-spa-pedicure',
      'gel-x-hard-gel-extensions-deluxe-lavender-pedicure',
    ]);

    expect(template.services.every(service => service.category === 'combo')).toBe(true);

    const comboMappingPairs = template.serviceAddOns.map(mapping => ({
      serviceSlug: mapping.serviceSlug,
      addOnSlug: mapping.addOnSlug,
    }));

    expect(comboMappingPairs).toContainEqual({
      serviceSlug: 'biab-classic-pedicure',
      addOnSlug: 'simple-nail-art',
    });
    expect(comboMappingPairs).toContainEqual({
      serviceSlug: 'gel-x-hard-gel-extensions-deluxe-lavender-pedicure',
      addOnSlug: 'nail-repair',
    });
    expect(comboMappingPairs.some(mapping => mapping.addOnSlug === 'gel-removal')).toBe(false);
    expect(comboMappingPairs.some(mapping => mapping.addOnSlug === 'extensions-removal')).toBe(false);
    expect(comboMappingPairs.some(mapping => mapping.addOnSlug === 'add-gel-polish')).toBe(false);
  });
});
