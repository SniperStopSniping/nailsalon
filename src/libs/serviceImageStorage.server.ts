import 'server-only';

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { nanoid } from 'nanoid';
import sharp from 'sharp';

import { cloudinary, isCloudinaryConfigured } from '@/libs/Cloudinary';
import { serviceImageDeploymentScope } from '@/libs/serviceImageDeploymentScope.server';

export const SERVICE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const SERVICE_IMAGE_MAX_DIMENSION = 10_000;
export const SERVICE_IMAGE_MAX_PIXELS = 40_000_000;
export const SERVICE_IMAGE_FINALIZE_MAX_AGE_SECONDS = 15 * 60;
// This preset is intentionally app-controlled rather than client-selectable.
// Production must configure it as signed, with JPEG/PNG/WebP only and no
// format-changing incoming transformation. The browser and presign route
// enforce 5 MiB before upload; decoded Cloudinary metadata is authoritative
// during finalization.
export const SERVICE_IMAGE_UPLOAD_PRESET = 'luster_service_images_v1';
const SERVICE_IMAGE_PENDING_TAG_PREFIX = 'luster_service_image_pending_v1';
export const SERVICE_IMAGE_ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type ServiceImageFormat = 'jpg' | 'png' | 'webp';

const SAFE_ID = /^[\w-]{1,128}$/;
const TOKEN = '[\\w-]{16}';
const MANAGED_PUBLIC_ID = new RegExp(
  `^salons/([\\w-]{1,128})/services/service_([\\w-]{1,128})_(${TOKEN})_(jpg|png|webp)$`,
);
const PENDING_CONTEXT_KEYS = {
  state: 'luster_image_state',
  salonId: 'luster_salon_id',
  serviceId: 'luster_service_id',
  deploymentScope: 'luster_deployment_scope',
  finalizeDigest: 'luster_finalize_token_sha256',
  binding: 'luster_pending_binding_v1',
} as const;

export function serviceImagePendingTag(): string {
  return `${SERVICE_IMAGE_PENDING_TAG_PREFIX}_${serviceImageDeploymentScope()}`;
}

export class ServiceImageValidationError extends Error {
  code: string;
  managedAssetId?: string;

  constructor(code: string, message: string, managedAssetId?: string) {
    super(message);
    this.name = 'ServiceImageValidationError';
    this.code = code;
    this.managedAssetId = managedAssetId;
  }
}

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) {
    throw new ServiceImageValidationError(
      'UNMANAGED_IMAGE',
      `Invalid ${label} for a managed service image`,
    );
  }
}

export function serviceImageFormatForContentType(
  contentType: string,
): ServiceImageFormat {
  switch (contentType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      throw new ServiceImageValidationError(
        'INVALID_FILE_TYPE',
        'Only JPEG, PNG, and WebP images are allowed',
      );
  }
}

function normalizeDetectedFormat(format: string | undefined): ServiceImageFormat | null {
  if (format === 'jpeg' || format === 'jpg') {
    return 'jpg';
  }
  if (format === 'png' || format === 'webp') {
    return format;
  }
  return null;
}

function publicIdPattern(salonId: string, serviceId: string): RegExp {
  assertSafeId(salonId, 'salon id');
  assertSafeId(serviceId, 'service id');

  return new RegExp(
    `^salons/${salonId}/services/service_${serviceId}_${TOKEN}_(jpg|png|webp)$`,
  );
}

export function parseManagedServiceImagePublicId(publicId: string): {
  salonId: string;
  serviceId: string;
  format: ServiceImageFormat;
} | null {
  const match = publicId.match(MANAGED_PUBLIC_ID);
  if (!match) {
    return null;
  }

  return {
    salonId: match[1]!,
    serviceId: match[2]!,
    format: match[4] as ServiceImageFormat,
  };
}

function expectedFormatFromPublicId({
  publicId,
  salonId,
  serviceId,
}: {
  publicId: string;
  salonId: string;
  serviceId: string;
}): ServiceImageFormat | null {
  const match = publicId.match(publicIdPattern(salonId, serviceId));
  return (match?.[1] as ServiceImageFormat | undefined) ?? null;
}

