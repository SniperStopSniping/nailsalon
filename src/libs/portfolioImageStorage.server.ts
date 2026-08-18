import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { nanoid } from 'nanoid';

import { cloudinary, isCloudinaryConfigured } from '@/libs/Cloudinary';
import { serviceImageDeploymentScope } from '@/libs/serviceImageDeploymentScope.server';

/**
 * Portfolio image storage.
 *
 * This mirrors the hardened posture of `@/libs/serviceImageStorage.server`
 * rather than the older appointment-photo path, which validates MIME from the
 * browser-declared `file.type` alone. Concretely that means: an app-controlled
 * signed upload preset, an app-generated public id the client cannot choose,
 * an HMAC finalize token binding the authorization to that exact object,
 * decoded Cloudinary metadata treated as authoritative at finalize time, a
 * pending→active lifecycle so an abandoned upload is collectable, and
 * dimension/pixel/byte ceilings enforced server-side.
 *
 * It is a parallel module rather than a refactor of the service-image one on
 * purpose: that file is a protected, heavily tested surface, and widening it
 * to two domains mid-PR would put a working path at risk for no product gain.
 */

export const PORTFOLIO_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const PORTFOLIO_IMAGE_MAX_DIMENSION = 10_000;
export const PORTFOLIO_IMAGE_MAX_PIXELS = 40_000_000;
export const PORTFOLIO_IMAGE_MIN_DIMENSION = 400;
export const PORTFOLIO_IMAGE_FINALIZE_MAX_AGE_SECONDS = 15 * 60;

/**
 * Must be configured in Cloudinary as a SIGNED preset that accepts only
 * JPEG/PNG/WebP, applies no format-changing incoming transformation, and
 * strips metadata (EXIF, including embedded GPS) on store. Portfolio photos
 * are taken on phones in someone's home studio — location metadata must not
 * survive into a public asset.
 */
export const PORTFOLIO_IMAGE_UPLOAD_PRESET = 'luster_portfolio_images_v1';

const PORTFOLIO_PENDING_TAG_PREFIX = 'luster_portfolio_pending_v1';

export const PORTFOLIO_IMAGE_ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type PortfolioImageFormat = 'jpg' | 'png' | 'webp';

const SAFE_ID = /^[\w-]{1,128}$/;
const TOKEN = '[\\w-]{16}';
const MANAGED_PUBLIC_ID = new RegExp(
  `^salons/([\\w-]{1,128})/portfolio/portfolio_${TOKEN}_(jpg|png|webp)$`,
);

const PENDING_CONTEXT_KEYS = {
  state: 'luster_image_state',
  salonId: 'luster_salon_id',
  deploymentScope: 'luster_deployment_scope',
  finalizeDigest: 'luster_finalize_token_sha256',
} as const;

export function portfolioImagePendingTag(): string {
  return `${PORTFOLIO_PENDING_TAG_PREFIX}_${serviceImageDeploymentScope()}`;
}

export class PortfolioImageValidationError extends Error {
  code: string;
  managedAssetId?: string;

  constructor(code: string, message: string, managedAssetId?: string) {
    super(message);
    this.name = 'PortfolioImageValidationError';
    this.code = code;
    this.managedAssetId = managedAssetId;
  }
}

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) {
    throw new PortfolioImageValidationError(
      'UNMANAGED_IMAGE',
      `Invalid ${label} for a managed portfolio image`,
    );
  }
}

export function portfolioImageFormatForContentType(
  contentType: string,
): PortfolioImageFormat {
  switch (contentType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      throw new PortfolioImageValidationError(
        'INVALID_FILE_TYPE',
        'Only JPEG, PNG, and WebP images are allowed',
      );
  }
}

function normalizeDetectedFormat(format: string | undefined): PortfolioImageFormat | null {
  if (format === 'jpeg' || format === 'jpg') {
    return 'jpg';
  }

  if (format === 'png' || format === 'webp') {
    return format;
  }

  return null;
}

/**
 * The public id is generated here, never supplied by the browser: it is what
 * binds an upload to one salon's namespace.
 */
export function generatePortfolioImagePublicId({
  salonId,
  format,
}: {
  salonId: string;
  format: PortfolioImageFormat;
}): string {
  assertSafeId(salonId, 'salon id');

  return `salons/${salonId}/portfolio/portfolio_${nanoid(16)}_${format}`;
}

export function parseManagedPortfolioImagePublicId(publicId: string): {
  salonId: string;
  format: PortfolioImageFormat;
} | null {
  const match = MANAGED_PUBLIC_ID.exec(publicId);

  if (!match) {
    return null;
  }

  const format = normalizeDetectedFormat(match[2]);

  return format ? { salonId: match[1]!, format } : null;
}

