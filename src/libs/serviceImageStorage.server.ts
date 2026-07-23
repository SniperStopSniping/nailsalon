import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { nanoid } from 'nanoid';
import sharp from 'sharp';

import { cloudinary, isCloudinaryConfigured } from '@/libs/Cloudinary';

export const SERVICE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const SERVICE_IMAGE_MAX_DIMENSION = 10_000;
export const SERVICE_IMAGE_MAX_PIXELS = 40_000_000;
export const SERVICE_IMAGE_FINALIZE_MAX_AGE_SECONDS = 15 * 60;
// This preset is intentionally app-controlled rather than client-selectable.
// Production must configure it as signed, with JPEG/PNG/WebP only, a
// 5 MiB maximum, and no format-changing incoming transformation.
export const SERVICE_IMAGE_UPLOAD_PRESET = 'luster_service_images_v1';
export const SERVICE_IMAGE_ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type ServiceImageFormat = 'jpg' | 'png' | 'webp';

const SAFE_ID = /^[\w-]{1,128}$/;
const TOKEN = '[A-Za-z0-9_-]{16}';

export class ServiceImageValidationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ServiceImageValidationError';
    this.code = code;
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

export function createServiceImageUploadSignature(publicId: string): {
  uploadUrl: string;
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  uploadPreset: string;
  publicId: string;
  overwrite: false;
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
  const paramsToSign = {
    overwrite: false,
    public_id: publicId,
    timestamp,
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
  public_id?: string;
  resource_type?: string;
  type?: string;
  format?: string;
  bytes?: number;
  width?: number;
  height?: number;
  secure_url?: string;
};

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

export async function verifyCloudinaryServiceImage({
  publicId,
  salonId,
  serviceId,
}: {
  publicId: string;
  salonId: string;
  serviceId: string;
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

  const resource = (await cloudinary.api.resource(publicId, {
    resource_type: 'image',
    type: 'upload',
  })) as CloudinaryResource;
  const format = normalizeDetectedFormat(resource.format);
  const expectedFormat = expectedFormatFromPublicId({
    publicId,
    salonId,
    serviceId,
  });

  if (
    resource.public_id !== publicId
    || resource.resource_type !== 'image'
    || (resource.type !== undefined && resource.type !== 'upload')
    || !format
    || format !== expectedFormat
  ) {
    throw new ServiceImageValidationError(
      'INVALID_IMAGE',
      'The uploaded file is not an allowed image',
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
    );
  }
  if (bytes > SERVICE_IMAGE_MAX_BYTES) {
    throw new ServiceImageValidationError(
      'FILE_TOO_LARGE',
      'Image must be 5 MB or smaller',
    );
  }

  validateDimensions({ width: resource.width, height: resource.height });

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

  await cloudinary.uploader.destroy(publicId, {
    resource_type: 'image',
    type: 'upload',
    invalidate: true,
  });
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
