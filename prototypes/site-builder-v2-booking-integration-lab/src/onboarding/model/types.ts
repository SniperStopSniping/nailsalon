import type { DepositDraft } from '../integrations/contracts/booking-preferences';
import type { ServiceMenuSelectionDraft } from '../integrations/contracts/service-menu';

export const ONBOARDING_SCHEMA_VERSION = 11 as const;

export type OnboardingStage = 'basics' | 'booking' | 'design' | 'review';

/**
 * `welcome` and `photo_social` are legacy ids: they left the live flow when
 * the starter-first opening shipped (schema v9), but stay in the union so
 * persisted drafts and event journals from older versions keep parsing.
 * Storage migration remaps them (`welcome`→`starter`, `photo_social`→`business`).
 */
export type OnboardingScreenId =
  | 'welcome'
  | 'business'
  | 'photo_social'
  | 'location_contact'
  | 'booking_preferences'
  | 'starter'
  | 'starting_preview'
  | 'about'
  | 'about_design'
  | 'policies'
  | 'site_style'
  | 'extras'
  | 'final_preview';

export type OptionalOnboardingItem =
  | 'photo'
  | 'hours'
  | 'about'
  | 'policies'
  | 'gallery'
  | 'canva'
  | 'extras';

export type BusinessStructure = 'solo' | 'multi_tech';

export type OnboardingBusinessType =
  | 'independent_salon'
  | 'home_based'
  | 'mobile'
  | 'salon_team';

export type PreferredContactMethod = 'text' | 'call' | 'instagram' | 'email';

export type LocationType =
  | 'home_studio'
  | 'salon_suite'
  | 'traditional_salon'
  | 'mobile_service';

export type AddressVisibility = 'public' | 'after_booking' | 'hidden';

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export type DayHoursDraft = {
  closed: boolean;
  open: string;
  close: string;
};

export type WeeklyHoursSetupState = 'unset' | 'configured' | 'skipped';

export type WeeklyHoursDraft = {
  days: Record<Weekday, DayHoursDraft>;
  setupState: WeeklyHoursSetupState;
  showOnSite: boolean;
};

export type LocalImageReference = {
  id: string;
  fileName: string;
  mimeType: string;
  /**
   * `data_url` is retained only so a legacy browser draft can be normalized.
   * Current state serialization converts it to metadata-only `missing` state.
   */
  source: 'fixture' | 'indexed_db' | 'data_url' | 'missing';
  storageId?: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  altText?: string;
};

export type LocationDraft = {
  cityOrArea: string;
  exactAddress: string;
  locationType: LocationType | null;
  addressVisibility: AddressVisibility;
  allowGeneralAreaDirections: boolean;
  parking: string;
  entranceInstructions: string;
  transitInformation: string;
};

export type ClientContactDraft = {
  primaryNumber: string;
  callEnabled: boolean;
  textEnabled: boolean;
  useDifferentTextNumber: boolean;
  differentTextNumber: string;
};

export type AboutElementId =
  | 'profile_photo'
  | 'owner_name'
  | 'salon_name'
  | 'bio'
  | 'specialties'
  | 'experience'
  | 'certifications'
  | 'languages'
  | 'appointment_status'
  | 'new_client_status'
  | 'policy_summary'
  | 'instagram'
  | 'book_button';

export type AboutProfileDraft = {
  shortBio: string;
  fullBio: string;
  specialties: string[];
  yearsOfExperience: string;
  certifications: string[];
  languages: string[];
  clientAppreciation: string;
  visibility: Record<AboutElementId, boolean>;
};

export type VisitMode =
  | 'appointment_only'
  | 'walk_ins_only'
  | 'appointments_and_walk_ins';

export type NewClientStatus = 'yes' | 'no' | 'ask_first' | 'waitlist_only';

export type BookingPreferencesDraft = {
  visitMode: VisitMode | null;
  newClientStatus: NewClientStatus | null;
  minimumNoticeMinutes: number;
  legacyV5Archive?: {
    advanceNotice: 'same_day' | '24_hours' | '48_hours' | 'custom' | null;
    customAdvanceNotice: string;
  };
};

export type CancellationNotice =
  | 'same_day'
  | '12_hours'
  | '24_hours'
  | '48_hours'
  | '72_hours'
  | 'custom';

export type CancellationConsequence =
  | 'deposit_lost'
  | 'cancellation_fee'
  | 'full_service_charge'
  | 'custom';

export type DepositPolicyMode = DepositDraft['mode'];

export type PolicySectionId =
  | 'cancellations'
  | 'deposits'
  | 'late_arrivals'
  | 'no_shows'
  | 'repairs'
  | 'other';

export type PolicyCopyDraft = {
  suggestedWording: string;
  wordingOverride: string;
  useSuggestedWording: boolean;
  visible: boolean;
};

