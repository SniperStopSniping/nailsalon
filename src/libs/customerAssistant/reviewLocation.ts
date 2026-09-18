import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import { buildDirectionsDestination, type DirectionsLocation, resolveDirectionsLocation } from '@/libs/directions';
import { applyLocationDisplayMode } from '@/libs/salonContent';

export function resolveCustomerReviewLocation(salon: DirectionsLocation & { name: string; settings?: unknown }, location: (DirectionsLocation & { name: string }) | null) {
  const source = resolveDirectionsLocation(location) ?? (buildDirectionsDestination(salon)
    ? { name: salon.name, address: salon.address ?? null, city: salon.city ?? null, state: salon.state ?? null, zipCode: salon.zipCode ?? null }
    : null);
  return source
    ? applyLocationDisplayMode({
      name: source.name,
      address: source.address ?? null,
      city: source.city ?? null,
      state: source.state ?? null,
      zipCode: source.zipCode ?? null,
    }, resolveBookingPageContent(salon.settings).live.locationDisplayMode)
    : null;
}
