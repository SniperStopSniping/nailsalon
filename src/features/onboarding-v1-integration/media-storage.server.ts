import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import type { OnboardingMediaRole } from './media-claim-client';

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SAFE_ID = /^[\w-]{1,160}$/;

export type StoredOnboardingMediaFile = {
  byteSize: number;
  height: number;
  mimeType: 'image/webp';
  storageKey: string;
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
};

export class OnboardingMediaStorageError extends Error {
  readonly code:
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

const resolveRoot = (): string => {
  if (process.env.NODE_ENV === 'production') {
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

export const saveOnboardingMediaFile = async ({
  file,
  role,
  revisionId,
  salonId,
  siteId,
  stableItemId,
  uploadAttemptId,
}: SaveOnboardingMediaFileInput): Promise<StoredOnboardingMediaFile> => {
  assertSafeId(stableItemId, 'image item id');
  assertSafeId(revisionId, 'site revision id');
  assertSafeId(salonId, 'salon id');
  assertSafeId(siteId, 'site id');
  assertSafeId(uploadAttemptId, 'upload attempt id');
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new OnboardingMediaStorageError(
      'UNSUPPORTED_IMAGE',
      'Choose a JPG, PNG or WebP image.',
    );
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    throw new OnboardingMediaStorageError(
      'INVALID_IMAGE',
      'Choose a readable image no larger than 12 MB.',
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

  let normalized: Buffer;
  let normalizedMetadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    normalized = await sharp(input, {
      failOn: 'error',
      limitInputPixels: MAX_PIXELS,
    })
      .rotate()
      .webp({ quality: 88 })
      .toBuffer();
    normalizedMetadata = await sharp(normalized).metadata();
  } catch {
    throw new OnboardingMediaStorageError(
      'INVALID_IMAGE',
      'This photo could not be prepared for your site.',
    );
  }
  if (!normalizedMetadata.width || !normalizedMetadata.height) {
    throw new OnboardingMediaStorageError(
      'INVALID_IMAGE',
      'This photo has invalid dimensions.',
    );
  }

  const fingerprint = createHash('sha256')
    // Revisions are append-only. Including the immutable revision identity
    // prevents a later replace-draft upload with the same logical image id
    // from overwriting bytes referenced by an earlier saved revision.
    // A lease attempt owns a unique immutable object. If a stale request is
    // reclaimed while it is still normalizing bytes, its cleanup can remove
    // only its own object and can never delete the replacement request's
    // successful upload.
    .update(`${revisionId}:${stableItemId}:${role}:${uploadAttemptId}`)
    .digest('hex')
    .slice(0, 32);
  const storageKey = path.posix.join(
    salonId,
    siteId,
    revisionId,
    role,
    `${fingerprint}.webp`,
  );
  const absolute = resolveStoragePath(storageKey);
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

  return {
    byteSize: normalized.byteLength,
    height: normalizedMetadata.height,
    mimeType: 'image/webp',
    storageKey,
    width: normalizedMetadata.width,
  };
};

export const readOnboardingMediaFile = async (
  storageKey: string,
): Promise<Buffer> => readFile(resolveStoragePath(storageKey));

export const deleteOnboardingMediaFile = async (
  storageKey: string,
): Promise<void> => {
  await unlink(resolveStoragePath(storageKey)).catch((error: unknown) => {
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
 * metadata. A hardened cloud provider can replace this adapter without
 * changing the purge transaction.
 */
export const deleteOnboardingMediaFiles = async (
  storageKeys: string[],
): Promise<{ failed: number; removed: number }> => {
  const uniqueKeys = [...new Set(storageKeys)];
  const results = await Promise.allSettled(
    uniqueKeys.map(storageKey => deleteOnboardingMediaFile(storageKey)),
  );
  const failed = results.filter(result => result.status === 'rejected').length;
  return { failed, removed: results.length - failed };
};
