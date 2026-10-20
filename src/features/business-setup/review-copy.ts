import { getQuickBookLayout, isQuickBookLayoutId } from '@/libs/quickBookSiteLayout';

import { SITE_PALETTE_BY_ID } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/palettes';
import { websiteDetailsSchema } from '../custom-sites/website-details';

const WEBSITE_LABELS: Record<string, string> = {
  'website.config.layout': 'Website layout',
  'website.config.quickBookLayout': 'Booking page layout',
  'website.config.serviceMenuLayout': 'Service menu layout',
  'website.config.siteStylePreset': 'Website style',
  'website.config.sitePalettePreset': 'Website colours',
  'website.config.siteBodyFont': 'Body text font',
  'website.config.siteHeadingFont': 'Heading font',
  'website.config.sectionOrder': 'Website section order',
  'website.config.hiddenSections': 'Hidden website sections',
  'website.config.quickBookProfile.showBio': 'Show your introduction',
  'website.config.quickBookProfile.showEmail': 'Show your public email',
  'website.config.quickBookProfile.showHours': 'Show opening hours',
  'website.config.quickBookProfile.showPhone': 'Show your public phone number',
  'website.config.quickBookProfile.showReviews': 'Show reviews',
  'website.config.quickBookProfile.showLocation': 'Show your public location',
  'website.config.quickBookProfile.showTechName': 'Show your booking name',
  'website.config.quickBookProfile.showTechPhoto': 'Show your photo when added',
  'website.config.quickBookProfile.showInstagram': 'Show Instagram',
  'website.config.quickBookProfile.showBookingPolicy': 'Show the booking agreement',
  'website.config.quickBookProfile.showCancellationPolicy': 'Show cancellation information',
  'website.content.bio': 'Business introduction',
  'website.content.coverText': 'Cover wording',
  'website.content.locationDisplayMode': 'Website address visibility',
  'website.content.websiteDetails.locationDirections': 'Public intersection or directions',
  'website.content.websiteDetails.instagram': 'Instagram',
  'website.content.websiteDetails.email': 'Public email',
  'website.content.websiteDetails.phone': 'Public phone number',
  'website.content.websiteDetails.sections': 'Website policies and information',
};

function words(identifier: string) {
  const text = identifier.replace(/([a-z])([A-Z])/gu, '$1 $2').replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function websiteReviewLabel(path: string) {
  return WEBSITE_LABELS[path] ?? (path.startsWith('website.') ? `Website · ${words(path.split('.').at(-1)!)}` : undefined);
}

/** Format known configuration identifiers; never rewrite owner-authored text. */
export function websiteReviewValue(path: string, value: unknown): string | undefined {
  if (path === 'website.content.websiteDetails') {
    if (value === null || value === undefined) {
      return 'No public contact details or website policies saved';
    }
    const parsed = websiteDetailsSchema.safeParse(value);
    if (!parsed.success) {
      return undefined;
    }
    const details = parsed.data;
    return [
      `Instagram: ${details.instagram || 'Not set'}`,
      `Public email: ${details.email || 'Not set'}`,
      `Public phone: ${details.phone || 'Not set'}`,
      `Public intersection or directions: ${details.locationDirections || 'Not set'}`,
      `Website policies and information: ${details.sections.length ? details.sections.map(section => `${section.title}\n${section.text}`).join('\n\n') : 'None'}`,
    ].join('\n');
  }
  if (path === 'website.content.websiteDetails.sections') {
    const parsed = websiteDetailsSchema.shape.sections.safeParse(value);
    return parsed.success ? parsed.data.map(section => `${section.title}\n${section.text}`).join('\n\n') || 'None' : undefined;
  }
  if (typeof value === 'boolean' && path.startsWith('website.config.quickBookProfile.')) {
    return value ? 'Shown when available' : 'Hidden';
  }
  if (typeof value !== 'string' || !value) {
    return undefined;
  }
  if (path === 'business.locationDisplayMode' || path === 'website.content.locationDisplayMode') {
    return ({ full_address: 'Full address publicly', after_booking: 'Full address after a confirmed booking', city_only: 'City or area only' } as Record<string, string>)[value];
  }
  if (path === 'business.workMode') {
    return ({ solo: 'I work alone', team: 'I have a team', unknown: 'Not chosen' } as Record<string, string>)[value];
  }
  if (path === 'booking.confirmationMode') {
    return ({ instant: 'Confirm automatically', request_approval: 'Ask me to approve appointment requests' } as Record<string, string>)[value];
  }
  if (path === 'website.config.quickBookLayout' && isQuickBookLayoutId(value)) {
    return getQuickBookLayout(value).label;
  }
  if (path === 'website.config.sitePalettePreset') {
    return Object.values(SITE_PALETTE_BY_ID).find(palette => palette.id === value)?.label ?? words(value);
  }
  if (['website.config.siteStylePreset', 'website.config.siteBodyFont', 'website.config.siteHeadingFont', 'website.config.serviceMenuLayout', 'website.config.layout'].includes(path)) {
    return words(value);
  }
  return undefined;
}
