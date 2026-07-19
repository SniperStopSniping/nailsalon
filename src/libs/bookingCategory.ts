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
