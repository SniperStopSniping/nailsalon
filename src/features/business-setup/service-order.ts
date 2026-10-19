type OrderedService = { id: string; sortOrder: number | null; createdAt: Date | null };

/** Match the original catalog's sort_order/created_at, leaving lock/hash rows intact. */
export function setupServiceDisplayOrder<T extends OrderedService>(services: T[]): T[] {
  return [...services].sort((a, b) => {
    const orderA = a.sortOrder ?? Number.POSITIVE_INFINITY;
    const orderB = b.sortOrder ?? Number.POSITIVE_INFINITY;
    if (orderA !== orderB) {
      return orderA < orderB ? -1 : 1;
    }
    const createdA = a.createdAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const createdB = b.createdAt?.getTime() ?? Number.POSITIVE_INFINITY;
    return createdA === createdB ? a.id.localeCompare(b.id) : createdA < createdB ? -1 : 1;
  });
}