export function generateServiceImagePublicId({
  salonId,
  serviceId,
  format,
}: {
  salonId: string;
  serviceId: string;
  format: ServiceImageFormat;
}): string {
  assertSafeId(salonId, 'salon id');
  assertSafeId(serviceId, 'service id');

  return `salons/${salonId}/services/service_${serviceId}_${nanoid(16)}_${format}`;
}

export function assertManagedServiceImagePublicId({
  publicId,
  salonId,
  serviceId,
}: {
  publicId: string;
  salonId: string;
  serviceId: string;
}): void {
  if (!expectedFormatFromPublicId({ publicId, salonId, serviceId })) {
    throw new ServiceImageValidationError(
      'UNMANAGED_IMAGE',
      'The image is not managed by this service',
    );
  }
}

function serviceImageFinalizeTokenDigest(finalizeToken: string): string {
  return createHash('sha256').update(finalizeToken).digest('hex');
}

function serviceImagePendingBinding({
  publicId,
  finalizeDigest,
  deploymentScope,
}: {
  publicId: string;
  finalizeDigest: string;
  deploymentScope: string;
}): string {
  return createHmac('sha256', process.env.CLOUDINARY_API_SECRET!)
    .update(
      `service-image-pending-v1|${deploymentScope}|${publicId}|${finalizeDigest}`,
    )
    .digest('hex');
}

function serviceImagePendingContext({
  publicId,
  salonId,
  serviceId,
  finalizeToken,
}: {
  publicId: string;
  salonId: string;
  serviceId: string;
  finalizeToken: string;
}): string {
  assertManagedServiceImagePublicId({ publicId, salonId, serviceId });
  const deploymentScope = serviceImageDeploymentScope();
  const finalizeDigest = serviceImageFinalizeTokenDigest(finalizeToken);
  const binding = serviceImagePendingBinding({
    publicId,
    finalizeDigest,
    deploymentScope,
  });

  return [
    `${PENDING_CONTEXT_KEYS.state}=pending`,
    `${PENDING_CONTEXT_KEYS.salonId}=${salonId}`,
    `${PENDING_CONTEXT_KEYS.serviceId}=${serviceId}`,
    `${PENDING_CONTEXT_KEYS.deploymentScope}=${deploymentScope}`,
    `${PENDING_CONTEXT_KEYS.finalizeDigest}=${finalizeDigest}`,
    `${PENDING_CONTEXT_KEYS.binding}=${binding}`,
  ].join('|');
}

export function createServiceImageUploadSignature({
  publicId,
  salonId,
  serviceId,
  expectedImageUrl,
}: {
  publicId: string;
  salonId: string;
  serviceId: string;
  expectedImageUrl: string | null;
}): {
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
  } {
  if (!isCloudinaryConfigured()) {
    throw new ServiceImageValidationError(
      'IMAGE_STORAGE_UNAVAILABLE',
      'Service image storage is not configured',
    );
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME!;
  const apiKey = process.env.CLOUDINARY_API_KEY!;
  const apiSecret = process.env.CLOUDINARY_API_SECRET!;
  const timestamp = Math.floor(Date.now() / 1000);
  const finalizeToken = createServiceImageFinalizeToken({
    publicId,
    salonId,
    serviceId,
    expectedImageUrl,
    timestamp,
  });
  const context = serviceImagePendingContext({
    publicId,
    salonId,
    serviceId,
    finalizeToken,
  });
  const paramsToSign = {
    context,
    overwrite: false,
    public_id: publicId,
    tags: serviceImagePendingTag(),
    timestamp,
    type: 'upload',
    upload_preset: SERVICE_IMAGE_UPLOAD_PRESET,
  };
  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    apiSecret,
  );

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    signature,
    timestamp,
    apiKey,
    cloudName,
    uploadPreset: SERVICE_IMAGE_UPLOAD_PRESET,
    publicId,
    overwrite: false,
    type: 'upload',
    tags: serviceImagePendingTag(),
    context,
    finalizeToken,
  };
}