export function assertManagedPortfolioImagePublicId({
  publicId,
  salonId,
}: {
  publicId: string;
  salonId: string;
}): void {
  const parsed = parseManagedPortfolioImagePublicId(publicId);

  if (!parsed || parsed.salonId !== salonId) {
    throw new PortfolioImageValidationError(
      'UNMANAGED_IMAGE',
      'The image reference is not managed by this salon',
    );
  }
}

function finalizeTokenPayload({
  publicId,
  salonId,
  timestamp,
}: {
  publicId: string;
  salonId: string;
  timestamp: number;
}): string {
  return JSON.stringify({
    deploymentScope: serviceImageDeploymentScope(),
    publicId,
    salonId,
    timestamp,
  });
}

export function createPortfolioFinalizeToken({
  publicId,
  salonId,
  timestamp,
}: {
  publicId: string;
  salonId: string;
  timestamp: number;
}): string {
  assertManagedPortfolioImagePublicId({ publicId, salonId });

  if (!isCloudinaryConfigured()) {
    throw new PortfolioImageValidationError(
      'IMAGE_STORAGE_UNAVAILABLE',
      'Portfolio image storage is not configured',
    );
  }

  return createHmac('sha256', process.env.CLOUDINARY_API_SECRET!)
    .update(finalizeTokenPayload({ publicId, salonId, timestamp }))
    .digest('hex');
}

