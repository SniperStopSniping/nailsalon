import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import type { OnboardingMediaStorageError } from './media-storage.server';
import {
  deleteOnboardingMediaFiles,
  normalizeOnboardingImage,
  readOnboardingMediaFile,
  saveOnboardingMediaFile,
} from './media-storage.server';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/Cloudinary', () => ({
  cloudinary: {},
  isCloudinaryConfigured: () => false,
}));

describe('development onboarding media storage', () => {
  let mediaRoot: string;
  const owner = { salonId: 'salon_test_1', siteId: 'site_test_1' };

  beforeEach(async () => {
    mediaRoot = await mkdtemp(path.join(tmpdir(), 'luster-onboarding-media-'));
    vi.stubEnv('LUSTER_ONBOARDING_MEDIA_DIR', mediaRoot);
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(mediaRoot, { force: true, recursive: true });
  });

  it('preserves original text edges and full tall-page dimensions with the artwork profile', async () => {
    // Thin, high-contrast lines expose text-edge damage without depending on
    // optional SVG/font decoders in the test environment.
    const pixels = Buffer.alloc(1200 * 6000 * 3, 255);
    for (let y = 10; y < 6000; y += 40) {
      for (let x = 10; x < 1190; x++) {
        const offset = (y * 1200 + x) * 3;
        pixels[offset] = 138;
        pixels[offset + 1] = 56;
        pixels[offset + 2] = 89;
      }
    }
    const input = await sharp(pixels, { raw: { width: 1200, height: 6000, channels: 3 } }).png().toBuffer();
    const result = await normalizeOnboardingImage(new File([new Uint8Array(input)], 'canva.png', { type: 'image/png' }), { artwork: true, maxOutputBytes: 750000 });

    expect(result.normalizedMetadata).toMatchObject({ width: 1200, height: 6000 });
    expect(result.normalized.byteLength).toBeLessThanOrEqual(750000);

    const rendered = await sharp(result.normalized).ensureAlpha().raw().toBuffer();
    const original = await sharp(input).ensureAlpha().raw().toBuffer();

    expect(rendered.equals(original)).toBe(true);
  });

  it('never manufactures resolution for a small image and retains MIME, pixel and byte validation', async () => {
    const input = await sharp({ create: { width: 279, height: 1280, channels: 3, background: '#ecd1db' } }).png().toBuffer();
    const file = new File([new Uint8Array(input)], 'small.png', { type: 'image/png' });

    expect((await normalizeOnboardingImage(file, { artwork: true, maxOutputBytes: 750000 })).normalizedMetadata).toMatchObject({ width: 279, height: 1280 });
    await expect(normalizeOnboardingImage(new File([new Uint8Array(input)], 'wrong.jpg', { type: 'image/jpeg' }), { artwork: true, maxOutputBytes: 750000 })).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    await expect(normalizeOnboardingImage(file, { artwork: true, maxOutputBytes: 0 })).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    await expect(normalizeOnboardingImage(file, { artwork: true, maxOutputBytes: 4000000 })).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });

  it('uses the same artwork preparation in secure storage and strips metadata', async () => {
    const input = await sharp({ create: { width: 1200, height: 4000, channels: 3, background: '#ecd1db' } }).withMetadata().png().toBuffer();
    const stored = await saveOnboardingMediaFile({ file: new File([new Uint8Array(input)], 'canva.png', { type: 'image/png' }), role: 'custom_design', revisionId: 'canva_revision', salonId: owner.salonId, siteId: owner.siteId, stableItemId: 'page1', uploadAttemptId: 'sharper1', imagePreparation: { artwork: true, maxOutputBytes: 750000 } });
    const saved = await readOnboardingMediaFile(stored.storageKey, owner);

    expect(stored).toMatchObject({ width: 1200, height: 4000 });
    expect((await sharp(saved).metadata()).exif).toBeUndefined();
  });

  it('refuses to shrink a detailed manual artwork page merely to meet its byte bound', async () => {
    const pixels = Buffer.alloc(1200 * 1200 * 3);
    let state = 17;
    for (let i = 0; i < pixels.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      pixels[i] = state >>> 24;
    }
    const input = await sharp(pixels, { raw: { width: 1200, height: 1200, channels: 3 } }).webp({ quality: 95 }).toBuffer();
    const file = new File([new Uint8Array(input)], 'detailed.webp', { type: 'image/webp' });

    await expect(normalizeOnboardingImage(file, { artwork: true, maxOutputBytes: 300000, preserveDimensions: true }))
      .rejects.toThrow('Export it as separate PNG pages');

    // Reference analysis retains its existing bounded width fallback; manual
    // artwork requires exact geometry rather than inheriting that behaviour.
    const reference = await normalizeOnboardingImage(file, { artwork: true, maxOutputBytes: 300000 });

    expect(reference.normalizedMetadata.width).toBeLessThan(1200);
    expect(reference.normalized.length).toBeLessThanOrEqual(300000);
  }, 20_000);

  it.each(['logo', 'cover'] as const)('normalizes, reads and deletes a tenant-owned %s outside the repository', async (role) => {
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
      role,
      revisionId: 'revision_test_1',
      salonId: 'salon_test_1',
      siteId: 'site_test_1',
      stableItemId: 'logo_item_1',
      uploadAttemptId: 'upload_attempt_1',
    });

    expect(stored).toMatchObject({
      height: 24,
      mimeType: 'image/webp',
      storageProvider: 'development_local',
      width: 48,
    });
    expect(stored.storageKey).toContain(`/${role}/`);
    expect((await readOnboardingMediaFile(stored.storageKey, owner)).byteLength).toBeGreaterThan(0);
    await expect(readOnboardingMediaFile(stored.storageKey, { salonId: 'other_salon' }))
      .rejects.toMatchObject({ code: 'INVALID_MEDIA_OWNER' });
    await expect(deleteOnboardingMediaFiles([stored.storageKey], owner)).resolves.toEqual({ failed: 0, removed: 1 });
    await expect(readOnboardingMediaFile(stored.storageKey, owner)).rejects.toMatchObject({ code: 'ENOENT' });
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

  it('reads existing private uploads in an explicitly local optimized Development runtime', async () => {
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer();
    const saved = await saveOnboardingMediaFile({ file: new File([Uint8Array.from(bytes)], 'photo.png', { type: 'image/png' }), ...owner, role: 'gallery', revisionId: 'revision_optimized', stableItemId: 'photo', uploadAttemptId: 'attempt' });
    const original = await readOnboardingMediaFile(saved.storageKey, owner);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ENV', 'development');
    for (const key of ['VERCEL', 'VERCEL_ENV', 'VITEST', 'CI', 'GITHUB_ACTIONS']) {
      vi.stubEnv(key, undefined);
    }

    await expect(readOnboardingMediaFile(saved.storageKey, owner)).resolves.toEqual(original);
    await expect(readOnboardingMediaFile(saved.storageKey, { salonId: 'another_salon' })).rejects.toMatchObject({ code: 'INVALID_MEDIA_OWNER' });
  });

  it.each([
    { app: undefined, vercel: undefined, deployment: undefined },
    { app: 'preview', vercel: undefined, deployment: undefined },
    { app: 'development', vercel: '1', deployment: 'development' },
    { app: 'development', vercel: '1', deployment: 'production' },
    { app: 'production', vercel: '1', deployment: 'production' },
  ])('keeps local uploads inaccessible to hosted or ambiguous optimized runtimes: %j', async ({ app, vercel, deployment }) => {
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer();
    const saved = await saveOnboardingMediaFile({ file: new File([Uint8Array.from(bytes)], 'photo.png', { type: 'image/png' }), ...owner, role: 'gallery', revisionId: 'revision_rejected', stableItemId: 'photo', uploadAttemptId: 'attempt' });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ENV', app);
    vi.stubEnv('VERCEL', vercel);
    vi.stubEnv('VERCEL_ENV', deployment);
    vi.stubEnv('VITEST', undefined);

    await expect(readOnboardingMediaFile(saved.storageKey, owner)).rejects.toMatchObject({ code: 'IMAGE_STORAGE_UNAVAILABLE' });
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
    const firstBytesBefore = await readOnboardingMediaFile(first.storageKey, owner);
    const second = await saveOnboardingMediaFile({
      ...common,
      file: new File([Uint8Array.from(secondInput)], 'second.png', { type: 'image/png' }),
      revisionId: 'revision_test_2',
      uploadAttemptId: 'upload_attempt_2',
    });

    expect(second.storageKey).not.toBe(first.storageKey);
    expect(await readOnboardingMediaFile(first.storageKey, owner)).toEqual(firstBytesBefore);
    expect(await readOnboardingMediaFile(second.storageKey, owner)).not.toEqual(firstBytesBefore);
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

    await deleteOnboardingMediaFiles([first.storageKey], owner);

    await expect(readOnboardingMediaFile(first.storageKey, owner)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readOnboardingMediaFile(second.storageKey, owner)).resolves.toHaveLength(first.byteSize);
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
    ], owner)).resolves.toEqual({ failed: 0, removed: 1 });
    await expect(readOnboardingMediaFile(stored.storageKey, owner)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
