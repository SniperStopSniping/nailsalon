import type { SetupDocument } from '@/features/business-setup/contracts';
import { previewBusinessIdentity } from '@/features/business-setup/contracts';
import { setupServicePriceLabel } from '@/features/business-setup/service-pricing';

import { publicCustomSiteBookingPolicy } from './booking-policy';
import type { CustomSiteData } from './contracts';

export function customSiteDataFromSetup(document: SetupDocument): CustomSiteData {
  return {
    business: { ...previewBusinessIdentity(document), address: document.business.locationDisplayMode === 'full_address' ? document.business.exactAddress : null, bio: document.website.content.bio ?? '', hours: document.hours },
    services: document.services.filter(s => s.priceCents !== null && s.durationMinutes !== null).map(s => ({ id: `setup_preview_${s.id}`, name: s.name, description: s.description, priceCents: s.priceCents!, priceLabel: setupServicePriceLabel(s, document.booking.currency), durationMinutes: s.durationMinutes! })),
    details: document.website.content.websiteDetails,
    bookingRules: { timezone: document.booking.timezone, minimumNoticeMinutes: document.booking.minimumNoticeMinutes, bufferMinutes: document.booking.bufferMinutes, confirmationMode: document.booking.confirmationMode, policy: document.bookingPolicy },
    bookingPolicy: publicCustomSiteBookingPolicy(document.bookingPolicy),
    currency: document.booking.currency,
    preview: true,
  };
}
