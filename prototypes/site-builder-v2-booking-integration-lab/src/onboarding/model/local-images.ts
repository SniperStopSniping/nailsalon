import {
  CUSTOM_DESIGN_MAX_DECODED_PIXELS,
  CUSTOM_DESIGN_MAX_IMAGE_DIMENSION_PX,
  decodeImageInBrowser,
  detectImageMimeType,
  ImageUploadError,
  readBlobArrayBuffer,
  type DecodedImage,
  type ImageDecoder,
} from '../../custom-design/assets/image-processing';
import {
  CUSTOM_DESIGN_MAX_FILE_BYTES,
  CUSTOM_DESIGN_MAX_SECTION_BYTES,
} from '../../custom-design/model/constants';

export const ONBOARDING_LOCAL_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const ONBOARDING_HEIC_MIME_TYPES = [
  'image/heic',
  'image/heif',
] as const;

export const ONBOARDING_LOCAL_IMAGE_MAX_BYTES = CUSTOM_DESIGN_MAX_FILE_BYTES;
export const ONBOARDING_GALLERY_MAX_FILES = 8;
export const ONBOARDING_GALLERY_MAX_TOTAL_BYTES =
  CUSTOM_DESIGN_MAX_SECTION_BYTES;

const supportedMimeTypes = new Set<string>(ONBOARDING_LOCAL_IMAGE_MIME_TYPES);
const heicMimeTypes = new Set<string>(ONBOARDING_HEIC_MIME_TYPES);
const heicBrands = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'hevm',
  'hevs',
]);
const genericHeifBrands = new Set(['mif1', 'msf1']);
const avifBrands = new Set(['avif', 'avis']);

export const ONBOARDING_IMAGE_DECODE_ERROR =
  'This image couldn’t be opened. Try exporting or selecting it again.';

export type OnboardingImageDimensions = {
  height: number;
  width: number;
};

export type OnboardingImageNormalizationOptions = {
  decodeImage?: ImageDecoder;
  encodeDecodedImage?: (
    decoded: DecodedImage,
    sourceFile: File,
  ) => Promise<File>;
};

const validateImageFileSize = (file: File): void => {
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    throw new ImageUploadError(
      'invalid_file_size',
      'The selected image has an invalid file size.',
    );
  }
  if (file.size === 0) {
    throw new ImageUploadError('empty_file', 'The selected image is empty.');
  }
  if (file.size > ONBOARDING_LOCAL_IMAGE_MAX_BYTES) {
    throw new ImageUploadError(
      'file_too_large',
      'Choose an image smaller than 15 MB.',
    );
  }
};

export const validateOnboardingLocalImage = (file: File): void => {
  validateImageFileSize(file);
  if (!supportedMimeTypes.has(file.type) && !heicMimeTypes.has(file.type)) {
    throw new ImageUploadError(
      'unsupported_type',
      'Choose a PNG, JPG, WebP, HEIC, or HEIF image.',
    );
  }
};

const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...bytes.slice(start, start + length));

export const hasHeicFileSignature = async (blob: Blob): Promise<boolean> => {
  const bytes = new Uint8Array(
    await readBlobArrayBuffer(blob.slice(0, Math.min(blob.size, 256))),
  );
  if (bytes.length < 12 || ascii(bytes, 4, 4) !== 'ftyp') return false;
  const brands = [
    ascii(bytes, 8, 4),
    ...Array.from(
      { length: Math.max(0, Math.floor((bytes.length - 16) / 4)) },
      (_, index) => ascii(bytes, 16 + index * 4, 4),
    ),
  ];
  if (brands.some((brand) => avifBrands.has(brand))) return false;
  return brands.some((brand) => heicBrands.has(brand) || genericHeifBrands.has(brand));
};

const normalizedJpegName = (fileName: string): string => {
  const trimmed = fileName.trim() || 'iphone-photo';
  return /\.(?:heic|heif)$/iu.test(trimmed)
    ? trimmed.replace(/\.(?:heic|heif)$/iu, '.jpg')
    : `${trimmed}.jpg`;
};

