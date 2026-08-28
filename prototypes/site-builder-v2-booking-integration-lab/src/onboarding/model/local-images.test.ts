import {
  ONBOARDING_GALLERY_MAX_FILES,
  ONBOARDING_LOCAL_IMAGE_MAX_BYTES,
  validateOnboardingGalleryImages,
  validateOnboardingLocalImage,
} from './local-images';

describe('browser-local onboarding image limits', () => {
  it('accepts bounded raster images and rejects unsupported or oversized files', () => {
    expect(() => validateOnboardingLocalImage(
      new File(['image'], 'portrait.jpg', { type: 'image/jpeg' }),
    )).not.toThrow();
    expect(() => validateOnboardingLocalImage(
      new File(['pdf'], 'portrait.pdf', { type: 'application/pdf' }),
    )).toThrow(/PNG, JPG, or WebP/u);
    expect(() => validateOnboardingLocalImage(
      new File([new Uint8Array(ONBOARDING_LOCAL_IMAGE_MAX_BYTES + 1)], 'large.png', {
        type: 'image/png',
      }),
    )).toThrow(/smaller than 1.5 MB/u);
  });

  it('bounds Gallery count and aggregate browser-local payload size', () => {
    const tooMany = Array.from({ length: ONBOARDING_GALLERY_MAX_FILES + 1 }, (_, index) =>
      new File(['image'], `${index}.webp`, { type: 'image/webp' }));
    expect(() => validateOnboardingGalleryImages(tooMany)).toThrow(/up to 8/u);

    const largeSelection = [0, 1, 2].map((index) => new File([
      new Uint8Array(1_100_000),
    ], `${index}.png`, { type: 'image/png' }));
    expect(() => validateOnboardingGalleryImages(largeSelection)).toThrow(/under 3 MB total/u);
  });
});
