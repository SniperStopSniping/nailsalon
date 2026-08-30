import type { LocalImageReference } from './types';

/**
 * Canonical example Gallery shown during onboarding and after an account-backed
 * save. Keeping this fixture beside the onboarding model prevents the saved
 * Preview from inventing a second sample portfolio.
 */
export const ONBOARDING_EXAMPLE_GALLERY_IMAGES: readonly LocalImageReference[] = [
  {
    altText: 'Precision Russian manicure',
    fileName: 'russian-manicure.webp',
    id: 'gallery-mock-russian',
    mimeType: 'image/webp',
    previewUrl: '/manicure-russian-clean.webp',
    source: 'fixture',
  },
  {
    altText: 'Glossy nude gel manicure',
    fileName: 'nude-gel.webp',
    id: 'gallery-mock-nude',
    mimeType: 'image/webp',
    previewUrl: '/manicure-gel-nude.webp',
    source: 'fixture',
  },
  {
    altText: 'Pearl chrome manicure',
    fileName: 'pearl-chrome.webp',
    id: 'gallery-mock-pearl',
    mimeType: 'image/webp',
    previewUrl: '/manicure-pearl-chrome.webp',
    source: 'fixture',
  },
  {
    altText: 'French manicure',
    fileName: 'french.webp',
    id: 'gallery-mock-french',
    mimeType: 'image/webp',
    previewUrl: '/manicure-french.webp',
    source: 'fixture',
  },
];
