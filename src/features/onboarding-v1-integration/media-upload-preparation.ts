import {
  CUSTOM_DESIGN_MAX_DECODED_PIXELS,
  CUSTOM_DESIGN_MAX_IMAGE_DIMENSION_PX,
  decodeImageInBrowser,
  detectImageMimeType,
  generateImageThumbnail,
  getOrientedDimensions,
  ImageUploadError,
  readExifOrientation,
  validateUploadCapacity,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/assets/image-processing';
import { ONBOARDING_MEDIA_MAX_FILE_BYTES } from './media-limits';

/** Prepare only a transport copy; the original IndexedDB asset stays intact. */
export const prepareOnboardingMediaUpload = async (blob: Blob, fileName: string): Promise<File> => {
  const file = new File([blob], fileName, { type: blob.type });
  validateUploadCapacity(file, { currentImageCount: 0, currentSectionBytes: 0 });
  if (await detectImageMimeType(file) !== file.type) {
    throw new ImageUploadError('signature_mismatch', 'This photo could not be prepared for upload.');
  }
  if (file.size <= ONBOARDING_MEDIA_MAX_FILE_BYTES) {
    return file;
  }
  // The established decoder handles iPhone orientation and Safari's bitmap
  // fallback; the shared canvas renderer applies EXIF exactly once.
  const orientation = await readExifOrientation(file);
  const decoded = await decodeImageInBrowser(file);
  try {
    const dimensions = decoded.orientationApplied
      ? { height: decoded.height, width: decoded.width }
      : getOrientedDimensions(decoded.width, decoded.height, orientation);
    if (!Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height)
      || dimensions.width <= 0 || dimensions.height <= 0
      || dimensions.width > CUSTOM_DESIGN_MAX_IMAGE_DIMENSION_PX
      || dimensions.height > CUSTOM_DESIGN_MAX_IMAGE_DIMENSION_PX
      || dimensions.width * dimensions.height > CUSTOM_DESIGN_MAX_DECODED_PIXELS) {
      throw new ImageUploadError('dimensions_too_large', 'This photo has too many pixels to upload safely.');
    }
    const settings = [
      { maxEdgePx: 2_560, quality: 0.9 },
      { maxEdgePx: 2_560, quality: 0.78 },
      { maxEdgePx: 2_048, quality: 0.82 },
      { maxEdgePx: 1_600, quality: 0.76 },
      { maxEdgePx: 1_280, quality: 0.7 },
      { maxEdgePx: 1_024, quality: 0.7 },
      { maxEdgePx: 896, quality: 0.7 },
      { maxEdgePx: 768, quality: 0.7 },
    ];
    for (const options of settings) {
      const renderInput = { decoded, ...dimensions, orientation };
      let prepared = await generateImageThumbnail(renderInput, options);
      // Safari may return PNG when WebP encoding is unavailable. JPEG input
      // is opaque, so JPEG fallback preserves photo detail at the same size.
      // PNG/WebP sources keep their alpha channel and instead downsize further.
      if (file.type === 'image/jpeg' && prepared?.type === 'image/png') {
        prepared = await generateImageThumbnail(renderInput, { ...options, mimeType: 'image/jpeg' });
      }
      if (prepared && prepared.size > 0 && prepared.size <= ONBOARDING_MEDIA_MAX_FILE_BYTES
        && ['image/jpeg', 'image/png', 'image/webp'].includes(prepared.type)) {
        const extension = prepared.type === 'image/jpeg' ? 'jpg' : prepared.type.slice('image/'.length);
        const name = `${fileName.replace(/\.[^.]+$/, '')}.${extension}`;
        return new File([prepared], name, { type: prepared.type });
      }
    }
    throw new ImageUploadError('normalization_failed', 'This photo could not be made small enough to upload.');
  } finally {
    decoded.close?.();
  }
};
