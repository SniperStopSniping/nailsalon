import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import type { OnboardingMediaStorageError } from './media-storage.server';
import {
  deleteOnboardingMediaFiles,
  readOnboardingMediaFile,
  saveOnboardingMediaFile,
} from './media-storage.server';

describe('development onboarding media storage', () => {
  let mediaRoot: string;

  beforeEach(async () => {
    mediaRoot = await mkdtemp(path.join(tmpdir(), 'luster-onboarding-media-'));
    vi.stubEnv('LUSTER_ONBOARDING_MEDIA_DIR', mediaRoot);
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(mediaRoot, { force: true, recursive: true });
  });

  it('validates and atomically normalizes a role-owned image outside the repository', async () => {
    const input = await sharp({
      create: {
        background: '#9b3658',
        channels: 4,
        height: 24,
        width: 48,
      },
    }).png().toBuffer();
    const stored = await saveOnboardingMediaFile({
      file: new File([Uint8Array.from(input)], 'logo.png', { type: 'image/png' }),
      role: 'logo',
      revisionId: 'revision_test_1',
      salonId: 'salon_test_1',
      siteId: 'site_test_1',
      stableItemId: 'logo_item_1',
      uploadAttemptId: 'upload_attempt_1',
    });

    expect(stored).toMatchObject({
      height: 24,
      mimeType: 'image/webp',
      width: 48,
    });
    expect(stored.storageKey).toContain('/logo/');
    expect((await readOnboardingMediaFile(stored.storageKey)).byteLength).toBeGreaterThan(0);
  });

  it('rejects a mismatched signature rather than trusting the MIME label', async () => {
    await expect(saveOnboardingMediaFile({
      file: new File(['not an image'], 'fake.png', { type: 'image/png' }),
      role: 'gallery',
      revisionId: 'revision_test_1',
      salonId: 'salon_test_1',
      siteId: 'site_test_1',
      stableItemId: 'gallery_item_1',
      uploadAttemptId: 'upload_attempt_1',
    })).rejects.toMatchObject({
      code: 'INVALID_IMAGE',
    } satisfies Partial<OnboardingMediaStorageError>);
  });

  it('fails closed when a development root is absent', async () => {
    vi.stubEnv('LUSTER_ONBOARDING_MEDIA_DIR', '');
    const input = await sharp({
      create: {
        background: '#fff',
        channels: 3,
        height: 4,
        width: 4,
      },
    }).jpeg().toBuffer();

    await expect(saveOnboardingMediaFile({
      file: new File([Uint8Array.from(input)], 'profile.jpg', { type: 'image/jpeg' }),
      role: 'profile',
      revisionId: 'revision_test_1',
      salonId: 'salon_test_1',
      siteId: 'site_test_1',
      stableItemId: 'profile_item_1',
      uploadAttemptId: 'upload_attempt_1',
    })).rejects.toMatchObject({
      code: 'IMAGE_STORAGE_UNAVAILABLE',
    } satisfies Partial<OnboardingMediaStorageError>);
  });

  it('keeps identical logical image ids immutable across saved revisions', async () => {
    const firstInput = await sharp({
      create: { background: '#9b3658', channels: 3, height: 8, width: 8 },
    }).png().toBuffer();
    const secondInput = await sharp({
      create: { background: '#193b55', channels: 3, height: 8, width: 8 },
    }).png().toBuffer();
    const common = {
      role: 'profile' as const,
      salonId: 'salon_test_1',
      siteId: 'site_test_1',
      stableItemId: 'profile_item_1',
      uploadAttemptId: 'upload_attempt_1',
    };

    const first = await saveOnboardingMediaFile({
      ...common,
      file: new File([Uint8Array.from(firstInput)], 'first.png', { type: 'image/png' }),
      revisionId: 'revision_test_1',
    });
    const firstBytesBefore = await readOnboardingMediaFile(first.storageKey);
    const second = await saveOnboardingMediaFile({
      ...common,
      file: new File([Uint8Array.from(secondInput)], 'second.png', { type: 'image/png' }),
      revisionId: 'revision_test_2',
      uploadAttemptId: 'upload_attempt_2',
    });

    expect(second.storageKey).not.toBe(first.storageKey);
    expect(await readOnboardingMediaFile(first.storageKey)).toEqual(firstBytesBefore);
    expect(await readOnboardingMediaFile(second.storageKey)).not.toEqual(firstBytesBefore);
  });

  it('gives concurrent attempts for one logical item independent storage objects', async () => {
    const input = await sharp({
      create: { background: '#9b3658', channels: 3, height: 8, width: 8 },
    }).png().toBuffer();
    const common = {
      file: new File([Uint8Array.from(input)], 'profile.png', { type: 'image/png' }),
      revisionId: 'revision_test_1',
      role: 'profile' as const,
      salonId: 'salon_test_1',
      siteId: 'site_test_1',
      stableItemId: 'profile_item_1',
    };

    const first = await saveOnboardingMediaFile({
      ...common,
      uploadAttemptId: 'upload_attempt_1',
    });
    const second = await saveOnboardingMediaFile({
      ...common,
      uploadAttemptId: 'upload_attempt_2',
    });

    expect(first.storageKey).not.toBe(second.storageKey);

    await deleteOnboardingMediaFiles([first.storageKey]);

    await expect(readOnboardingMediaFile(first.storageKey)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readOnboardingMediaFile(second.storageKey)).resolves.toHaveLength(first.byteSize);
  });

  it('cleans unique tenant-owned files after a committed tenant purge', async () => {
    const input = await sharp({
      create: { background: '#9b3658', channels: 3, height: 8, width: 8 },
    }).png().toBuffer();
    const stored = await saveOnboardingMediaFile({
      file: new File([Uint8Array.from(input)], 'profile.png', { type: 'image/png' }),
      revisionId: 'revision_test_cleanup',
      role: 'profile',
      salonId: 'salon_test_1',
      siteId: 'site_test_1',
      stableItemId: 'profile_item_1',
      uploadAttemptId: 'upload_attempt_cleanup',
    });

    await expect(deleteOnboardingMediaFiles([
      stored.storageKey,
      stored.storageKey,
    ])).resolves.toEqual({ failed: 0, removed: 1 });
    await expect(readOnboardingMediaFile(stored.storageKey)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
