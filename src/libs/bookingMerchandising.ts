import type { ServiceCategory } from '@/models/Schema';

export const LUSTER_MANICURE_TEMPLATE_KEY = 'luster_manicure';
export const LUSTER_PEDICURE_TEMPLATE_KEY = 'luster_pedicure';

/**
 * Luster's own services lead their category. Combos are deliberately excluded
 * — there is no Luster combo, only an optional product upgrade.
 */
export const LUSTER_LEAD_TEMPLATE_KEYS: Record<'manicure' | 'pedicure', string> = {
  manicure: LUSTER_MANICURE_TEMPLATE_KEY,
  pedicure: LUSTER_PEDICURE_TEMPLATE_KEY,
};

export const FEATURED_SERVICE_CATEGORY_PRIORITY: ServiceCategory[] = [
  'combo',
  'extensions',
  'builder_gel',
];

type MerchandisedService = {
  id: string;
  name: string;
  category: ServiceCategory;
  sortOrder?: number | null;
  featuredOrder?: number | null;
  templateKey?: string | null;
  isActive?: boolean | null;
};

type FeaturedOptions = {
  /** Salon setting "Feature Luster Manicure"; defaults to enabled. */
  lusterFeaturingEnabled?: boolean;
};

function compareBaseline(serviceA: MerchandisedService, serviceB: MerchandisedService): number {
  const sortOrder = (serviceA.sortOrder ?? Number.MAX_SAFE_INTEGER)
    - (serviceB.sortOrder ?? Number.MAX_SAFE_INTEGER);
  if (sortOrder !== 0) {
    return sortOrder;
  }

  const nameOrder = serviceA.name.localeCompare(serviceB.name, 'en', { sensitivity: 'base' });
  if (nameOrder !== 0) {
    return nameOrder;
  }

  return serviceA.id.localeCompare(serviceB.id, 'en');
}

/**
 * Orders one visible category for display. Luster's own service leads its
 * category whenever it is active; everything else keeps the salon's own
 * sortOrder. Combos never get a forced leader — there is no Luster combo.
 */
export function sortServicesForCategory<
  T extends MerchandisedService & { bookingCategory?: string | null },
>(services: T[], bookingCategory: 'manicure' | 'pedicure' | 'combo'): T[] {
  const leadKey = bookingCategory === 'combo'
    ? null
    : LUSTER_LEAD_TEMPLATE_KEYS[bookingCategory];

  return [...services].sort((serviceA, serviceB) => {
    if (leadKey) {
      const aLeads = serviceA.templateKey === leadKey && serviceA.isActive !== false;
      const bLeads = serviceB.templateKey === leadKey && serviceB.isActive !== false;
      if (aLeads !== bLeads) {
        return aLeads ? -1 : 1;
      }
    }
    return compareBaseline(serviceA, serviceB);
  });
}

/**
 * Ordered featured services for the booking page:
 * 1. The active Luster Manicure, then the active Luster Pedicure, when the
 *    salon has featuring enabled. There is deliberately no Luster combo.
 * 2. Manually featured services (featuredOrder ascending).
 * 3. Category heuristic fallback (combo → extensions → builder_gel).
 * Deduped by id; inactive services are never featured; no placeholders.
 */
export function getFeaturedServices<T extends MerchandisedService>(
  services: T[],
  options: FeaturedOptions = {},
): T[] {
  const active = services.filter(service => service.isActive !== false);

  const lusterLeads = options.lusterFeaturingEnabled === false
    ? []
    : [LUSTER_MANICURE_TEMPLATE_KEY, LUSTER_PEDICURE_TEMPLATE_KEY]
        .map(key => active.filter(service => service.templateKey === key).sort(compareBaseline)[0])
        .filter((service): service is T => Boolean(service));

  const manual = active
    .filter(service => service.featuredOrder != null)
    .sort((serviceA, serviceB) => {
      const positionOrder = (serviceA.featuredOrder ?? 0) - (serviceB.featuredOrder ?? 0);
      if (positionOrder !== 0) {
        return positionOrder;
      }
      return compareBaseline(serviceA, serviceB);
    });

  const categoryPriority = new Map(
    FEATURED_SERVICE_CATEGORY_PRIORITY.map((category, index) => [category, index]),
  );
  const fallback = active
    .filter(service => categoryPriority.has(service.category))
    .slice()
    .sort((serviceA, serviceB) => {
      const categoryOrder = (categoryPriority.get(serviceA.category) ?? Number.MAX_SAFE_INTEGER)
        - (categoryPriority.get(serviceB.category) ?? Number.MAX_SAFE_INTEGER);
      if (categoryOrder !== 0) {
        return categoryOrder;
      }
      return compareBaseline(serviceA, serviceB);
    });

  const featured: T[] = [];
  const seen = new Set<string>();
  for (const service of [...lusterLeads, ...manual, ...fallback]) {
    if (!seen.has(service.id)) {
      seen.add(service.id);
      featured.push(service);
    }
  }

  return featured;
}
