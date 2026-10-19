import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const provider = vi.hoisted(() => ({ destroy: vi.fn(), resources: vi.fn(), configured: vi.fn(), serviceDelete: vi.fn(), onboardingDelete: vi.fn() }));
vi.mock('@/libs/Cloudinary', () => ({
  cloudinary: { uploader: { destroy: provider.destroy }, api: { resources_by_ids: provider.resources } },
  isCloudinaryConfigured: provider.configured,
}));
vi.mock('@/features/onboarding-v1-integration/media-storage.server', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/onboarding-v1-integration/media-storage.server')>(),
  deleteOnboardingMediaFile: provider.onboardingDelete,
}));
vi.mock('@/libs/serviceImageStorage.server', async importOriginal => ({
  ...await importOriginal<typeof import('@/libs/serviceImageStorage.server')>(),
  deleteCloudinaryServiceImageByPublicId: provider.serviceDelete,
}));

const { removeSalonDeletionAsset, assertSalonDeletionAssetUnreferenced } = await import('./salonDeletionMedia.server');

describe('salon deletion provider confirmations', () => {
  const salonId = 'fake_salon';

  beforeEach(() => {
    vi.resetAllMocks();
    provider.configured.mockReturnValue(true);
    provider.destroy.mockResolvedValue({ result: 'ok' });
  });

  it.each(['ok', 'not found'])('accepts only confirmed idempotent removal: %s', async (result) => {
    provider.destroy.mockResolvedValueOnce({ result });
    const publicId = `salons/${salonId}/appointments/fake_appointment/fake_photo`;
    await removeSalonDeletionAsset({ kind: 'cloudinary', publicId, source: 'appointment' }, salonId);

    expect(provider.destroy).toHaveBeenCalledWith(publicId, { invalidate: true, resource_type: 'image', type: 'upload' });
  });

  it('keeps unexpected provider results retryable and does not swallow errors', async () => {
    provider.destroy.mockResolvedValueOnce({ result: 'error' });

    await expect(removeSalonDeletionAsset({ kind: 'cloudinary', publicId: `salons/${salonId}/appointments/appt/photo`, source: 'appointment' }, salonId)).rejects.toThrow('Provider did not confirm');

    provider.configured.mockReturnValue(false);

    await expect(removeSalonDeletionAsset({ kind: 'cloudinary', publicId: `salons/${salonId}/appointments/appt/photo`, source: 'appointment' }, salonId)).rejects.toThrow('Image storage unavailable');
  });

  it('refuses another salon’s keys and manual-review references', async () => {
    await expect(removeSalonDeletionAsset({ kind: 'cloudinary', publicId: 'salons/other/appointments/appt/photo', source: 'appointment' }, salonId)).rejects.toThrow('ownership');
    await expect(removeSalonDeletionAsset({ kind: 'review', reference: 'https://external.example.test/image', reason: 'Unknown ownership' }, salonId)).rejects.toThrow('review');
    expect(provider.destroy).not.toHaveBeenCalled();
  });

  it('retains the existing service metadata guards and independently verifies absence', async () => {
    const publicId = `salons/${salonId}/services/service_svc_${'a'.repeat(16)}_webp`;
    const asset = { kind: 'cloudinary', publicId, source: 'service' } as const;
    provider.serviceDelete.mockResolvedValue(false);
    provider.resources.mockResolvedValueOnce({ resources: [{ public_id: publicId }] });

    await expect(removeSalonDeletionAsset(asset, salonId)).rejects.toThrow('not confirmed');
    expect(provider.serviceDelete).toHaveBeenCalledWith({ publicId, salonId, serviceId: 'svc' });
    expect(provider.destroy).not.toHaveBeenCalled();

    provider.resources.mockResolvedValueOnce({ resources: [] });

    await expect(removeSalonDeletionAsset(asset, salonId)).resolves.toBeUndefined();
  });

  it('uses the owned private-media adapter for onboarding files', async () => {
    const key = `cloudinary_authenticated:salons/${salonId}/onboarding-sites/site/revisions/rev/gallery/${'b'.repeat(32)}`;
    await removeSalonDeletionAsset({ kind: 'onboarding', key }, salonId);

    expect(provider.onboardingDelete).toHaveBeenCalledWith(key, { salonId });
  });

  it('blocks a newly added live reference, including transformed URLs with query strings', async () => {
    const publicId = `salons/${salonId}/appointments/appt/photo`;
    const execute = vi.fn().mockResolvedValue({ rows: [{ reference: `https://res.cloudinary.com/demo/image/upload/c_fill/v123/${publicId}.webp?ignored=1`, imageUrl: null }] });

    await expect(assertSalonDeletionAssetUnreferenced({ execute } as unknown as Parameters<typeof assertSalonDeletionAssetUnreferenced>[0], { kind: 'cloudinary', publicId, source: 'appointment' })).rejects.toThrow('referenced');
    expect(provider.destroy).not.toHaveBeenCalled();

    execute.mockResolvedValueOnce({ rows: [] });

    await expect(assertSalonDeletionAssetUnreferenced({ execute } as unknown as Parameters<typeof assertSalonDeletionAssetUnreferenced>[0], { kind: 'cloudinary', publicId, source: 'appointment' })).resolves.toBeUndefined();
  });
});
