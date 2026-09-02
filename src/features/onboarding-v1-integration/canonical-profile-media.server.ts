import 'server-only';

import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { UploadApiResponse } from 'cloudinary';

import { cloudinary, isCloudinaryConfigured } from '@/libs/Cloudinary';

const SAFE_ID = /^[\w-]{1,160}$/;
const LOCAL_ROOT_SEGMENTS = ['public', 'uploads', 'onboarding-profile'] as const;

export type CanonicalOnboardingProfileMediaRole = 'logo' | 'profile';

export type CanonicalOnboardingProfileMedia = {
  publicUrl: string;
  storageKey: string;
  storageProvider: 'cloudinary' | 'development_public';
};

export class CanonicalOnboardingProfileMediaError extends Error {
  readonly code:
    | 'CANONICAL_MEDIA_STORAGE_UNAVAILABLE'
    | 'CANONICAL_MEDIA_NOT_READY'
    | 'CANONICAL_MEDIA_REVISION_STALE'
    | 'CANONICAL_PROFILE_OWNER_UNRESOLVED'
    | 'INVALID_CANONICAL_MEDIA_OWNER'
    | 'INVALID_CANONICAL_MEDIA_ROLE';

  constructor(
    code: CanonicalOnboardingProfileMediaError['code'],
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = 'CanonicalOnboardingProfileMediaError';
  }
}

const assertSafeId = (value: string, label: string): void => {
  if (!SAFE_ID.test(value)) {
    throw new CanonicalOnboardingProfileMediaError(
      'INVALID_CANONICAL_MEDIA_OWNER',
      `Invalid ${label}.`,
    );
  }
};

const canonicalFileStem = ({
  mediaId,
  role,
  technicianId,
}: {
  mediaId: string;
  role: CanonicalOnboardingProfileMediaRole;
  technicianId: string | null;
}): string => {
  if (role === 'logo') {
    return `logo_${mediaId}`;
  }
  if (!technicianId) {
    throw new CanonicalOnboardingProfileMediaError(
      'INVALID_CANONICAL_MEDIA_ROLE',
      'A profile photo needs one exact technician owner.',
    );
  }
  assertSafeId(technicianId, 'technician id');
  return `profile_${technicianId}_${mediaId}`;
};

const localRoot = (): string => path.resolve(
  process.cwd(),
  ...LOCAL_ROOT_SEGMENTS,
);

const assertContainedPath = (root: string, candidate: string): void => {
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new CanonicalOnboardingProfileMediaError(
      'INVALID_CANONICAL_MEDIA_OWNER',
      'The canonical media path is outside its managed directory.',
    );
  }
};

const saveDevelopmentPublicMedia = async ({
  bytes,
  fileStem,
  mediaId,
  salonId,
}: {
  bytes: Buffer;
  fileStem: string;
  mediaId: string;
  salonId: string;
}): Promise<CanonicalOnboardingProfileMedia> => {
  if (process.env.NODE_ENV === 'production') {
    throw new CanonicalOnboardingProfileMediaError(
      'CANONICAL_MEDIA_STORAGE_UNAVAILABLE',
      'Public profile image storage is not configured.',
    );
  }
  const root = localRoot();
  const directory = path.resolve(root, salonId);
  const fileName = `${fileStem}.webp`;
  const absolutePath = path.resolve(directory, fileName);
  assertContainedPath(root, directory);
  assertContainedPath(directory, absolutePath);
  await mkdir(directory, { recursive: true });
  await writeFile(absolutePath, bytes);
  return {
    publicUrl: `/uploads/onboarding-profile/${salonId}/${fileName}?v=${encodeURIComponent(mediaId)}`,
    storageKey: `${salonId}/${fileName}`,
    storageProvider: 'development_public',
  };
};

const saveCloudinaryMedia = async ({
  bytes,
  fileStem,
  role,
  salonId,
}: {
  bytes: Buffer;
  fileStem: string;
  role: CanonicalOnboardingProfileMediaRole;
  salonId: string;
}): Promise<CanonicalOnboardingProfileMedia> => {
  const publicId = `salons/${salonId}/onboarding-profile/${fileStem}`;
  const result = await new Promise<UploadApiResponse>((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        overwrite: true,
        public_id: publicId,
        resource_type: 'image',
        invalidate: true,
        transformation: role === 'profile'
          ? [{ crop: 'fill', gravity: 'face', height: 400, width: 400 }]
          : [{ crop: 'limit', height: 600, width: 1_200 }],
      },
      (error, uploaded) => {
        if (error) {
          reject(new Error(`Cloudinary upload failed: ${error.message}`));
          return;
        }
        if (!uploaded?.secure_url) {
          reject(new Error('Cloudinary upload returned no public URL.'));
          return;
        }
        resolve(uploaded);
      },
    ).end(bytes);
  });
  return {
    publicUrl: result.secure_url,
    storageKey: publicId,
    storageProvider: 'cloudinary',
  };
};

/**
 * Creates a public, canonical projection of one already-normalized onboarding
 * identity image. The private revision-owned media object remains the saved
 * site authority; this projection only connects the same bytes to the shared
 * Salon or Technician field used by public booking templates.
 */
export const saveCanonicalOnboardingProfileMedia = async ({
  bytes,
  mediaId,
  role,
  salonId,
  technicianId = null,
}: {
  bytes: Buffer;
  mediaId: string;
  role: CanonicalOnboardingProfileMediaRole;
  salonId: string;
  technicianId?: string | null;
}): Promise<CanonicalOnboardingProfileMedia> => {
  assertSafeId(mediaId, 'media id');
  assertSafeId(salonId, 'salon id');
  if (bytes.byteLength === 0) {
    throw new CanonicalOnboardingProfileMediaError(
      'INVALID_CANONICAL_MEDIA_ROLE',
      'The canonical profile image is empty.',
    );
  }
  const fileStem = canonicalFileStem({ mediaId, role, technicianId });
  return isCloudinaryConfigured()
    ? saveCloudinaryMedia({ bytes, fileStem, role, salonId })
    : saveDevelopmentPublicMedia({ bytes, fileStem, mediaId, salonId });
};

export const deleteCanonicalOnboardingProfileMedia = async (
  media: CanonicalOnboardingProfileMedia,
): Promise<void> => {
  if (media.storageProvider === 'cloudinary') {
    await cloudinary.uploader.destroy(media.storageKey, { invalidate: true });
    return;
  }
  const root = localRoot();
  const absolutePath = path.resolve(root, media.storageKey);
  assertContainedPath(root, absolutePath);
  await unlink(absolutePath).catch((error: unknown) => {
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