function serviceImageFinalizeTokenPayload({
  publicId,
  salonId,
  serviceId,
  expectedImageUrl,
  timestamp,
}: {
  publicId: string;
  salonId: string;
  serviceId: string;
  expectedImageUrl: string | null;
  timestamp: number;
}): string {
  return JSON.stringify({
    deploymentScope: serviceImageDeploymentScope(),
    expectedImageUrl,
    publicId,
    salonId,
    serviceId,
    timestamp,
  });
}

export function createServiceImageFinalizeToken({
  publicId,
  salonId,
  serviceId,
  expectedImageUrl,
  timestamp,
}: {
  publicId: string;
  salonId: string;
  serviceId: string;
  expectedImageUrl: string | null;
  timestamp: number;
}): string {
  assertManagedServiceImagePublicId({ publicId, salonId, serviceId });
  if (!isCloudinaryConfigured()) {
    throw new ServiceImageValidationError(
      'IMAGE_STORAGE_UNAVAILABLE',
      'Service image storage is not configured',
    );
  }

  return createHmac('sha256', process.env.CLOUDINARY_API_SECRET!)
    .update(serviceImageFinalizeTokenPayload({
      publicId,
      salonId,
      serviceId,
      expectedImageUrl,
      timestamp,
    }))
    .digest('hex');
}

export function verifyServiceImageFinalizeToken({
  token,
  publicId,
  salonId,
  serviceId,
  expectedImageUrl,
  timestamp,
  nowSeconds = Math.floor(Date.now() / 1000),
}: {
  token: string;
  publicId: string;
  salonId: string;
  serviceId: string;
  expectedImageUrl: string | null;
  timestamp: number;
  nowSeconds?: number;
}): boolean {
  if (
    !Number.isInteger(timestamp)
    || timestamp > nowSeconds + 60
    || nowSeconds - timestamp > SERVICE_IMAGE_FINALIZE_MAX_AGE_SECONDS
  ) {
    return false;
  }

  let expectedToken: string;
  try {
    expectedToken = createServiceImageFinalizeToken({
      publicId,
      salonId,
      serviceId,
      expectedImageUrl,
      timestamp,
    });
  } catch {
    return false;
  }

  if (!/^[a-f0-9]{64}$/.test(token)) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(token, 'hex'),
    Buffer.from(expectedToken, 'hex'),
  );
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
  tags?: unknown;
  context?: unknown;
  created_at?: string;
};

function cloudinaryContextValues(context: unknown): Record<string, unknown> | null {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return null;
  }

  const values = context as Record<string, unknown>;
  const custom = values.custom;
  if (custom && typeof custom === 'object' && !Array.isArray(custom)) {
    return custom as Record<string, unknown>;
  }
  return values;
}

function hasPendingServiceImageMetadata({
  resource,
  publicId,
  salonId,
  serviceId,
  finalizeToken,
}: {
  resource: CloudinaryResource;
  publicId: string;
  salonId: string;
  serviceId: string;
  finalizeToken?: string;
}): boolean {
  if (
    !Array.isArray(resource.tags)
    || !resource.tags.includes(serviceImagePendingTag())
  ) {
    return false;
  }

  const context = cloudinaryContextValues(resource.context);
  const deploymentScope = serviceImageDeploymentScope();
  const finalizeDigest = context?.[PENDING_CONTEXT_KEYS.finalizeDigest];
  if (
    context?.[PENDING_CONTEXT_KEYS.state] !== 'pending'
    || context?.[PENDING_CONTEXT_KEYS.salonId] !== salonId
    || context?.[PENDING_CONTEXT_KEYS.serviceId] !== serviceId
    || context?.[PENDING_CONTEXT_KEYS.deploymentScope] !== deploymentScope
    || typeof finalizeDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(finalizeDigest)
  ) {
    return false;
  }

  if (
    finalizeToken
    && finalizeDigest !== serviceImageFinalizeTokenDigest(finalizeToken)
  ) {
    return false;
  }

  const expectedBinding = serviceImagePendingBinding({
    publicId,
    finalizeDigest,
    deploymentScope,
  });
  const actualBinding = context[PENDING_CONTEXT_KEYS.binding];
  if (
    typeof actualBinding !== 'string'
    || !/^[a-f0-9]{64}$/.test(actualBinding)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(actualBinding, 'hex'),
    Buffer.from(expectedBinding, 'hex'),
  );
}

