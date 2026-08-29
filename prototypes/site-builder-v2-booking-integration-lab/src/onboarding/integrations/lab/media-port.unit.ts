import type {
  AssetRepository,
  ImageAssetMetadata,
  PreparedImageAsset,
} from '../../../custom-design/assets';
import { ONBOARDING_IMAGE_DECODE_ERROR } from '../../model/local-images';
import type { LocalImageReference } from '../../model/types';
import { resolveOnboardingImageUrl } from '../adapters/media';
import { LAB_ONBOARDING_MEDIA_PORT } from './media-port';

const mediaMocks = vi.hoisted(() => ({
  decode: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock('../../model/local-images', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../model/local-images')>();
  return {
    ...original,
    decodeOnboardingLocalImage: mediaMocks.decode,
  };
});

vi.mock('../../../custom-design/assets/image-processing', () => ({
  prepareImageAsset: mediaMocks.prepare,
}));

type RepositoryHarness = {
  commit: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  discard: ReturnType<typeof vi.fn>;
  repository: AssetRepository;
  stage: ReturnType<typeof vi.fn>;
};

const metadataFor = (
  id: string,
  fileName = 'portrait.png',
): ImageAssetMetadata => ({
  aspectRatio: 2 / 3,
  byteSize: 128,
  createdAt: '2026-08-29T12:00:00.000Z',
  fileName,
  height: 900,
  id,
  mimeType: 'image/png',
  orientation: 1,
  width: 600,
});

const createRepository = (): RepositoryHarness => {
  const stage = vi.fn(async (asset: PreparedImageAsset) => asset.metadata);
  const commit = vi.fn(async (assetId: string) => metadataFor(assetId));
  const discard = vi.fn(async () => true);
  const deleteAsset = vi.fn(async () => true);
  return {
    commit,
    delete: deleteAsset,
    discard,
    repository: {
      clear: vi.fn(async () => 0),
      close: vi.fn(),
      commit,
      commitBatch: vi.fn(async () => []),
      delete: deleteAsset,
      deleteDatabase: vi.fn(async () => undefined),
      discard,
      get: vi.fn(async () => null),
      getMetadata: vi.fn(async () => null),
      getOriginal: vi.fn(async () => null),
      getThumbnail: vi.fn(async () => null),
      has: vi.fn(async () => false),
      list: vi.fn(async () => []),
      stage,
    },
    stage,
  };
};

const file = (name = 'portrait.png'): File =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, {
    type: 'image/png',
  });

const indexedImage = (storageId: string): LocalImageReference => ({
  fileName: `${storageId}.png`,
  id: `profile_${storageId}`,
  mimeType: 'image/png',
  source: 'indexed_db',
  storageId,
});

describe('LAB_ONBOARDING_MEDIA_PORT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mediaMocks.decode.mockResolvedValue({ height: 900, width: 600 });
    mediaMocks.prepare.mockImplementation(async (
      selectedFile: File,
      options: { assetId: string },
    ): Promise<PreparedImageAsset> => ({
      blob: selectedFile,
      metadata: metadataFor(options.assetId, selectedFile.name),
    }));
  });

  it('stores through the shared repository and returns a metadata-only IndexedDB reference', async () => {
    const harness = createRepository();
    harness.commit.mockImplementation(async (assetId: string) =>
      metadataFor(assetId, 'daniela.png'));
    const selectedFile = file('daniela.png');

    const reference = await LAB_ONBOARDING_MEDIA_PORT.storeOne(
      harness.repository,
      selectedFile,
      'profile',
    );

    expect(mediaMocks.decode).toHaveBeenCalledWith(selectedFile);
    expect(mediaMocks.prepare).toHaveBeenCalledWith(
      selectedFile,
      expect.objectContaining({ assetId: expect.stringMatching(/^onboarding_profile_/u) }),
    );
    expect(harness.stage).toHaveBeenCalledOnce();
    expect(harness.commit).toHaveBeenCalledWith(reference.storageId);
    expect(reference).toEqual(expect.objectContaining({
      altText: 'Business owner portrait',
      fileName: 'daniela.png',
      height: 900,
      mimeType: 'image/png',
      source: 'indexed_db',
      width: 600,
    }));
    expect(reference).not.toHaveProperty('previewUrl');
    expect(JSON.stringify(reference)).not.toContain('data:');
  });

  it('does not create or discard a repository record when decoding fails', async () => {
    const harness = createRepository();
    mediaMocks.decode.mockRejectedValueOnce(new Error('native decoder detail'));

    await expect(LAB_ONBOARDING_MEDIA_PORT.storeOne(
      harness.repository,
      file('corrupt.png'),
      'logo',
    )).rejects.toThrow('native decoder detail');

    expect(mediaMocks.prepare).not.toHaveBeenCalled();
    expect(harness.stage).not.toHaveBeenCalled();
    expect(harness.commit).not.toHaveBeenCalled();
    expect(harness.discard).not.toHaveBeenCalled();
  });

  it.each(['stage', 'commit'] as const)(
    'discards the candidate asset after a %s failure and exposes safe owner copy',
    async (failedOperation) => {
      const harness = createRepository();
      harness[failedOperation].mockRejectedValueOnce(new Error('low-level storage detail'));

      await expect(LAB_ONBOARDING_MEDIA_PORT.storeOne(
        harness.repository,
        file(`${failedOperation}.png`),
        'logo',
      )).rejects.toThrow(ONBOARDING_IMAGE_DECODE_ERROR);

      const prepared = mediaMocks.prepare.mock.results[0]?.value;
      const preparedAsset = await prepared as PreparedImageAsset;
      expect(harness.discard).toHaveBeenCalledOnce();
      expect(harness.discard).toHaveBeenCalledWith(preparedAsset.metadata.id);
    },
  );

  it('reports truthful per-file partial success while keeping accepted references metadata-only', async () => {
    const harness = createRepository();
    const acceptedFiles = new Map<string, string>();
    mediaMocks.prepare.mockImplementation(async (
      selectedFile: File,
      options: { assetId: string },
    ): Promise<PreparedImageAsset> => {
      acceptedFiles.set(options.assetId, selectedFile.name);
      return {
        blob: selectedFile,
        metadata: metadataFor(options.assetId, selectedFile.name),
      };
    });
    harness.commit.mockImplementation(async (assetId: string) =>
      metadataFor(assetId, acceptedFiles.get(assetId)));
    mediaMocks.decode.mockImplementation(async (selectedFile: File) => {
      if (selectedFile.name === 'broken.png') {
        throw new Error(ONBOARDING_IMAGE_DECODE_ERROR);
      }
      return { height: 900, width: 600 };
    });

    const result = await LAB_ONBOARDING_MEDIA_PORT.storeBatch(
      harness.repository,
      [file('first.png'), file('broken.png'), file('second.png')],
      'gallery',
    );

    expect(result.accepted.map((image) => image.fileName)).toEqual([
      'first.png',
      'second.png',
    ]);
    expect(result.accepted.every((image) =>
      image.source === 'indexed_db'
      && image.storageId !== undefined
      && image.previewUrl === undefined)).toBe(true);
    expect(result.failures).toEqual([{
      fileName: 'broken.png',
      message: ONBOARDING_IMAGE_DECODE_ERROR,
    }]);
    expect(harness.stage).toHaveBeenCalledTimes(2);
    expect(harness.commit).toHaveBeenCalledTimes(2);
  });

  it('deletes only unique owned IndexedDB records and returns bounded deletion errors', async () => {
    const harness = createRepository();
    harness.delete.mockImplementation(async (storageId: string) => {
      if (storageId === 'cannot-delete') {
        throw new Error('storage unavailable');
      }
      return true;
    });
    const fixtureImage: LocalImageReference = {
      fileName: 'fixture.png',
      id: 'fixture',
      mimeType: 'image/png',
      source: 'fixture',
    };
    const legacyDataUrl: LocalImageReference = {
      fileName: 'legacy.png',
      id: 'legacy',
      mimeType: 'image/png',
      previewUrl: 'data:image/png;base64,AA==',
      source: 'data_url',
    };

    const errors = await LAB_ONBOARDING_MEDIA_PORT.deleteOwned(
      harness.repository,
      [
        indexedImage('kept-once'),
        indexedImage('kept-once'),
        fixtureImage,
        legacyDataUrl,
        indexedImage('cannot-delete'),
      ],
    );

    expect(harness.delete).toHaveBeenCalledTimes(2);
    expect(harness.delete).toHaveBeenNthCalledWith(1, 'kept-once');
    expect(harness.delete).toHaveBeenNthCalledWith(2, 'cannot-delete');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual(expect.objectContaining({ message: 'storage unavailable' }));
  });

  it('never renders legacy inline bytes or metadata-only missing references', () => {
    const legacyInline: LocalImageReference = {
      fileName: 'legacy.png',
      id: 'legacy-inline',
      mimeType: 'image/png',
      previewUrl: 'data:image/png;base64,AA==',
      source: 'data_url',
    };
    const missing: LocalImageReference = {
      fileName: 'missing.png',
      id: 'missing-reference',
      mimeType: 'image/png',
      source: 'missing',
    };

    expect(resolveOnboardingImageUrl(legacyInline, new Map())).toBeNull();
    expect(resolveOnboardingImageUrl(missing, new Map())).toBeNull();
  });
});
