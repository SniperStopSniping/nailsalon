import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { cloudinary, isCloudinaryConfigured } from '@/libs/Cloudinary';
import { resolveRuntimeEnvironment } from '@/libs/environmentIsolation';
import sharp from '@/libs/safeSharp.server';

import { ONBOARDING_SITE_MEDIA_ROLES } from './contracts';
import type { OnboardingMediaRole } from './media-claim-client';
import { ONBOARDING_MEDIA_MAX_DECODED_PIXELS, ONBOARDING_MEDIA_MAX_FILE_BYTES } from './media-limits';

const MAX_BYTES = ONBOARDING_MEDIA_MAX_FILE_BYTES;
const MAX_PIXELS = ONBOARDING_MEDIA_MAX_DECODED_PIXELS;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SAFE_ID = /^[\w-]{1,160}$/;
const ROLES = new Set<string>(ONBOARDING_SITE_MEDIA_ROLES);
const CLOUD_PREFIX = 'cloudinary_authenticated:';
const CLOUD_KEY = /^salons\/([\w-]{1,160})\/onboarding-sites\/([\w-]{1,160})\/revisions\/([\w-]{1,160})\/(profile|logo|gallery|custom_design|cover)\/([a-f0-9]{32})$/;
const LOCAL_KEY = /^([\w-]{1,160})\/([\w-]{1,160})\/([\w-]{1,160})\/(profile|logo|gallery|custom_design|cover)\/([a-f0-9]{32})\.webp$/;

export type OnboardingMediaStorageProvider = 'cloudinary_authenticated' | 'development_local';
export type OnboardingMediaStorageOwner = { salonId: string; siteId?: string };

export type StoredOnboardingMediaFile = {
  byteSize: number;
  height: number;
  mimeType: 'image/webp';
  storageKey: string;
  storageProvider: OnboardingMediaStorageProvider;
  width: number;
};

export type SaveOnboardingMediaFileInput = {
  file: File;
  role: OnboardingMediaRole;
  revisionId: string;
  salonId: string;
  siteId: string;
  stableItemId: string;
  uploadAttemptId: string;
  imagePreparation?: { artwork: true; maxOutputBytes: number; preserveDimensions?: true };
};

export class OnboardingMediaStorageError extends Error {
  readonly code:
    | 'IMAGE_NOT_FOUND'
    | 'IMAGE_STORAGE_UNAVAILABLE'
    | 'INVALID_IMAGE'
    | 'INVALID_MEDIA_OWNER'
    | 'UNSUPPORTED_IMAGE';

  constructor(
    code: OnboardingMediaStorageError['code'],
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = 'OnboardingMediaStorageError';
  }
}

const assertSafeId = (value: string, label: string) => {
  if (!SAFE_ID.test(value)) {
    throw new OnboardingMediaStorageError(
      'INVALID_MEDIA_OWNER',
      `Invalid ${label}.`,
    );
  }
};

const storageUnavailable = () => new OnboardingMediaStorageError(
  'IMAGE_STORAGE_UNAVAILABLE',
  'This image could not be stored securely. Try again shortly.',
);

const assertCloudinaryConfigured = () => {
  if (!isCloudinaryConfigured()) {
    throw storageUnavailable();
  }
};

const ownedStorageKey = (storageKey: string, owner: OnboardingMediaStorageOwner) => {
  const isCloud = storageKey.startsWith(CLOUD_PREFIX);
  const key = isCloud ? storageKey.slice(CLOUD_PREFIX.length) : storageKey;
  const match = (isCloud ? CLOUD_KEY : LOCAL_KEY).exec(key);
  // An inherited revision may refer to older immutable bytes, but never to
  // another salon or site. Database authorization resolves the current revision.
  if (!match || match[1] !== owner.salonId || (owner.siteId && match[2] !== owner.siteId)) {
    throw new OnboardingMediaStorageError('INVALID_MEDIA_OWNER', 'The media storage key is invalid.');
  }
  return { isCloud, key };
};

export const isOnboardingMediaStorageProvider = (
  value: string | null,
): value is OnboardingMediaStorageProvider => (
  value === 'cloudinary_authenticated' || value === 'development_local'
);

