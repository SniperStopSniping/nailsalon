// =============================================================================
// CLOUDINARY URL HELPER FOR AUTOPOST
// =============================================================================
// Generates Instagram-safe public URLs from Cloudinary object keys.
// Applies transformations to ensure IG-compatible aspect ratio and size.
// =============================================================================

/**
 * Generate an Instagram-safe public URL from a Cloudinary object key.
 *
 * Applies transformations:
 * - Max width: 1080px (IG optimal)
 * - Aspect ratio: 4:5 (0.8) - IG's most common portrait ratio
 * - Crop: fill with auto gravity for smart cropping
 * - Format: auto for best compression
 * - Quality: auto for optimal quality/size balance
 *
 * @param objectKey - The Cloudinary public ID (e.g., "photos/appt123/after/abc123_xyz.jpg")
 * @returns Public URL that Meta can fetch
 */
export function getInstagramSafeUrl(objectKey: string): string {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;

  if (!cloudName) {
    console.warn('[Autopost] CLOUDINARY_CLOUD_NAME not set, using objectKey as-is');
    return objectKey;
  }

  // Remove file extension from objectKey to get public_id
  const publicId = objectKey.replace(/\.[^/.]+$/, '');

  // Build transformation URL
  // Instagram accepts 4:5 (portrait), 1:1 (square), 1.91:1 (landscape)
  // We use 4:5 as it's the most common and works well for nail photos
  const transformations = [
    'w_1080', // Max width 1080px
    'ar_4:5', // Aspect ratio 4:5 (portrait)
    'c_fill', // Fill the frame, cropping if needed
    'g_auto', // Smart gravity for cropping
    'f_auto', // Auto format (webp/jpg based on browser)
    'q_auto', // Auto quality
  ].join(',');

  // Cloudinary URL format: https://res.cloudinary.com/{cloud_name}/image/upload/{transformations}/{public_id}
  return `https://res.cloudinary.com/${cloudName}/image/upload/${transformations}/${publicId}`;
}

/**
 * Generate a Facebook-safe public URL from a Cloudinary object key.
 * Facebook is more lenient than Instagram, but we still apply basic optimizations.
 *
 * @param objectKey - The Cloudinary public ID
 * @returns Public URL that Meta can fetch
 */
export function getFacebookSafeUrl(objectKey: string): string {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;

  if (!cloudName) {
    console.warn('[Autopost] CLOUDINARY_CLOUD_NAME not set, using objectKey as-is');
    return objectKey;
  }

  // Remove file extension from objectKey to get public_id
  const publicId = objectKey.replace(/\.[^/.]+$/, '');

  // Facebook is more lenient, just ensure reasonable size and quality
  const transformations = [
    'w_1200', // Max width 1200px
    'c_limit', // Limit size without cropping
    'f_auto', // Auto format
    'q_auto', // Auto quality
  ].join(',');

  return `https://res.cloudinary.com/${cloudName}/image/upload/${transformations}/${publicId}`;
}
