import { serviceMenuPort } from '../integrations/adapters/service-menu';
import {
  type AboutElementId,
  type BusinessProfileDraft,
  type CanvaDraft,
  type DashboardHandoffDraft,
  DEFAULT_QUICK_BOOK_PROFILE_VISIBILITY,
  type GalleryDraft,
  ONBOARDING_SCHEMA_VERSION,
  type OnboardingLabState,
  type OnboardingProgress,
  type OnboardingSiteRecipe,
  type PlanOfferDraft,
  type PoliciesDraft,
  type Weekday,
  type WeeklyHoursDraft,
} from './types';

export const DEFAULT_OFFER_SEEDED_AT = '2026-08-27T12:00:00.000Z';
export const DEFAULT_OFFER_EXPIRES_AT = '2026-08-28T12:00:00.000Z';
/** Normal owner mode anchors seeded availability to the current Lab clock. */
export const DEFAULT_PREVIEW_TIMESTAMP = new Date().toISOString();

export const createSecureBrowserToken = (prefix: string): string => {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return `${prefix}_${cryptoApi.randomUUID()}`;
  }
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(24));
    const random = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${prefix}_${random}`;
  }
  throw new Error('Secure random number generation is unavailable.');
};

export const createAnonymousDraftId = (): string => createSecureBrowserToken('draft');

const WEEKDAYS: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const ABOUT_ELEMENTS: readonly AboutElementId[] = [
  'profile_photo',
  'owner_name',
  'salon_name',
  'bio',
  'specialties',
  'experience',
  'certifications',
  'languages',
  'appointment_status',
  'new_client_status',
  'policy_summary',
  'instagram',
  'book_button',
];

export const createDefaultWeeklyHours = (): WeeklyHoursDraft => ({
  days: Object.fromEntries(WEEKDAYS.map(day => [
    day,
    {
      close: '',
      closed: false,
      open: '',
    },
  ])) as Record<Weekday, WeeklyHoursDraft['days'][Weekday]>,
  setupState: 'unset',
  showOnSite: true,
});

export const createDefaultPolicies = (): PoliciesDraft => ({
  cancellations: {
    consequence: null,
    customConsequence: '',
    customNotice: '',
    notice: null,
  },
  copy: {
    cancellations: {
      suggestedWording: '',
      useSuggestedWording: true,
      visible: true,
      wordingOverride: '',
    },
    deposits: {
      suggestedWording: '',
      useSuggestedWording: true,
      visible: true,
      wordingOverride: '',
    },
    late_arrivals: {
      suggestedWording: '',
      useSuggestedWording: true,
      visible: true,
      wordingOverride: '',
    },
    no_shows: {
      suggestedWording: '',
      useSuggestedWording: true,
      visible: true,
      wordingOverride: '',
    },
    repairs: {
      suggestedWording: '',
      useSuggestedWording: true,
      visible: true,
      wordingOverride: '',
    },
    other: {
      suggestedWording: '',
      useSuggestedWording: true,
      visible: false,
      wordingOverride: '',
    },
  },
  deposits: {
    amountCents: null,
    mode: 'none',
    refundable: null,
    transferable: null,
    wordingOverride: '',
  },
  lateArrivals: {
    gracePeriodMinutes: '',
    rescheduleAfterLimit: null,
    shortenService: null,
  },
  noShows: {
    custom: '',
    fullCharge: false,
    loseDeposit: false,
    paymentRequiredToRebook: false,
  },
  other: {
    appointmentPreparation: '',
    children: '',
    custom: '',
    guests: '',
    outsideRemoval: '',
  },
  repairs: {
    conditions: '',
    freeRepairWindowDays: '',
    noRepairPolicy: false,
  },
});

export const createDefaultBusinessProfile = (): BusinessProfileDraft => ({
  about: {
    certifications: [],
    clientAppreciation: '',
    fullBio: '',
    languages: [],
    shortBio: '',
    specialties: [],
    visibility: Object.fromEntries(
      ABOUT_ELEMENTS.map(element => [element, true]),
    ) as Record<AboutElementId, boolean>,
    yearsOfExperience: '',
  },
  bookingOnlyContact: false,
  bookingPreferences: {
    minimumNoticeMinutes: 120,
    newClientStatus: null,
    visitMode: null,
  },
  brand: {
    accentPreference: '',
    styleNotes: '',
  },
  businessName: '',
  businessType: null,
  businessStructure: null,
  clientContact: {
    callEnabled: false,
    differentTextNumber: '',
    primaryNumber: '',
    textEnabled: false,
    useDifferentTextNumber: false,
  },
  email: '',
  hours: createDefaultWeeklyHours(),
  timeZone: 'America/Toronto',
  instagram: '',
  location: {
    allowGeneralAreaDirections: false,
    addressVisibility: 'public',
    addressVisibilityDefaulted: true,
    cityOrArea: '',
    entranceInstructions: '',
    exactAddress: '',
    locationType: null,
    parking: '',
    transitInformation: '',
  },
  ownerName: '',
  siteSlug: '',
  siteSlugCustomized: false,
  policies: createDefaultPolicies(),
  preferredContact: null,
  serviceMenu: serviceMenuPort.createDefaultSelection(),
});

export const createDefaultSiteRecipe = (): OnboardingSiteRecipe => ({
  aboutEnabled: true,
  aboutPreset: 'photo_right',
  canvaEnabled: false,
  galleryEnabled: false,
  policiesEnabled: true,
  // A fresh owner has just supplied their name and explicitly chosen any
  // profile photo during onboarding, so recommend the compact identity shown
  // in the Quick Book reference. Legacy drafts are migrated separately with
  // conservative, evidence-based visibility and account-side config still
  // defaults every flag to private.
  quickBookProfile: {
    ...DEFAULT_QUICK_BOOK_PROFILE_VISIBILITY,
    showTechName: true,
    showTechPhoto: true,
  },
  quickBookLayout: 'compact_dropdown',
  paletteConfirmed: false,
  palettePreset: 'luster_berry',
  starter: null,
  starterDocumentSiteId: null,
  styleConfirmed: false,
  stylePreset: 'modern',
  wantsCanvaFromWelcome: false,
});

export const createDefaultProgress = (): OnboardingProgress => ({
  currentScreen: 'starter',
  lastActiveScreen: 'starter',
  lastSavedAt: null,
  screenHistory: ['starter'],
  sessionStatus: 'active',
  skippedOptionalItems: [],
  visitedScreens: ['starter'],
});

export const createDefaultGalleryDraft = (): GalleryDraft => ({
  images: [],
  layout: 'grid',
  source: null,
});

export const createDefaultCanvaDraft = (): CanvaDraft => ({
  customDesignSectionId: null,
  displayMode: 'contained',
  errorMessage: '',
  images: [],
  ownedAssetIds: [],
  placement: 'after_booking',
  status: 'empty',
  uploadResult: null,
});

export const createDefaultPlanOffer = (): PlanOfferDraft => ({
  expiresAt: DEFAULT_OFFER_EXPIRES_AT,
  fixtureState: 'available',
  foundingMode: 'lifetime',
  planIntent: null,
  seededAt: DEFAULT_OFFER_SEEDED_AT,
});

export const createDefaultDashboardHandoff = (): DashboardHandoffDraft => ({
  checklistFixtures: {
    googleCalendar: 'not_connected',
    payments: 'not_connected',
    shareBookingLink: 'not_connected',
  },
  tourCompleted: false,
});

export const createDefaultOnboardingState = (): OnboardingLabState => ({
  anonymousDraftId: createAnonymousDraftId(),
  canva: createDefaultCanvaDraft(),
  dashboardHandoff: createDefaultDashboardHandoff(),
  eventJournal: [],
  gallery: createDefaultGalleryDraft(),
  planOffer: createDefaultPlanOffer(),
  profile: createDefaultBusinessProfile(),
  progress: createDefaultProgress(),
  recipe: createDefaultSiteRecipe(),
  reviewOptions: {
    appliedFixtureId: null,
    feedbackMilestones: [],
    previewTimestamp: DEFAULT_PREVIEW_TIMESTAMP,
    reducedMotion: false,
    viewportFixture: null,
  },
  schemaVersion: ONBOARDING_SCHEMA_VERSION,
});

export const shouldDefaultAboutToEnabled = (
  profile: BusinessProfileDraft,
): boolean => Boolean(profile.profilePhoto || profile.ownerName.trim());
