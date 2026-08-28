import type {
  AboutElementId,
  AboutPresetId,
  BusinessProfileDraft,
} from './types';

export const ABOUT_ELEMENT_IDS = [
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
] as const satisfies readonly AboutElementId[];

export type AboutPresetElementCapability = {
  availability: 'supported';
};

export type AboutPresetCapability = {
  elements: Readonly<Record<AboutElementId, AboutPresetElementCapability>>;
};

const createAllElementsSupported = (): AboutPresetCapability => ({
  elements: Object.fromEntries(
    ABOUT_ELEMENT_IDS.map((element) => [element, { availability: 'supported' }]),
  ) as Record<AboutElementId, AboutPresetElementCapability>,
});

/**
 * The renderer contract is deliberately exhaustive: an enabled About element
 * is available in every preset and therefore must never silently disappear.
 */
export const ABOUT_PRESET_CAPABILITIES = {
  about_before_you_book: createAllElementsSupported(),
  editorial_portrait: createAllElementsSupported(),
  photo_right: createAllElementsSupported(),
  profile_quick_facts: createAllElementsSupported(),
} as const satisfies Record<AboutPresetId, AboutPresetCapability>;

export const aboutPresetSupportsElement = (
  preset: AboutPresetId,
  element: AboutElementId,
): boolean => ABOUT_PRESET_CAPABILITIES[preset].elements[element].availability === 'supported';

const cleanInlineValue = (value: string): string => value.trim().replace(/\s+/gu, ' ');

const humanList = (values: readonly string[]): string => {
  if (values.length <= 1) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
};

/**
 * Converts the raw editing buffer into the structured Business Profile value.
 * Parsing happens only at a deliberate commit point so typing, paste, IME,
 * selection, and caret movement never rewrite the active textarea.
 */
export const parseAboutListInput = (value: string): string[] => value
  .split(/[,;\r\n]+/u)
  .map(cleanInlineValue)
  .filter(Boolean);

export const formatAboutListInput = (values: readonly string[]): string =>
  values.join(', ');

/** Deterministic Lab-only wording; no network or AI request is made. */
export const buildAboutWordingSuggestion = (
  profile: BusinessProfileDraft,
): string => {
  const ownerName = cleanInlineValue(profile.ownerName);
  const businessName = cleanInlineValue(profile.businessName);
  const area = cleanInlineValue(profile.location.cityOrArea);
  const specialties = profile.about.specialties
    .map(cleanInlineValue)
    .filter(Boolean)
    .slice(0, 4);

  const identity = ownerName && businessName
    ? `I’m ${ownerName}, the nail artist behind ${businessName}.`
    : ownerName
      ? `I’m ${ownerName}, an independent nail artist.`
      : businessName
        ? `I’m the nail artist behind ${businessName}.`
        : 'I’m an independent nail artist.';
  const specialtySentence = specialties.length > 0
    ? `My specialties include ${humanList(specialties)}.`
    : 'I focus on thoughtful, long-lasting nail care.';
  const locationSentence = area ? `I welcome clients in ${area}.` : '';

  return [
    identity,
    'I create calm, detail-focused appointments shaped around each client.',
    specialtySentence,
    locationSentence,
  ].filter(Boolean).join(' ');
};
