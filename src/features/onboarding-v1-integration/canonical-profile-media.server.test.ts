import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

vi.mock('server-only', () => ({}));

const cloudinary = vi.hoisted(() => ({
  configured: false,
  destroy: vi.fn(async () => undefined),
  uploadStream: vi.fn(),
}));

vi.mock('@/libs/Cloudinary', () => ({
  cloudinary: {
    uploader: {
      destroy: cloudinary.destroy,
      upload_stream: cloudinary.uploadStream,
    },
  },
  isCloudinaryConfigured: () => cloudinary.configured,
}));

/* eslint-disable import/first */
import {
  deleteCanonicalOnboardingProfileMedia,
  saveCanonicalOnboardingProfileMedia,
} from './canonical-profile-media.server';
/* eslint-enable import/first */

const SALON_ID = 'salon_canonical_media_test';
const managedDirectory = path.join(
  process.cwd(),
  'public',
  'uploads',
  'onboarding-profile',
  SALON_ID,
);

beforeEach(() => {
  vi.clearAllMocks();
  cloudinary.configured = false;
  vi.stubEnv('NODE_ENV', 'test');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(managedDirectory, { force: true, recursive: true });
});

describe('canonical onboarding profile media', () => {
  it('writes logo and profile bytes to separate public role-owned paths in development', async () => {
    const logo = await saveCanonicalOnboardingProfileMedia({
      bytes: Buffer.from('logo-bytes'),
      mediaId: 'media_logo_1',
      role: 'logo',
      salonId: SALON_ID,
    });
    const profile = await saveCanonicalOnboardingProfileMedia({
      bytes: Buffer.from('profile-bytes'),
      mediaId: 'media_profile_1',
      role: 'profile',
      salonId: SALON_ID,
      technicianId: 'technician_1',
    });

    expect(logo.publicUrl).toBe(
      `/uploads/onboarding-profile/${SALON_ID}/logo_media_logo_1.webp?v=media_logo_1`,
    );
    expect(profile.publicUrl).toBe(
      `/uploads/onboarding-profile/${SALON_ID}/profile_technician_1_media_profile_1.webp?v=media_profile_1`,
    );
    expect(logo.publicUrl).not.toBe(profile.publicUrl);
    await expect(readFile(path.join(managedDirectory, 'logo_media_logo_1.webp')))
      .resolves.toEqual(Buffer.from('logo-bytes'));
    await expect(readFile(path.join(
      managedDirectory,
      'profile_technician_1_media_profile_1.webp',
    ))).resolves.toEqual(Buffer.from('profile-bytes'));
  });

  it('never guesses a profile owner and never substitutes the logo target', async () => {
    await expect(saveCanonicalOnboardingProfileMedia({
      bytes: Buffer.from('profile-bytes'),
      mediaId: 'media_profile_1',
      role: 'profile',
      salonId: SALON_ID,
    })).rejects.toMatchObject({
      code: 'INVALID_CANONICAL_MEDIA_ROLE',
    });
  });

  it('uses immutable role objects so an old upload cannot overwrite a newer replacement', async () => {
    const first = await saveCanonicalOnboardingProfileMedia({
      bytes: Buffer.from('first-logo'),
      mediaId: 'media_logo_1',
      role: 'logo',
      salonId: SALON_ID,
    });
    const second = await saveCanonicalOnboardingProfileMedia({
      bytes: Buffer.from('second-logo'),
      mediaId: 'media_logo_2',
      role: 'logo',
      salonId: SALON_ID,
    });

    expect(first.storageKey).not.toBe(second.storageKey);
    expect(first.publicUrl).not.toBe(second.publicUrl);
    await expect(readFile(path.join(managedDirectory, 'logo_media_logo_1.webp')))
      .resolves.toEqual(Buffer.from('first-logo'));
    await expect(readFile(path.join(managedDirectory, 'logo_media_logo_2.webp')))
      .resolves.toEqual(Buffer.from('second-logo'));
    await expect(readdir(managedDirectory)).resolves.toEqual([
      'logo_media_logo_1.webp',
      'logo_media_logo_2.webp',
    ]);
  });

  it('fails closed in production when the existing public provider is unavailable', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    await expect(saveCanonicalOnboardingProfileMedia({
      bytes: Buffer.from('logo-bytes'),
      mediaId: 'media_logo_1',
      role: 'logo',
      salonId: SALON_ID,
    })).rejects.toMatchObject({
      code: 'CANONICAL_MEDIA_STORAGE_UNAVAILABLE',
    });
  });

  it('uses the configured Cloudinary provider with separate stable role targets', async () => {
    cloudinary.configured = true;
    cloudinary.uploadStream.mockImplementation((options, callback) => ({
      end: (bytes: Buffer) => callback(null, {
        bytes: bytes.byteLength,
        public_id: options.public_id,
        secure_url: `https://res.cloudinary.com/luster/image/upload/v2/${options.public_id}.webp`,
      }),
    }));

    const profile = await saveCanonicalOnboardingProfileMedia({
      bytes: Buffer.from('profile-bytes'),
      mediaId: 'media_profile_1',
      role: 'profile',
      salonId: SALON_ID,
      technicianId: 'technician_1',
    });

    expect(profile).toEqual({
      publicUrl: `https://res.cloudinary.com/luster/image/upload/v2/salons/${SALON_ID}/onboarding-profile/profile_technician_1_media_profile_1.webp`,
      storageKey: `salons/${SALON_ID}/onboarding-profile/profile_technician_1_media_profile_1`,
      storageProvider: 'cloudinary',
    });
    expect(cloudinary.uploadStream).toHaveBeenCalledWith(
      expect.objectContaining({
        invalidate: true,
        overwrite: true,
        public_id: `salons/${SALON_ID}/onboarding-profile/profile_technician_1_media_profile_1`,
      }),
      expect.any(Function),
    );
  });

  it('removes only a known managed development projection', async () => {
    const logo = await saveCanonicalOnboardingProfileMedia({
      bytes: Buffer.from('logo-bytes'),
      mediaId: 'media_logo_1',
      role: 'logo',
      salonId: SALON_ID,
    });
    await deleteCanonicalOnboardingProfileMedia(logo);

    await expect(readFile(path.join(managedDirectory, 'logo_media_logo_1.webp')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
});
