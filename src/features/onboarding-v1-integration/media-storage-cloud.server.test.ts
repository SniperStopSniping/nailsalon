import { randomBytes } from 'node:crypto';

import sharp from 'sharp';

import { ONBOARDING_MEDIA_MAX_FILE_BYTES } from './media-limits';
import {
  deleteOnboardingMediaFile,
  deleteOnboardingMediaFiles,
  isOnboardingMediaStorageProvider,
  readOnboardingMediaFile,
  saveOnboardingMediaFile,
} from './media-storage.server';

vi.mock('server-only', () => ({}));

const provider = vi.hoisted(() => {
  const objects = new Map<string, Buffer>();
  return {
    configured: true,
    objects,
    destroy: vi.fn(async (publicId: string) => ({ result: objects.delete(publicId) ? 'ok' : 'not found' })),
    download: vi.fn((_publicId: string, _format: string, _options: { expires_at: number }) =>
      'https://api.cloudinary.com/v1_1/test-cloud/image/download?signature=test-only'),
    fetch: vi.fn(async () => new Response('private-image', { headers: { 'Content-Type': 'image/webp' } })),
    upload: vi.fn((
      options: { public_id: string },
      callback: (error: null | { message: string }, result?: Record<string, unknown>) => void,
    ) => ({
      end: (bytes: Buffer) => {
        if (!objects.has(options.public_id)) {
          objects.set(options.public_id, bytes);
        }
        callback(null, {
          format: 'webp',
          public_id: options.public_id,
          resource_type: 'image',
          secure_url: 'https://res.cloudinary.com/test-cloud/image/authenticated/private.webp',
          type: 'authenticated',
        });
      },
    })),
  };
});

vi.mock('@/libs/Cloudinary', () => ({
  cloudinary: {
    uploader: { destroy: provider.destroy, upload_stream: provider.upload },
    utils: { private_download_url: provider.download },
  },
  isCloudinaryConfigured: () => provider.configured,
}));

const owner = { salonId: 'salon_test', siteId: 'site_test' };
const common = {
  ...owner,
  revisionId: 'revision_test',
  role: 'gallery' as const,
  stableItemId: 'image_test',
  uploadAttemptId: 'attempt_test',
};
let file: File;

