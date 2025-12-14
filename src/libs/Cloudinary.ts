import type { Buffer } from 'node:buffer';

import type { UploadApiResponse } from 'cloudinary';
import { v2 as cloudinary } from 'cloudinary';

// =============================================================================
// CLOUDINARY CONFIGURATION
// =============================================================================
// Required environment variables:
//   CLOUDINARY_CLOUD_NAME
//   CLOUDINARY_API_KEY
//   CLOUDINARY_API_SECRET
//
// Add these to your .env file with values from your Cloudinary dashboard.
// =============================================================================

// Configure Cloudinary with environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export type UploadResult = {
  publicId: string;
  imageUrl: string;
  thumbnailUrl: string;
};

/**
 * Upload a photo for an appointment to Cloudinary
 *
 * @param fileBuffer - The image file as a Buffer
 * @param salonId - The salon ID for folder organization
 * @param appointmentId - The appointment ID for folder organization
 * @returns Upload result with URLs
 */
export async function uploadAppointmentPhoto(
  fileBuffer: Buffer,
  salonId: string,
  appointmentId: string,
): Promise<UploadResult> {
  // Validate Cloudinary is configured
  if (
    !process.env.CLOUDINARY_CLOUD_NAME
    || !process.env.CLOUDINARY_API_KEY
    || !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new Error('Cloudinary is not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET environment variables.');
  }

  // Upload folder structure: /salons/{salonId}/appointments/{appointmentId}
  const folder = `salons/${salonId}/appointments/${appointmentId}`;

  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder,
          resource_type: 'image',
          // Generate transformations for consistent sizing
          eager: [
            // Thumbnail: 200x200 cropped
            { width: 200, height: 200, crop: 'fill', gravity: 'auto' },
          ],
          eager_async: false,
        },
        (error, result: UploadApiResponse | undefined) => {
          if (error) {
            reject(new Error(`Cloudinary upload failed: ${error.message}`));
            return;
          }

          if (!result) {
            reject(new Error('Cloudinary upload returned no result'));
            return;
          }

          // Get thumbnail URL from eager transformation
          const thumbnailUrl
            = result.eager?.[0]?.secure_url
            || cloudinary.url(result.public_id, {
              width: 200,
              height: 200,
              crop: 'fill',
              gravity: 'auto',
            });

          resolve({
            publicId: result.public_id,
            imageUrl: result.secure_url,
            thumbnailUrl,
          });
        },
      )
      .end(fileBuffer);
  });
}

/**
 * Delete a photo from Cloudinary
 *
 * @param publicId - The Cloudinary public ID of the image to delete
 */
export async function deleteAppointmentPhoto(publicId: string): Promise<void> {
  if (
    !process.env.CLOUDINARY_CLOUD_NAME
    || !process.env.CLOUDINARY_API_KEY
    || !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new Error('Cloudinary is not configured');
  }

  await cloudinary.uploader.destroy(publicId);
}

/**
 * Check if Cloudinary is properly configured
 */
export function isCloudinaryConfigured(): boolean {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME
    && process.env.CLOUDINARY_API_KEY
    && process.env.CLOUDINARY_API_SECRET
  );
}

export { cloudinary };
