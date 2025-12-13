import { v2 as cloudinary } from 'cloudinary';
import { nanoid } from 'nanoid';

// =============================================================================
// CLOUDINARY STORAGE CLIENT
// Provides presigned upload URLs and verification for Canvas Flow OS
// =============================================================================

// Configure Cloudinary (uses same env vars as existing Cloudinary.ts)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export type PhotoKind = 'before' | 'after';

export type PresignResult = {
  objectKey: string;
  uploadUrl: string;
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  expiresInSeconds: number;
};

export type VerifyResult = {
  exists: boolean;
  url?: string;
  thumbnailUrl?: string;
};

/**
 * Check if Cloudinary is properly configured
 */
export function isStorageConfigured(): boolean {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME
    && process.env.CLOUDINARY_API_KEY
    && process.env.CLOUDINARY_API_SECRET
  );
}

/**
 * Generate a random, non-guessable object key for photo uploads
 * Format: photos/{appointmentId}/{kind}/{nanoid}_{timestamp}.{ext}
 */
export function generateObjectKey(
  appointmentId: string,
  kind: PhotoKind,
  contentType: string,
): string {
  const ext = getExtensionFromContentType(contentType);
  const randomId = nanoid(16);
  const timestamp = Date.now().toString(36);
  return `photos/${appointmentId}/${kind}/${randomId}_${timestamp}.${ext}`;
}

/**
 * Get file extension from content type
 */
function getExtensionFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
  };
  return map[contentType] || 'bin';
}

/**
 * Generate a presigned upload configuration for Cloudinary
 * Client will use these params to upload directly to Cloudinary
 */
export function generatePresignedUpload(
  objectKey: string,
  expiresInSeconds: number = 900,
): PresignResult {
  if (!isStorageConfigured()) {
    throw new Error('Cloudinary is not configured');
  }

  const timestamp = Math.floor(Date.now() / 1000);

  // Cloudinary uses public_id (without extension) for the signature
  const publicId = objectKey.replace(/\.[^/.]+$/, '');
  const folder = publicId.substring(0, publicId.lastIndexOf('/'));
  const filename = publicId.substring(publicId.lastIndexOf('/') + 1);

  // Generate signature for upload
  const paramsToSign = {
    timestamp,
    folder,
    public_id: filename,
    upload_preset: undefined, // Not using presets
  };

  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    process.env.CLOUDINARY_API_SECRET!,
  );

  return {
    objectKey,
    uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`,
    signature,
    timestamp,
    apiKey: process.env.CLOUDINARY_API_KEY!,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME!,
    expiresInSeconds,
  };
}

/**
 * Verify that an upload exists in Cloudinary
 */
export async function verifyUploadExists(objectKey: string): Promise<VerifyResult> {
  if (!isStorageConfigured()) {
    throw new Error('Cloudinary is not configured');
  }

  try {
    const publicId = objectKey.replace(/\.[^/.]+$/, '');
    const result = await cloudinary.api.resource(publicId);

    return {
      exists: true,
      url: result.secure_url,
      thumbnailUrl: cloudinary.url(publicId, {
        width: 200,
        height: 200,
        crop: 'fill',
        gravity: 'auto',
      }),
    };
  } catch (error: unknown) {
    // Cloudinary throws if resource not found
    if (error && typeof error === 'object' && 'http_code' in error && error.http_code === 404) {
      return { exists: false };
    }
    throw error;
  }
}

/**
 * Generate a signed URL for reading a private photo
 * Note: Cloudinary URLs are typically public unless you enable signed URLs in settings
 */
export function getSignedReadUrl(objectKey: string, expiresInSeconds: number = 2592000): string {
  if (!isStorageConfigured()) {
    throw new Error('Cloudinary is not configured');
  }

  const publicId = objectKey.replace(/\.[^/.]+$/, '');

  // Generate signed URL with expiration
  return cloudinary.url(publicId, {
    sign_url: true,
    type: 'authenticated',
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
  });
}
