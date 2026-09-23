import { type BookingBasket, buildBookingUrl } from '@/libs/bookingParams';

/**
 * Adds calendar weeks to a salon-local YYYY-MM-DD key. This intentionally
 * operates on a date-only value: adding seven days across daylight-saving
 * changes must keep the customer's local calendar day, not add 168 hours.
 */
export function addCalendarWeeks(date: string, weeks: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(weeks)) {
    throw new Error('INVALID_REBOOKING_DATE');
  }
  const [year, month, day] = date.split('-').map(Number);
  const sourceDate = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    sourceDate.getUTCFullYear() !== year
    || sourceDate.getUTCMonth() !== month! - 1
    || sourceDate.getUTCDate() !== day!
  ) {
    // Date.UTC normalizes impossible dates (for example 2026-02-30), so
    // reject them rather than silently moving the recommendation.
    throw new Error('INVALID_REBOOKING_DATE');
  }
  const calendarDate = new Date(Date.UTC(year!, month! - 1, day! + weeks * 7));
  return [
    calendarDate.getUTCFullYear(),
    String(calendarDate.getUTCMonth() + 1).padStart(2, '0'),
    String(calendarDate.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function buildConfirmationRebookingUrl(args: {
  salonSlug: string;
  locale: string;
  bookingBasket: BookingBasket;
  locationId: string | null;
  technicianId: string | null;
  suggestedDate: string;
}): string {
  return buildBookingUrl('/book/time', {
    bookingBasket: args.bookingBasket,
    locationId: args.locationId,
    techId: args.technicianId,
    date: args.suggestedDate,
  }, {
    routeSalonSlug: args.salonSlug,
    locale: args.locale,
  });
}

export function buildConfirmationRebookingFallbackUrl(args: {
  salonSlug: string;
  locale: string;
  locationId: string | null;
  rebookingFallback: 'catalogue_changed';
  bookingBasket?: BookingBasket | null;
}): string {
  return buildBookingUrl('/book/service', {
    locationId: args.locationId,
    rebookingFallback: args.rebookingFallback,
    bookingBasket: args.bookingBasket,
  }, {
    routeSalonSlug: args.salonSlug,
    locale: args.locale,
  });
}
