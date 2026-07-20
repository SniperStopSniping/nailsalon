import type { AddOn } from '@/models/Schema';
import type { AddOnResponse } from '@/types/admin';

/**
 * Shared admin add-on serializer. Lives outside the route files because
 * Next.js only allows route handlers (GET/POST/…) to be exported from them.
 */
export function buildAddOnPayload(addOn: AddOn): AddOnResponse {
  return {
    id: addOn.id,
    name: addOn.name,
    slug: addOn.slug ?? '',
    descriptionItems: addOn.descriptionItems ?? null,
    priceCents: addOn.priceCents,
    priceDisplayText: addOn.priceDisplayText ?? null,
    durationMinutes: addOn.durationMinutes,
    category: addOn.category,
    pricingType: addOn.pricingType,
    unitLabel: addOn.unitLabel ?? null,
    maxQuantity: addOn.maxQuantity ?? null,
    displayOrder: addOn.displayOrder ?? null,
    isActive: addOn.isActive,
  };
}
