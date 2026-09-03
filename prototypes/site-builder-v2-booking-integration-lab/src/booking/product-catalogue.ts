import { getTemplateByKey } from '../../../../src/libs/serviceTemplateCatalog';
import {
  ADD_ON_PRODUCTION_MAPPINGS,
  SERVICE_MENU_PRODUCTION_MAPPINGS,
} from '../onboarding/integrations/contracts/service-menu-production-mapping';
import type { MockAddOn, MockService } from './types';

/** A read-only projection of the same templates used by the real owner Workspace. */
export function connectProductServiceCatalogue(
  acceptedServices: readonly MockService[],
): readonly MockService[] {
  const acceptedIds = new Set(acceptedServices.map(service => service.id));
  const addOnIdByTemplateKey = new Map(ADD_ON_PRODUCTION_MAPPINGS.map(mapping => [
    mapping.productionCanonicalId,
    mapping.labServiceId,
  ]));
  return [
    ...acceptedServices,
    ...SERVICE_MENU_PRODUCTION_MAPPINGS.flatMap((mapping): MockService[] => {
      if (acceptedIds.has(mapping.labServiceId)) return [];
      const template = getTemplateByKey(mapping.productionCanonicalId);
      if (!template || template.serviceType === 'addon') return [];
      return [{
        category: template.bookingCategory === 'combo'
          ? 'combos'
          : template.bookingCategory === 'pedicure'
            ? 'pedicure'
            : template.systemKey.startsWith('gel_x')
              ? 'gel_x'
              : template.serviceCategory === 'builder_gel' || template.serviceCategory === 'extensions'
                ? 'builder_gel'
                : 'manicure',
        compatibleAddOnIds: (template.compatibleAddOnKeys ?? []).flatMap((key) => {
          const id = addOnIdByTemplateKey.get(key);
          return id ? [id] : [];
        }),
        durationMinutes: template.defaultDurationMinutes,
        // Adding library choices must not silently opt existing drafts into more services.
        featured: false,
        id: mapping.labServiceId,
        // Templates do not own tenant-uploaded images. Existing accepted photos stay intact.
        image: null,
        longDescription: template.description,
        name: template.name,
        price: {
          amountCents: template.defaultPriceCents,
          behavior: template.priceDisplayText ? 'starts_at' : 'fixed',
        },
        shortDescription: template.description,
      }];
    }),
  ];
}

export function connectProductAddOnCatalogue(
  acceptedAddOns: readonly MockAddOn[],
): readonly MockAddOn[] {
  const acceptedIds = new Set(acceptedAddOns.map(addOn => addOn.id));
  return [
    ...acceptedAddOns,
    ...ADD_ON_PRODUCTION_MAPPINGS.flatMap((mapping): MockAddOn[] => {
      if (acceptedIds.has(mapping.labServiceId)) return [];
      const template = getTemplateByKey(mapping.productionCanonicalId);
      if (!template || template.serviceType !== 'addon') return [];
      return [{
        durationMinutes: template.defaultDurationMinutes,
        id: mapping.labServiceId,
        name: template.name,
        priceCents: template.defaultPriceCents,
      }];
    }),
  ];
}
