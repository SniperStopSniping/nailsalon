import { IDBFactory } from 'fake-indexeddb';

import {
  IndexedDbAssetRepository,
  type ImageAssetMetadata,
  type PreparedImageAsset,
} from '../assets';
import type {
  CustomDesignImageItem,
  CustomDesignInteractiveArea,
} from '../model/types';
import { CustomDesignAssetTransactionCoordinator } from './AssetTransactionCoordinator';

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x00,
]);

const imageFile = (name: string): File =>
  new File([pngBytes], name, { type: 'image/png' });

const decode = async (): Promise<{
  height: number;
  orientationApplied: true;
  width: number;
}> => ({ height: 200, orientationApplied: true, width: 100 });

const noThumbnail = async (): Promise<null> => null;

const area = (): CustomDesignInteractiveArea => ({
  id: 'custom_design_area_one',
  geometry: { x: 10, y: 10, width: 20, height: 20 },
  semanticOrder: 0,
  accessibleLabel: 'Book now',
  labelConfirmed: true,
  action: { type: 'start_booking' },
  validationStatus: 'valid',
  reviewStatus: 'approved',
});

const imageItem = (
  assetId: string,
  overrides: Partial<CustomDesignImageItem> = {},
): CustomDesignImageItem => ({
  id: 'custom_design_image_existing',
  assetId,
  fileName: 'existing.png',
  mimeType: 'image/png',
  fileSize: pngBytes.byteLength,
  width: 100,
  height: 200,
  aspectRatio: 0.5,
  altText: 'Existing design',
  decorative: false,
  interactiveAreas: [area()],
  ...overrides,
});

const storedAsset = (assetId: string): PreparedImageAsset => {
  const blob = new Blob([pngBytes], { type: 'image/png' });
  const metadata: ImageAssetMetadata = {
    id: assetId,
    fileName: `${assetId}.png`,
    mimeType: 'image/png',
    byteSize: blob.size,
    width: 100,
    height: 200,
    aspectRatio: 0.5,
    orientation: 1,
    createdAt: '2026-08-27T12:00:00.000Z',
  };
  return { blob, metadata };
};

const createHarness = (name: string) => {
  const repository = new IndexedDbAssetRepository({
    dbName: name,
    indexedDB: new IDBFactory(),
  });
  let reachable = new Set<string>();
  const changed = vi.fn();
  const coordinator = new CustomDesignAssetTransactionCoordinator({
    getReachableAssetIds: () => new Set(reachable),
    onAssetsChanged: changed,
    repository,
  });
  return {
    changed,
    coordinator,
    repository,
    setReachable: (assetIds: readonly string[]) => {
      reachable = new Set(assetIds);
    },
  };
};

