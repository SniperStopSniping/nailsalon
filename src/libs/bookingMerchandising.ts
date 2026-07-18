import type { ServiceCategory } from '@/models/Schema';

export const LUSTER_MANICURE_TEMPLATE_KEY = 'luster_manicure';

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
 * Ordered featured services for the booking page:
 * 1. The active Luster Manicure service, when the salon has featuring enabled.
 * 2. Manually featured services (featuredOrder ascending).
 * 3. Category heuristic fallback (combo → extensions → builder_gel).
 * Deduped by id; inactive services are never featured; no placeholders.
 */
export function getFeaturedServices<T extends MerchandisedService>(
  services: T[],
  options: FeaturedOptions = {},
): T[] {
  const active = services.filter(service => service.isActive !== false);

  const luster = options.lusterFeaturingEnabled === false
    ? null
    : active
      .filter(service => service.templateKey === LUSTER_MANICURE_TEMPLATE_KEY)
      .sort(compareBaseline)[0] ?? null;

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
  for (const service of [...(luster ? [luster] : []), ...manual, ...fallback]) {
    if (!seen.has(service.id)) {
      seen.add(service.id);
      featured.push(service);
    }
  }

  return featured;
}
