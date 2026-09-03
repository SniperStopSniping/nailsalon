import { bookingPreferencesPort } from '../integrations/adapters/booking-preferences';
import { serviceMenuPort } from '../integrations/adapters/service-menu';
import type {
  DepositDraft,
  LegacyV5DepositArchive,
} from '../integrations/contracts/booking-preferences';
import type { ServiceMenuSelectionDraft } from '../integrations/contracts/service-menu';
import {
  getCoherentPreferredContact,
  resolveInstagramUsername,
} from '../model/contact';
import { createDefaultOnboardingState } from '../model/defaults';
import {
  inferOnboardingBusinessType,
  normalizeSiteSlug,
} from '../model/business-identity';
import { getResolvedPolicyWording } from '../model/policies';
import {
  type BusinessProfileDraft,
  type BusinessStructure,
  type CanvaDraft,
  type ClientContactDraft,
  type DashboardHandoffDraft,
  DEFAULT_QUICK_BOOK_PROFILE_VISIBILITY,
  type FoundingOfferMode,
  type GalleryDraft,
  type LocalImageReference,
  type LocationType,
  type OnboardingBusinessType,
  ONBOARDING_SCHEMA_VERSION,
  type OnboardingLabState,
  type OnboardingScreenId,
  type OnboardingSessionStatus,
  type PlanIntent,
  type QuickBookLayoutId,
  type QuickBookProfileVisibilityDraft,
  type SetupChecklistFixtureStatus,
  type SitePalettePresetId,
  type Weekday,
  type WeeklyHoursDraft,
} from '../model/types';

export const ONBOARDING_STORAGE_KEY = 'luster:onboarding-v1-lab';

const FEEDBACK_MILESTONE_IDS = new Set([
  'all_required_complete',
  'stage_basics',
  'stage_booking',
  'stage_design',
  'starting_site_ready',
]);

const normalizeFeedbackMilestones = (value: unknown): string[] => [
  ...new Set(
    Array.isArray(value)
      ? value.filter((item): item is string =>
          typeof item === 'string' && FEEDBACK_MILESTONE_IDS.has(item))
      : [],
  ),
];

export type OnboardingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type LoadOnboardingStateResult =
  | { status: 'empty'; state: OnboardingLabState }
  | { status: 'loaded'; state: OnboardingLabState }
  | { status: 'error'; state: OnboardingLabState; message: string };

export type SaveOnboardingStateResult =
  | { success: true; state: OnboardingLabState }
  | { success: false; message: string };

export type ClearOnboardingStateResult =
  | { success: true }
  | { success: false; message: string };

