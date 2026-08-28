import {
  ONBOARDING_SCHEMA_VERSION,
  type AboutElementId,
  type BusinessProfileDraft,
  type CanvaDraft,
  type GalleryDraft,
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
export const DEFAULT_PREVIEW_TIMESTAMP = '2026-08-27T18:30:00.000Z';

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
  days: Object.fromEntries(WEEKDAYS.map((day) => [
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
    amount: '',
    amountType: null,
    mode: null,
    refundable: null,
    transferable: null,
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
      ABOUT_ELEMENTS.map((element) => [element, true]),
    ) as Record<AboutElementId, boolean>,
    yearsOfExperience: '',
  },
  bookingOnlyContact: false,
  bookingPreferences: {
    advanceNotice: null,
    customAdvanceNotice: '',
    newClientStatus: null,
    visitMode: null,
  },
  brand: {
    accentPreference: '',
    styleNotes: '',
  },
  businessName: '',
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
  instagram: '',
  location: {
    allowGeneralAreaDirections: false,
    addressVisibility: 'after_booking',
    cityOrArea: '',
    entranceInstructions: '',
    exactAddress: '',
    locationType: null,
    parking: '',
    transitInformation: '',
  },
  ownerName: '',
  policies: createDefaultPolicies(),
  preferredContact: null,
});

export const createDefaultSiteRecipe = (): OnboardingSiteRecipe => ({
  aboutEnabled: true,
  aboutPreset: 'photo_right',
  canvaEnabled: false,
  galleryEnabled: false,
  policiesEnabled: true,
  starter: null,
  starterDocumentSiteId: null,
  styleConfirmed: false,
  stylePreset: 'modern',
  wantsCanvaFromWelcome: false,
});

export const createDefaultProgress = (): OnboardingProgress => ({
  currentScreen: 'welcome',
  lastActiveScreen: 'welcome',
  lastSavedAt: null,
  screenHistory: ['welcome'],
  sessionStatus: 'active',
  skippedOptionalItems: [],
  visitedScreens: ['welcome'],
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
  placement: 'after_booking',
  status: 'empty',
});

export const createDefaultPlanOffer = (): PlanOfferDraft => ({
  expiresAt: DEFAULT_OFFER_EXPIRES_AT,
  fixtureState: 'available',
  planIntent: null,
  seededAt: DEFAULT_OFFER_SEEDED_AT,
});

export const createDefaultOnboardingState = (): OnboardingLabState => ({
  canva: createDefaultCanvaDraft(),
  eventJournal: [],
  gallery: createDefaultGalleryDraft(),
  planOffer: createDefaultPlanOffer(),
  profile: createDefaultBusinessProfile(),
  progress: createDefaultProgress(),
  recipe: createDefaultSiteRecipe(),
  reviewOptions: {
    appliedFixtureId: null,
    previewTimestamp: DEFAULT_PREVIEW_TIMESTAMP,
    reducedMotion: false,
    viewportFixture: null,
  },
  schemaVersion: ONBOARDING_SCHEMA_VERSION,
});

export const shouldDefaultAboutToEnabled = (
  profile: BusinessProfileDraft,
): boolean => Boolean(profile.profilePhoto || profile.ownerName.trim());
