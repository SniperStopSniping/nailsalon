import { createDefaultOnboardingState } from '../model/defaults';
import { getCoherentPreferredContact } from '../model/contact';
import {
  ONBOARDING_SCHEMA_VERSION,
  type BusinessProfileDraft,
  type BusinessStructure,
  type CanvaDraft,
  type ClientContactDraft,
  type DepositAmountType,
  type DepositPolicyMode,
  type LocationType,
  type OnboardingLabState,
  type OnboardingScreenId,
  type Weekday,
  type WeeklyHoursDraft,
} from '../model/types';

export const ONBOARDING_STORAGE_KEY = 'luster:onboarding-v1-lab';

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
  'booking_preferences',
  'starter',
  'starting_preview',
  'about',
  'about_design',
  'policies',
  'site_style',
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

const isDepositPolicyMode = (value: unknown): value is DepositPolicyMode | null =>
  value === null
  || value === 'none'
  || value === 'generally_required'
  || value === 'depends_on_service';

const isDepositAmountType = (value: unknown): value is DepositAmountType | null =>
  value === null
  || value === 'fixed'
  || value === 'percentage'
  || value === 'service_defined';

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

type SharedStateShape = Record<string, unknown> & {
  canva: Record<string, unknown>;
  profile: Record<string, unknown>;
  progress: Record<string, unknown>;
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
    && isBusinessStructure(value.profile.businessStructure)
    && isClientContactDraft(value.profile.clientContact)
    && isRecord(value.profile.bookingPreferences)
    && !('depositPreference' in value.profile.bookingPreferences)
    && isRecord(value.profile.policies)
    && isRecord(value.profile.policies.deposits)
    && isDepositPolicyMode(value.profile.policies.deposits.mode)
    && isDepositAmountType(value.profile.policies.deposits.amountType)
    && !('required' in value.profile.policies.deposits)
    && isRecord(value.profile.location)
    && typeof value.profile.location.allowGeneralAreaDirections === 'boolean'
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

const migrateDepositMode = (
  deposits: Record<string, unknown>,
  bookingPreferences: Record<string, unknown>,
): DepositPolicyMode | null => {
  if (isDepositPolicyMode(deposits.mode)) return deposits.mode;
  if (deposits.required === true) return 'generally_required';
  if (deposits.required === false) return 'none';
  switch (bookingPreferences.depositPreference) {
    case 'yes': return 'generally_required';
    case 'no': return 'none';
    case 'depends_on_service': return 'depends_on_service';
    default: return null;
  }
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
  const mode = migrateDepositMode(deposits, bookingPreferences);
  const amountType = mode === 'depends_on_service'
    ? 'service_defined'
    : deposits.amountType === 'fixed' || deposits.amountType === 'percentage'
      ? deposits.amountType
      : null;
  const { depositPreference: _legacyPreference, ...bookingValues } = bookingPreferences;
  const { required: _legacyRequired, ...depositValues } = deposits;

  return {
    bookingPreferences: {
      ...defaults.bookingPreferences,
      ...(bookingValues as BusinessProfileDraft['bookingPreferences']),
    },
    policies: {
      ...defaults.policies,
      ...(policies as BusinessProfileDraft['policies']),
      copy: {
        ...defaults.policies.copy,
        ...(isRecord(policies.copy)
          ? policies.copy as BusinessProfileDraft['policies']['copy']
          : {}),
      },
      deposits: {
        ...defaults.policies.deposits,
        ...(depositValues as BusinessProfileDraft['policies']['deposits']),
        amountType,
        mode,
      },
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
  const migratedProfile = {
    ...defaults,
    ...(nextProfile as unknown as BusinessProfileDraft),
    businessStructure,
    clientContact: migrateClientContact(value),
    ...depositPolicy,
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
  } satisfies BusinessProfileDraft;

  if (!migratedProfile.bookingOnlyContact) {
    migratedProfile.preferredContact = getCoherentPreferredContact(migratedProfile);
  }
  return migratedProfile;
};

const migrateLegacyOnboardingState = (
  value: SharedStateShape,
): OnboardingLabState => {
  const defaults = createDefaultOnboardingState();
  const profile = value.profile as Record<string, unknown>;
  const reviewOptions = value.reviewOptions as Record<string, unknown>;
  const legacyHours = isLegacyWeeklyHoursDraft(profile.hours) ? profile.hours : null;
  const edited = legacyHours ? legacyHoursWereEdited(legacyHours) : false;
  const hours = legacyHours
    ? {
        days: edited ? legacyHours.days : defaults.profile.hours.days,
        setupState: legacyHours.skipped ? 'skipped' as const : edited ? 'configured' as const : 'unset' as const,
        showOnSite: !legacyHours.skipped,
      }
    : profile.hours as WeeklyHoursDraft;
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
    profile: {
      ...migrateBusinessProfile(profile),
      hours,
    },
    reviewOptions: {
      ...(reviewOptions as unknown as OnboardingLabState['reviewOptions']),
      previewTimestamp: typeof reviewOptions.previewTimestamp === 'string'
        ? reviewOptions.previewTimestamp
        : defaults.reviewOptions.previewTimestamp,
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
): string => JSON.stringify(state);

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
  if (isLegacyOnboardingState(value)) {
    return { state: migrateLegacyOnboardingState(value), status: 'loaded' };
  }
  if (!isOnboardingState(value)) {
    return {
      message: 'Saved onboarding progress is incomplete or uses an unsupported version.',
      state: createDefaultOnboardingState(),
      status: 'error',
    };
  }
  return { state: value, status: 'loaded' };
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
  const savedState = withLastSavedAt(
    state,
    options.timestamp ?? new Date().toISOString(),
  );
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