const SCREEN_IDS = new Set<OnboardingScreenId>([
  'welcome',
  'business',
  'photo_social',
  'location_contact',
  'hours',
  'booking_preferences',
  'starter',
  'starting_preview',
  'about',
  'about_design',
  'policies',
  'site_style',
  'save_progress',
  'extras',
  'final_preview',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isScreenId = (value: unknown): value is OnboardingScreenId =>
  typeof value === 'string' && SCREEN_IDS.has(value as OnboardingScreenId);

const WEEKDAYS: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const STRUCTURAL_ABOUT_VISIBILITY = [
  'profile_photo',
  'owner_name',
  'salon_name',
  'bio',
  'book_button',
] as const;

const isDayHours = (value: unknown): boolean => isRecord(value)
  && typeof value.closed === 'boolean'
  && typeof value.open === 'string'
  && typeof value.close === 'string';

const hasValidDays = (value: unknown): value is WeeklyHoursDraft['days'] => isRecord(value)
  && WEEKDAYS.every((day) => isDayHours(value[day]));

const isWeeklyHoursDraft = (value: unknown): value is WeeklyHoursDraft => isRecord(value)
  && hasValidDays(value.days)
  && (value.setupState === 'unset'
    || value.setupState === 'configured'
    || value.setupState === 'skipped')
  && typeof value.showOnSite === 'boolean';

const isClientContactDraft = (value: unknown): value is ClientContactDraft => isRecord(value)
  && typeof value.primaryNumber === 'string'
  && typeof value.callEnabled === 'boolean'
  && typeof value.textEnabled === 'boolean'
  && typeof value.useDifferentTextNumber === 'boolean'
  && typeof value.differentTextNumber === 'string';

const isBusinessStructure = (value: unknown): value is BusinessStructure | null =>
  value === null || value === 'solo' || value === 'multi_tech';

const isOnboardingBusinessType = (
  value: unknown,
): value is OnboardingBusinessType | null => value === null
  || value === 'independent_salon'
  || value === 'home_based'
  || value === 'mobile'
  || value === 'salon_team';

const isQuickBookLayoutId = (value: unknown): value is QuickBookLayoutId =>
  value === 'compact_dropdown'
  || value === 'clean_card'
  || value === 'editorial'
  || value === 'hub_menu'
  || value === 'profile_story'
  || value === 'ultra_minimal';

const isNullableBoolean = (value: unknown): value is boolean | null =>
  value === null || typeof value === 'boolean';

const isDepositDraft = (value: unknown): value is DepositDraft => isRecord(value)
  && (value.mode === 'none' || value.mode === 'fixed')
  && (value.amountCents === null
    || (Number.isSafeInteger(value.amountCents) && Number(value.amountCents) >= 0))
  && isNullableBoolean(value.refundable)
  && isNullableBoolean(value.transferable)
  && typeof value.wordingOverride === 'string';

const isOwnerOverride = (value: unknown): boolean => isRecord(value)
  && (value.durationMinutes === undefined
    || (Number.isSafeInteger(value.durationMinutes) && Number(value.durationMinutes) > 0))
  && (value.priceCents === undefined
    || (Number.isSafeInteger(value.priceCents) && Number(value.priceCents) >= 0));

const isServiceMenuSelection = (
  value: unknown,
): value is ServiceMenuSelectionDraft => {
  if (!isRecord(value)) return false;
  const selectedServiceIds = value.selectedServiceIds;
  const selectedAddOnIds = value.selectedAddOnIds;
  const ownerOverridesByServiceId = value.ownerOverridesByServiceId;
  if (!Array.isArray(selectedServiceIds)
    || !selectedServiceIds.every((item) => typeof item === 'string')
    || (selectedAddOnIds !== undefined && (
      !Array.isArray(selectedAddOnIds)
      || !selectedAddOnIds.every((item) => typeof item === 'string')
    ))
    || !isRecord(ownerOverridesByServiceId)
    || !Object.values(ownerOverridesByServiceId).every(isOwnerOverride)) {
    return false;
  }
  const normalized = serviceMenuPort.normalizeSelection(
    value as ServiceMenuSelectionDraft,
  );
  return normalized.selectedServiceIds.length === selectedServiceIds.length
    && normalized.selectedServiceIds.every(
      (serviceId, index) => serviceId === selectedServiceIds[index],
    )
    && (selectedAddOnIds === undefined || (
      (normalized.selectedAddOnIds?.length ?? 0) === selectedAddOnIds.length
      && normalized.selectedAddOnIds?.every(
        (addOnId, index) => addOnId === selectedAddOnIds[index],
      ) === true
    ))
    && Object.keys(normalized.ownerOverridesByServiceId).length
      === Object.keys(ownerOverridesByServiceId).length;
};

const isChecklistFixtureStatus = (
  value: unknown,
): value is SetupChecklistFixtureStatus => value === 'not_connected'
  || value === 'connected'
  || value === 'needs_attention';

const isDashboardHandoffDraft = (
  value: unknown,
): value is DashboardHandoffDraft => isRecord(value)
  && typeof value.tourCompleted === 'boolean'
  && isRecord(value.checklistFixtures)
  && isChecklistFixtureStatus(value.checklistFixtures.googleCalendar)
  && isChecklistFixtureStatus(value.checklistFixtures.payments)
  && isChecklistFixtureStatus(value.checklistFixtures.shareBookingLink);

const isSessionStatus = (value: unknown): value is OnboardingSessionStatus =>
  value === 'active'
  || value === 'paused'
  || value === 'builder'
  || value === 'dashboard';

const isPlanIntent = (value: unknown): value is PlanIntent | null => value === null
  || value === 'founding'
  || value === 'monthly'
  || value === 'free';

const SITE_PALETTE_IDS = new Set<SitePalettePresetId>([
  'luster_berry',
  'blush_cocoa',
  'terracotta_cream',
  'sage_stone',
  'lilac_plum',
  'navy_ivory',
  'monochrome',
  'black_champagne',
]);

const isSitePalettePresetId = (value: unknown): value is SitePalettePresetId =>
  typeof value === 'string' && SITE_PALETTE_IDS.has(value as SitePalettePresetId);

const QUICK_BOOK_PROFILE_VISIBILITY_KEYS = [
  'showBio',
  'showBookingPolicy',
  'showCancellationPolicy',
  'showEmail',
  'showHours',
  'showInstagram',
  'showLocation',
  'showPhone',
  'showReviews',
  'showTechName',
  'showTechPhoto',
] as const satisfies readonly (keyof QuickBookProfileVisibilityDraft)[];

const isQuickBookProfileVisibility = (
  value: unknown,
): value is QuickBookProfileVisibilityDraft => isRecord(value)
  && QUICK_BOOK_PROFILE_VISIBILITY_KEYS.every(
    key => typeof value[key] === 'boolean',
  );

const isFoundingOfferMode = (value: unknown): value is FoundingOfferMode =>
  value === 'lifetime'
  || value === 'discounted_annual'
  || value === 'locked_monthly'
  || value === 'free_beta'
  || value === 'hidden';

const isCanvaUploadResult = (
  value: unknown,
): value is CanvaDraft['uploadResult'] => value === null || (
  isRecord(value)
  && typeof value.addedCount === 'number'
  && typeof value.summary === 'string'
  && Array.isArray(value.failures)
  && value.failures.every((failure) => isRecord(failure)
    && typeof failure.fileName === 'string'
    && typeof failure.message === 'string'
    && (failure.code === undefined || typeof failure.code === 'string'))
);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isUnsafeEphemeralImageUrl = (value: unknown): boolean => typeof value === 'string'
  && /^\s*(?:blob|data):/iu.test(value);

const isAccountBackedFixtureReference = (
  previewUrl: string | undefined,
  storageId: string | undefined,
): boolean => Boolean(
  previewUrl
  && storageId
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(storageId)
  && previewUrl === `/api/onboarding/v1/media/${encodeURIComponent(storageId)}`,
);

const copySafeImageMetadata = (
  value: Record<string, unknown>,
): Omit<LocalImageReference, 'source'> | null => {
  if (typeof value.id !== 'string'
    || typeof value.fileName !== 'string'
    || typeof value.mimeType !== 'string') {
    return null;
  }
  return {
    ...(typeof value.altText === 'string' ? { altText: value.altText } : {}),
    fileName: value.fileName,
    ...(typeof value.height === 'number' && Number.isFinite(value.height) && value.height > 0
      ? { height: value.height }
      : {}),
    id: value.id,
    mimeType: value.mimeType,
    ...(typeof value.width === 'number' && Number.isFinite(value.width) && value.width > 0
      ? { width: value.width }
      : {}),
  };
};

/**
 * Converts legacy in-document image bytes and ephemeral object URLs into an
 * honest metadata-only state. The filename/dimensions remain available so the
 * owner can identify what needs to be selected again on this device.
 */
const normalizeLocalImageReference = (
  value: unknown,
): LocalImageReference | undefined => {
  if (!isRecord(value)) return undefined;
  const metadata = copySafeImageMetadata(value);
  if (!metadata) return undefined;
  const storageId = typeof value.storageId === 'string' && value.storageId.trim()
    ? value.storageId
    : undefined;
  const previewUrl = typeof value.previewUrl === 'string' && value.previewUrl.trim()
    ? value.previewUrl
    : undefined;

  if (value.source === 'indexed_db' && storageId) {
    return { ...metadata, source: 'indexed_db', storageId };
  }
  if (value.source === 'fixture' && !isUnsafeEphemeralImageUrl(previewUrl)) {
    return {
      ...metadata,
      ...(previewUrl ? { previewUrl } : {}),
      source: 'fixture',
      ...(isAccountBackedFixtureReference(previewUrl, storageId)
        ? { storageId }
        : {}),
    };
  }
  if (value.source === 'missing'
    || value.source === 'data_url'
    || isUnsafeEphemeralImageUrl(previewUrl)
    || (value.source === 'indexed_db' && !storageId)) {
    return { ...metadata, source: 'missing' };
  }
  return undefined;
};

const normalizeGalleryDraft = (
  value: unknown,
  fallback: GalleryDraft,
): GalleryDraft => {
  if (!isRecord(value)) return fallback;
  const images = Array.isArray(value.images)
    ? value.images.flatMap((image) => {
        const normalized = normalizeLocalImageReference(image);
        return normalized ? [normalized] : [];
      })
    : [];
  const source = value.source === 'uploads' || value.source === 'mock_luster'
    ? value.source
    : null;
  const layout = value.layout === 'grid'
    || value.layout === 'carousel'
    || value.layout === 'editorial'
    ? value.layout
    : fallback.layout;
  return {
    images,
    layout,
    source: images.length > 0 ? source : null,
  };
};

const normalizeOnboardingMediaReferences = <T>(value: T): T => {
  if (!isRecord(value)) return value;
  const defaults = createDefaultOnboardingState();
  const profile = isRecord(value.profile) ? { ...value.profile } : null;
  if (profile) {
    const profilePhoto = normalizeLocalImageReference(profile.profilePhoto);
    const logo = normalizeLocalImageReference(profile.logo);
    delete profile.profilePhoto;
    delete profile.logo;
    if (profilePhoto) profile.profilePhoto = profilePhoto;
    if (logo) profile.logo = logo;
  }
  return {
    ...value,
    gallery: normalizeGalleryDraft(value.gallery, defaults.gallery),
    ...(profile ? { profile } : {}),
  } as T;
};

const isCurrentLocalImageReference = (
  value: unknown,
): value is LocalImageReference => {
  const normalized = normalizeLocalImageReference(value);
  if (!normalized || !isRecord(value) || normalized.source === 'data_url') return false;
  return JSON.stringify(normalized) === JSON.stringify(value);
};

const isGalleryDraft = (value: unknown): value is GalleryDraft => isRecord(value)
  && (value.layout === 'grid' || value.layout === 'carousel' || value.layout === 'editorial')
  && (value.source === null || value.source === 'uploads' || value.source === 'mock_luster')
  && Array.isArray(value.images)
  && value.images.every(isCurrentLocalImageReference);

type SharedStateShape = Record<string, unknown> & {
  canva: Record<string, unknown>;
  planOffer: Record<string, unknown>;
  profile: Record<string, unknown>;
  progress: Record<string, unknown>;
  recipe: Record<string, unknown>;
  reviewOptions: Record<string, unknown>;
};

const hasSharedStateShape = (value: unknown): value is SharedStateShape => {
  if (!isRecord(value)) return false;
  return isRecord(value.profile)
    && isRecord(value.recipe)
    && isRecord(value.progress)
    && isRecord(value.gallery)
    && isRecord(value.canva)
    && isRecord(value.planOffer)
    && isRecord(value.reviewOptions)
    && Array.isArray(value.eventJournal)
    && isScreenId(value.progress.currentScreen)
    && isScreenId(value.progress.lastActiveScreen)
    && Array.isArray(value.progress.screenHistory)
    && value.progress.screenHistory.every(isScreenId)
    && Array.isArray(value.progress.visitedScreens)
    && value.progress.visitedScreens.every(isScreenId)
    && Array.isArray(value.progress.skippedOptionalItems);
};

const isOnboardingState = (value: unknown): value is OnboardingLabState => {
  if (!hasSharedStateShape(value) || value.schemaVersion !== ONBOARDING_SCHEMA_VERSION) {
    return false;
  }
  return isWeeklyHoursDraft(value.profile.hours)
    && typeof value.anonymousDraftId === 'string'
    && /^draft_[a-z0-9_-]{12,100}$/iu.test(value.anonymousDraftId)
    && isBusinessStructure(value.profile.businessStructure)
    && isOnboardingBusinessType(value.profile.businessType)
    && typeof value.profile.siteSlug === 'string'
    && typeof value.profile.siteSlugCustomized === 'boolean'
    && isClientContactDraft(value.profile.clientContact)
    && (value.profile.profilePhoto === undefined
      || isCurrentLocalImageReference(value.profile.profilePhoto))
    && (value.profile.logo === undefined
      || isCurrentLocalImageReference(value.profile.logo))
    && isGalleryDraft(value.gallery)
    && isRecord(value.profile.bookingPreferences)
    && Number.isSafeInteger(value.profile.bookingPreferences.minimumNoticeMinutes)
    && Number(value.profile.bookingPreferences.minimumNoticeMinutes) >= 0
    && !('depositPreference' in value.profile.bookingPreferences)
    && isServiceMenuSelection(value.profile.serviceMenu)
    && isRecord(value.profile.policies)
    && isDepositDraft(value.profile.policies.deposits)
    && !('amount' in value.profile.policies.deposits)
    && !('amountType' in value.profile.policies.deposits)
    && !('required' in value.profile.policies.deposits)
    && isDashboardHandoffDraft(value.dashboardHandoff)
    && isRecord(value.recipe)
    && isSitePalettePresetId(value.recipe.palettePreset)
    && typeof value.recipe.paletteConfirmed === 'boolean'
    && isQuickBookLayoutId(value.recipe.quickBookLayout)
    && isQuickBookProfileVisibility(value.recipe.quickBookProfile)
    && isRecord(value.profile.location)
    && typeof value.profile.location.allowGeneralAreaDirections === 'boolean'
    && isSessionStatus(value.progress.sessionStatus)
    && isPlanIntent(value.planOffer.planIntent)
    && isFoundingOfferMode(value.planOffer.foundingMode)
    && typeof value.reviewOptions.previewTimestamp === 'string'
    && isStringArray(value.canva.ownedAssetIds)
    && isCanvaUploadResult(value.canva.uploadResult);
};

type LegacyWeeklyHoursDraft = {
  days: WeeklyHoursDraft['days'];
  skipped: boolean;
};

const isLegacyWeeklyHoursDraft = (value: unknown): value is LegacyWeeklyHoursDraft =>
  isRecord(value) && hasValidDays(value.days) && typeof value.skipped === 'boolean';

const LEGACY_DEFAULT_DAYS: WeeklyHoursDraft['days'] = Object.fromEntries(
  WEEKDAYS.map((day) => [day, {
    close: day === 'saturday' ? '16:00' : '17:00',
    closed: day === 'sunday',
    open: day === 'saturday' ? '10:00' : '09:00',
  }]),
) as WeeklyHoursDraft['days'];

const legacyHoursWereEdited = (hours: LegacyWeeklyHoursDraft): boolean =>
  WEEKDAYS.some((day) => {
    const current = hours.days[day];
    const seeded = LEGACY_DEFAULT_DAYS[day];
    return current.closed !== seeded.closed
      || current.open !== seeded.open
      || current.close !== seeded.close;
  });

type LegacyBusinessType =
  | 'solo'
  | 'home_studio'
  | 'salon_suite'
  | 'traditional_salon'
  | 'mobile'
  | 'multi_tech';

const LEGACY_LOCATION_TYPES: Partial<Record<LegacyBusinessType, LocationType>> = {
  home_studio: 'home_studio',
  mobile: 'mobile_service',
  salon_suite: 'salon_suite',
  traditional_salon: 'traditional_salon',
};

const isLegacyBusinessType = (value: unknown): value is LegacyBusinessType =>
  value === 'solo'
  || value === 'home_studio'
  || value === 'salon_suite'
  || value === 'traditional_salon'
  || value === 'mobile'
  || value === 'multi_tech';

const migrateClientContact = (
  profile: Record<string, unknown>,
): ClientContactDraft => {
  if (isClientContactDraft(profile.clientContact)) return profile.clientContact;
  const phone = typeof profile.phone === 'string' ? profile.phone : '';
  const textPhone = typeof profile.textPhone === 'string' ? profile.textPhone : '';
  const hasPhone = Boolean(phone.trim());
  const hasText = Boolean(textPhone.trim());
  const differentNumbers = hasPhone && hasText && phone.trim() !== textPhone.trim();
  const preferredContact = profile.preferredContact;
  const primaryNumber = hasPhone ? phone : textPhone;
  return {
    callEnabled: hasPhone || (preferredContact === 'call' && Boolean(primaryNumber.trim())),
    differentTextNumber: differentNumbers ? textPhone : '',
    primaryNumber,
    textEnabled: hasText || (preferredContact === 'text' && Boolean(primaryNumber.trim())),
    useDifferentTextNumber: differentNumbers,
  };
};

type LegacyDepositMode = LegacyV5DepositArchive['mode'];
type LegacyDepositAmountType = LegacyV5DepositArchive['amountType'];

const isLegacyDepositMode = (value: unknown): value is LegacyDepositMode =>
  value === null
  || value === 'none'
  || value === 'generally_required'
  || value === 'depends_on_service';

const isLegacyDepositAmountType = (
  value: unknown,
): value is LegacyDepositAmountType => value === null
  || value === 'fixed'
  || value === 'percentage'
  || value === 'service_defined';

const migrateLegacyDepositMode = (
  deposits: Record<string, unknown>,
  bookingPreferences: Record<string, unknown>,
): LegacyDepositMode => {
  if (isLegacyDepositMode(deposits.mode)) return deposits.mode;
  if (deposits.required === true) return 'generally_required';
  if (deposits.required === false) return 'none';
  switch (bookingPreferences.depositPreference) {
    case 'yes': return 'generally_required';
    case 'no': return 'none';
    case 'depends_on_service': return 'depends_on_service';
    default: return null;
  }
};

const parseLegacyFixedDepositCents = (value: unknown): number | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(String(value).trim().replace(/^\$/u, '').replaceAll(',', ''));
  return bookingPreferencesPort.normalizeCustomDepositAmount(String(parsed));
};

const migrateMinimumNoticeMinutes = (
  bookingPreferences: Record<string, unknown>,
): BusinessProfileDraft['bookingPreferences'] => {
  const advanceNotice = bookingPreferences.advanceNotice;
  const customAdvanceNotice = typeof bookingPreferences.customAdvanceNotice === 'string'
    ? bookingPreferences.customAdvanceNotice
    : '';
  let minimumNoticeMinutes = 120;
  if (Number.isSafeInteger(bookingPreferences.minimumNoticeMinutes)
    && Number(bookingPreferences.minimumNoticeMinutes) >= 0) {
    minimumNoticeMinutes = Number(bookingPreferences.minimumNoticeMinutes);
  } else if (advanceNotice === 'same_day') {
    minimumNoticeMinutes = 0;
  } else if (advanceNotice === '24_hours') {
    minimumNoticeMinutes = 1_440;
  } else if (advanceNotice === '48_hours') {
    minimumNoticeMinutes = 2_880;
  } else if (advanceNotice === 'custom') {
    const match = customAdvanceNotice.trim().match(
      /^(\d+(?:\.\d+)?)\s*(hours?|hrs?|days?)?$/iu,
    );
    if (match) {
      const normalized = bookingPreferencesPort.normalizeCustomMinimumNotice(
        match[1] ?? '0',
        match[2]?.toLocaleLowerCase('en-US').startsWith('day') ? 'days' : 'hours',
      );
      if (normalized !== null) minimumNoticeMinutes = normalized;
    }
  }

  return {
    minimumNoticeMinutes,
    newClientStatus: bookingPreferences.newClientStatus === 'yes'
      || bookingPreferences.newClientStatus === 'no'
      || bookingPreferences.newClientStatus === 'ask_first'
      || bookingPreferences.newClientStatus === 'waitlist_only'
      ? bookingPreferences.newClientStatus
      : null,
    visitMode: bookingPreferences.visitMode === 'appointment_only'
      || bookingPreferences.visitMode === 'walk_ins_only'
      || bookingPreferences.visitMode === 'appointments_and_walk_ins'
      ? bookingPreferences.visitMode
      : null,
    ...(advanceNotice === 'same_day'
      || advanceNotice === '24_hours'
      || advanceNotice === '48_hours'
      || advanceNotice === 'custom'
      ? {
          legacyV5Archive: {
            advanceNotice,
            customAdvanceNotice,
          },
        }
      : {}),
  };
};

const migrateDepositPolicy = (
  profile: Record<string, unknown>,
): Pick<BusinessProfileDraft, 'bookingPreferences' | 'policies'> => {
  const defaults = createDefaultOnboardingState().profile;
  const policies = isRecord(profile.policies) ? profile.policies : {};
  const deposits = isRecord(policies.deposits) ? policies.deposits : {};
  const bookingPreferences = isRecord(profile.bookingPreferences)
    ? profile.bookingPreferences
    : {};
  const legacyMode = migrateLegacyDepositMode(deposits, bookingPreferences);
  const legacyAmountType = isLegacyDepositAmountType(deposits.amountType)
    ? deposits.amountType
    : legacyMode === 'depends_on_service'
      ? 'service_defined'
      : null;
  const legacyAmount = typeof deposits.amount === 'string'
    ? deposits.amount
    : typeof deposits.amount === 'number'
      ? String(deposits.amount)
      : '';
  const depositCopy = isRecord(policies.copy)
    && isRecord(policies.copy.deposits)
    ? policies.copy.deposits
    : {};
  const migratedDeposit = bookingPreferencesPort.normalizeDepositDraft({
    amountCents: legacyMode === 'generally_required' && legacyAmountType === 'fixed'
      ? parseLegacyFixedDepositCents(legacyAmount)
      : null,
    legacyV5Archive: {
      amount: legacyAmount,
      amountType: legacyAmountType,
      mode: legacyMode,
    },
    mode: legacyMode === 'generally_required' ? 'fixed' : 'none',
    refundable: isNullableBoolean(deposits.refundable) ? deposits.refundable : null,
    transferable: isNullableBoolean(deposits.transferable) ? deposits.transferable : null,
    wordingOverride: typeof deposits.wordingOverride === 'string'
      ? deposits.wordingOverride
      : typeof depositCopy.wordingOverride === 'string'
        ? depositCopy.wordingOverride
        : '',
  });

  return {
    bookingPreferences: migrateMinimumNoticeMinutes(bookingPreferences),
    policies: {
      ...defaults.policies,
      ...(policies as BusinessProfileDraft['policies']),
      copy: {
        ...defaults.policies.copy,
        ...(isRecord(policies.copy)
          ? policies.copy as BusinessProfileDraft['policies']['copy']
          : {}),
      },
      deposits: migratedDeposit,
    },
  };
};

const migrateBusinessProfile = (
  value: Record<string, unknown>,
): BusinessProfileDraft => {
  const defaults = createDefaultOnboardingState().profile;
  const nextProfile = { ...value };
  delete nextProfile.businessType;
  delete nextProfile.phone;
  delete nextProfile.textPhone;

  const legacyBusinessType = isLegacyBusinessType(value.businessType)
    ? value.businessType
    : null;
  const businessStructure = isBusinessStructure(value.businessStructure)
    ? value.businessStructure
    : legacyBusinessType === 'multi_tech'
      ? 'multi_tech'
      : legacyBusinessType
        ? 'solo'
        : null;
  const legacyLocationType = legacyBusinessType
    ? LEGACY_LOCATION_TYPES[legacyBusinessType]
    : undefined;
  const location = isRecord(value.location) ? value.location : {};
  const depositPolicy = migrateDepositPolicy(value);
  const serviceMenu = isServiceMenuSelection(value.serviceMenu)
    ? serviceMenuPort.normalizeSelection(value.serviceMenu)
    : defaults.serviceMenu;
  const legacyAbout = isRecord(value.about) ? value.about : {};
  const legacyAboutVisibility = isRecord(legacyAbout.visibility)
    ? legacyAbout.visibility
    : {};
  const aboutVisibility = Object.fromEntries(
    Object.entries(defaults.about.visibility).map(([element, defaultVisible]) => [
      element,
      typeof legacyAboutVisibility[element] === 'boolean'
        ? legacyAboutVisibility[element]
        : defaultVisible,
    ]),
  ) as BusinessProfileDraft['about']['visibility'];
  for (const element of STRUCTURAL_ABOUT_VISIBILITY) aboutVisibility[element] = true;
  const migratedProfile = {
    ...defaults,
    ...(nextProfile as unknown as BusinessProfileDraft),
    about: {
      ...defaults.about,
      ...(legacyAbout as unknown as BusinessProfileDraft['about']),
      visibility: aboutVisibility,
    },
    businessStructure,
    businessType: isOnboardingBusinessType(value.businessType)
      ? value.businessType
      : inferOnboardingBusinessType({
          businessStructure,
          locationType: location.locationType
            ? location.locationType as LocationType
            : legacyLocationType ?? null,
        }),
    clientContact: migrateClientContact(value),
    ...depositPolicy,
    serviceMenu,
    location: {
      ...defaults.location,
      ...(location as unknown as BusinessProfileDraft['location']),
      allowGeneralAreaDirections: typeof location.allowGeneralAreaDirections === 'boolean'
        ? location.allowGeneralAreaDirections
        : false,
      locationType: location.locationType
        ? location.locationType as LocationType
        : legacyLocationType ?? null,
    },
    siteSlug: typeof value.siteSlug === 'string' && value.siteSlug.trim()
      ? normalizeSiteSlug(value.siteSlug)
      : normalizeSiteSlug(typeof value.businessName === 'string' ? value.businessName : ''),
    siteSlugCustomized: typeof value.siteSlugCustomized === 'boolean'
      ? value.siteSlugCustomized
      : false,
    timeZone: typeof value.timeZone === 'string' && value.timeZone.trim()
      ? value.timeZone
      : defaults.timeZone,
  } satisfies BusinessProfileDraft;

  const instagram = resolveInstagramUsername(migratedProfile.instagram);
  if (instagram.status === 'resolved') {
    migratedProfile.instagram = instagram.username;
  }

  if (!migratedProfile.bookingOnlyContact) {
    migratedProfile.preferredContact = getCoherentPreferredContact(migratedProfile);
  }
  return migratedProfile;
};

/**
 * Schema 9 had no Quick Book-specific visibility record. Preserve fields that
 * were provably public through existing profile/policy switches, but keep
 * ambiguous or unsupported data (notably reviews) private. This migration
 * changes presentation only and never removes the canonical profile values.
 */
const migrateQuickBookProfileVisibility = (
  recipe: Record<string, unknown>,
  profile: BusinessProfileDraft,
): QuickBookProfileVisibilityDraft => {
  if (isQuickBookProfileVisibility(recipe.quickBookProfile)) {
    return { ...recipe.quickBookProfile };
  }

  const aboutWasPublic = recipe.aboutEnabled === true;
  const policiesWerePublic = recipe.policiesEnabled === true;
  const instagram = resolveInstagramUsername(profile.instagram);
  const depositsWording = getResolvedPolicyWording(profile.policies, 'deposits').trim();
  const depositWasConfigured = (
    profile.policies.deposits.mode === 'fixed'
    && profile.policies.deposits.amountCents !== null
  ) || Boolean(
      profile.policies.deposits.wordingOverride.trim()
      || profile.policies.copy.deposits.wordingOverride.trim(),
    );
  const cancellationWording = getResolvedPolicyWording(
    profile.policies,
    'cancellations',
  ).trim();
  const locationWasPublic = profile.location.addressVisibility !== 'hidden'
    && Boolean(
      profile.location.cityOrArea.trim()
      || (profile.location.addressVisibility === 'public'
        && profile.location.exactAddress.trim()),
    );
  const phoneWasPublic = !profile.bookingOnlyContact
    && Boolean(profile.clientContact.primaryNumber.trim())
    && (profile.clientContact.callEnabled || profile.clientContact.textEnabled);

  return {
    ...DEFAULT_QUICK_BOOK_PROFILE_VISIBILITY,
    showBio: aboutWasPublic
      && profile.about.visibility.bio
      && Boolean(profile.about.shortBio.trim() || profile.about.fullBio.trim()),
    showBookingPolicy: Boolean(
      profile.bookingPreferences.visitMode
      || (policiesWerePublic
        && profile.policies.copy.deposits.visible
        && depositWasConfigured
        && depositsWording),
    ),
    showCancellationPolicy: policiesWerePublic
      && profile.policies.copy.cancellations.visible
      && Boolean(cancellationWording),
    showEmail: !profile.bookingOnlyContact && Boolean(profile.email.trim()),
    showHours: profile.hours.showOnSite && profile.hours.setupState === 'configured',
    showInstagram: instagram.status === 'resolved',
    showLocation: locationWasPublic,
    showPhone: phoneWasPublic,
    showTechName: aboutWasPublic
      && profile.about.visibility.owner_name
      && Boolean(profile.ownerName.trim()),
    showTechPhoto: aboutWasPublic
      && profile.about.visibility.profile_photo
      && Boolean(profile.profilePhoto),
  };
};

/**
 * Screens removed from the live flow by the starter-first opening (schema 9).
 * Old drafts can still point at them, so they remap onto the screens that
 * absorbed them rather than invalidating the whole saved state.
 */
const LEGACY_SCREEN_REMAP: Partial<Record<OnboardingScreenId, OnboardingScreenId>> = {
  photo_social: 'business',
  welcome: 'starter',
};

const remapLegacyScreen = (screen: OnboardingScreenId): OnboardingScreenId =>
  LEGACY_SCREEN_REMAP[screen] ?? screen;

const remapLegacyProgressScreens = (
  progress: Record<string, unknown>,
): Record<string, unknown> => {
  const screenHistory = (progress.screenHistory as OnboardingScreenId[])
    .map(remapLegacyScreen)
    .filter((screen, index, all) => index === 0 || screen !== all[index - 1]);
  return {
    ...progress,
    currentScreen: remapLegacyScreen(progress.currentScreen as OnboardingScreenId),
    lastActiveScreen: remapLegacyScreen(progress.lastActiveScreen as OnboardingScreenId),
    screenHistory,
    visitedScreens: [...new Set(
      (progress.visitedScreens as OnboardingScreenId[]).map(remapLegacyScreen),
    )],
  };
};

const migrateLegacyOnboardingState = (
  value: SharedStateShape,
): OnboardingLabState => {
  const defaults = createDefaultOnboardingState();
  const profile = value.profile as Record<string, unknown>;
  const reviewOptions = value.reviewOptions as Record<string, unknown>;
  const planOffer = value.planOffer;
  const legacyHours = isLegacyWeeklyHoursDraft(profile.hours) ? profile.hours : null;
  const edited = legacyHours ? legacyHoursWereEdited(legacyHours) : false;
  const hours = legacyHours
    ? {
        days: edited ? legacyHours.days : defaults.profile.hours.days,
        setupState: legacyHours.skipped ? 'skipped' as const : edited ? 'configured' as const : 'unset' as const,
        showOnSite: !legacyHours.skipped,
      }
    : profile.hours as WeeklyHoursDraft;
  const migratedProfile = {
    ...migrateBusinessProfile(profile),
    hours,
  };
  return {
    ...(value as unknown as OnboardingLabState),
    canva: {
      ...defaults.canva,
      ...(value.canva as unknown as CanvaDraft),
      ownedAssetIds: [...new Set(isStringArray(value.canva.ownedAssetIds)
        ? value.canva.ownedAssetIds
        : (Array.isArray(value.canva.images)
            ? value.canva.images.flatMap((image) => isRecord(image)
              && typeof image.storageId === 'string'
              ? [image.storageId]
              : [])
            : []))],
      uploadResult: isCanvaUploadResult(value.canva.uploadResult)
        ? value.canva.uploadResult
        : null,
    },
    dashboardHandoff: isDashboardHandoffDraft(value.dashboardHandoff)
      ? value.dashboardHandoff
      : defaults.dashboardHandoff,
    planOffer: {
      ...defaults.planOffer,
      ...(value.planOffer as unknown as OnboardingLabState['planOffer']),
      foundingMode: isFoundingOfferMode(planOffer.foundingMode)
        ? planOffer.foundingMode
        : defaults.planOffer.foundingMode,
      planIntent: planOffer.planIntent === 'lifetime'
        ? 'founding'
        : isPlanIntent(planOffer.planIntent)
          ? planOffer.planIntent
          : null,
    },
    anonymousDraftId: typeof value.anonymousDraftId === 'string'
      && /^draft_[a-z0-9_-]{12,100}$/iu.test(value.anonymousDraftId)
      ? value.anonymousDraftId
      : defaults.anonymousDraftId,
    profile: migratedProfile,
    progress: remapLegacyProgressScreens(
      value.progress,
    ) as unknown as OnboardingLabState['progress'],
    reviewOptions: {
      ...(reviewOptions as unknown as OnboardingLabState['reviewOptions']),
      feedbackMilestones: normalizeFeedbackMilestones(
        reviewOptions.feedbackMilestones,
      ),
      previewTimestamp: typeof reviewOptions.previewTimestamp === 'string'
        ? reviewOptions.previewTimestamp
        : defaults.reviewOptions.previewTimestamp,
    },
    recipe: {
      ...defaults.recipe,
      ...(value.recipe as OnboardingLabState['recipe']),
      paletteConfirmed: typeof value.recipe.paletteConfirmed === 'boolean'
        ? value.recipe.paletteConfirmed
        : false,
      palettePreset: isSitePalettePresetId(value.recipe.palettePreset)
        ? value.recipe.palettePreset
        : defaults.recipe.palettePreset,
      quickBookLayout: isQuickBookLayoutId(value.recipe.quickBookLayout)
        ? value.recipe.quickBookLayout
        : defaults.recipe.quickBookLayout,
      quickBookProfile: migrateQuickBookProfileVisibility(
        value.recipe,
        migratedProfile,
      ),
    },
    schemaVersion: ONBOARDING_SCHEMA_VERSION,
  };
};

const isLegacyOnboardingState = (value: unknown): value is SharedStateShape =>
  hasSharedStateShape(value)
  && (
    (value.schemaVersion === 1 && isLegacyWeeklyHoursDraft(value.profile.hours))
    || (value.schemaVersion === 2 && isWeeklyHoursDraft(value.profile.hours))
    || (value.schemaVersion === 3 && isWeeklyHoursDraft(value.profile.hours))
    || (value.schemaVersion === 4 && isWeeklyHoursDraft(value.profile.hours))
    || (value.schemaVersion === 5 && isWeeklyHoursDraft(value.profile.hours))
    || (value.schemaVersion === 6 && isWeeklyHoursDraft(value.profile.hours))
    || (value.schemaVersion === 7 && isWeeklyHoursDraft(value.profile.hours))
    || (value.schemaVersion === 8 && isWeeklyHoursDraft(value.profile.hours))
    || (value.schemaVersion === 9 && isWeeklyHoursDraft(value.profile.hours))
    || (value.schemaVersion === 10 && isWeeklyHoursDraft(value.profile.hours))
    || (value.schemaVersion === 11 && isWeeklyHoursDraft(value.profile.hours))
    || (value.schemaVersion === 12 && isWeeklyHoursDraft(value.profile.hours))
  );

const defaultStorage = (): OnboardingStorage => {
  if (typeof window === 'undefined') {
    throw new Error('Browser storage is not available.');
  }
  return window.localStorage;
};

const storageErrorMessage = (
  error: unknown,
  fallback: string,
): string => error instanceof Error && error.message ? error.message : fallback;

export const withLastSavedAt = (
  state: OnboardingLabState,
  timestamp: string,
): OnboardingLabState => ({
  ...state,
  progress: {
    ...state.progress,
    lastSavedAt: timestamp,
  },
});

export const serializeOnboardingState = (
  state: OnboardingLabState,
): string => JSON.stringify(normalizeOnboardingMediaReferences(state));

export const parseOnboardingState = (
  json: string,
): LoadOnboardingStateResult => {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    return {
      message: 'Saved onboarding progress is not valid JSON.',
      state: createDefaultOnboardingState(),
      status: 'error',
    };
  }
  const normalizedValue = normalizeOnboardingMediaReferences(value);
  if (isLegacyOnboardingState(normalizedValue)) {
    return { state: migrateLegacyOnboardingState(normalizedValue), status: 'loaded' };
  }
  if (!isOnboardingState(normalizedValue)) {
    return {
      message: 'Saved onboarding progress is incomplete or uses an unsupported version.',
      state: createDefaultOnboardingState(),
      status: 'error',
    };
  }
  const instagram = resolveInstagramUsername(normalizedValue.profile.instagram);
  const profile = {
    ...normalizedValue.profile,
    ...(instagram.status === 'resolved' ? { instagram: instagram.username } : {}),
  };
  if (!profile.bookingOnlyContact) {
    profile.preferredContact = getCoherentPreferredContact(profile);
  }
  return {
    state: {
      ...normalizedValue,
      profile,
      reviewOptions: {
        ...normalizedValue.reviewOptions,
        feedbackMilestones: normalizeFeedbackMilestones(
          normalizedValue.reviewOptions.feedbackMilestones,
        ),
      },
    },
    status: 'loaded',
  };
};

