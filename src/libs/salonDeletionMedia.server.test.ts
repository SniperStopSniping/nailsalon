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

  it.each([
    { kind: 'cloudinary', publicId: `salons/${salonId}/appointments/appt/photo`, source: 'appointment' },
    { kind: 'cloudinary', publicId: `salons/${salonId}/services/service_svc_abcdefghijklmnop_webp`, source: 'service' },
    { kind: 'local_service', imageUrl: `/uploads/services/${salonId}/service_svc_abcdefghijklmnop.webp`, serviceId: 'svc' },
    { kind: 'review', reference: 'https://external.example.test/image', reason: 'Unknown ownership' },
  ] as const)('refuses unfenced public and unverified media: $kind', async (asset) => {
    await expect(removeSalonDeletionAsset(asset, salonId)).rejects.toThrow('requires manual review');
    expect(provider.destroy).not.toHaveBeenCalled();
    expect(provider.resources).not.toHaveBeenCalled();
    expect(provider.serviceDelete).not.toHaveBeenCalled();
    expect(provider.onboardingDelete).not.toHaveBeenCalled();
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