const encodeDecodedImageAsJpeg = async (
  decoded: DecodedImage,
  sourceFile: File,
): Promise<File> => {
  if (!decoded.source || typeof document === 'undefined') {
    throw new ImageUploadError(
      'normalization_failed',
      'This iPhone photo could not be converted for the website.',
    );
  }
  if (
    !Number.isFinite(decoded.width)
    || !Number.isFinite(decoded.height)
    || decoded.width <= 0
    || decoded.height <= 0
    || decoded.width > CUSTOM_DESIGN_MAX_IMAGE_DIMENSION_PX
    || decoded.height > CUSTOM_DESIGN_MAX_IMAGE_DIMENSION_PX
    || decoded.width * decoded.height > CUSTOM_DESIGN_MAX_DECODED_PIXELS
  ) {
    throw new ImageUploadError(
      'dimensions_too_large',
      'This iPhone photo has too many pixels to process safely.',
    );
  }

  const canvas = document.createElement('canvas');
  canvas.width = decoded.width;
  canvas.height = decoded.height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new ImageUploadError(
      'normalization_failed',
      'This iPhone photo could not be converted for the website.',
    );
  }
  try {
    context.drawImage(decoded.source, 0, 0, decoded.width, decoded.height);
  } catch (error) {
    throw new ImageUploadError(
      'normalization_failed',
      'This iPhone photo could not be converted for the website.',
      error,
    );
  }
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.9);
  });
  if (!blob || blob.size <= 0 || blob.type !== 'image/jpeg') {
    throw new ImageUploadError(
      'normalization_failed',
      'This iPhone photo could not be converted for the website.',
    );
  }
  return new File([blob], normalizedJpegName(sourceFile.name), {
    lastModified: sourceFile.lastModified,
    type: 'image/jpeg',
  });
};

/**
 * Leaves already-safe browser rasters untouched. HEIC/HEIF bytes are accepted
 * only when this browser can decode and normalize them into a shared supported
 * raster. No remote conversion or inline bytes are introduced.
 */
export const normalizeOnboardingLocalImage = async (
  file: File,
  options: OnboardingImageNormalizationOptions = {},
): Promise<File> => {
  validateImageFileSize(file);
  let hasHeicSignature: boolean;
  try {
    hasHeicSignature = await hasHeicFileSignature(file);
  } catch (error) {
    throw new ImageUploadError(
      'decode_failed',
      ONBOARDING_IMAGE_DECODE_ERROR,
      error,
    );
  }

  const declaredHeic = heicMimeTypes.has(file.type);
  if (declaredHeic && !hasHeicSignature) {
    throw new ImageUploadError(
      'signature_mismatch',
      'This file’s contents do not match its iPhone photo format.',
    );
  }
  if (!hasHeicSignature) {
    if (!supportedMimeTypes.has(file.type)) {
      throw new ImageUploadError(
        'unsupported_type',
        'Choose a PNG, JPG, or WebP image.',
      );
    }
    return file;
  }

  let decoded: DecodedImage;
  try {
    decoded = await (options.decodeImage ?? decodeImageInBrowser)(file);
  } catch (error) {
    throw new ImageUploadError(
      'unsupported_heic',
      'This iPhone photo format isn’t supported in this browser. Choose a JPG, PNG, or WebP image.',
      error,
    );
  }
  try {
    return await (options.encodeDecodedImage ?? encodeDecodedImageAsJpeg)(
      decoded,
      file,
    );
  } catch (error) {
    if (error instanceof ImageUploadError) throw error;
    throw new ImageUploadError(
      'normalization_failed',
      'This iPhone photo could not be converted for the website.',
      error,
    );
  } finally {
    decoded.close?.();
  }
};

/**
 * Compatibility validator retained for focused callers and tests. The Lab
 * media port itself prepares each normal raster only once.
 */
export const decodeOnboardingLocalImage = async (
  file: File,
  options: OnboardingImageNormalizationOptions = {},
): Promise<OnboardingImageDimensions> => {
  const normalized = await normalizeOnboardingLocalImage(file, options);
  let detectedMimeType: Awaited<ReturnType<typeof detectImageMimeType>>;
  try {
    detectedMimeType = await detectImageMimeType(normalized);
  } catch (error) {
    throw new ImageUploadError(
      'decode_failed',
      ONBOARDING_IMAGE_DECODE_ERROR,
      error,
    );
  }
  if (!detectedMimeType || detectedMimeType !== normalized.type) {
    throw new ImageUploadError(
      'signature_mismatch',
      ONBOARDING_IMAGE_DECODE_ERROR,
    );
  }

  let decoded: DecodedImage;
  try {
    decoded = await (options.decodeImage ?? decodeImageInBrowser)(normalized);
  } catch (error) {
    throw new ImageUploadError(
      'decode_failed',
      ONBOARDING_IMAGE_DECODE_ERROR,
      error,
    );
  }

  try {
    if (
      !Number.isFinite(decoded.width)
      || !Number.isFinite(decoded.height)
      || decoded.width <= 0
      || decoded.height <= 0
    ) {
      throw new ImageUploadError(
        'corrupt_image',
        ONBOARDING_IMAGE_DECODE_ERROR,
      );
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
    throw new ImageUploadError(
      'too_many_images',
      `Choose up to ${ONBOARDING_GALLERY_MAX_FILES} portfolio images.`,
    );
  }
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > ONBOARDING_GALLERY_MAX_TOTAL_BYTES) {
    throw new ImageUploadError(
      'section_too_large',
      'Keep the selected portfolio images under 75 MB total.',
    );
  }
};
