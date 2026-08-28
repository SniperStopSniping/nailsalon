import type { SiteBuilderDocument } from '../../model/types';
import { getIncompleteEssentials } from './essentials';
import type { OnboardingLabState, OnboardingScreenId } from '../model/types';

export type ReadinessStatus = 'ready' | 'recommended' | 'optional' | 'needs_attention';

export type ReadinessItem = {
  detail?: string;
  id: string;
  label: string;
  screen?: OnboardingScreenId;
  status: ReadinessStatus;
};

const hasBookingPath = (document: SiteBuilderDocument | null): boolean => Boolean(
  document?.pages.some((page) => page.visible && page.sections.some(
    (section) => section.visible && section.sectionType === 'booking',
  )),
);

export const getReadinessItems = (
  state: OnboardingLabState,
  document: SiteBuilderDocument | null,
): ReadinessItem[] => {
  const incomplete = getIncompleteEssentials(state);
  const items: ReadinessItem[] = incomplete.map((essential) => ({
    id: `essential-${essential.id}`,
    label: essential.label,
    screen: essential.screen,
    status: 'needs_attention',
  }));

  if (!hasBookingPath(document)) {
    items.push({
      detail: 'The universal starter must keep one visible Booking section.',
      id: 'booking-path-missing',
      label: 'No booking path',
      screen: 'starter',
      status: 'needs_attention',
    });
  } else {
    items.push({ id: 'booking-path', label: 'Booking path available', status: 'ready' });
  }
  if (state.profile.businessName.trim()) {
    items.push({ id: 'business-name', label: 'Business name added', status: 'ready' });
  }
  if (
    state.profile.bookingOnlyContact
    || state.profile.phone.trim()
    || state.profile.textPhone.trim()
    || state.profile.email.trim()
    || state.profile.instagram.trim()
  ) {
    items.push({ id: 'contact', label: 'Contact method added', status: 'ready' });
  }
  items.push({ id: 'mobile', label: 'Mobile layout ready', status: 'ready' });

  if (!state.recipe.policiesEnabled) {
    items.push({ id: 'policies', label: 'Add policies', screen: 'policies', status: 'recommended' });
  }
  if (!state.recipe.galleryEnabled) {
    items.push({ id: 'gallery', label: 'Add work', screen: 'extras', status: 'recommended' });
  }
  if (!state.recipe.aboutEnabled) {
    items.push({ id: 'about', label: 'Add About', screen: 'about', status: 'recommended' });
  }
  if (!state.recipe.canvaEnabled) {
    items.push({ id: 'canva', label: 'Upload Canva design', screen: 'extras', status: 'optional' });
  }
  if (!state.profile.logo) {
    items.push({ id: 'logo', label: 'Add logo', screen: 'photo_social', status: 'optional' });
  }
  if (state.canva.status === 'invalid') {
    items.push({
      detail: state.canva.errorMessage || 'Review the selected Canva asset.',
      id: 'canva-invalid',
      label: 'Invalid Canva asset',
      screen: 'extras',
      status: 'needs_attention',
    });
  }

  return items.filter((item, index, all) => all.findIndex((candidate) => (
    candidate.label === item.label && candidate.status === item.status
  )) === index);
};

export const getNeedsAttentionItems = (
  state: OnboardingLabState,
  document: SiteBuilderDocument | null,
): ReadinessItem[] => getReadinessItems(state, document).filter(
  (item) => item.status === 'needs_attention',
);

export const getBuilderPrimaryLabel = (
  state: OnboardingLabState,
  document: SiteBuilderDocument | null,
): string => {
  const needsAttention = getNeedsAttentionItems(state, document);
  const essentialCount = new Set(needsAttention
    .filter((item) => item.id.startsWith('essential-') || item.id === 'booking-path-missing')
    .map((item) => item.screen ?? item.id)).size;
  if (essentialCount > 0) {
    return `Finish ${essentialCount} ${essentialCount === 1 ? 'essential' : 'essentials'}`;
  }
  if (needsAttention.length > 0) {
    return `Resolve ${needsAttention.length} ${needsAttention.length === 1 ? 'issue' : 'issues'}`;
  }
  return 'Open my Builder';
};
