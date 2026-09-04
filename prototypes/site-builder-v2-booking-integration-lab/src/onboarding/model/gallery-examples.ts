import type { LocalImageReference } from './types';

/**
 * Canonical example Gallery shown during onboarding and after an account-backed
 * save. Keeping this fixture beside the onboarding model prevents the saved
 * Preview from inventing a second sample portfolio.
 */
export const ONBOARDING_EXAMPLE_GALLERY_IMAGES: readonly LocalImageReference[] = [
  {
    altText: 'Builder gel French portfolio set',
    fileName: 'biab-french.jpg',
    id: 'gallery-mock-russian',
    mimeType: 'image/jpeg',
    previewUrl: '/assets/images/biab-french.jpg',
    source: 'fixture',
  },
  {
    altText: 'Medium builder gel portfolio set',
    fileName: 'biab-medium.webp',
    id: 'gallery-mock-nude',
    mimeType: 'image/webp',
    previewUrl: '/assets/images/biab-medium.webp',
    source: 'fixture',
  },
  {
    altText: 'Short builder gel portfolio set',
    fileName: 'biab-short.webp',
    id: 'gallery-mock-pearl',
    mimeType: 'image/webp',
    previewUrl: '/assets/images/biab-short.webp',
    source: 'fixture',
  },
  {
    altText: 'Gel extension portfolio set',
    fileName: 'gel-x-extensions.jpg',
    id: 'gallery-mock-french',
    mimeType: 'image/jpeg',
    previewUrl: '/assets/images/gel-x-extensions.jpg',
    source: 'fixture',
  },
];