export const loadOnboardingState = (
  storage?: OnboardingStorage,
): LoadOnboardingStateResult => {
  try {
    const saved = (storage ?? defaultStorage()).getItem(ONBOARDING_STORAGE_KEY);
    return saved
      ? parseOnboardingState(saved)
      : { state: createDefaultOnboardingState(), status: 'empty' };
  } catch (error) {
    return {
      message: storageErrorMessage(error, 'Saved onboarding progress could not be read.'),
      state: createDefaultOnboardingState(),
      status: 'error',
    };
  }
};

export const saveOnboardingState = (
  state: OnboardingLabState,
  options: {
    storage?: OnboardingStorage;
    timestamp?: string;
  } = {},
): SaveOnboardingStateResult => {
  const savedState = normalizeOnboardingMediaReferences(withLastSavedAt(
    state,
    options.timestamp ?? new Date().toISOString(),
  ));
  try {
    (options.storage ?? defaultStorage()).setItem(
      ONBOARDING_STORAGE_KEY,
      serializeOnboardingState(savedState),
    );
    return { state: savedState, success: true };
  } catch (error) {
    return {
      message: storageErrorMessage(error, 'Onboarding progress could not be saved in this browser.'),
      success: false,
    };
  }
};

export const clearOnboardingState = (
  storage?: OnboardingStorage,
): ClearOnboardingStateResult => {
  try {
    (storage ?? defaultStorage()).removeItem(ONBOARDING_STORAGE_KEY);
    return { success: true };
  } catch (error) {
    return {
      message: storageErrorMessage(error, 'Onboarding progress could not be cleared.'),
      success: false,
    };
  }
};
