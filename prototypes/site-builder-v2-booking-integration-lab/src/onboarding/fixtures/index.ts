import { CORE_SCREEN_ORDER } from '../copy';
import {
  DEFAULT_OFFER_EXPIRES_AT,
  DEFAULT_OFFER_SEEDED_AT,
  DEFAULT_PREVIEW_TIMESTAMP,
  createDefaultOnboardingState,
} from '../model/defaults';
import { refreshPolicySuggestedWording } from '../model/policies';
import type {
  OnboardingLabState,
  OnboardingScreenId,
} from '../model/types';
import danielaPortraitUrl from './assets/daniela-placeholder.jpg';

export type LabReviewFixtureId =
  | 'blank_new_owner'
  | 'daniela_isla'
  | 'about_off'
  | 'policies_off'
  | 'canva_intent'
  | 'gallery_selected'
  | 'all_essentials_complete'
  | 'one_essential_missing'
  | 'preview_time_open'
  | 'preview_time_closed'
  | 'lifetime_offer_available'
  | 'offer_expiring'
  | 'offer_expired'
  | 'offer_none'
  | 'reduced_motion'
  | 'long_policy_copy'
  | 'small_phone'
  | 'multi_page_starter';

export type LabReviewFixture = {
  id: LabReviewFixtureId;
  label: string;
  createState: () => OnboardingLabState;
};

const clone = <Value>(value: Value): Value => structuredClone(value);

const setCurrentScreen = (
  state: OnboardingLabState,
  currentScreen: OnboardingScreenId,
): OnboardingLabState => {
  const history = CORE_SCREEN_ORDER.slice(
    0,
    CORE_SCREEN_ORDER.indexOf(currentScreen) + 1,
  ).filter((screen) => state.recipe.aboutEnabled || screen !== 'about_design');
  return {
    ...state,
    progress: {
      ...state.progress,
      currentScreen,
      lastActiveScreen: currentScreen,
      screenHistory: [...history],
      visitedScreens: [...history],
    },
  };
};

export const createDanielaFixtureState = (): OnboardingLabState => {
  const state = createDefaultOnboardingState();
  state.profile.businessName = 'Isla Nail Studio';
  state.profile.ownerName = 'Daniela';
  state.profile.businessStructure = 'solo';
  state.profile.profilePhoto = {
    altText: 'Fictional portrait for the Daniela Lab fixture',
    fileName: 'daniela-placeholder.jpg',
    height: 1100,
    id: 'fixture_daniela_portrait',
    mimeType: 'image/jpeg',
    previewUrl: danielaPortraitUrl,
    source: 'fixture',
    width: 732,
  };
  state.profile.instagram = '@islanail.studio';
  state.profile.preferredContact = 'instagram';
  state.profile.location.cityOrArea = 'Scarborough, Ontario';
  state.profile.location.locationType = 'home_studio';
  state.profile.location.addressVisibility = 'after_booking';
  state.profile.location.allowGeneralAreaDirections = false;
  state.profile.location.parking = 'Street parking is available nearby.';
  state.profile.hours.setupState = 'configured';
  state.profile.hours.showOnSite = true;
  for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const) {
    state.profile.hours.days[day] = { close: '18:00', closed: false, open: '10:00' };
  }
  state.profile.hours.days.saturday = { close: '16:00', closed: false, open: '10:00' };
  state.profile.hours.days.sunday = { close: '', closed: true, open: '' };
  state.profile.bookingPreferences.visitMode = 'appointment_only';
  state.profile.bookingPreferences.newClientStatus = 'yes';
  state.profile.bookingPreferences.advanceNotice = '24_hours';
  state.profile.about.shortBio = 'I create thoughtful, detailed nail appointments in a calm private studio.';
  state.profile.about.fullBio = 'I’m Daniela, the nail artist behind Isla Nail Studio. I specialize in structured manicures and durable, natural-looking enhancements designed around each client.';
  state.profile.about.specialties = [
    'Russian Manicure',
    'BIAB',
    'Gel-X',
    'Hard Gel',
  ];
  state.profile.about.yearsOfExperience = '6';
  state.profile.about.languages = ['English', 'Spanish'];
  state.profile.about.clientAppreciation = 'A calm appointment, careful prep, and honest guidance about what will work best.';
  state.profile.policies = refreshPolicySuggestedWording({
    ...state.profile.policies,
    cancellations: {
      ...state.profile.policies.cancellations,
      consequence: 'deposit_lost',
      notice: '24_hours',
    },
    deposits: {
      amount: '50',
      amountType: 'fixed',
      mode: 'generally_required',
      refundable: false,
      transferable: true,
    },
    lateArrivals: {
      gracePeriodMinutes: '15',
      rescheduleAfterLimit: true,
      shortenService: true,
    },
    noShows: {
      ...state.profile.policies.noShows,
      loseDeposit: true,
      paymentRequiredToRebook: true,
    },
    repairs: {
      ...state.profile.policies.repairs,
      freeRepairWindowDays: '7',
    },
  });
  state.recipe.starter = 'one_page';
  state.recipe.starterDocumentSiteId = 'site_fixture_isla_one_page';
  state.recipe.aboutEnabled = true;
  state.recipe.aboutPreset = 'about_before_you_book';
  state.recipe.policiesEnabled = true;
  state.recipe.stylePreset = 'soft';
  state.recipe.styleConfirmed = true;
  state.reviewOptions.previewTimestamp = DEFAULT_PREVIEW_TIMESTAMP;
  return setCurrentScreen(state, 'final_preview');
};

