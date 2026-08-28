import { getPublicContactPreview } from '../onboarding/model/contact';
import {
  getPublicWeeklyHours,
  getWeeklyHoursPreviewStatus,
} from '../onboarding/model/hours';
import { getPublicLocationPreview } from '../onboarding/model/location';
import type { OnboardingLabState } from '../onboarding/model/types';
import type { ClientBusinessMetadata } from './Preview';

export const createOnboardingClientBusinessMetadata = (
  state: OnboardingLabState,
): ClientBusinessMetadata => {
  const contact = getPublicContactPreview(state.profile);
  const location = getPublicLocationPreview(state.profile.location);
  return {
    contact: contact ? {
      actionLabel: contact.actionLabel,
      detail: contact.detail,
    } : null,
    currentHoursStatusLabel: getWeeklyHoursPreviewStatus(
      state.profile.hours,
      state.reviewOptions.previewTimestamp,
    )?.label,
    location: {
      detail: location.detail,
      directionsAvailable: Boolean(location.directionsTarget),
      primary: location.primary,
    },
    weeklyHours: getPublicWeeklyHours(state.profile.hours),
  };
};
