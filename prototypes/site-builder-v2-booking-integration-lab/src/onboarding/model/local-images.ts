import {
  decodeImageInBrowser,
  detectImageMimeType,
  type ImageDecoder,
} from '../../custom-design/assets/image-processing';

export const ONBOARDING_LOCAL_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const ONBOARDING_LOCAL_IMAGE_MAX_BYTES = 1_500_000;
export const ONBOARDING_GALLERY_MAX_FILES = 8;
export const ONBOARDING_GALLERY_MAX_TOTAL_BYTES = 3_000_000;

const supportedMimeTypes = new Set<string>(ONBOARDING_LOCAL_IMAGE_MIME_TYPES);

export const ONBOARDING_IMAGE_DECODE_ERROR =
  'This image couldn’t be opened. Try exporting or selecting it again.';

export type OnboardingImageDimensions = {
  height: number;
  width: number;
};

export const validateOnboardingLocalImage = (file: File): void => {
  if (!supportedMimeTypes.has(file.type)) {
    throw new Error('Choose a PNG, JPG, or WebP image.');
  }
  if (file.size <= 0) {
    throw new Error('The selected image is empty.');
  }
  if (file.size > ONBOARDING_LOCAL_IMAGE_MAX_BYTES) {
    throw new Error('Choose an image smaller than 1.5 MB.');
  }
};

/**
 * Uses the accepted Custom Design signature and browser-decoding path so a
 * MIME-labelled text file can never become a broken customer image.
 */
export const decodeOnboardingLocalImage = async (
  file: File,
  options: { decodeImage?: ImageDecoder } = {},
): Promise<OnboardingImageDimensions> => {
  validateOnboardingLocalImage(file);
  let detectedMimeType: Awaited<ReturnType<typeof detectImageMimeType>>;
  try {
    detectedMimeType = await detectImageMimeType(file);
  } catch {
    throw new Error(ONBOARDING_IMAGE_DECODE_ERROR);
  }
  if (!detectedMimeType || detectedMimeType !== file.type) {
    throw new Error(ONBOARDING_IMAGE_DECODE_ERROR);
  }

  let decoded: Awaited<ReturnType<ImageDecoder>>;
  try {
    decoded = await (options.decodeImage ?? decodeImageInBrowser)(file);
  } catch {
    throw new Error(ONBOARDING_IMAGE_DECODE_ERROR);
  }

  try {
    if (
      !Number.isFinite(decoded.width)
      || !Number.isFinite(decoded.height)
      || decoded.width <= 0
      || decoded.height <= 0
    ) {
      throw new Error(ONBOARDING_IMAGE_DECODE_ERROR);
    }
    return { height: decoded.height, width: decoded.width };
  } finally {
    decoded.close?.();
  }
};

export const validateOnboardingGalleryImages = (
  files: readonly File[],
): void => {
  if (files.length > ONBOARDING_GALLERY_MAX_FILES) {
    throw new Error(`Choose up to ${ONBOARDING_GALLERY_MAX_FILES} portfolio images.`);
  }
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > ONBOARDING_GALLERY_MAX_TOTAL_BYTES) {
    throw new Error('Keep the selected portfolio images under 3 MB total.');
  }
};