export function verifyPortfolioFinalizeToken({
  token,
  publicId,
  salonId,
  timestamp,
  nowSeconds = Math.floor(Date.now() / 1000),
}: {
  token: string;
  publicId: string;
  salonId: string;
  timestamp: number;
  nowSeconds?: number;
}): boolean {
  if (
    !Number.isInteger(timestamp)
    || timestamp > nowSeconds + 60
    || nowSeconds - timestamp > PORTFOLIO_IMAGE_FINALIZE_MAX_AGE_SECONDS
  ) {
    return false;
  }

  let expected: string;

  try {
    expected = createPortfolioFinalizeToken({ publicId, salonId, timestamp });
  } catch {
    return false;
  }

  const provided = Buffer.from(token, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (provided.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(provided, expectedBuffer);
}

export type PortfolioUploadSignature = {
  uploadUrl: string;
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  uploadPreset: string;
  publicId: string;
  overwrite: false;
  type: 'upload';
  tags: string;
  context: string;
  finalizeToken: string;
};

export function createPortfolioUploadSignature({
  publicId,
  salonId,
}: {
  publicId: string;
  salonId: string;
}): PortfolioUploadSignature {
  assertManagedPortfolioImagePublicId({ publicId, salonId });

  if (!isCloudinaryConfigured()) {
    throw new PortfolioImageValidationError(
      'IMAGE_STORAGE_UNAVAILABLE',
      'Portfolio image storage is not configured',
    );
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME!;
  const apiKey = process.env.CLOUDINARY_API_KEY!;
  const apiSecret = process.env.CLOUDINARY_API_SECRET!;
  const timestamp = Math.floor(Date.now() / 1000);
  const finalizeToken = createPortfolioFinalizeToken({ publicId, salonId, timestamp });
  const finalizeDigest = createHmac('sha256', apiSecret)
    .update(finalizeToken)
    .digest('hex');

  const context = [
    `${PENDING_CONTEXT_KEYS.state}=pending`,
    `${PENDING_CONTEXT_KEYS.salonId}=${salonId}`,
    `${PENDING_CONTEXT_KEYS.deploymentScope}=${serviceImageDeploymentScope()}`,
    `${PENDING_CONTEXT_KEYS.finalizeDigest}=${finalizeDigest}`,
  ].join('|');

  const tags = portfolioImagePendingTag();

  const signature = cloudinary.utils.api_sign_request(
    {
      context,
      overwrite: false,
      public_id: publicId,
      tags,
      timestamp,
      type: 'upload',
      upload_preset: PORTFOLIO_IMAGE_UPLOAD_PRESET,
    },
    apiSecret,
  );

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    signature,
    timestamp,
    apiKey,
    cloudName,
    uploadPreset: PORTFOLIO_IMAGE_UPLOAD_PRESET,
    publicId,
    overwrite: false,
    type: 'upload',
    tags,
    context,
    finalizeToken,
  };
}

type CloudinaryResource = {
  asset_id?: string;
  public_id?: string;
  resource_type?: string;
  type?: string;
  format?: string;
  bytes?: number;
  width?: number;
  height?: number;
  secure_url?: string;
};

/**
 * Authoritative validation at finalize time.
 *
 * Everything the browser said is re-derived from Cloudinary's own decoded
 * metadata: format, byte size and pixel dimensions. A client that lies about
 * its file gets rejected here regardless of what it claimed at presign.
 */
export async function verifyCloudinaryPortfolioImage({
  assetId,
  publicId,
  salonId,
}: {
  assetId: string;
  publicId: string;
  salonId: string;
}): Promise<{
    imageUrl: string;
    format: PortfolioImageFormat;
    bytes: number;
    width: number;
    height: number;
  }> {
  assertManagedPortfolioImagePublicId({ publicId, salonId });

  if (!isCloudinaryConfigured()) {
    throw new PortfolioImageValidationError(
      'IMAGE_STORAGE_UNAVAILABLE',
      'Portfolio image storage is not configured',
    );
  }

  const page = (await cloudinary.api.resources_by_asset_ids([assetId], {
    tags: true,
    context: true,
  })) as { resources?: CloudinaryResource[] };

  const resources = page.resources ?? [];

  if (resources.length !== 1) {
    throw new PortfolioImageValidationError(
      'UNMANAGED_IMAGE',
      'The uploaded Cloudinary asset is not available',
    );
  }

  const resource = resources[0]!;

  if (resource.asset_id !== assetId || resource.public_id !== publicId) {
    throw new PortfolioImageValidationError(
      'UNMANAGED_IMAGE',
      'The uploaded asset does not match this image authorization',
    );
  }

  const format = normalizeDetectedFormat(resource.format);
  const expectedFormat = parseManagedPortfolioImagePublicId(publicId)?.format ?? null;

  if (
    resource.resource_type !== 'image'
    || resource.type !== 'upload'
    || !format
    || format !== expectedFormat
  ) {
    throw new PortfolioImageValidationError(
      'INVALID_IMAGE',
      'The uploaded file is not an allowed image',
      assetId,
    );
  }

  const { bytes, width, height, secure_url: secureUrl } = resource;

  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0) {
    throw new PortfolioImageValidationError(
      'INVALID_IMAGE',
      'The uploaded file is not a readable image',
      assetId,
    );
  }

  if (bytes > PORTFOLIO_IMAGE_MAX_BYTES) {
    throw new PortfolioImageValidationError(
      'FILE_TOO_LARGE',
      'The uploaded image is too large',
      assetId,
    );
  }

  if (
    typeof width !== 'number'
    || typeof height !== 'number'
    || !Number.isInteger(width)
    || !Number.isInteger(height)
    || width <= 0
    || height <= 0
  ) {
    throw new PortfolioImageValidationError(
      'INVALID_IMAGE',
      'The uploaded image has unreadable dimensions',
      assetId,
    );
  }

  if (width > PORTFOLIO_IMAGE_MAX_DIMENSION || height > PORTFOLIO_IMAGE_MAX_DIMENSION) {
    throw new PortfolioImageValidationError(
      'IMAGE_TOO_LARGE',
      'The uploaded image is too large to process',
      assetId,
    );
  }

  if (width * height > PORTFOLIO_IMAGE_MAX_PIXELS) {
    throw new PortfolioImageValidationError(
      'IMAGE_TOO_LARGE',
      'The uploaded image has too many pixels to process',
      assetId,
    );
  }

  // A portfolio photo becomes a 4:5 swipe card and a 1:1 thumbnail in later
  // Discover PRs. Something tiny cannot survive either crop, so it is refused
  // at upload rather than looking broken to a client months from now.
  if (width < PORTFOLIO_IMAGE_MIN_DIMENSION || height < PORTFOLIO_IMAGE_MIN_DIMENSION) {
    throw new PortfolioImageValidationError(
      'IMAGE_TOO_SMALL',
      `Portfolio photos must be at least ${PORTFOLIO_IMAGE_MIN_DIMENSION}px on each side`,
      assetId,
    );
  }

  if (typeof secureUrl !== 'string' || !secureUrl.startsWith('https://')) {
    throw new PortfolioImageValidationError(
      'INVALID_IMAGE',
      'The uploaded image has no usable URL',
      assetId,
    );
  }

  return { imageUrl: secureUrl, format, bytes, width, height };
}

/** Promote a verified upload out of the pending sweep. */
export async function markPortfolioImageActive({
  publicId,
  salonId,
}: {
  publicId: string;
  salonId: string;
}): Promise<void> {
  assertManagedPortfolioImagePublicId({ publicId, salonId });

  if (!isCloudinaryConfigured()) {
    return;
  }

  await cloudinary.uploader.remove_tag(portfolioImagePendingTag(), [publicId]);
  await cloudinary.uploader.add_context(
    `${PENDING_CONTEXT_KEYS.state}=active`,
    [publicId],
  );
}

/**
 * Remove a managed object. Used both when a client deletes a photo and when a
 * finalize is rejected — a refused upload must not leave an orphan behind.
 */
export async function deletePortfolioImage({
  publicId,
  salonId,
}: {
  publicId: string;
  salonId: string;
}): Promise<void> {
  assertManagedPortfolioImagePublicId({ publicId, salonId });

  if (!isCloudinaryConfigured()) {
    return;
  }

  await cloudinary.uploader.destroy(publicId, {
    invalidate: true,
    resource_type: 'image',
    type: 'upload',
  });
}