export type PoliciesDraft = {
  cancellations: {
    notice: CancellationNotice | null;
    customNotice: string;
    consequence: CancellationConsequence | null;
    customConsequence: string;
  };
  deposits: DepositDraft;
  lateArrivals: {
    gracePeriodMinutes: string;
    shortenService: boolean | null;
    rescheduleAfterLimit: boolean | null;
  };
  noShows: {
    loseDeposit: boolean;
    fullCharge: boolean;
    paymentRequiredToRebook: boolean;
    custom: string;
  };
  repairs: {
    freeRepairWindowDays: string;
    conditions: string;
    noRepairPolicy: boolean;
  };
  other: {
    guests: string;
    children: string;
    appointmentPreparation: string;
    outsideRemoval: string;
    custom: string;
  };
  copy: Record<PolicySectionId, PolicyCopyDraft>;
};

export type BrandStyleDraft = {
  accentPreference: string;
  styleNotes: string;
};

export type BusinessProfileDraft = {
  businessName: string;
  businessType: OnboardingBusinessType | null;
  ownerName: string;
  businessStructure: BusinessStructure | null;
  siteSlug: string;
  siteSlugCustomized: boolean;
  profilePhoto?: LocalImageReference;
  logo?: LocalImageReference;
  instagram: string;
  preferredContact: PreferredContactMethod | null;
  clientContact: ClientContactDraft;
  email: string;
  bookingOnlyContact: boolean;
  location: LocationDraft;
  hours: WeeklyHoursDraft;
  about: AboutProfileDraft;
  bookingPreferences: BookingPreferencesDraft;
  serviceMenu: ServiceMenuSelectionDraft;
  policies: PoliciesDraft;
  brand: BrandStyleDraft;
};

export type AboutPresetId =
  | 'photo_right'
  | 'editorial_portrait'
  | 'profile_quick_facts'
  | 'about_before_you_book';

export type SiteStylePresetId =
  | 'modern'
  | 'editorial'
  | 'soft'
  | 'minimal'
  | 'bold'
  | 'luxury';

export type SitePalettePresetId =
  | 'luster_berry'
  | 'blush_cocoa'
  | 'terracotta_cream'
  | 'sage_stone'
  | 'lilac_plum'
  | 'navy_ivory'
  | 'monochrome'
  | 'black_champagne';

export type StarterId = 'quick_book' | 'one_page' | 'multi_page';

/**
 * Quick Book-specific presentation choices. The values decide whether one
 * shared salon-profile field may be rendered by Quick Book; the underlying
 * business, staff, contact, policy, and social content remains canonical in
 * `BusinessProfileDraft`.
 */
export type QuickBookProfileVisibilityDraft = {
  showBio: boolean;
  showBookingPolicy: boolean;
  showCancellationPolicy: boolean;
  showEmail: boolean;
  showHours: boolean;
  showInstagram: boolean;
  showLocation: boolean;
  showPhone: boolean;
  showReviews: boolean;
  showTechName: boolean;
  showTechPhoto: boolean;
};

export const DEFAULT_QUICK_BOOK_PROFILE_VISIBILITY = {
  showBio: false,
  showBookingPolicy: false,
  showCancellationPolicy: false,
  showEmail: false,
  showHours: false,
  showInstagram: true,
  showLocation: false,
  showPhone: false,
  showReviews: false,
  showTechName: true,
  showTechPhoto: true,
} as const satisfies QuickBookProfileVisibilityDraft;

export type OnboardingSiteRecipe = {
  starter: StarterId | null;
  starterDocumentSiteId: string | null;
  aboutEnabled: boolean;
  aboutPreset: AboutPresetId;
  policiesEnabled: boolean;
  galleryEnabled: boolean;
  canvaEnabled: boolean;
  wantsCanvaFromWelcome: boolean;
  stylePreset: SiteStylePresetId;
  styleConfirmed: boolean;
  palettePreset: SitePalettePresetId;
  paletteConfirmed: boolean;
  quickBookProfile: QuickBookProfileVisibilityDraft;
};

export type GalleryLayout = 'grid' | 'carousel' | 'editorial';
export type GallerySource = 'uploads' | 'mock_luster';

export type GalleryDraft = {
  layout: GalleryLayout;
  source: GallerySource | null;
  images: LocalImageReference[];
};

export type CanvaDisplayMode = 'poster' | 'contained' | 'full_width';
export type CanvaPlacement = 'before_booking' | 'after_booking';

export type CanvaUploadFailureDraft = {
  code?: string;
  fileName: string;
  message: string;
};

export type CanvaUploadResultDraft = {
  addedCount: number;
  failures: CanvaUploadFailureDraft[];
  summary: string;
};

