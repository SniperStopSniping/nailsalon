export const ONBOARDING_LOCAL_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const ONBOARDING_LOCAL_IMAGE_MAX_BYTES = 1_500_000;
export const ONBOARDING_GALLERY_MAX_FILES = 8;
export const ONBOARDING_GALLERY_MAX_TOTAL_BYTES = 3_000_000;

const supportedMimeTypes = new Set<string>(ONBOARDING_LOCAL_IMAGE_MIME_TYPES);

export const validateOnboardingLocalImage = (file: File): void => {
  if (!supportedMimeTypes.has(file.type)) {
    throw new Error('Choose a PNG, JPG, or WebP image.');
  }
  if (file.size <= 0) {
    throw new Error('The selected image is empty.');
  }
  if (file.size > ONBOARDING_LOCAL_IMAGE_MAX_BYTES) {
    throw new Error('Choose an image smaller than 1.5 MB for this browser-local Lab.');
  }
};

export const validateOnboardingGalleryImages = (
  files: readonly File[],
): void => {
  if (files.length > ONBOARDING_GALLERY_MAX_FILES) {
    throw new Error(`Choose up to ${ONBOARDING_GALLERY_MAX_FILES} portfolio images.`);
  }
  files.forEach(validateOnboardingLocalImage);
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > ONBOARDING_GALLERY_MAX_TOTAL_BYTES) {
    throw new Error('Keep the selected portfolio images under 3 MB total for this browser-local Lab.');
  }
};