function hasActiveServiceImageMetadata({
  resource,
  publicId,
  salonId,
  serviceId,
}: {
  resource: CloudinaryResource;
  publicId: string;
  salonId: string;
  serviceId: string;
}): boolean {
  const context = cloudinaryContextValues(resource.context);
  const deploymentScope = serviceImageDeploymentScope();
  const finalizeDigest = context?.[PENDING_CONTEXT_KEYS.finalizeDigest];
  const actualBinding = context?.[PENDING_CONTEXT_KEYS.binding];

  if (
    context?.[PENDING_CONTEXT_KEYS.state] !== 'active'
    || context?.[PENDING_CONTEXT_KEYS.salonId] !== salonId
    || context?.[PENDING_CONTEXT_KEYS.serviceId] !== serviceId
    || context?.[PENDING_CONTEXT_KEYS.deploymentScope] !== deploymentScope
    || typeof finalizeDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(finalizeDigest)
    || typeof actualBinding !== 'string'
    || !/^[a-f0-9]{64}$/.test(actualBinding)
  ) {
    return false;
  }

  const expectedBinding = serviceImagePendingBinding({
    publicId,
    finalizeDigest,
    deploymentScope,
  });

  return timingSafeEqual(
    Buffer.from(actualBinding, 'hex'),
    Buffer.from(expectedBinding, 'hex'),
  );
}

function validateDimensions({
  width,
  height,
}: {
  width: number | undefined;
  height: number | undefined;
}): void {
  if (
    typeof width !== 'number'
    || typeof height !== 'number'
    || !Number.isInteger(width)
    || !Number.isInteger(height)
    || width <= 0
    || height <= 0
  ) {
    throw new ServiceImageValidationError(
      'INVALID_IMAGE',
      'The uploaded file is not a readable image',
    );
  }

  if (
    width > SERVICE_IMAGE_MAX_DIMENSION
    || height > SERVICE_IMAGE_MAX_DIMENSION
    || width * height > SERVICE_IMAGE_MAX_PIXELS
  ) {
    throw new ServiceImageValidationError(
      'IMAGE_DIMENSIONS_TOO_LARGE',
      'Image dimensions are too large',
    );
  }
}

