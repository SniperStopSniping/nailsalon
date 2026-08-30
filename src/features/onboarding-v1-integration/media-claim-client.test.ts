import type { AssetRepository } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/assets/types';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import {
  claimOnboardingMedia,
  cleanupVerifiedUnreferencedOnboardingMedia,
  collectOnboardingMediaReferences,
} from './media-claim-client';

const pngBlob = new Blob([
  Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
], { type: 'image/png' });

const repository = ({ missing = false }: { missing?: boolean } = {}) => ({
  getMetadata: vi.fn(async (assetId: string) => missing
    ? null
    : ({
        aspectRatio: 1,
        byteSize: pngBlob.size,
        createdAt: '2026-08-30T00:00:00.000Z',
        fileName: `${assetId}.png`,
        height: 24,
        id: assetId,
        mimeType: 'image/png',
        orientation: 1,
        width: 24,
      })),
  getOriginal: vi.fn(async () => missing ? null : pngBlob),
}) as unknown as AssetRepository;

describe('onboarding media claim client', () => {
  it('collects role-owned IndexedDB references without treating fixtures as uploads', () => {
    const state = createDefaultOnboardingState();
    state.profile.profilePhoto = {
      fileName: 'daniela.png',
      id: 'profile-reference',
      mimeType: 'image/png',
      source: 'indexed_db',
      storageId: 'profile-asset',
    };
    state.profile.logo = {
      fileName: 'isla.png',
      id: 'logo-reference',
      mimeType: 'image/png',
      source: 'indexed_db',
      storageId: 'logo-asset',
    };
    state.gallery.images = [{
      fileName: 'example.webp',
      id: 'fixture-gallery',
      mimeType: 'image/webp',
      previewUrl: '/example.webp',
      source: 'fixture',
    }];

    expect(collectOnboardingMediaReferences(state)).toEqual([
      expect.objectContaining({ assetId: 'profile-asset', role: 'profile' }),
      expect.objectContaining({ assetId: 'logo-asset', role: 'logo' }),
    ]);
  });

  it('rejects cross-role profile and logo reuse', () => {
    const state = createDefaultOnboardingState();
    state.profile.profilePhoto = {
      fileName: 'portrait.png',
      id: 'profile-reference',
      mimeType: 'image/png',
      source: 'indexed_db',
      storageId: 'same-asset',
    };
    state.profile.logo = {
      fileName: 'logo.png',
      id: 'logo-reference',
      mimeType: 'image/png',
      source: 'indexed_db',
      storageId: 'same-asset',
    };

    expect(() => collectOnboardingMediaReferences(state)).toThrow(
      'ONBOARDING_MEDIA_ROLE_CONFLICT',
    );
  });

  it('uploads local assets with stable ownership and verifies the saved revision', async () => {
    const state = createDefaultOnboardingState();
    state.profile.logo = {
      altText: 'Isla Nail Studio logo',
      fileName: 'isla.png',
      id: 'logo-reference',
      mimeType: 'image/png',
      source: 'indexed_db',
      storageId: 'logo-asset',
    };
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/verify')) {
        return Response.json({ data: { revision: 4 } });
      }
      return Response.json({
        data: {
          media: {
            height: 100,
            id: 'media-logo',
            url: '/api/onboarding/v1/media/media-logo',
            width: 200,
          },
        },
      });
    });

    const result = await claimOnboardingMedia({
      draftId: 'draft-safe',
      fetcher,
      idempotencyKey: 'claim-safe',
      repository: repository(),
      siteId: 'site-safe',
      siteRevision: 3,
      state,
    });

    expect(result).toEqual({
      failures: [],
      uploaded: [expect.objectContaining({
        assetId: 'logo-asset',
        role: 'logo',
        serverMediaId: 'media-logo',
      })],
      verifiedRevision: 4,
    });

    const uploadRequest = fetcher.mock.calls[0];

    expect(uploadRequest?.[1]?.body).toBeInstanceOf(FormData);
    expect((uploadRequest?.[1]?.body as FormData).get('role')).toBe('logo');
  });

  it('keeps a missing local asset as a retryable failure and never deletes it', async () => {
    const state = createDefaultOnboardingState();
    state.gallery.images = [{
      fileName: 'work.png',
      id: 'gallery-reference',
      mimeType: 'image/png',
      source: 'indexed_db',
      storageId: 'missing-gallery-asset',
    }];
    const assetRepository = repository({ missing: true });
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ data: { revision: 2 } }));

    const result = await claimOnboardingMedia({
      draftId: 'draft-safe',
      fetcher,
      idempotencyKey: 'claim-safe',
      repository: assetRepository,
      siteId: 'site-safe',
      siteRevision: 2,
      state,
    });

    expect(result.failures).toEqual([
      expect.objectContaining({
        assetId: 'missing-gallery-asset',
        code: 'asset_missing',
        role: 'gallery',
      }),
    ]);
    expect(assetRepository.delete).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('cleans only ledger-owned assets unreferenced by the verified local draft', async () => {
    const state = createDefaultOnboardingState();
    state.profile.logo = {
      fileName: 'logo.png',
      id: 'logo-reference',
      mimeType: 'image/png',
      source: 'indexed_db',
      storageId: 'keep-logo',
    };
    state.canva.ownedAssetIds = ['keep-logo', 'remove-old', 'remove-old'];
    const assetRepository = {
      delete: vi.fn(async () => true),
    } as unknown as AssetRepository;

    await expect(cleanupVerifiedUnreferencedOnboardingMedia(
      assetRepository,
      state,
    )).resolves.toEqual({
      failedAssetIds: [],
      removedAssetIds: ['remove-old'],
    });
    expect(assetRepository.delete).toHaveBeenCalledTimes(1);
    expect(assetRepository.delete).toHaveBeenCalledWith('remove-old');
    expect(assetRepository.delete).not.toHaveBeenCalledWith('keep-logo');
  });
});