describe('CustomDesignAssetTransactionCoordinator', () => {
  it('turns a partially valid multi-select into one prepared document change', async () => {
    const harness = createHarness('coordinator-partial');
    const cancel = vi.fn();
    const prepare = vi.fn((images: readonly CustomDesignImageItem[]) => ({
      cancel,
      changed: true,
      publish: () => {
        harness.setReachable(images.map((image) => image.assetId));
        return true;
      },
    }));
    const invalid = new File(['not-an-image'], 'notes.txt', {
      type: 'text/plain',
    });

    const result = await harness.coordinator.uploadImages({
      createAssetId: (_file, index) => `custom_design_asset_${index}`,
      createImageItemId: (_file, index) => `custom_design_image_${index}`,
      currentImages: [],
      decodeImage: decode,
      files: [imageFile('poster.png'), invalid],
      generateThumbnail: noThumbnail,
      prepareDocumentTransition: prepare,
    });

    expect(result.status).toBe('partial');
    expect(result.added).toHaveLength(1);
    expect(result.failures).toMatchObject([
      { code: 'unsupported_type', fileName: 'notes.txt', index: 1 },
    ]);
    expect(prepare).toHaveBeenCalledOnce();
    await expect(
      harness.repository.has('custom_design_asset_0'),
    ).resolves.toBe(true);
    expect(harness.changed).toHaveBeenCalledWith(
      ['custom_design_asset_0'],
      'committed',
    );
    expect(cancel).not.toHaveBeenCalled();
    harness.repository.close();
  });

  it('discards staged writes when command preparation rejects the change', async () => {
    const harness = createHarness('coordinator-prepare-failure');
    const result = await harness.coordinator.uploadImages({
      createAssetId: () => 'custom_design_asset_rejected',
      createImageItemId: () => 'custom_design_image_rejected',
      currentImages: [],
      decodeImage: decode,
      files: [imageFile('poster.png')],
      generateThumbnail: noThumbnail,
      prepareDocumentTransition: () => {
        throw new Error('document validation failed');
      },
    });

    expect(result).toMatchObject({
      added: [],
      documentChanged: false,
      status: 'failed',
      failures: [{ code: 'document_rejected', message: 'document validation failed' }],
    });
    await expect(
      harness.repository.list({ includeStaged: true }),
    ).resolves.toEqual([]);
    harness.repository.close();
  });

  it('compensates committed assets when prepared-history publication loses its baseline', async () => {
    const harness = createHarness('coordinator-publish-failure');
    const cancel = vi.fn();
    const result = await harness.coordinator.uploadImages({
      createAssetId: () => 'custom_design_asset_orphan',
      createImageItemId: () => 'custom_design_image_orphan',
      currentImages: [],
      decodeImage: decode,
      files: [imageFile('poster.png')],
      generateThumbnail: noThumbnail,
      prepareDocumentTransition: () => ({
        cancel,
        changed: true,
        publish: () => false,
      }),
    });

    expect(result.status).toBe('failed');
    expect(result.failures[0]?.code).toBe('document_publish_failed');
    await expect(
      harness.repository.list({ includeStaged: true }),
    ).resolves.toEqual([]);
    expect(harness.changed).toHaveBeenCalledWith(
      ['custom_design_asset_orphan'],
      'deleted',
    );
    expect(cancel).toHaveBeenCalledOnce();
    harness.repository.close();
  });

  it('cancels when a prepared command reports no document change', async () => {
    const harness = createHarness('coordinator-no-change');
    const cancel = vi.fn();
    const publish = vi.fn();
    const result = await harness.coordinator.uploadImages({
      createAssetId: () => 'custom_design_asset_no_change',
      createImageItemId: () => 'custom_design_image_no_change',
      currentImages: [],
      decodeImage: decode,
      files: [imageFile('poster.png')],
      generateThumbnail: noThumbnail,
      prepareDocumentTransition: () => ({
        cancel,
        changed: false,
        publish,
      }),
    });

    expect(result).toMatchObject({
      documentChanged: false,
      status: 'failed',
      failures: [{ code: 'document_rejected' }],
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
    await expect(
      harness.repository.list({ includeStaged: true }),
    ).resolves.toEqual([]);
    harness.repository.close();
  });

  it('cancels and compensates when prepared-history publication throws', async () => {
    const harness = createHarness('coordinator-publish-throw');
    const cancel = vi.fn();
    const result = await harness.coordinator.uploadImages({
      createAssetId: () => 'custom_design_asset_publish_throw',
      createImageItemId: () => 'custom_design_image_publish_throw',
      currentImages: [],
      decodeImage: decode,
      files: [imageFile('poster.png')],
      generateThumbnail: noThumbnail,
      prepareDocumentTransition: () => ({
        cancel,
        changed: true,
        publish: () => {
          throw new Error('publish threw');
        },
      }),
    });

    expect(result).toMatchObject({
      documentChanged: false,
      status: 'failed',
      failures: [{ code: 'document_publish_failed', message: 'publish threw' }],
    });
    expect(cancel).toHaveBeenCalledOnce();
    await expect(
      harness.repository.list({ includeStaged: true }),
    ).resolves.toEqual([]);
    harness.repository.close();
  });

  it('cancels a prepared document lock when atomic asset commit fails', async () => {
    const harness = createHarness('coordinator-commit-failure');
    const cancel = vi.fn();
    vi.spyOn(harness.repository, 'commitBatch').mockRejectedValueOnce(
      new Error('commit failed'),
    );

    const result = await harness.coordinator.uploadImages({
      createAssetId: () => 'custom_design_asset_commit_failure',
      createImageItemId: () => 'custom_design_image_commit_failure',
      currentImages: [],
      decodeImage: decode,
      files: [imageFile('poster.png')],
      generateThumbnail: noThumbnail,
      prepareDocumentTransition: () => ({
        cancel,
        changed: true,
        publish: () => true,
      }),
    });

    expect(result.status).toBe('failed');
    expect(cancel).toHaveBeenCalledOnce();
    await expect(
      harness.repository.list({ includeStaged: true }),
    ).resolves.toEqual([]);
    harness.repository.close();
  });

  it('replaces bytes while preserving the image ID and history-reachable original', async () => {
    const harness = createHarness('coordinator-replacement');
    await harness.repository.stage(storedAsset('custom_design_asset_old'));
    await harness.repository.commit('custom_design_asset_old');
    const current = imageItem('custom_design_asset_old');

    const result = await harness.coordinator.replaceImage({
      createAssetId: () => 'custom_design_asset_new',
      currentImages: [current],
      decodeImage: decode,
      file: imageFile('replacement.png'),
      generateThumbnail: noThumbnail,
      imageItemId: current.id,
      prepareDocumentTransition: (images) => ({
        changed: true,
        publish: () => {
          // A real history scan sees both new present and old past snapshots.
          harness.setReachable([
            'custom_design_asset_old',
            images[0]?.assetId ?? '',
          ]);
          return true;
        },
      }),
    });

    expect(result).toMatchObject({
      success: true,
      image: {
        id: current.id,
        assetId: 'custom_design_asset_new',
        interactiveAreas: [{ id: 'custom_design_area_one', reviewStatus: 'approved' }],
      },
      reviewRequired: false,
    });
    await expect(harness.repository.has('custom_design_asset_old')).resolves.toBe(true);
    await expect(harness.repository.has('custom_design_asset_new')).resolves.toBe(true);
    expect(harness.changed).toHaveBeenCalledWith(
      ['custom_design_asset_old', 'custom_design_asset_new'],
      'replaced',
    );
    harness.repository.close();
  });

  it('deletes only assets absent from the latest reachable snapshots', async () => {
    const harness = createHarness('coordinator-cleanup');
    for (const assetId of ['keep', 'delete']) {
      await harness.repository.stage(storedAsset(assetId));
      await harness.repository.commit(assetId);
    }
    harness.setReachable(['keep']);

    await expect(harness.coordinator.cleanupUnreferencedAssets()).resolves.toEqual({
      deleted: ['delete'],
      failed: [],
      retained: ['keep'],
    });
    await expect(harness.repository.has('keep')).resolves.toBe(true);
    await expect(harness.repository.has('delete')).resolves.toBe(false);
    harness.repository.close();
  });

  it('deletes only the explicitly supplied onboarding assets and preserves unrelated records', async () => {
    const harness = createHarness('coordinator-scoped-onboarding-cleanup');
    for (const assetId of ['onboarding-owned', 'still-referenced', 'unrelated']) {
      await harness.repository.stage(storedAsset(assetId));
      await harness.repository.commit(assetId);
    }
    harness.setReachable(['still-referenced']);

    await expect(harness.coordinator.deleteAssetsIfUnreferenced([
      'onboarding-owned',
      'still-referenced',
    ])).resolves.toEqual([]);

    await expect(harness.repository.has('onboarding-owned')).resolves.toBe(false);
    await expect(harness.repository.has('still-referenced')).resolves.toBe(true);
    await expect(harness.repository.has('unrelated')).resolves.toBe(true);
    expect(harness.changed).toHaveBeenCalledWith(['onboarding-owned'], 'deleted');
    harness.repository.close();
  });

  it('serializes an import-like reference mutation ahead of queued cleanup', async () => {
    const harness = createHarness('coordinator-document-mutation-cleanup');
    await harness.repository.stage(storedAsset('imported-reference'));
    await harness.repository.commit('imported-reference');
    harness.setReachable([]);
    let releaseMutation!: () => void;
    const mutationCanFinish = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const order: string[] = [];

    const mutation = harness.coordinator.coordinateDocumentMutation(async () => {
      order.push('mutation-start');
      await mutationCanFinish;
      harness.setReachable(['imported-reference']);
      order.push('mutation-finish');
    });
    const cleanup = harness.coordinator.cleanupUnreferencedAssets().then((result) => {
      order.push('cleanup');
      return result;
    });

    await vi.waitFor(() => expect(order).toEqual(['mutation-start']));
    releaseMutation();
    await mutation;
    await expect(cleanup).resolves.toEqual({
      deleted: [],
      failed: [],
      retained: ['imported-reference'],
    });
    expect(order).toEqual(['mutation-start', 'mutation-finish', 'cleanup']);
    await expect(harness.repository.has('imported-reference')).resolves.toBe(true);
    harness.repository.close();
  });

  it('clears committed and abandoned staged records at the awaited Reset Lab boundary', async () => {
    const harness = createHarness('coordinator-reset-clear');
    await harness.repository.stage(storedAsset('committed'));
    await harness.repository.commit('committed');
    await harness.repository.stage(storedAsset('staged'));

    await expect(harness.coordinator.clearAllAssets()).resolves.toBe(2);
    await expect(
      harness.repository.list({ includeStaged: true }),
    ).resolves.toEqual([]);
    expect(harness.changed).toHaveBeenCalledWith(
      ['committed', 'staged'],
      'deleted',
    );
    harness.repository.close();
  });

  it('serializes prepared transitions instead of interleaving uploads', async () => {
    const harness = createHarness('coordinator-serialization');
    let releaseFirst!: () => void;
    const firstCanPublish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const transitions: string[] = [];
    const first = harness.coordinator.uploadImages({
      createAssetId: () => 'asset_first',
      createImageItemId: () => 'image_first',
      currentImages: [],
      decodeImage: decode,
      files: [imageFile('first.png')],
      generateThumbnail: noThumbnail,
      prepareDocumentTransition: async () => {
        transitions.push('prepare-first');
        await firstCanPublish;
        return { changed: true, publish: () => true };
      },
    });
    const second = harness.coordinator.uploadImages({
      createAssetId: () => 'asset_second',
      createImageItemId: () => 'image_second',
      currentImages: [],
      decodeImage: decode,
      files: [imageFile('second.png')],
      generateThumbnail: noThumbnail,
      prepareDocumentTransition: () => {
        transitions.push('prepare-second');
        return { changed: true, publish: () => true };
      },
    });

    await vi.waitFor(() => expect(transitions).toEqual(['prepare-first']));
    releaseFirst();
    await Promise.all([first, second]);
    expect(transitions).toEqual(['prepare-first', 'prepare-second']);
    harness.repository.close();
  });
});
