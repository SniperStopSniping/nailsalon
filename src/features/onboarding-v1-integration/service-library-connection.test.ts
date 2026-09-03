import { getTemplateByKey, SERVICE_TEMPLATES } from '@/libs/serviceTemplateCatalog';

import { CANONICAL_SERVICES, MOCK_ADD_ONS } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/booking/data';
import { serviceMenuPort } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/integrations/adapters/service-menu';
import {
  ADD_ON_PRODUCTION_MAPPINGS,
  SERVICE_MENU_PRODUCTION_MAPPINGS,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/integrations/contracts/service-menu-production-mapping';
import { createOnboardingBookingFixture } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/booking-preview';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';

describe('onboarding connection to the full Product Service Library', () => {
  it('exposes every current service and add-on template, not only the starter set', () => {
    const services = serviceMenuPort.getLibraryServices();
    const addOns = serviceMenuPort.getLibraryAddOns();

    for (const template of SERVICE_TEMPLATES) {
      const mappings = template.serviceType === 'addon'
        ? ADD_ON_PRODUCTION_MAPPINGS
        : SERVICE_MENU_PRODUCTION_MAPPINGS;
      const items = template.serviceType === 'addon' ? addOns : services;
      const mapping = mappings.find(item => (
        item.mappingKind === 'exact_template'
        && item.productionCanonicalId === template.systemKey
      ));

      expect(mapping, template.systemKey).toBeDefined();
      expect(items.some(item => item.id === mapping?.labServiceId), template.systemKey).toBe(true);
    }

    expect(services.some(item => item.id === 'svc-template-luster_manicure')).toBe(true);
    expect(services.some(item => item.id === 'svc-template-acrylic_full_set_extra_long')).toBe(true);
    expect(addOns.some(item => item.id === 'addon-template-toenail_repair')).toBe(true);
    expect(new Set(services.map(item => item.id)).size).toBe(services.length);
    expect(new Set(addOns.map(item => item.id)).size).toBe(addOns.length);
  });

  it('preserves accepted draft IDs, overrides, defaults and original service photos', () => {
    const defaults = serviceMenuPort.createDefaultSelection();
    const draft = {
      ...defaults,
      ownerOverridesByServiceId: { 'svc-manicure-gel': { durationMinutes: 75, priceCents: 6700 } },
      reviewed: true,
      selectedAddOnIds: ['addon-french'],
      selectedServiceIds: ['svc-manicure-gel'],
    };

    expect(defaults.selectedServiceIds).toEqual([
      'svc-manicure-russian',
      'svc-manicure-gel',
      'svc-builder-overlay',
      'svc-gelx-full-set',
      'svc-pedicure-spa',
      'svc-combo-gel',
    ]);
    expect(defaults.selectedAddOnIds).toEqual([
      'addon-french',
      'addon-chrome',
      'addon-simple-art',
      'addon-detailed-art',
    ]);
    expect(serviceMenuPort.normalizeSelection(draft)).toEqual(draft);
    expect(CANONICAL_SERVICES.find(item => item.id === 'svc-manicure-gel')).toMatchObject({
      durationMinutes: 60,
      image: { src: '/assets/images/services/manicure-gel-nude.webp' },
      price: { amountCents: 5000, behavior: 'fixed' },
    });
  });

  it('uses Product prices and compatibility for newly available selections in customer preview', () => {
    const state = createDefaultOnboardingState();
    state.profile.serviceMenu = {
      ownerOverridesByServiceId: {},
      selectedAddOnIds: ['addon-template-french_toes', 'addon-template-toenail_repair'],
      selectedServiceIds: ['svc-template-shellac_gel_toes'],
    };
    const fixture = createOnboardingBookingFixture(state.profile);
    const template = getTemplateByKey('shellac_gel_toes')!;
    const service = fixture.services[0]!;

    expect(fixture.services).toHaveLength(1);
    expect(service).toMatchObject({
      durationMinutes: template.defaultDurationMinutes,
      id: 'svc-template-shellac_gel_toes',
      image: null,
      name: template.name,
      price: { amountCents: template.defaultPriceCents, behavior: 'fixed' },
    });
    expect(fixture.addOns.map(item => item.id)).toEqual(state.profile.serviceMenu.selectedAddOnIds);
    expect(service.compatibleAddOnIds).toContain('addon-template-french_toes');
    expect(service.compatibleAddOnIds).not.toContain('addon-french');
    expect(service.compatibleAddOnIds).not.toContain('addon-template-callus_treatment');
    expect(service.compatibleAddOnIds.every(id => MOCK_ADD_ONS.some(addOn => addOn.id === id))).toBe(true);
    expect(serviceMenuPort.getLibraryAddOns().find(item => item.id === 'addon-template-toenail_repair'))
      .toMatchObject({ categoryLabel: 'Repair', priceLabel: '$5 per nail' });
  });
});
