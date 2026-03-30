import type { ServiceCategory } from '@/models/Schema';

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
};

export function getFeaturedServices<T extends MerchandisedService>(services: T[]): T[] {
  const categoryPriority = new Map(
    FEATURED_SERVICE_CATEGORY_PRIORITY.map((category, index) => [category, index]),
  );

  return services
    .filter(service => categoryPriority.has(service.category))
    .slice()
    .sort((serviceA, serviceB) => {
      const categoryOrder = (categoryPriority.get(serviceA.category) ?? Number.MAX_SAFE_INTEGER)
        - (categoryPriority.get(serviceB.category) ?? Number.MAX_SAFE_INTEGER);
      if (categoryOrder !== 0) {
        return categoryOrder;
      }

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
    });
}
