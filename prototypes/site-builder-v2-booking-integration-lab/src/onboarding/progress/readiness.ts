import type { SiteBuilderDocument } from '../../model/types';
import { getIncompleteEssentials, hasPublicContactMethod } from './essentials';
import {
  getDepositsAndCancellationsDisplayWording,
  isDepositsAndCancellationsComplete,
  isDepositsAndCancellationsVisible,
} from '../model/policies';
import type { OnboardingLabState, OnboardingScreenId } from '../model/types';

export type ReadinessStatus = 'ready' | 'recommended' | 'optional' | 'needs_attention';

export type ReadinessItem = {
  actionLabel?: string;
  detail?: string;
  id: string;
  label: string;
  screen?: OnboardingScreenId;
  status: ReadinessStatus;
};

export type CustomDesignAssetReadiness = {
  assetId: string;
  fileName: string;
  status: 'error' | 'loading' | 'missing';
};

const hasBookingPath = (document: SiteBuilderDocument | null): boolean => Boolean(
  document?.pages.some((page) => page.visible && page.sections.some(
    (section) => section.visible && section.sectionType === 'booking',
  )),
);

export const getReadinessItems = (
  state: OnboardingLabState,
  document: SiteBuilderDocument | null,
  customDesignAssets: readonly CustomDesignAssetReadiness[] = [],
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
      detail: 'Your site needs a visible booking option before you can continue.',
      id: 'booking-path-missing',
      label: 'No booking path',
      screen: 'starter',
      status: 'needs_attention',
    });
  } else {
    items.push({ id: 'booking-path', label: 'Clients can book you', status: 'ready' });
  }
  if (state.profile.businessName.trim()) {
    items.push({ id: 'business-name', label: 'Business information', status: 'ready' });
  }
  if (hasPublicContactMethod(state)) {
    items.push({ id: 'contact', label: 'Contact and privacy', status: 'ready' });
  }
  items.push({ id: 'mobile', label: 'Looks right on a phone', status: 'ready' });
  items.push({ id: 'style', label: 'Website style', screen: 'site_style', status: 'ready' });

  const combinedPolicyReady = isDepositsAndCancellationsComplete(state.profile.policies)
    && isDepositsAndCancellationsVisible(state.profile.policies)
    && Boolean(getDepositsAndCancellationsDisplayWording(state.profile.policies).trim());
  if (!combinedPolicyReady) {
    items.push({
      id: 'policies',
      label: 'Deposits & cancellation policy',
      screen: 'policies',
      status: 'recommended',
    });
  } else if (!state.recipe.policiesEnabled) {
    items.push({
      detail: 'Your policy answers are saved, but not shown on your site.',
      id: 'policies',
      label: 'Deposits & cancellation policy',
      screen: 'policies',
      status: 'recommended',
    });
  } else {
    items.push({
      id: 'policies',
      label: 'Deposits & cancellation policy',
      screen: 'policies',
      status: 'ready',
    });
  }
  if (!state.recipe.galleryEnabled) {
    items.push({ id: 'gallery', label: 'Add photos of your work', screen: 'extras', status: 'recommended' });
  } else if (state.gallery.source === 'mock_luster') {
    items.push({
      detail: 'Example gallery — replace before publishing.',
      id: 'gallery-examples',
      label: 'Replace example Gallery photos',
      screen: 'extras',
      status: 'recommended',
    });
  } else {
    items.push({ id: 'gallery-ready', label: 'Gallery photos', screen: 'extras', status: 'ready' });
  }
  if (!state.recipe.aboutEnabled) {
    items.push({ id: 'about', label: 'Add About', screen: 'about', status: 'recommended' });
  } else {
    items.push({ id: 'about', label: 'About section', screen: 'about', status: 'ready' });
  }
  if (!state.recipe.canvaEnabled) {
    items.push({ id: 'canva', label: 'Upload Canva design', screen: 'extras', status: 'optional' });
  }
  if (!state.profile.logo) {
    items.push({ id: 'logo', label: 'Add logo', screen: 'business', status: 'optional' });
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
  for (const asset of customDesignAssets) {
    items.push({
      actionLabel: asset.status === 'loading' ? 'Review' : 'Replace',
      detail: asset.status === 'loading'
        ? 'We’re checking that this uploaded page is available in this browser.'
        : 'This uploaded page is unavailable. Its image and links stay hidden until you replace it.',
      id: `canva-asset-${asset.assetId}`,
      label: asset.status === 'loading'
        ? `Checking ${asset.fileName}`
        : `${asset.fileName} needs attention`,
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
  customDesignAssets: readonly CustomDesignAssetReadiness[] = [],
): ReadinessItem[] => getReadinessItems(state, document, customDesignAssets).filter(
  (item) => item.status === 'needs_attention',
);

export const getBuilderPrimaryLabel = (
  state: OnboardingLabState,
  document: SiteBuilderDocument | null,
  customDesignAssets: readonly CustomDesignAssetReadiness[] = [],
): string => {
  const needsAttention = getNeedsAttentionItems(state, document, customDesignAssets);
  const essentialCount = new Set(needsAttention
    .filter((item) => item.id.startsWith('essential-') || item.id === 'booking-path-missing')
    .map((item) => item.screen ?? item.id)).size;
  if (essentialCount > 0) {
    return `Finish ${essentialCount} required ${essentialCount === 1 ? 'step' : 'steps'}`;
  }
  if (needsAttention.length > 0) {
    return `Resolve ${needsAttention.length} ${needsAttention.length === 1 ? 'issue' : 'issues'}`;
  }
  return 'Finish setup';
};
