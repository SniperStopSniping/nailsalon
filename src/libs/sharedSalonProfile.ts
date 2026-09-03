import type { SalonSettings } from '@/types/salonPolicy';

import type { LocationDisplayMode } from './bookingPageContent';
import { applyPhoneDisplayMode } from './salonContent';

export type SharedSalonBusinessType =
  | 'independent_salon'
  | 'home_based'
  | 'mobile'
  | 'salon_team';

export type SharedSalonProfile = {
  bookingOnlyContact: boolean | null;
  businessType: SharedSalonBusinessType | null;
  callEnabled: boolean | null;
  entranceInstructions: string | null;
  textEnabled: boolean | null;
  textNumber: string | null;
  transitInformation: string | null;
};

export const EMPTY_SHARED_SALON_PROFILE: SharedSalonProfile = {
  bookingOnlyContact: null,
  businessType: null,
  callEnabled: null,
  entranceInstructions: null,
  textEnabled: null,
  textNumber: null,
  transitInformation: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized && Array.from(normalized).length <= maximum
    ? normalized
    : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function optionalBusinessType(value: unknown): SharedSalonBusinessType | null {
  return value === 'independent_salon'
    || value === 'home_based'
    || value === 'mobile'
    || value === 'salon_team'
    ? value
    : null;
}

/**
 * Resolves the shared salon-profile JSON defensively. A malformed field fails
 * closed on its own and cannot hide another valid field or leak unvalidated
 * owner text into a public template.
 */
export function resolveSharedSalonProfile(
  settings: SalonSettings | null | undefined,
): SharedSalonProfile {
  const raw = isRecord(settings?.sharedProfile) ? settings.sharedProfile : {};

  return {
    bookingOnlyContact: optionalBoolean(raw.bookingOnlyContact),
    businessType: optionalBusinessType(raw.businessType),
    callEnabled: optionalBoolean(raw.callEnabled),
    entranceInstructions: optionalText(raw.entranceInstructions, 2_000),
    textEnabled: optionalBoolean(raw.textEnabled),
    textNumber: optionalText(raw.textNumber, 64),
    transitInformation: optionalText(raw.transitInformation, 2_000),
  };
}

/**
 * The shared booking-only decision is the global public-contact gate. The
 * canonical phone remains stored on the salon/location rows, while this
 * projection prevents every public booking surface from receiving it.
 * Missing legacy state preserves the established location-mode behavior.
 */
export function resolvePublicSalonPhone(
  profile: SharedSalonProfile,
  phone: string | null | undefined,
  locationDisplayMode: LocationDisplayMode,
): string | null {
  return profile.bookingOnlyContact === true
    ? null
    : applyPhoneDisplayMode(phone ?? null, locationDisplayMode);
}

/**
 * Compact public presentation of the same canonical values. It deliberately
 * returns no directions text unless the owner marked the address public.
 */
export function resolvePublicLocationInstructions(
  profile: SharedSalonProfile,
  options: {
    addressIsPublic: boolean;
    parkingInstructions: string | null | undefined;
  },
): string[] {
  if (!options.addressIsPublic) {
    return [];
  }
  const parkingInstructions = optionalText(options.parkingInstructions, 2_000);

  return [...new Set([
    profile.entranceInstructions,
    parkingInstructions
      ? `Parking: ${parkingInstructions}`
      : null,
    profile.transitInformation
      ? `Transit: ${profile.transitInformation}`
      : null,
  ].filter((value): value is string => Boolean(value)))];
}
