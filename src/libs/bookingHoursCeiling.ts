// Pure helper — no database import, so pages rendered in jsdom suites and the
// public booking time step can use it directly. `bookingPolicy` re-exports it
// for the API routes. (`import type` is erased at build time, so this does not
// pull `bookingPolicy`'s DB import into the client bundle.)
import type { BusinessHours } from '@/libs/bookingPolicy';

export type BookingHoursCeiling = {
  /** Location the booking is scoped to (`null` when the salon has none). */
  locationId: string | null;
  /** Opening hours the booked window must fit inside. */
  businessHours: BusinessHours;
  /** Which record supplied `businessHours` — for logging and tests. */
  source: 'location' | 'salon' | 'none';
};

/**
 * Opening hours are an authority for EVERY salon, not only for callers that
 * carry a `locationId`. Hours live in two places — the `salon` row and the
 * primary `salon_location` row (onboarding writes both; `PATCH
 * /api/admin/salon/information` mirrors both) — but only the location copy
 * used to be consulted, so a salon with no location row (or any request that
 * omitted `locationId`) got no hours check at all and could be booked on a day
 * the owner had marked closed.
 *
 * Resolution order, most specific first:
 *   1. the resolved location's own hours,
 *   2. the salon's hours (a location that never had hours mirrored into it
 *      still belongs to a salon whose owner set opening hours),
 *   3. nothing — the salon has published no hours anywhere, so the technician
 *      schedule stays the only bound (unchanged pre-existing behaviour).
 *
 * The caller resolves the location itself (query parameter, else the salon's
 * primary location) so this stays a pure function.
 */
export function resolveBookingHoursCeiling(args: {
  location?: { id: string; businessHours?: BusinessHours } | null;
  salonBusinessHours?: BusinessHours;
}): BookingHoursCeiling {
  const { location = null, salonBusinessHours = null } = args;
  const businessHours = location?.businessHours ?? salonBusinessHours ?? null;

  return {
    locationId: location?.id ?? null,
    businessHours,
    source: businessHours === null
      ? 'none'
      : location?.businessHours
        ? 'location'
        : 'salon',
  };
}