export function managedCloudinaryPublicIdFromUrl({
  imageUrl,
  salonId,
  serviceId,
}: {
  imageUrl: string;
  salonId: string;
  serviceId: string;
}): string | null {
  if (!isCloudinaryConfigured()) {
    return null;
  }

  try {
    const parsed = new URL(imageUrl);
    if (
      parsed.origin !== 'https://res.cloudinary.com'
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
    ) {
      return null;
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME!;
    const deliveryPrefix = `/${cloudName}/image/upload/`;
    if (!parsed.pathname.startsWith(deliveryPrefix)) {
      return null;
    }

    let deliveredPath = parsed.pathname.slice(deliveryPrefix.length);
    deliveredPath = deliveredPath.replace(/^v\d+\//, '');
    const extensionIndex = deliveredPath.lastIndexOf('.');
    if (extensionIndex <= 0) {
      return null;
    }

    const publicId = deliveredPath.slice(0, extensionIndex);
    const extension = normalizeDetectedFormat(
      deliveredPath.slice(extensionIndex + 1).toLowerCase(),
    );
    const expectedFormat = expectedFormatFromPublicId({
      publicId,
      salonId,
      serviceId,
    });

    return extension && expectedFormat === extension ? publicId : null;
  } catch {
    return null;
  }
}

/**
 * Non-destructive reference check for a known app-managed Cloudinary asset.
 *
 * Unlike the deletion allowlist above, this deliberately accepts versioned
 * and transformed delivery URLs. It can only preserve an asset; it never
 * authorizes a deletion.
 */
export function serviceImageUrlReferencesManagedPublicId({
  imageUrl,
  publicId,
}: {
  imageUrl: string;
  publicId: string;
}): boolean {
  const identity = parseManagedServiceImagePublicId(publicId);
  if (!identity || !isCloudinaryConfigured()) {
    return false;
  }

  try {
    const parsed = new URL(imageUrl);
    if (
      parsed.origin !== 'https://res.cloudinary.com'
      || parsed.username
      || parsed.password
    ) {
      return false;
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME!;
    const deliveryPrefix = `/${cloudName}/image/upload/`;
    if (!parsed.pathname.startsWith(deliveryPrefix)) {
      return false;
    }

    const deliveredPath = parsed.pathname.slice(deliveryPrefix.length);

    // A delivery transformation can change or omit the output extension, and
    // query/hash values do not change the underlying asset. This helper is
    // preservation-only, so deliberately over-preserve when the exact managed
    // public ID is the final path value. It never authorizes deletion.
    const publicIdIndex = deliveredPath.lastIndexOf(publicId);
    if (
      publicIdIndex < 0
      || (publicIdIndex > 0 && deliveredPath[publicIdIndex - 1] !== '/')
    ) {
      return false;
    }

    const remainder = deliveredPath.slice(publicIdIndex + publicId.length);
    return remainder === ''
      || (remainder.startsWith('.') && !remainder.includes('/'));
  } catch {
    return false;
  }
}

export async function verifyCloudinaryServiceImage({
  assetId,
  publicId,
  salonId,
  serviceId,
  finalizeToken,
}: {
  assetId: string;
  publicId: string;
  salonId: string;
  serviceId: string;
  finalizeToken: string;
}): Promise<{
    imageUrl: string;
    format: ServiceImageFormat;
    bytes: number;
    width: number;
    height: number;
  }> {
  assertManagedServiceImagePublicId({ publicId, salonId, serviceId });
  if (!isCloudinaryConfigured()) {
    throw new ServiceImageValidationError(
      'IMAGE_STORAGE_UNAVAILABLE',
      'Service image storage is not configured',
    );
  }

  const page = (await cloudinary.api.resources_by_asset_ids([assetId], {
    tags: true,
    context: true,
  })) as CloudinaryResourcePage;
  const resources = page.resources ?? [];
  if (resources.length !== 1) {
    throw new Error('The uploaded Cloudinary asset is not available');
  }
  const resource = resources[0]!;
  const format = normalizeDetectedFormat(resource.format);
  const expectedFormat = expectedFormatFromPublicId({
    publicId,
    salonId,
    serviceId,
  });

  if (
    resource.asset_id !== assetId
    || resource.public_id !== publicId
    || !hasPendingServiceImageMetadata({
      resource,
      publicId,
      salonId,
      serviceId,
      finalizeToken,
    })
  ) {
    throw new ServiceImageValidationError(
      'UNMANAGED_IMAGE',
      'The uploaded asset does not match this image authorization',
    );
  }
  if (
    resource.resource_type !== 'image'
    || resource.type !== 'upload'
    || !format
    || format !== expectedFormat
  ) {
    throw new ServiceImageValidationError(
      'INVALID_IMAGE',
      'The uploaded file is not an allowed image',
      assetId,
    );
  }
  const bytes = resource.bytes;

  if (
    typeof bytes !== 'number'
    || !Number.isInteger(bytes)
    || bytes <= 0
  ) {
    throw new ServiceImageValidationError(
      'INVALID_IMAGE',
      'The uploaded file is not a readable image',
      assetId,
    );
  }
  if (bytes > SERVICE_IMAGE_MAX_BYTES) {
    throw new ServiceImageValidationError(
      'FILE_TOO_LARGE',
      'Image must be 5 MB or smaller',
      assetId,
    );
  }

  try {
    validateDimensions({ width: resource.width, height: resource.height });
  } catch (error) {
    if (error instanceof ServiceImageValidationError) {
      throw new ServiceImageValidationError(
        error.code,
        error.message,
        assetId,
      );
    }
    throw error;
  }

  if (
    !resource.secure_url
    || managedCloudinaryPublicIdFromUrl({
      imageUrl: resource.secure_url,
      salonId,
      serviceId,
    }) !== publicId
  ) {
    throw new ServiceImageValidationError(
      'UNMANAGED_IMAGE',
      'Cloudinary returned an unexpected image URL',
      assetId,
    );
  }

  return {
    imageUrl: resource.secure_url,
    format,
    bytes,
    width: resource.width!,
    height: resource.height!,
  };
}

export type PendingServiceImageAsset = {
  assetId: string;
  publicId: string;
  salonId: string;
  serviceId: string;
  resourceType: 'image' | 'video' | 'raw';
  deliveryType: string;
  createdAt: Date;
};

type CloudinaryResourcePage = {
  resources?: CloudinaryResource[];
  next_cursor?: string;
};

export async function listPendingServiceImageAssetsPage({
  resourceType = 'image',
  nextCursor,
  maxResults = 100,
}: {
  resourceType?: 'image' | 'video' | 'raw';
  nextCursor?: string;
  maxResults?: number;
} = {}): Promise<{
    assets: PendingServiceImageAsset[];
    skippedUnsafe: number;
    nextCursor: string | null;
  }> {
  if (!isCloudinaryConfigured()) {
    throw new ServiceImageValidationError(
      'IMAGE_STORAGE_UNAVAILABLE',
      'Service image storage is not configured',
    );
  }

  const boundedMaxResults = Math.max(1, Math.min(100, Math.floor(maxResults)));
  const page = (await cloudinary.api.resources_by_tag(
    serviceImagePendingTag(),
    {
      resource_type: resourceType,
      max_results: boundedMaxResults,
      ...(nextCursor ? { next_cursor: nextCursor } : {}),
      tags: true,
      context: true,
      direction: 'asc',
    },
  )) as CloudinaryResourcePage;

  const assets: PendingServiceImageAsset[] = [];
  let skippedUnsafe = 0;
  for (const resource of page.resources ?? []) {
    const publicId = resource.public_id;
    const assetId = resource.asset_id;
    const identity = typeof publicId === 'string'
      ? parseManagedServiceImagePublicId(publicId)
      : null;
    const createdAtMs = typeof resource.created_at === 'string'
      ? Date.parse(resource.created_at)
      : Number.NaN;

    if (
      !publicId
      || typeof assetId !== 'string'
      || !/^[\w-]{8,128}$/.test(assetId)
      || !identity
      || resource.resource_type !== resourceType
      || typeof resource.type !== 'string'
      || resource.type.length === 0
      || !Number.isFinite(createdAtMs)
      || !hasPendingServiceImageMetadata({
        resource,
        publicId,
        salonId: identity.salonId,
        serviceId: identity.serviceId,
      })
    ) {
      skippedUnsafe++;
      continue;
    }

    assets.push({
      assetId,
      publicId,
      salonId: identity.salonId,
      serviceId: identity.serviceId,
      resourceType,
      deliveryType: resource.type,
      createdAt: new Date(createdAtMs),
    });
  }

  return {
    assets,
    skippedUnsafe,
    nextCursor:
      typeof page.next_cursor === 'string' && page.next_cursor.length > 0
        ? page.next_cursor
        : null,
  };
}

export async function loadPendingServiceImageAsset({
  assetId,
  publicId,
  salonId,
  serviceId,
}: {
  assetId: string;
  publicId: string;
  salonId: string;
  serviceId: string;
}): Promise<PendingServiceImageAsset | null> {
  assertManagedServiceImagePublicId({ publicId, salonId, serviceId });
  if (
    !isCloudinaryConfigured()
    || !/^[\w-]{8,128}$/.test(assetId)
  ) {
    return null;
  }

  const page = (await cloudinary.api.resources_by_asset_ids([assetId], {
    tags: true,
    context: true,
  })) as CloudinaryResourcePage;
  const resources = page.resources ?? [];
  if (resources.length !== 1) {
    return null;
  }

  const resource = resources[0]!;
  const createdAtMs = typeof resource.created_at === 'string'
    ? Date.parse(resource.created_at)
    : Number.NaN;
  if (
    resource.asset_id !== assetId
    || resource.public_id !== publicId
    || (
      resource.resource_type !== 'image'
      && resource.resource_type !== 'video'
      && resource.resource_type !== 'raw'
    )
    || typeof resource.type !== 'string'
    || resource.type.length === 0
    || !Number.isFinite(createdAtMs)
    || !hasPendingServiceImageMetadata({
      resource,
      publicId,
      salonId,
      serviceId,
    })
  ) {
    return null;
  }

  return {
    assetId,
    publicId,
    salonId,
    serviceId,
    resourceType: resource.resource_type,
    deliveryType: resource.type,
    createdAt: new Date(createdAtMs),
  };
}

export async function deletePendingServiceImageAssetById({
  assetId,
  publicId,
  salonId,
  serviceId,
}: {
  assetId: string;
  publicId: string;
  salonId: string;
  serviceId: string;
}): Promise<boolean> {
  const pendingAsset = await loadPendingServiceImageAsset({
    assetId,
    publicId,
    salonId,
    serviceId,
  });
  if (!pendingAsset) {
    return false;
  }

  await cloudinary.api.delete_resources_by_asset_ids(
    [pendingAsset.assetId],
    { invalidate: true },
  );
  return true;
}

export async function markCloudinaryServiceImageActive({
  publicId,
  salonId,
  serviceId,
}: {
  publicId: string;
  salonId: string;
  serviceId: string;
}): Promise<boolean> {
  assertManagedServiceImagePublicId({ publicId, salonId, serviceId });
  if (!isCloudinaryConfigured()) {
    return false;
  }

  await cloudinary.uploader.remove_tag(
    serviceImagePendingTag(),
    [publicId],
    {
      resource_type: 'image',
      type: 'upload',
    },
  );
  await cloudinary.uploader.add_context(
    [
      `${PENDING_CONTEXT_KEYS.state}=active`,
      `${PENDING_CONTEXT_KEYS.deploymentScope}=${serviceImageDeploymentScope()}`,
    ].join('|'),
    [publicId],
    {
      resource_type: 'image',
      type: 'upload',
    },
  );
  return true;
}

export async function deleteCloudinaryServiceImageByPublicId({
  publicId,
  salonId,
  serviceId,
}: {
  publicId: string;
  salonId: string;
  serviceId: string;
}): Promise<boolean> {
  assertManagedServiceImagePublicId({ publicId, salonId, serviceId });
  if (!isCloudinaryConfigured()) {
    return false;
  }

  const page = (await cloudinary.api.resources_by_ids([publicId], {
    resource_type: 'image',
    type: 'upload',
    tags: true,
    context: true,
  })) as CloudinaryResourcePage;
  const resources = page.resources ?? [];
  if (resources.length !== 1) {
    return false;
  }

  const resource = resources[0]!;
  const assetId = resource.asset_id;
  if (
    resource.public_id !== publicId
    || resource.resource_type !== 'image'
    || resource.type !== 'upload'
    || typeof assetId !== 'string'
    || !/^[\w-]{8,128}$/.test(assetId)
    || !hasActiveServiceImageMetadata({
      resource,
      publicId,
      salonId,
      serviceId,
    })
  ) {
    return false;
  }

  await cloudinary.api.delete_resources_by_asset_ids(
    [assetId],
    { invalidate: true },
  );
  return true;
}

function localUploadRoot(): string {
  return path.resolve(process.cwd(), 'public', 'uploads', 'services');
}

function assertContainedPath(root: string, candidate: string): void {
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new ServiceImageValidationError(
      'UNMANAGED_IMAGE',
      'Service image path is outside the managed upload directory',
    );
  }
}

function localImageDetails({
  imageUrl,
  salonId,
  serviceId,
}: {
  imageUrl: string;
  salonId: string;
  serviceId: string;
}): { absolutePath: string } | null {
  if (process.env.NODE_ENV === 'production') {
    return null;
  }
  assertSafeId(salonId, 'salon id');
  assertSafeId(serviceId, 'service id');

  const filePattern = new RegExp(
    `^/uploads/services/${salonId}/service_${serviceId}_${TOKEN}\\.webp$`,
  );
  if (!filePattern.test(imageUrl)) {
    return null;
  }

  const root = localUploadRoot();
  const absolutePath = path.resolve(
    process.cwd(),
    'public',
    imageUrl.replace(/^\//, ''),
  );
  assertContainedPath(root, absolutePath);
  return { absolutePath };
}

export async function saveLocalServiceImage({
  file,
  salonId,
  serviceId,
}: {
  file: File;
  salonId: string;
  serviceId: string;
}): Promise<{ imageUrl: string }> {
  if (process.env.NODE_ENV === 'production') {
    throw new ServiceImageValidationError(
      'IMAGE_STORAGE_UNAVAILABLE',
      'Local service image storage is development-only',
    );
  }
  assertSafeId(salonId, 'salon id');
  assertSafeId(serviceId, 'service id');

  const declaredFormat = serviceImageFormatForContentType(file.type);
  if (file.size <= 0) {
    throw new ServiceImageValidationError(
      'INVALID_IMAGE',
      'The uploaded image is empty',
    );
  }
  if (file.size > SERVICE_IMAGE_MAX_BYTES) {
    throw new ServiceImageValidationError(
      'FILE_TOO_LARGE',
      'Image must be 5 MB or smaller',
    );
  }

  const inputBuffer = Buffer.from(await file.arrayBuffer());
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    metadata = await sharp(inputBuffer, {
      failOn: 'error',
      limitInputPixels: SERVICE_IMAGE_MAX_PIXELS,
    }).metadata();
  } catch {
    throw new ServiceImageValidationError(
      'INVALID_IMAGE',
      'The uploaded file is not a readable image',
    );
  }

  const detectedFormat = normalizeDetectedFormat(metadata.format);
  if (!detectedFormat || detectedFormat !== declaredFormat) {
    throw new ServiceImageValidationError(
      'INVALID_IMAGE',
      'The image content does not match its declared file type',
    );
  }
  validateDimensions({ width: metadata.width, height: metadata.height });

  let normalizedBuffer: Buffer;
  try {
    normalizedBuffer = await sharp(inputBuffer, {
      failOn: 'error',
      limitInputPixels: SERVICE_IMAGE_MAX_PIXELS,
    })
      .rotate()
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    throw new ServiceImageValidationError(
      'INVALID_IMAGE',
      'The uploaded image could not be normalized',
    );
  }

  const token = nanoid(16);
  const fileName = `service_${serviceId}_${token}.webp`;
  const root = localUploadRoot();
  const directory = path.resolve(root, salonId);
  const absolutePath = path.resolve(directory, fileName);
  assertContainedPath(root, directory);
  assertContainedPath(directory, absolutePath);

  await mkdir(directory, { recursive: true });
  await writeFile(absolutePath, normalizedBuffer);

  return {
    imageUrl: `/uploads/services/${salonId}/${fileName}`,
  };
}

export async function deleteManagedServiceImage({
  imageUrl,
  salonId,
  serviceId,
}: {
  imageUrl: string;
  salonId: string;
  serviceId: string;
}): Promise<boolean> {
  const cloudinaryPublicId = managedCloudinaryPublicIdFromUrl({
    imageUrl,
    salonId,
    serviceId,
  });
  if (cloudinaryPublicId) {
    return deleteCloudinaryServiceImageByPublicId({
      publicId: cloudinaryPublicId,
      salonId,
      serviceId,
    });
  }

  const local = localImageDetails({ imageUrl, salonId, serviceId });
  if (!local) {
    return false;
  }

  try {
    await unlink(local.absolutePath);
  } catch (error) {
    if (
      !error
      || typeof error !== 'object'
      || !('code' in error)
      || error.code !== 'ENOENT'
    ) {
      throw error;
    }
  }
  return true;
}
