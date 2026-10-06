import type { BookingPageConfig, BookingPageConfigSide } from './bookingPageConfig';
import type { BookingPageContent, BookingPageContentSide } from './bookingPageContent';

// Client safe: compare the same saved draft/live pair that Publish uses.
// Operational records (prices, availability, contact details) are not drafts.
const CONFIG_LABELS: Record<keyof BookingPageConfigSide, string> = {
  layout: 'Page layout',
  sitePalettePreset: 'Colours',
  siteStylePreset: 'Visual style',
  siteHeadingFont: 'Heading font',
  siteBodyFont: 'Body font',
  quickBookLayout: 'Profile layout',
  serviceMenuLayout: 'Service menu layout',
  stylePack: 'Style pack',
  tokenOverrides: 'Style customizations',
  sectionOrder: 'Section order',
  sectionVariants: 'Section layouts',
  hiddenSections: 'Section visibility',
  businessMode: 'Business presentation',
  startMode: 'Booking entry',
  quickBookProfile: 'Profile and policy visibility',
};

const CONTENT_LABELS: Record<keyof BookingPageContentSide, string> = {
  heroImageUrl: 'Cover photo',
  specialtyLine: 'Specialty line',
  bio: 'Studio bio',
  locationDisplayMode: 'Address visibility',
  coverFocalPoint: 'Cover photo crop',
  portraitFocalPoint: 'Profile photo crop',
  coverTextMode: 'Cover text display',
  coverText: 'Cover text',
  galleryPhotoIds: 'Gallery photos',
};

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every(key => sameValue(a[key], b[key]));
  }
  return false;
}

export function summarizeBookingPageDraft(config: BookingPageConfig, content: BookingPageContent): string[] {
  return [
    ...Object.entries(CONFIG_LABELS).filter(([key]) => {
      const field = key as keyof BookingPageConfigSide;
      if (field === 'hiddenSections') {
        return !sameValue([...config.draft.hiddenSections].sort(), [...config.live.hiddenSections].sort());
      }
      return !sameValue(config.draft[field], config.live[field]);
    }).map(([, label]) => label),
    ...Object.entries(CONTENT_LABELS).filter(([key]) => {
      const field = key as keyof BookingPageContentSide;
      return !sameValue(content.draft[field], content.live[field]);
    }).map(([, label]) => label),
  ];
}
