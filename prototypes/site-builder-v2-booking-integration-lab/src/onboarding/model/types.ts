export const ONBOARDING_SCHEMA_VERSION = 1 as const;

export type OnboardingStage = 'basics' | 'booking' | 'design' | 'review';

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

export type BusinessType =
  | 'solo'
  | 'home_studio'
  | 'salon_suite'
  | 'traditional_salon'
  | 'mobile'
  | 'multi_tech';

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

export type WeeklyHoursDraft = {
  days: Record<Weekday, DayHoursDraft>;
  skipped: boolean;
};

export type LocalImageReference = {
  id: string;
  fileName: string;
  mimeType: string;
  source: 'fixture' | 'indexed_db' | 'data_url';
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
  parking: string;
  entranceInstructions: string;
  transitInformation: string;
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

export type AdvanceNotice = 'same_day' | '24_hours' | '48_hours' | 'custom';

export type DepositPreference = 'yes' | 'no' | 'depends_on_service';

export type BookingPreferencesDraft = {
  visitMode: VisitMode | null;
  newClientStatus: NewClientStatus | null;
  advanceNotice: AdvanceNotice | null;
  customAdvanceNotice: string;
  depositPreference: DepositPreference | null;
};

export type CancellationNotice = '12_hours' | '24_hours' | '48_hours' | 'custom';

export type CancellationConsequence =
  | 'deposit_lost'
  | 'cancellation_fee'
  | 'full_service_charge'
  | 'custom';

export type DepositAmountType = 'fixed' | 'percentage';

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
  deposits: {
    required: boolean | null;
    amountType: DepositAmountType | null;
    amount: string;
    refundable: boolean | null;
    transferable: boolean | null;
  };
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
  ownerName: string;
  businessType: BusinessType | null;
  profilePhoto?: LocalImageReference;
  logo?: LocalImageReference;
  instagram: string;
  preferredContact: PreferredContactMethod | null;
  phone: string;
  textPhone: string;
  email: string;
  bookingOnlyContact: boolean;
  location: LocationDraft;
  hours: WeeklyHoursDraft;
  about: AboutProfileDraft;
  bookingPreferences: BookingPreferencesDraft;
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

export type StarterId = 'quick_book' | 'one_page' | 'multi_page';

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

export type CanvaDraft = {
  displayMode: CanvaDisplayMode;
  placement: CanvaPlacement;
  images: LocalImageReference[];
  customDesignSectionId: string | null;
  status: 'empty' | 'ready' | 'invalid';
  errorMessage: string;
};

export type PlanIntent = 'lifetime' | 'monthly' | 'free';
export type PlanOfferFixtureState = 'available' | 'expiring' | 'expired' | 'none';

export type PlanOfferDraft = {
  fixtureState: PlanOfferFixtureState;
  seededAt: string;
  expiresAt: string | null;
  planIntent: PlanIntent | null;
};

export type OnboardingSessionStatus = 'active' | 'paused' | 'builder';

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
  | { type: 'preset_changed'; presetKind: 'about' | 'style'; presetId: AboutPresetId | SiteStylePresetId }
  | { type: 'preview_opened'; source: 'starting_preview' | 'site_style' | 'final_preview' }
  | { type: 'preview_closed'; source: 'starting_preview' | 'site_style' | 'final_preview' }
  | { type: 'starter_selected'; starter: StarterId }
  | { type: 'extras_selected'; extras: Array<'gallery' | 'canva'> }
  | { type: 'open_builder' }
  | { type: 'offer_choice'; intent: PlanIntent }
  | { type: 'validation_failure'; screen: OnboardingScreenId; fieldIds: string[] }
  | { type: 'resume_after_reload'; screen: OnboardingScreenId }
  | { type: 'paused'; screen: OnboardingScreenId }
  | { type: 'reset' };

export type OnboardingEvent = OnboardingEventInput & {
  id: string;
  timestamp: string;
};

export type OnboardingLabState = {
  schemaVersion: typeof ONBOARDING_SCHEMA_VERSION;
  profile: BusinessProfileDraft;
  recipe: OnboardingSiteRecipe;
  progress: OnboardingProgress;
  gallery: GalleryDraft;
  canva: CanvaDraft;
  planOffer: PlanOfferDraft;
  reviewOptions: LabReviewOptions;
  eventJournal: OnboardingEvent[];
};

export type OnboardingSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