const fixture = (
  id: LabReviewFixtureId,
  label: string,
  createState: () => OnboardingLabState,
): LabReviewFixture => ({ createState, id, label });

export const LAB_REVIEW_FIXTURES: readonly LabReviewFixture[] = [
  fixture('blank_new_owner', 'Blank new owner', createDefaultOnboardingState),
  fixture('daniela_isla', 'Daniela / Isla Nail Studio', createDanielaFixtureState),
  fixture('about_off', 'About Off', () => {
    const state = createDanielaFixtureState();
    state.recipe.aboutEnabled = false;
    return setCurrentScreen(state, 'policies');
  }),
  fixture('policies_off', 'Policies Off', () => {
    const state = createDanielaFixtureState();
    state.recipe.policiesEnabled = false;
    return setCurrentScreen(state, 'site_style');
  }),
  fixture('canva_intent', 'Canva intent', () => {
    const state = createDanielaFixtureState();
    state.recipe.canvaEnabled = false;
    state.recipe.wantsCanvaFromWelcome = true;
    return setCurrentScreen(state, 'extras');
  }),
  fixture('gallery_selected', 'Gallery selected', () => {
    const state = createDanielaFixtureState();
    state.gallery.layout = 'editorial';
    state.gallery.source = 'mock_luster';
    state.recipe.galleryEnabled = true;
    return setCurrentScreen(state, 'extras');
  }),
  fixture('all_essentials_complete', 'All essentials complete', createDanielaFixtureState),
  fixture('one_essential_missing', 'One essential missing', () => {
    const state = createDanielaFixtureState();
    state.recipe.styleConfirmed = false;
    return state;
  }),
  fixture('preview_time_open', 'Preview time · Open', () => {
    const state = createDanielaFixtureState();
    state.reviewOptions.previewTimestamp = '2026-08-27T18:30:00.000Z';
    return state;
  }),
  fixture('preview_time_closed', 'Preview time · Closed', () => {
    const state = createDanielaFixtureState();
    state.reviewOptions.previewTimestamp = '2026-08-28T01:00:00.000Z';
    return state;
  }),
  fixture('lifetime_offer_available', 'Lifetime offer available', () => {
    const state = createDanielaFixtureState();
    state.planOffer.fixtureState = 'available';
    state.planOffer.seededAt = DEFAULT_OFFER_SEEDED_AT;
    state.planOffer.expiresAt = DEFAULT_OFFER_EXPIRES_AT;
    return state;
  }),
  fixture('offer_expiring', 'Offer expiring', () => {
    const state = createDanielaFixtureState();
    state.planOffer.fixtureState = 'expiring';
    state.planOffer.seededAt = '2026-08-28T08:00:00.000Z';
    state.planOffer.expiresAt = '2026-08-28T12:00:00.000Z';
    return state;
  }),
  fixture('offer_expired', 'Offer expired', () => {
    const state = createDanielaFixtureState();
    state.planOffer.fixtureState = 'expired';
    state.planOffer.seededAt = DEFAULT_OFFER_SEEDED_AT;
    state.planOffer.expiresAt = DEFAULT_OFFER_EXPIRES_AT;
    return state;
  }),
  fixture('offer_none', 'No offer', () => {
    const state = createDanielaFixtureState();
    state.planOffer.fixtureState = 'none';
    state.planOffer.expiresAt = null;
    return state;
  }),
  fixture('reduced_motion', 'Reduced motion', () => {
    const state = createDanielaFixtureState();
    state.reviewOptions.reducedMotion = true;
    return setCurrentScreen(state, 'starter');
  }),
  fixture('long_policy_copy', 'Long policy copy', () => {
    const state = createDanielaFixtureState();
    state.profile.policies.copy.cancellations.useSuggestedWording = false;
    state.profile.policies.copy.cancellations.wordingOverride = 'Appointments may be cancelled or moved with at least 24 hours of notice. Changes after that window may forfeit the deposit because the reserved studio time is difficult to refill at short notice. Please contact the studio as soon as possible if an emergency affects your visit.';
    return setCurrentScreen(state, 'policies');
  }),
  fixture('small_phone', 'Small phone', () => {
    const state = createDefaultOnboardingState();
    state.reviewOptions.viewportFixture = 'small_phone';
    return setCurrentScreen(state, 'business');
  }),
  fixture('multi_page_starter', 'Multi-page starter', () => {
    const state = createDanielaFixtureState();
    state.recipe.starter = 'multi_page';
    state.recipe.starterDocumentSiteId = 'site_fixture_isla_multi_page';
    return setCurrentScreen(state, 'starting_preview');
  }),
];

const FIXTURE_BY_ID = new Map(
  LAB_REVIEW_FIXTURES.map((entry) => [entry.id, entry]),
);

export const applyLabReviewFixture = (
  id: LabReviewFixtureId,
): OnboardingLabState => {
  const selected = FIXTURE_BY_ID.get(id);
  if (!selected) {
    throw new Error(`Unknown onboarding Lab fixture: ${id}`);
  }
  const state = clone(selected.createState());
  state.reviewOptions.appliedFixtureId = id;
  return state;
};
