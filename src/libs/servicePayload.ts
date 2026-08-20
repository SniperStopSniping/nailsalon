import type { Service } from '@/models/Schema';
import type { ServiceResponse } from '@/types/admin';

/**
 * Shared admin service serializer, mirroring `addOnPayload.ts`'s role for
 * add-ons. Lives outside route files because Next.js only allows route
 * handlers (GET/POST/PATCH/…) to be exported from them, and both
 * `services/route.ts` and `services/[id]/route.ts` need the identical shape
 * — including the Luster L1 fields (dark; migrations 0072/0073), which are
 * raw stored columns, never re-derived or defaulted here. A legacy service
 * has NULL in every one of them and this function does not change that.
 */
export function buildServicePayload(service: Service): ServiceResponse {
  return {
    id: service.id,
    name: service.name,
    slug: service.slug ?? null,
    description: service.description,
    descriptionItems: service.descriptionItems ?? null,
    price: service.price,
    priceDisplayText: service.priceDisplayText ?? null,
    durationMinutes: service.durationMinutes,
    preparationBufferMinutes: service.preparationBufferMinutes,
    cleanupBufferMinutes: service.cleanupBufferMinutes,
    category: service.category,
    bookingCategory: service.bookingCategory,
    templateKey: service.templateKey ?? null,
    imageUrl: service.imageUrl,
    sortOrder: service.sortOrder,
    featuredOrder: service.featuredOrder ?? null,
    isActive: service.isActive,
    isIntroPrice: service.isIntroPrice ?? false,
    introPriceLabel: service.introPriceLabel ?? null,
    introPriceExpiresAt: service.introPriceExpiresAt
      ? service.introPriceExpiresAt.toISOString()
      : null,
    parentServiceId: service.parentServiceId ?? null,
    variantLabel: service.variantLabel ?? null,
    variantKind: service.variantKind ?? null,
    selectionMode: (service.selectionMode as 'direct' | 'guided' | null) ?? null,
    confirmationMode: (service.confirmationMode as ServiceResponse['confirmationMode']) ?? null,
  };
}
