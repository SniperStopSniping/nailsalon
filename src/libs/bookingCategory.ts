import type { BookingCategory, ServiceCategory } from '@/models/Schema';

/**
 * Maps a legacy admin service category to the client-facing booking category.
 * Mirrors the backfill CASE in migrations/0056_booking_category_luster_featuring.sql.
 */
export function deriveBookingCategory(category: ServiceCategory): BookingCategory {
  switch (category) {
    case 'pedicure':
    case 'feet':
      return 'pedicure';
    case 'combo':
      return 'combo';
    default:
      return 'manicure';
  }
}

export const BOOKING_CATEGORY_META: Record<BookingCategory, { label: string; icon: string }> = {
  manicure: { label: 'Manicure', icon: '💅' },
  pedicure: { label: 'Pedicure', icon: '🦶' },
  combo: { label: 'Combos', icon: '✨' },
};

/** The only main service categories any user-facing surface may show. */
export const VISIBLE_BOOKING_CATEGORIES: BookingCategory[] = ['manicure', 'pedicure', 'combo'];

/**
 * Canonical visible group for any service-shaped record — the single rule
 * shared by public booking, the owner menu, technician views, and the
 * Service Library so surfaces cannot drift. Prefers the authoritative
 * bookingCategory column; derives from the legacy category only for records
 * that predate it. Unknown or malformed values fall back to 'manicure'
 * (deriveBookingCategory's default arm) instead of throwing.
 */
export function resolveVisibleBookingCategory(service: {
  bookingCategory?: BookingCategory | null;
  category: ServiceCategory | string;
}): BookingCategory {
  if (service.bookingCategory && BOOKING_CATEGORY_META[service.bookingCategory]) {
    return service.bookingCategory;
  }
  return deriveBookingCategory(service.category as ServiceCategory);
}