export type CanvaDraft = {
  displayMode: CanvaDisplayMode;
  placement: CanvaPlacement;
  images: LocalImageReference[];
  ownedAssetIds: string[];
  customDesignSectionId: string | null;
  status: 'empty' | 'ready' | 'invalid';
  errorMessage: string;
  uploadResult: CanvaUploadResultDraft | null;
};

export type PlanIntent = 'founding' | 'monthly' | 'free';
export type PlanOfferFixtureState = 'available' | 'expiring' | 'expired' | 'none';
export type FoundingOfferMode =
  | 'lifetime'
  | 'discounted_annual'
  | 'locked_monthly'
  | 'free_beta'
  | 'hidden';

export type PlanOfferDraft = {
  fixtureState: PlanOfferFixtureState;
  foundingMode: FoundingOfferMode;
  seededAt: string;
  expiresAt: string | null;
  planIntent: PlanIntent | null;
};

export type OnboardingSessionStatus = 'active' | 'paused' | 'builder' | 'dashboard';

export type SetupChecklistFixtureStatus =
  | 'not_connected'
  | 'connected'
  | 'needs_attention';

export type DashboardHandoffDraft = {
  checklistFixtures: {
    googleCalendar: SetupChecklistFixtureStatus;
    payments: SetupChecklistFixtureStatus;
    shareBookingLink: SetupChecklistFixtureStatus;
  };
  tourCompleted: boolean;
};

export type OnboardingProgress = {
  currentScreen: OnboardingScreenId;
  screenHistory: OnboardingScreenId[];
  visitedScreens: OnboardingScreenId[];
  skippedOptionalItems: OptionalOnboardingItem[];
  lastActiveScreen: OnboardingScreenId;
  lastSavedAt: string | null;
  sessionStatus: OnboardingSessionStatus;
};

export type LabViewportFixture = 'small_phone' | null;

export type LabReviewOptions = {
  appliedFixtureId: string | null;
  feedbackMilestones?: string[];
  previewTimestamp: string;
  reducedMotion: boolean;
  viewportFixture: LabViewportFixture;
};

export type OnboardingEventInput =
  | { type: 'screen_viewed'; screen: OnboardingScreenId }
  | { type: 'continue'; screen: OnboardingScreenId; nextScreen: OnboardingScreenId | null }
  | { type: 'back'; screen: OnboardingScreenId; nextScreen: OnboardingScreenId }
  | { type: 'skip'; screen: OnboardingScreenId; item: OptionalOnboardingItem }
  | { type: 'about_toggled'; enabled: boolean }
  | { type: 'policies_toggled'; enabled: boolean }
  | { type: 'preset_changed'; presetKind: 'about' | 'palette' | 'style'; presetId: AboutPresetId | SitePalettePresetId | SiteStylePresetId }
  | { type: 'preview_opened'; source: 'starting_preview' | 'about' | 'about_design' | 'site_style' | 'final_preview' }
  | { type: 'preview_closed'; source: 'starting_preview' | 'about' | 'about_design' | 'site_style' | 'final_preview' }
  | { type: 'starter_selected'; starter: StarterId }
  | { type: 'extras_selected'; extras: Array<'gallery' | 'canva'> }
  | { type: 'open_builder' }
  | { type: 'offer_choice'; intent: PlanIntent }
  | { type: 'validation_failure'; screen: OnboardingScreenId; fieldIds: string[] }
  | { type: 'about_wording_helper'; action: 'opened' | 'used' | 'kept' | 'undone' }
  | { type: 'resume_after_reload'; screen: OnboardingScreenId }
  | { type: 'paused'; screen: OnboardingScreenId }
  | { type: 'reset' }
  | { type: 'final_review_completed' }
  | { type: 'save_site_started' }
  | { type: 'account_gate_viewed' }
  | { type: 'sign_up_started' }
  | { type: 'sign_up_completed' }
  | { type: 'sign_in_completed' }
  | { type: 'draft_claim_started' }
  | { type: 'draft_claim_completed' }
  | { type: 'draft_claim_failed' }
  | { type: 'media_claim_failed' }
  | { type: 'site_saved' }
  | { type: 'plan_selected'; intent: PlanIntent }
  | { type: 'palette_selected'; presetId: SitePalettePresetId }
  | { type: 'dashboard_entered' };

export type OnboardingEvent = OnboardingEventInput & {
  id: string;
  timestamp: string;
};

export type OnboardingLabState = {
  anonymousDraftId: string;
  schemaVersion: typeof ONBOARDING_SCHEMA_VERSION;
  profile: BusinessProfileDraft;
  dashboardHandoff: DashboardHandoffDraft;
  recipe: OnboardingSiteRecipe;
  progress: OnboardingProgress;
  gallery: GalleryDraft;
  canva: CanvaDraft;
  planOffer: PlanOfferDraft;
  reviewOptions: LabReviewOptions;
  eventJournal: OnboardingEvent[];
};

export type OnboardingSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
