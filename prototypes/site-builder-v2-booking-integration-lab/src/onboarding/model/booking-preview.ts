import { createMenuFixture } from '../../booking/helpers';
import type { MockMenuFixture } from '../../booking/types';
import { getPublicLocationPreview } from './location';
import type { BusinessProfileDraft } from './types';

export const ONBOARDING_NEXT_AVAILABILITY_LABEL = 'Tomorrow at 10:30 AM';

export const CANONICAL_ONBOARDING_BOOKING_FIXTURE = createMenuFixture();

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
): MockMenuFixture => ({
  ...fixture,
  salon: {
    ...fixture.salon,
    id: 'onboarding-preview-salon',
    location: getOnboardingPreviewLocation(profile),
    name: profile.businessName.trim() || 'Your nail studio',
    slug: 'onboarding-preview',
  },
});