beforeEach(async () => {
  vi.clearAllMocks();
  provider.objects.clear();
  provider.configured = true;
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('LUSTER_ONBOARDING_MEDIA_DIR', '/tmp/not-used-in-production');
  vi.stubGlobal('fetch', provider.fetch);
  const bytes = await sharp({
    create: { background: '#9b3658', channels: 3, height: 8, width: 16 },
  }).withMetadata().png().toBuffer();
  file = new File([Uint8Array.from(bytes)], 'photo.png', { type: 'image/png' });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('production authenticated onboarding media', () => {
  it.each(['logo', 'profile', 'gallery', 'custom_design'] as const)(
    'stores sanitized %s bytes under an immutable authenticated tenant/site/revision key',
    async (role) => {
      const saved = await saveOnboardingMediaFile({ ...common, file, role });
      const publicId = saved.storageKey.replace('cloudinary_authenticated:', '');

      expect(saved).toMatchObject({ height: 8, mimeType: 'image/webp', storageProvider: 'cloudinary_authenticated', width: 16 });
      expect(publicId).toMatch(new RegExp(`^salons/salon_test/onboarding-sites/site_test/revisions/revision_test/${role}/[a-f0-9]{32}$`));
      expect(provider.upload.mock.calls[0]?.[0]).toEqual({
        format: 'webp',
        overwrite: false,
        public_id: publicId,
        resource_type: 'image',
        type: 'authenticated',
      });

      const metadata = await sharp(provider.objects.get(publicId)!).metadata();

      expect(metadata.format).toBe('webp');
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(JSON.stringify(saved)).not.toContain('cloudinary.com');
    },
  );

  it('fails closed without configured credentials even when a local directory exists', async () => {
    provider.configured = false;

    await expect(saveOnboardingMediaFile({ ...common, file })).rejects.toMatchObject({ code: 'IMAGE_STORAGE_UNAVAILABLE' });
    expect(provider.upload).not.toHaveBeenCalled();
  });

  it('rejects invalid content before contacting the provider', async () => {
    await expect(saveOnboardingMediaFile({
      ...common,
      file: new File(['fake'], 'photo.png', { type: 'image/png' }),
    })).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    expect(provider.upload).not.toHaveBeenCalled();
  });

  it.each(['gif', 'tiff'] as const)('blocks the %s decoder even with a forged allowed MIME type', async (format) => {
    const image = sharp({ create: { background: '#9b3658', channels: 3, height: 8, width: 16 } });
    const bytes = await (format === 'gif' ? image.gif() : image.tiff()).toBuffer();

    // This must fail at the native loader, before metadata could be inspected
    // to discover that the browser-supplied JPEG label is false.
    await expect(sharp(bytes).metadata()).rejects.toThrow(/unsupported image format|blocked/i);
    await expect(saveOnboardingMediaFile({
      ...common,
      file: new File([Uint8Array.from(bytes)], 'forged.jpg', { type: 'image/jpeg' }),
    })).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    expect(provider.upload).not.toHaveBeenCalled();
  });

  it('rejects an oversized transport file before contacting Cloudinary', async () => {
    await expect(saveOnboardingMediaFile({
      ...common,
      file: new File([new Uint8Array(ONBOARDING_MEDIA_MAX_FILE_BYTES + 1)], 'large.png', { type: 'image/png' }),
    })).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    expect(provider.upload).not.toHaveBeenCalled();
  });

  it('bounds the normalized response even when re-encoding a compact JPEG expands its bytes', async () => {
    const source = await sharp(randomBytes(3_500 * 3_500 * 3), {
      raw: { channels: 3, height: 3_500, width: 3_500 },
    }).jpeg({ quality: 20 }).toBuffer();

    expect(source.byteLength).toBeLessThan(ONBOARDING_MEDIA_MAX_FILE_BYTES);

    const saved = await saveOnboardingMediaFile({
      ...common,
      file: new File([Uint8Array.from(source)], 'detailed.jpg', { type: 'image/jpeg' }),
    });

    expect(saved.byteSize).toBeLessThanOrEqual(ONBOARDING_MEDIA_MAX_FILE_BYTES);
    expect(saved.width).toBeLessThan(3_500);
    expect(saved.height).toBe(saved.width);

    const savedBytes = provider.objects.get(saved.storageKey.replace('cloudinary_authenticated:', ''))!;

    expect(savedBytes.byteLength).toBe(saved.byteSize);
    expect(await sharp(savedBytes).metadata()).toMatchObject({ height: saved.height, width: saved.width });
  }, 15_000);

  it('makes a replay stable while different revisions, attempts and bytes cannot overwrite it', async () => {
    const first = await saveOnboardingMediaFile({ ...common, file });
    const replay = await saveOnboardingMediaFile({ ...common, file });
    const newAttempt = await saveOnboardingMediaFile({ ...common, file, uploadAttemptId: 'attempt_new' });
    const newRevision = await saveOnboardingMediaFile({ ...common, file, revisionId: 'revision_new' });
    const bytes = await sharp({ create: { background: '#000', channels: 3, height: 8, width: 16 } }).png().toBuffer();
    const newContent = await saveOnboardingMediaFile({
      ...common,
      file: new File([Uint8Array.from(bytes)], 'new.png', { type: 'image/png' }),
    });

    expect(replay).toEqual(first);
    expect(new Set([first, newAttempt, newRevision, newContent].map(item => item.storageKey)).size).toBe(4);
    expect(provider.objects.size).toBe(4);

    await deleteOnboardingMediaFile(first.storageKey, owner);

    expect(provider.objects.size).toBe(3);
    expect(provider.objects.has(newAttempt.storageKey.replace('cloudinary_authenticated:', ''))).toBe(true);
  });

  it('downloads privately on the server without a reusable redirect or cache', async () => {
    const saved = await saveOnboardingMediaFile({ ...common, file });
    const now = Math.floor(Date.now() / 1_000);

    await expect(readOnboardingMediaFile(saved.storageKey, owner)).resolves.toEqual(Buffer.from('private-image'));
    expect(provider.download).toHaveBeenCalledWith(saved.storageKey.replace('cloudinary_authenticated:', ''), 'webp', {
      attachment: false,
      expires_at: expect.any(Number),
      resource_type: 'image',
      type: 'authenticated',
    });
    expect(provider.download.mock.calls[0]?.[2].expires_at).toBeGreaterThanOrEqual(now + 60);
    expect(provider.download.mock.calls[0]?.[2].expires_at).toBeLessThanOrEqual(now + 62);
    expect(provider.fetch).toHaveBeenCalledWith(expect.any(URL), {
      cache: 'no-store',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    { salonId: 'other_salon', siteId: 'site_test' },
    { salonId: 'salon_test', siteId: 'other_site' },
  ])('refuses reads and deletes for a different owner scope: %j', async (wrongOwner) => {
    const saved = await saveOnboardingMediaFile({ ...common, file });

    await expect(readOnboardingMediaFile(saved.storageKey, wrongOwner)).rejects.toMatchObject({ code: 'INVALID_MEDIA_OWNER' });
    await expect(deleteOnboardingMediaFile(saved.storageKey, wrongOwner)).rejects.toMatchObject({ code: 'INVALID_MEDIA_OWNER' });
    expect(provider.download).not.toHaveBeenCalled();
    expect(provider.fetch).not.toHaveBeenCalled();
    expect(provider.destroy).not.toHaveBeenCalled();
  });

  it.each([
    'cloudinary_authenticated:salons/salon_test/appointments/private',
    'cloudinary_authenticated:salons/salon_test/onboarding-sites/site_test/revisions/../gallery/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'https://res.cloudinary.com/other/image/upload/photo',
  ])('rejects unmanaged or malformed keys before provider access: %s', async (key) => {
    await expect(readOnboardingMediaFile(key, owner)).rejects.toMatchObject({ code: 'INVALID_MEDIA_OWNER' });
    await expect(deleteOnboardingMediaFile(key, owner)).rejects.toMatchObject({ code: 'INVALID_MEDIA_OWNER' });
    expect(provider.download).not.toHaveBeenCalled();
    expect(provider.destroy).not.toHaveBeenCalled();
  });

  it('sanitizes provider errors and allows a later upload retry', async () => {
    provider.upload.mockImplementationOnce((_options, callback) => ({
      end: () => callback({ message: 'provider secret URL must not leak' }),
    }));

    await expect(saveOnboardingMediaFile({ ...common, file })).rejects.toMatchObject({
      code: 'IMAGE_STORAGE_UNAVAILABLE',
      message: 'This image could not be stored securely. Try again shortly.',
    });
    await expect(saveOnboardingMediaFile({ ...common, file })).resolves.toMatchObject({ storageProvider: 'cloudinary_authenticated' });
  });

  it('rejects a provider result that did not confirm authenticated storage', async () => {
    provider.upload.mockImplementationOnce((options, callback) => ({
      end: () => callback(null, { format: 'webp', public_id: options.public_id, resource_type: 'image', type: 'upload' }),
    }));

    await expect(saveOnboardingMediaFile({ ...common, file })).rejects.toMatchObject({ code: 'IMAGE_STORAGE_UNAVAILABLE' });
  });

  it.each(['wrong-host', 'provider-error', 'wrong-content', 'oversize'] as const)('fails closed on a %s download', async (failure) => {
    const saved = await saveOnboardingMediaFile({ ...common, file });
    if (failure === 'wrong-host') {
      provider.download.mockReturnValueOnce('https://example.test/private');
    } else if (failure === 'provider-error') {
      provider.fetch.mockRejectedValueOnce(new Error('signed URL must not leak'));
    } else {
      provider.fetch.mockResolvedValueOnce(new Response('content', {
        headers: { 'Content-Type': failure === 'wrong-content' ? 'text/html' : 'image/webp', 'Content-Length': String(13 * 1024 * 1024) },
      }));
    }

    await expect(readOnboardingMediaFile(saved.storageKey, owner)).rejects.toMatchObject({
      code: 'IMAGE_STORAGE_UNAVAILABLE',
      message: 'This image could not be stored securely. Try again shortly.',
    });
  });

  it('distinguishes a confirmed missing cloud object from a provider outage', async () => {
    const saved = await saveOnboardingMediaFile({ ...common, file });
    provider.fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));

    await expect(readOnboardingMediaFile(saved.storageKey, owner)).rejects.toMatchObject({ code: 'IMAGE_NOT_FOUND' });

    provider.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(readOnboardingMediaFile(saved.storageKey, owner)).rejects.toMatchObject({ code: 'IMAGE_STORAGE_UNAVAILABLE' });

    provider.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(readOnboardingMediaFile(saved.storageKey, owner)).rejects.toMatchObject({ code: 'IMAGE_STORAGE_UNAVAILABLE' });
  });

  it('purges only unique owned keys, tolerates already-deleted objects and reports failures as counts', async () => {
    const saved = await saveOnboardingMediaFile({ ...common, file });
    const other = await saveOnboardingMediaFile({ ...common, file, salonId: 'other_salon' });

    await expect(deleteOnboardingMediaFiles([saved.storageKey, saved.storageKey, other.storageKey], { salonId: owner.salonId }))
      .resolves.toEqual({ failed: 1, removed: 1 });
    await expect(deleteOnboardingMediaFiles([saved.storageKey], owner)).resolves.toEqual({ failed: 0, removed: 1 });
    expect(provider.destroy).toHaveBeenCalledWith(saved.storageKey.replace('cloudinary_authenticated:', ''), {
      invalidate: true,
      resource_type: 'image',
      type: 'authenticated',
    });
    expect(provider.objects.size).toBe(1);
  });

  it('bounds streamed downloads even when the provider omits content length', async () => {
    const saved = await saveOnboardingMediaFile({ ...common, file });
    const cancel = vi.fn();
    provider.fetch.mockResolvedValueOnce(new Response(new ReadableStream({
      cancel,
      start: controller => controller.enqueue(new Uint8Array(ONBOARDING_MEDIA_MAX_FILE_BYTES + 1)),
    }), { headers: { 'Content-Type': 'image/webp' } }));

    await expect(readOnboardingMediaFile(saved.storageKey, owner)).rejects.toMatchObject({ code: 'IMAGE_STORAGE_UNAVAILABLE' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('reports a provider cleanup failure without leaking its response', async () => {
    const saved = await saveOnboardingMediaFile({ ...common, file });
    provider.destroy.mockRejectedValueOnce(new Error('provider signed URL'));

    await expect(deleteOnboardingMediaFiles([saved.storageKey], owner)).resolves.toEqual({ failed: 1, removed: 0 });
    await expect(deleteOnboardingMediaFiles([saved.storageKey], owner)).resolves.toEqual({ failed: 0, removed: 1 });
  });

  it('recognizes only the managed private storage providers', () => {
    expect(isOnboardingMediaStorageProvider('cloudinary_authenticated')).toBe(true);
    expect(isOnboardingMediaStorageProvider('development_local')).toBe(true);
    expect(isOnboardingMediaStorageProvider('cloudinary')).toBe(false);
    expect(isOnboardingMediaStorageProvider(null)).toBe(false);
  });
});