const resolveRoot = (): string => {
  // A locally optimized Next.js build also has NODE_ENV=production. It can
  // read its existing Development uploads only with an explicit local marker.
  // Hosted deployments and ambiguous environments keep the original denial.
  const localOptimizedDevelopment = !process.env.VERCEL && !process.env.VERCEL_ENV
    && process.env.APP_ENV === 'development'
    && resolveRuntimeEnvironment(process.env) === 'development';
  if (process.env.NODE_ENV === 'production' && !localOptimizedDevelopment) {
    throw new OnboardingMediaStorageError(
      'IMAGE_STORAGE_UNAVAILABLE',
      'The development media adapter is disabled in Production.',
    );
  }
  const configured = process.env.LUSTER_ONBOARDING_MEDIA_DIR?.trim();
  if (!configured || !path.isAbsolute(configured)) {
    throw new OnboardingMediaStorageError(
      'IMAGE_STORAGE_UNAVAILABLE',
      'Set an absolute LUSTER_ONBOARDING_MEDIA_DIR for development media.',
    );
  }
  const root = path.resolve(configured);
  const repositoryRoot = path.resolve(process.cwd());
  if (root === repositoryRoot || root.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new OnboardingMediaStorageError(
      'IMAGE_STORAGE_UNAVAILABLE',
      'Development onboarding media must be stored outside the repository.',
    );
  }
  return root;
};

const resolveStoragePath = (storageKey: string): string => {
  const root = resolveRoot();
  const absolute = path.resolve(root, storageKey);
  if (absolute === root || !absolute.startsWith(`${root}${path.sep}`)) {
    throw new OnboardingMediaStorageError(
      'INVALID_MEDIA_OWNER',
      'The media storage key is invalid.',
    );
  }
  return absolute;
};

/** Decode, validate and normalize image bytes before any storage adapter. */
export async function normalizeOnboardingImage(file: File, preparation?: SaveOnboardingMediaFileInput['imagePreparation']) {
  const outputLimit = preparation?.maxOutputBytes ?? MAX_BYTES;
  if (!Number.isInteger(outputLimit) || outputLimit <= 0 || outputLimit > MAX_BYTES) {
    throw new OnboardingMediaStorageError('INVALID_IMAGE', 'The image preparation limit is invalid.');
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new OnboardingMediaStorageError(
      'UNSUPPORTED_IMAGE',
      'Choose a JPG, PNG or WebP image.',
    );
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    throw new OnboardingMediaStorageError(
      'INVALID_IMAGE',
      'This photo needs to be prepared again before uploading.',
    );
  }

  const input = Buffer.from(await file.arrayBuffer());
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    metadata = await sharp(input, {
      failOn: 'error',
      limitInputPixels: MAX_PIXELS,
    }).metadata();
  } catch {
    throw new OnboardingMediaStorageError(
      'INVALID_IMAGE',
      'This photo could not be read. Try selecting it again.',
    );
  }
  const detectedMimeType = metadata.format === 'jpeg'
    ? 'image/jpeg'
    : metadata.format === 'png'
      ? 'image/png'
      : metadata.format === 'webp'
        ? 'image/webp'
        : null;
  if (!detectedMimeType || detectedMimeType !== file.type) {
    throw new OnboardingMediaStorageError(
      'INVALID_IMAGE',
      'The image contents do not match the selected file type.',
    );
  }
  if (preparation?.artwork && (!metadata.width || !metadata.height || metadata.width > 40000 || metadata.height > 40000)) {
    throw new OnboardingMediaStorageError('INVALID_IMAGE', 'This Canva page is too long or wide. Export it as separate pages before uploading.');
  }

  let normalized: Buffer;
  let normalizedMetadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    const settings = preparation?.artwork
      ? [
          // Preserve text edges and native pixels when the lossless export fits.
          { width: undefined, maxEdge: undefined, quality: 100, lossless: true },
          ...[96, 90, 84].map(quality => ({ width: undefined, maxEdge: undefined, quality, lossless: false })),
          // A long Canva page needs width for legible text. Never squeeze the
          // whole page into a short maximum-height thumbnail or upscale pixels.
          ...(preparation.preserveDimensions ? [] : [2400, 1920, 1600, 1200, 1000, 800, 600].map(width => ({ width, maxEdge: undefined, quality: 90, lossless: false }))),
        ]
      : [
          { width: undefined, maxEdge: undefined, quality: 88, lossless: false },
          { width: undefined, maxEdge: 2_560, quality: 82, lossless: false },
          { width: undefined, maxEdge: 2_048, quality: 76, lossless: false },
          { width: undefined, maxEdge: 1_600, quality: 70, lossless: false },
        ];
    normalized = Buffer.alloc(0);
    for (const { width, maxEdge, quality, lossless } of settings) {
      const nativeWidth = metadata.orientation && metadata.orientation >= 5 ? metadata.height! : metadata.width!;
      if (width && width >= nativeWidth) {
        continue;
      }
      const pipeline = sharp(input, { failOn: 'error', limitInputPixels: MAX_PIXELS }).rotate();
      if (maxEdge) {
        pipeline.resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true });
      } else if (width) {
        pipeline.resize({ width, withoutEnlargement: true });
      }
      normalized = await pipeline.webp({ quality, lossless }).toBuffer();
      if (normalized.byteLength <= outputLimit) {
        break;
      }
    }
    normalizedMetadata = await sharp(normalized).metadata();
  } catch {
    throw new OnboardingMediaStorageError(
      'INVALID_IMAGE',
      'This photo could not be prepared for your site.',
    );
  }
  if (!normalizedMetadata.width || !normalizedMetadata.height || normalized.byteLength > outputLimit) {
    throw new OnboardingMediaStorageError(
      'INVALID_IMAGE',
      preparation?.artwork ? 'This design is too large to save clearly. Export it as separate PNG pages and upload them in order.' : 'This photo has invalid dimensions or is too large after preparation.',
    );
  }

  return { normalized, normalizedMetadata };
}

