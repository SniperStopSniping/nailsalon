import type { AssetRepository } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/assets/types';
import { createDefaultCustomDesignSettings } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/model/settings';
import { initializeStarter } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/starters';
import { createDefaultOnboardingState } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/model/defaults';
import {
  claimOnboardingMedia,
  cleanupVerifiedUnreferencedOnboardingMedia,
  collectOnboardingMediaReferences,
  collectPendingOnboardingMediaReferences,
} from './media-claim-client';
import { ONBOARDING_MEDIA_MAX_FILE_BYTES, ONBOARDING_MEDIA_MAX_REQUEST_BYTES } from './media-limits';

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

  it('prepares a large photo before sending multipart while retaining role and ownership fields', async () => {
    const state = createDefaultOnboardingState();
    state.profile.logo = {
      fileName: 'large.png',
      id: 'logo-reference',
      mimeType: 'image/png',
      source: 'indexed_db',
      storageId: 'logo-asset',
    };
    const bytes = new Uint8Array(8_000_000);
    bytes.set(new Uint8Array(await pngBlob.arrayBuffer()));
    const original = new Blob([bytes], { type: 'image/png' });
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close, height: 3_024, width: 4_032 })));
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => ({ drawImage: vi.fn(), scale: vi.fn() }),
        height: 0,
        toBlob: (callback: BlobCallback) => callback(new Blob([new Uint8Array(1_000_000)], { type: 'image/webp' })),
        width: 0,
      }),
    });
    const assetRepository = repository();
    assetRepository.getOriginal = vi.fn(async () => original);
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith('/verify')) {
        return Response.json({ data: { revision: 3 } });
      }
      const form = init?.body as FormData;
      const file = form.get('file') as File;

      expect(file.size).toBeLessThanOrEqual(ONBOARDING_MEDIA_MAX_FILE_BYTES);
      expect(file.type).toBe('image/webp');
      expect(form.get('mimeType')).toBe('image/webp');
      expect(form.get('siteId')).toBe('site-safe');
      expect(form.get('siteRevision')).toBe('3');
      expect(form.get('role')).toBe('logo');
      expect(form.get('localItemId')).toBe('logo-reference');
      expect((await new Response(form).blob()).size).toBeLessThan(ONBOARDING_MEDIA_MAX_REQUEST_BYTES);

      return Response.json({ data: { media: { height: 1_920, id: 'media-logo', url: '/api/onboarding/v1/media/media-logo', width: 2_560 } } });
    });
    try {
      const result = await claimOnboardingMedia({
        draftId: 'draft-safe',
        fetcher,
        idempotencyKey: 'claim-safe',
        repository: assetRepository,
        siteId: 'site-safe',
        siteRevision: 3,
        state,
      });

      expect(result.failures).toEqual([]);
      expect(result.uploaded).toHaveLength(1);
      expect(original.size).toBe(8_000_000);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uploads every active and restorable Custom Design asset in manifest order', async () => {
    const state = createDefaultOnboardingState();
    let nextId = 0;
    const document = initializeStarter('quick_book', {
      idFactory: kind => `multi-custom-${kind}-${nextId++}`,
    });
    const image = (id: string) => ({
      altText: `${id} design`,
      aspectRatio: 1,
      assetId: `${id}-asset`,
      decorative: false,
      fileName: `${id}.png`,
      fileSize: pngBlob.size,
      height: 24,
      id,
      interactiveAreas: [],
      mimeType: 'image/png' as const,
      width: 24,
    });
    const settings = createDefaultCustomDesignSettings();

    document.pages[0]!.sections.push({
      id: 'custom-active',
      label: 'Custom Design',
      order: document.pages[0]!.sections.length,
      sectionType: 'custom_design',
      settings: { ...settings, images: [image('active-image')] },
      visible: true,
    });
    document.unusedSections.push({
      id: 'custom-restorable',
      label: 'Custom Design',
      order: 0,
      sectionType: 'custom_design',
      settings: { ...settings, images: [image('restorable-image')] },
      visible: true,
    });
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith('/verify')) {
        return Response.json({ data: { revision: 5 } });
      }
      const form = init?.body as FormData;
      const localItemId = String(form.get('localItemId'));

      return Response.json({
        data: {
          media: {
            height: 24,
            id: `media-${localItemId}`,
            url: `/media/${localItemId}`,
            width: 24,
          },
        },
      });
    });

    expect(collectOnboardingMediaReferences(state, document)
      .filter(reference => reference.role === 'custom_design'))
      .toEqual([
        expect.objectContaining({
          assetId: 'active-image-asset',
          localItemId: 'active-image',
          order: 0,
        }),
        expect.objectContaining({
          assetId: 'restorable-image-asset',
          localItemId: 'restorable-image',
          order: 1,
        }),
      ]);

    const result = await claimOnboardingMedia({
      document,
      draftId: 'draft-safe',
      fetcher,
      idempotencyKey: 'claim-safe',
      repository: repository(),
      siteId: 'site-safe',
      siteRevision: 4,
      state,
    });

    expect(result.failures).toEqual([]);
    expect(result.uploaded.map(item => item.localItemId))
      .toEqual(['active-image', 'restorable-image']);
    expect(result.verifiedRevision).toBe(5);
  });

  it('does not reupload unchanged account-backed Custom Design media across active and restorable sections', async () => {
    const state = createDefaultOnboardingState();
    let nextId = 0;
    const document = initializeStarter('quick_book', {
      idFactory: kind => `inherited-custom-${kind}-${nextId++}`,
    });
    const image = (id: string, assetId = id) => ({
      altText: `${id} design`,
      aspectRatio: 1,
      assetId,
      decorative: false,
      fileName: `${id}.png`,
      fileSize: pngBlob.size,
      height: 24,
      id,
      interactiveAreas: [],
      mimeType: 'image/png' as const,
      width: 24,
    });
    const settings = createDefaultCustomDesignSettings();
    document.pages[0]!.sections.push({
      id: 'custom-account-active',
      label: 'Custom Design',
      order: document.pages[0]!.sections.length,
      sectionType: 'custom_design',
      settings: { ...settings, images: [image('account-active')] },
      visible: true,
    });
    document.unusedSections.push({
      id: 'custom-account-restorable',
      label: 'Custom Design',
      order: 0,
      sectionType: 'custom_design',
      settings: { ...settings, images: [image('account-restorable')] },
      visible: true,
    });
    const existing = new Map([
      ['account-active', '11111111-1111-4111-8111-111111111111'],
      ['account-restorable', '22222222-2222-4222-8222-222222222222'],
    ]);

    expect(collectPendingOnboardingMediaReferences(state, document, existing))
      .toEqual([]);

    const fetcher = vi.fn<typeof fetch>(async (input) => {
      expect(String(input).endsWith('/verify')).toBe(true);

      return Response.json({ data: { revision: 8 } });
    });
    const result = await claimOnboardingMedia({
      document,
      draftId: 'draft-safe',
      existingCustomMediaByLogicalId: existing,
      fetcher,
      idempotencyKey: 'claim-safe',
      repository: repository(),
      siteId: 'site-safe',
      siteRevision: 7,
      state,
    });

    expect(result).toEqual({ failures: [], uploaded: [], verifiedRevision: 8 });
    expect(fetcher).toHaveBeenCalledTimes(1);

    const active = document.pages[0]!.sections.find(
      section => section.id === 'custom-account-active',
    );
    if (active?.sectionType !== 'custom_design') {
      throw new Error('Expected the active Custom Design fixture.');
    }
    active.settings.images = [image('account-active', 'replacement-local-asset')];

    expect(collectPendingOnboardingMediaReferences(state, document, existing))
      .toEqual([
        expect.objectContaining({
          assetId: 'replacement-local-asset',
          localItemId: 'account-active',
          role: 'custom_design',
        }),
      ]);
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
