import 'server-only';

import type { BookingConfig } from '@/libs/bookingConfig.shared';
import { resolveBookingExperience } from '@/libs/bookingExperience';
import type { SalonSettings } from '@/types/salonPolicy';

import type { CustomSiteData } from './contracts';
import type { WebsiteDetails } from './website-details';

/** Server-side review comparison only. Dormant acknowledgment copy stays private. */
export function customSiteArtworkPolicy(settings: SalonSettings | null) {
  return resolveBookingExperience(settings, { includeAcknowledgmentConfiguration: true }).policy;
}

/** Presentation only: callers supply the original server-filtered booking catalog. */
export function customSiteDataFromLive(input: {
  salon: { name: string; city?: string | null; address?: string | null; businessHours?: CustomSiteData['business']['hours'] | null; settings: SalonSettings | null };
  content: { locationDisplayMode: string; bio?: string | null; websiteDetails?: WebsiteDetails };
  services: { id: string; name: string; description: string | null; priceCents: number; priceDisplayText?: string | null; durationMinutes: number }[];
  booking: Pick<BookingConfig, 'currency' | 'timezone' | 'minimumNoticeMinutes' | 'bufferMinutes' | 'confirmationMode'>;
}): CustomSiteData {
  const { salon, content, services, booking } = input;
  return {
    business: { name: salon.name, city: salon.city ?? '', address: content.locationDisplayMode === 'full_address' ? salon.address ?? null : null, bio: content.bio ?? '', hours: salon.businessHours ?? {} },
    services: services.map(service => ({ id: service.id, name: service.name, description: service.description, priceCents: service.priceCents, priceLabel: service.priceDisplayText || new Intl.NumberFormat('en-CA', { style: 'currency', currency: booking.currency }).format(service.priceCents / 100), durationMinutes: service.durationMinutes })),
    details: content.websiteDetails,
    bookingRules: { timezone: booking.timezone, minimumNoticeMinutes: booking.minimumNoticeMinutes, bufferMinutes: booking.bufferMinutes, confirmationMode: booking.confirmationMode, policy: resolveBookingExperience(salon.settings).policy },
    currency: booking.currency,
    preview: false,
  };
}
