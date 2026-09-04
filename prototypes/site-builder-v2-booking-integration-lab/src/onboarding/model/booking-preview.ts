import { createMenuFixture } from '../../booking/helpers';
import type { MockMenuFixture, MockService } from '../../booking/types';
import { serviceMenuPort } from '../integrations/adapters/service-menu';
import { getPublicLocationPreview } from './location';
import type { BusinessProfileDraft } from './types';

export const CANONICAL_ONBOARDING_BOOKING_FIXTURE = createMenuFixture();

export type OnboardingBookingFixture = MockMenuFixture & {
  readonly labAvailability: {
    readonly minimumNoticeMinutes: number;
  };
};

export const getOnboardingPreviewLocation = (
  profile: BusinessProfileDraft,
): string => getPublicLocationPreview(profile.location).primary
  || 'Location shared during booking';

/**
 * Booking remains the canonical owner of services, prices, durations, images,
 * categories, and add-ons. The onboarding customer preview adapts only the
 * salon identity fields that Booking renders so it cannot contradict the
 * Business Profile being edited.
 */
export const createOnboardingBookingFixture = (
  profile: BusinessProfileDraft,
  fixture: MockMenuFixture = CANONICAL_ONBOARDING_BOOKING_FIXTURE,
): OnboardingBookingFixture => {
  const serviceMenu = serviceMenuPort.normalizeSelection(profile.serviceMenu);
  const selectedIds = new Set(serviceMenu.selectedServiceIds);
  const selectedAddOnIds = new Set(serviceMenu.selectedAddOnIds ?? []);
  const services = fixture.services.flatMap((service): readonly MockService[] => {
    if (!selectedIds.has(service.id)) {
      return [];
    }
    const override = serviceMenu.ownerOverridesByServiceId[service.id];
    if (!override) {
      return [service];
    }
    return [{
      ...service,
      durationMinutes: override.durationMinutes ?? service.durationMinutes,
      price: override.priceCents === undefined
        ? service.price
        : { amountCents: override.priceCents, behavior: 'fixed' },
    }];
  });

  return {
    ...fixture,
    addOns: fixture.addOns.filter(({ id }) => selectedAddOnIds.has(id)),
    labAvailability: {
      minimumNoticeMinutes: profile.bookingPreferences.minimumNoticeMinutes,
    },
    salon: {
      ...fixture.salon,
      id: 'onboarding-preview-salon',
      location: getOnboardingPreviewLocation(profile),
      name: profile.businessName.trim() || 'Your nail studio',
      slug: 'onboarding-preview',
    },
    services,
  };
};