export const saveOnboardingMediaFile = async ({
  file,
  role,
  revisionId,
  salonId,
  siteId,
  stableItemId,
  uploadAttemptId,
  imagePreparation,
}: SaveOnboardingMediaFileInput): Promise<StoredOnboardingMediaFile> => {
  assertSafeId(stableItemId, 'image item id');
  assertSafeId(revisionId, 'site revision id');
  assertSafeId(salonId, 'salon id');
  assertSafeId(siteId, 'site id');
  assertSafeId(uploadAttemptId, 'upload attempt id');
  if (!ROLES.has(role)) {
    throw new OnboardingMediaStorageError('INVALID_MEDIA_OWNER', 'Invalid image role.');
  }
  const { normalized, normalizedMetadata } = await normalizeOnboardingImage(file, imagePreparation);

  const fingerprint = createHash('sha256')
    // Revisions are append-only. Including the immutable revision identity
    // prevents a later replace-draft upload with the same logical image id
    // from overwriting bytes referenced by an earlier saved revision.
    // A lease attempt owns a unique immutable object. If a stale request is
    // reclaimed while it is still normalizing bytes, its cleanup can remove
    // only its own object and can never delete the replacement request's
    // successful upload.
    .update(`${revisionId}:${stableItemId}:${role}:${uploadAttemptId}`)
    .update(normalized)
    .digest('hex')
    .slice(0, 32);
  const localKey = path.posix.join(
    salonId,
    siteId,
    revisionId,
    role,
    `${fingerprint}.webp`,
  );
  const storageProvider: OnboardingMediaStorageProvider = process.env.NODE_ENV === 'production'
    ? 'cloudinary_authenticated'
    : 'development_local';
  let storageKey = localKey;
  if (storageProvider === 'cloudinary_authenticated') {
    assertCloudinaryConfigured();
    const publicId = `salons/${salonId}/onboarding-sites/${siteId}/revisions/${revisionId}/${role}/${fingerprint}`;
    // Authenticated (not merely private) protects both originals and derived
    // images. The provider URL/signature never becomes the stored publicUrl.
    await new Promise<void>((resolve, reject) => {
      cloudinary.uploader.upload_stream({
        format: 'webp',
        overwrite: false,
        public_id: publicId,
        resource_type: 'image',
        type: 'authenticated',
      }, (error, result) => {
        if (error || !result || result.public_id !== publicId
          || result.type !== 'authenticated' || result.resource_type !== 'image'
          || result.format !== 'webp') {
          reject(storageUnavailable());
          return;
        }
        resolve();
      }).end(normalized);
    }).catch(() => {
      throw storageUnavailable();
    });
    storageKey = `${CLOUD_PREFIX}${publicId}`;
  } else {
    const absolute = resolveStoragePath(localKey);
    const directory = path.dirname(absolute);
    const temporary = path.join(directory, `.${fingerprint}.${randomUUID()}.tmp`);
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(temporary, normalized, { flag: 'wx' });
      await rename(temporary, absolute);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  return {
    byteSize: normalized.byteLength,
    height: normalizedMetadata.height,
    mimeType: 'image/webp',
    storageKey,
    storageProvider,
    width: normalizedMetadata.width,
  };
};

export const readOnboardingMediaFile = async (
  storageKey: string,
  owner: OnboardingMediaStorageOwner,
): Promise<Buffer> => {
  const { isCloud, key } = ownedStorageKey(storageKey, owner);
  if (!isCloud) {
    const bytes = await readFile(resolveStoragePath(key));
    if (bytes.byteLength > MAX_BYTES) {
      throw storageUnavailable();
    }
    return bytes;
  }
  assertCloudinaryConfigured();
  try {
    const signedUrl = cloudinary.utils.private_download_url(key, 'webp', {
      attachment: false,
      expires_at: Math.floor(Date.now() / 1_000) + 60,
      resource_type: 'image',
      type: 'authenticated',
    });
    const url = new URL(signedUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'api.cloudinary.com'
      || url.port || url.username || url.password) {
      throw storageUnavailable();
    }
    const response = await fetch(url, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) {
      await response.body?.cancel();
      throw new OnboardingMediaStorageError('IMAGE_NOT_FOUND', 'This saved image is no longer available.');
    }
    if (!response.ok || !response.body
      || response.headers.get('content-type')?.split(';')[0] !== 'image/webp'
      || Number(response.headers.get('content-length')) > MAX_BYTES) {
      await response.body?.cancel();
      throw storageUnavailable();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        size += value.byteLength;
        if (size > MAX_BYTES) {
          throw storageUnavailable();
        }
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    if (!size) {
      throw storageUnavailable();
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (error instanceof OnboardingMediaStorageError && error.code === 'IMAGE_NOT_FOUND') {
      throw error;
    }
    // Provider errors can contain signed URLs; never propagate them to routes.
    throw storageUnavailable();
  }
};

export const deleteOnboardingMediaFile = async (
  storageKey: string,
  owner: OnboardingMediaStorageOwner,
): Promise<void> => {
  const { isCloud, key } = ownedStorageKey(storageKey, owner);
  if (isCloud) {
    assertCloudinaryConfigured();
    try {
      const result = await cloudinary.uploader.destroy(key, {
        invalidate: true,
        resource_type: 'image',
        type: 'authenticated',
      });
      if (result.result !== 'ok' && result.result !== 'not found') {
        throw storageUnavailable();
      }
      return;
    } catch {
      throw storageUnavailable();
    }
  }
  await unlink(resolveStoragePath(key)).catch((error: unknown) => {
    if (
      !error
      || typeof error !== 'object'
      || !('code' in error)
      || error.code !== 'ENOENT'
    ) {
      throw error;
    }
  });
};

/**
 * Post-commit cleanup seam used by tenant hard deletion. It intentionally
 * returns only counts so storage paths never enter an HTTP response or audit
 * metadata. The resolved tenant scope is checked again before provider access.
 */
export const deleteOnboardingMediaFiles = async (
  storageKeys: string[],
  owner: OnboardingMediaStorageOwner,
): Promise<{ failed: number; removed: number }> => {
  const uniqueKeys = [...new Set(storageKeys)];
  const results = await Promise.allSettled(
    uniqueKeys.map(storageKey => deleteOnboardingMediaFile(storageKey, owner)),
  );
  const failed = results.filter(result => result.status === 'rejected').length;
  return { failed, removed: results.length - failed };
};
