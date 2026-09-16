import 'server-only';

import { getBookingConfigForSalon } from '@/libs/bookingConfig';
import { getAllAddOnsBySalonId, getServicesBySalonIdIncludingInactive } from '@/libs/queries';
import { getPublicBookableServiceIds } from '@/libs/serviceAssignments';

import type { ListServicesResult } from '../contracts';

/**
 * `list_services` (docs/OWNER_ASSISTANT_CHAT.md §3.3).
 *
 * The owner's own menu. `bookable` is the honest public answer, taken from the
 * same `getPublicBookableServiceIds` the booking page uses:
 *   - no ACTIVE technician  ⇒ nothing is bookable, and the result says why;
 *   - no assignment rows at all ⇒ legacy unrestricted salon, every active
 *     service is bookable;
 *   - otherwise ⇒ only assigned-and-enabled services.
 * An inactive service is never bookable regardless.
 *
 * Add-ons come from the same query `GET /api/salon/add-ons` serves, so the
 * assistant and the Add-ons tab cannot disagree.
 */
export async function listServices(
  salonId: string,
  args: { includeInactive: boolean },
): Promise<ListServicesResult> {
  const [services, addOns, bookableIds, bookingConfig] = await Promise.all([
    getServicesBySalonIdIncludingInactive(salonId),
    getAllAddOnsBySalonId(salonId),
    getPublicBookableServiceIds(salonId),
    getBookingConfigForSalon(salonId),
  ]);

  const noActiveTechnicians = bookableIds !== null && bookableIds.size === 0;
  const childParentIds = new Set(
    services
      .map(service => service.parentServiceId)
      .filter((parentId): parentId is string => Boolean(parentId)),
  );

  const visibleServices = args.includeInactive
    ? services
    : services.filter(service => service.isActive === true);
  const visibleAddOns = args.includeInactive
    ? addOns
    : addOns.filter(addOn => addOn.isActive === true);

  return {
    currency: bookingConfig.currency,
    ...(noActiveTechnicians ? { note: 'no_active_technicians' as const } : {}),
    services: visibleServices.map(service => ({
      id: service.id,
      name: service.name,
      priceCents: service.price,
      priceDisplayText: service.priceDisplayText,
      durationMinutes: service.durationMinutes,
      category: service.category,
      isActive: service.isActive === true,
      bookable: service.isActive === true
        && (bookableIds === null || bookableIds.has(service.id)),
      hasVariants: childParentIds.has(service.id),
      isIntroPrice: service.isIntroPrice === true,
    })),
    addOns: visibleAddOns.map(addOn => ({
      id: addOn.id,
      name: addOn.name,
      priceCents: addOn.priceCents,
      durationMinutes: addOn.durationMinutes,
      category: addOn.category,
      pricingType: addOn.pricingType,
      isActive: addOn.isActive === true,
    })),
  };
}
