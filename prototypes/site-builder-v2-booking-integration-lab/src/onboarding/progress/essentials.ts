import type {
  OnboardingLabState,
  OnboardingScreenId,
  OnboardingStage,
} from '../model/types';
import {
  contactMethodHasValue,
  resolveInstagramUsername,
} from '../model/contact';

export const ESSENTIAL_IDS = [
  'starting_point',
  'business',
  'location_contact',
  'booking_preferences',
  'site_style',
] as const;

export type EssentialId = (typeof ESSENTIAL_IDS)[number];

export type EssentialResult = {
  complete: boolean;
  id: EssentialId;
  label: string;
  screen: OnboardingScreenId;
  stage: OnboardingStage;
};

const nonBlank = (value: string): boolean => value.trim().length > 0;

export const hasPublicContactMethod = (state: OnboardingLabState): boolean => {
  const { profile } = state;
  if (resolveInstagramUsername(profile.instagram).status === 'invalid') return false;
  return profile.bookingOnlyContact
    || contactMethodHasValue(profile, profile.preferredContact);
};

export const getEssentialResults = (
  state: OnboardingLabState,
): EssentialResult[] => [
  {
    complete: state.recipe.starter !== null
      && nonBlank(state.recipe.starterDocumentSiteId ?? ''),
    id: 'starting_point',
    label: 'Starting point',
    screen: 'starter',
    stage: 'basics',
  },
  {
    complete: nonBlank(state.profile.businessName)
      && nonBlank(state.profile.ownerName)
      && state.profile.businessStructure !== null,
    id: 'business',
    label: 'Business information',
    screen: 'business',
    stage: 'basics',
  },
  {
    complete: nonBlank(state.profile.location.cityOrArea)
      && state.profile.location.locationType !== null
      && hasPublicContactMethod(state),
    id: 'location_contact',
    label: 'Location and contact',
    screen: 'location_contact',
    stage: 'basics',
  },
  {
    complete: state.profile.bookingPreferences.visitMode !== null
      && state.profile.bookingPreferences.newClientStatus !== null,
    id: 'booking_preferences',
    label: 'Booking preferences',
    screen: 'booking_preferences',
    stage: 'booking',
  },
  {
    complete: state.recipe.styleConfirmed && state.recipe.paletteConfirmed,
    id: 'site_style',
    label: 'Site style',
    screen: 'site_style',
    stage: 'design',
  },
];

export const getCompletedEssentialIds = (
  state: OnboardingLabState,
): EssentialId[] => getEssentialResults(state)
  .filter((essential) => essential.complete)
  .map((essential) => essential.id);

export const getIncompleteEssentials = (
  state: OnboardingLabState,
): EssentialResult[] => getEssentialResults(state)
  .filter((essential) => !essential.complete);

export const getEssentialsLeft = (state: OnboardingLabState): number =>
  getIncompleteEssentials(state).length;

export const getEssentialsMessage = (state: OnboardingLabState): string => {
  const count = getEssentialsLeft(state);
  if (count === 0) {
    return 'All required steps complete';
  }
  return `${count} required ${count === 1 ? 'step' : 'steps'} left`;
};

export const getFirstIncompleteEssentialScreen = (
  state: OnboardingLabState,
): OnboardingScreenId | null => getIncompleteEssentials(state)[0]?.screen ?? null;

export const getStageEssentialProgress = (
  state: OnboardingLabState,
  stage: OnboardingStage,
): { complete: number; total: number; stageComplete: boolean } => {
  const essentials = getEssentialResults(state).filter(
    (essential) => essential.stage === stage,
  );
  const complete = essentials.filter((essential) => essential.complete).length;
  return {
    complete,
    stageComplete: essentials.length === 0
      ? stage === 'review' && getEssentialsLeft(state) === 0
      : complete === essentials.length,
    total: essentials.length,
  };
};

export const getCompletedEssentialStages = (
  state: OnboardingLabState,
): OnboardingStage[] => (['basics', 'booking', 'design', 'review'] as const)
  .filter((stage) => getStageEssentialProgress(state, stage).stageComplete);

export const canOpenBuilder = (state: OnboardingLabState): boolean =>
  getEssentialsLeft(state) === 0;
