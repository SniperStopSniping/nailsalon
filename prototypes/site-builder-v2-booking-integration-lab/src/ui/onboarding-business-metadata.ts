import { getPublicContactActions } from '../onboarding/model/contact';
import {
  getPublicWeeklyHours,
  getWeeklyHoursPreviewStatus,
} from '../onboarding/model/hours';
import {
  getPublicDirectionsAction,
  getPublicLocationPreview,
} from '../onboarding/model/location';
import type { OnboardingLabState } from '../onboarding/model/types';
import type { ClientBusinessMetadata } from './Preview';

export const createOnboardingClientBusinessMetadata = (
  state: OnboardingLabState,
): ClientBusinessMetadata => {
  const location = getPublicLocationPreview(state.profile.location);
  return {
    contacts: getPublicContactActions(state.profile),
    currentHoursStatusLabel: getWeeklyHoursPreviewStatus(
      state.profile.hours,
      state.reviewOptions.previewTimestamp,
      state.profile.timeZone,
    )?.label,
    directions: getPublicDirectionsAction(state.profile.location),
    location: {
      detail: location.detail,
      primary: location.primary,
    },
    weeklyHours: getPublicWeeklyHours(state.profile.hours),
  };
};
