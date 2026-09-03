import {
  type AssetCleanupResult,
  type AssetRepository,
  type DecodedImage,
  deleteUnreferencedAssets,
  type ImageAssetMetadata,
  type ImageDecoder,
  type PreparedImageAsset,
  reclaimStaleStagedAssets,
  type StagedAssetReclamationResult,
  type ThumbnailGenerator,
} from '../assets';
import {
  type ImageUploadErrorCode,
  prepareImageAsset,
  processImageBatch,
  validateUploadCapacity,
} from '../assets/image-processing';
import { replaceCustomDesignImage } from '../model/replacement';
import type { CustomDesignImageItem } from '../model/types';

type MaybePromise<T> = T | Promise<T>;

export type PreparedCustomDesignDocumentTransition = {
  /** Releases a caller-owned transaction lock after any post-prepare failure. */
  cancel?: () => MaybePromise<void>;
  /** False means the validated command produced no document change. */
  changed: boolean;
  /**
   * Publishes the already-validated history transition. Implementations should
   * compare the prepared baseline with the live history state and return false
   * instead of overwriting a newer owner change.
   */
  publish: () => MaybePromise<boolean>;
};

export type PrepareCustomDesignDocumentTransition = (
  images: readonly CustomDesignImageItem[],
) => MaybePromise<PreparedCustomDesignDocumentTransition>;

export type CustomDesignAssetChangeReason =
  | 'committed'
  | 'deleted'
  | 'replaced';

export type CustomDesignAssetTransactionCoordinatorOptions = {
  getReachableAssetIds: () => MaybePromise<ReadonlySet<string>>;
  onAssetsChanged?: (
    assetIds: readonly string[],
    reason: CustomDesignAssetChangeReason,
  ) => MaybePromise<void>;
  onError?: (error: Error) => void;
  repository: AssetRepository;
};

export type CustomDesignUploadFailure = {
  code: ImageUploadErrorCode | `storage_${string}` | 'document_rejected' | 'document_publish_failed';
  fileName: string;
  index: number;
  message: string;
};

export type CustomDesignUploadResult = {
  added: CustomDesignImageItem[];
  cleanupErrors: Error[];
  documentChanged: boolean;
  failures: CustomDesignUploadFailure[];
  status: 'committed' | 'failed' | 'partial' | 'rejected';
};

type ImagePreparationOverrides = {
  decodeImage?: ImageDecoder;
  generateThumbnail?: ThumbnailGenerator;
};

export type UploadCustomDesignImagesInput = ImagePreparationOverrides & {
  createAssetId: (file: File, index: number) => string;
  createImageItemId: (file: File, index: number) => string;
  currentImages: readonly CustomDesignImageItem[];
  files: readonly File[];
  prepareDocumentTransition: PrepareCustomDesignDocumentTransition;
};

export type ReplaceCustomDesignImageInput = ImagePreparationOverrides & {
  createAssetId: (file: File) => string;
  currentImages: readonly CustomDesignImageItem[];
  file: File;
  imageItemId: string;
  prepareDocumentTransition: PrepareCustomDesignDocumentTransition;
};

export type ReplaceCustomDesignImageResult =
  | {
    cleanupErrors: Error[];
    image: CustomDesignImageItem;
    reviewRequired: boolean;
    success: true;
  }
  | {
    cleanupErrors: Error[];
    failure: CustomDesignUploadFailure;
    success: false;
  };

const asError = (error: unknown, fallback: string): Error =>
  error instanceof Error ? error : new Error(fallback);

const errorCode = (error: Error): string | null => {
  const candidate = (error as unknown as { code?: unknown }).code;
  return typeof candidate === 'string' ? candidate : null;
};

const storageFailure = (
  error: unknown,
  fileName: string,
  index: number,
): CustomDesignUploadFailure => {
  const normalized = asError(error, 'The image could not be stored in this browser.');
  const code = errorCode(normalized) ?? 'unknown';
  return {
    code: `storage_${code}`,
    fileName,
    index,
    message: normalized.message,
  };
};

const transitionFailure = (
  code: 'document_publish_failed' | 'document_rejected',
  error: unknown,
  fileName: string,
  index: number,
): CustomDesignUploadFailure => ({
  code,
  fileName,
  index,
  message: asError(
    error,
    code === 'document_rejected'
      ? 'The uploaded image could not be added to this section.'
      : 'The uploaded image could not be committed safely.',
  ).message,
});

const imageItemFromMetadata = (
  metadata: ImageAssetMetadata,
  imageItemId: string,
): CustomDesignImageItem => ({
  id: imageItemId,
  assetId: metadata.id,
  fileName: metadata.fileName,
  mimeType: metadata.mimeType,
  fileSize: metadata.byteSize,
  width: metadata.width,
  height: metadata.height,
  aspectRatio: metadata.aspectRatio,
  altText: '',
  decorative: false,
  interactiveAreas: [],
});

const sectionByteSize = (
  images: readonly CustomDesignImageItem[],
): number => images.reduce((total, image) => total + image.fileSize, 0);

const sortedFailures = (
  failures: readonly CustomDesignUploadFailure[],
): CustomDesignUploadFailure[] => [...failures].sort(
  (left, right) => left.index - right.index || left.fileName.localeCompare(right.fileName),
);

/**
 * Coordinates IndexedDB and the universal document without pretending they
 * share an atomic transaction. Every public mutation is serialized. A caller
 * first prepares (but does not publish) one universal history transition;
 * staged blobs are then committed atomically; finally the prepared transition
 * is published exactly once.
 */
export class CustomDesignAssetTransactionCoordinator {
  private readonly activeStagedIds = new Set<string>();
  private closed = false;
  private readonly getReachableAssetIds: CustomDesignAssetTransactionCoordinatorOptions['getReachableAssetIds'];
  private readonly onAssetsChanged?: CustomDesignAssetTransactionCoordinatorOptions['onAssetsChanged'];
  private readonly onError?: CustomDesignAssetTransactionCoordinatorOptions['onError'];
  private readonly repository: AssetRepository;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: CustomDesignAssetTransactionCoordinatorOptions) {
    this.repository = options.repository;
    this.getReachableAssetIds = options.getReachableAssetIds;
    this.onAssetsChanged = options.onAssetsChanged;
    this.onError = options.onError;
  }

  getActiveStagedAssetIds = (): ReadonlySet<string> =>
    new Set(this.activeStagedIds);

  close = (): void => {
    this.closed = true;
  };

  uploadImages = (
    input: UploadCustomDesignImagesInput,
  ): Promise<CustomDesignUploadResult> => this.enqueue(async () => {
    const assetIndexes = new Map<string, number>();
    const processed = await processImageBatch(input.files, {
      createAssetId: (file, index) => {
        const assetId = input.createAssetId(file, index);
        assetIndexes.set(assetId, index);
        return assetId;
      },
      currentImageCount: input.currentImages.length,
      currentSectionBytes: sectionByteSize(input.currentImages),
      ...(input.decodeImage ? { decodeImage: input.decodeImage } : {}),
      ...(input.generateThumbnail
        ? { generateThumbnail: input.generateThumbnail }
        : {}),
    });
    const failures: CustomDesignUploadFailure[] = processed.rejected.map(
      rejection => ({
        code: rejection.code,
        fileName: rejection.file.name,
        index: rejection.index,
        message: rejection.error.message,
      }),
    );
    const staged: PreparedImageAsset[] = [];

    for (const asset of processed.accepted) {
      const index = assetIndexes.get(asset.metadata.id) ?? 0;
      try {
        await this.repository.stage(asset);
        this.activeStagedIds.add(asset.metadata.id);
        staged.push(asset);
      } catch (error) {
        failures.push(storageFailure(error, asset.metadata.fileName, index));
      }
    }

    if (staged.length === 0) {
      return {
        added: [],
        cleanupErrors: [],
        documentChanged: false,
        failures: sortedFailures(failures),
        status: failures.some(failure => failure.code.startsWith('storage_'))
          ? 'failed'
          : 'rejected',
      };
    }

    let added: CustomDesignImageItem[];
    try {
      added = staged.map((asset) => {
        const index = assetIndexes.get(asset.metadata.id) ?? 0;
        const file = input.files[index];
        if (!file) {
          throw new Error('The uploaded image index is unavailable.');
        }
        return imageItemFromMetadata(
          asset.metadata,
          input.createImageItemId(file, index),
        );
      });
    } catch (error) {
      const cleanupErrors = await this.discardStages(staged);
      return {
        added: [],
        cleanupErrors,
        documentChanged: false,
        failures: sortedFailures([
          ...failures,
          ...staged.map(asset => transitionFailure(
            'document_rejected',
            error,
            asset.metadata.fileName,
            assetIndexes.get(asset.metadata.id) ?? 0,
          )),
        ]),
        status: 'failed',
      };
    }
    const nextImages = [...input.currentImages, ...added];
    const transaction = await this.commitPreparedMutation({
      assets: staged,
      fallbackFiles: staged.map(asset => ({
        fileName: asset.metadata.fileName,
        index: assetIndexes.get(asset.metadata.id) ?? 0,
      })),
      prepareDocumentTransition: () => input.prepareDocumentTransition(nextImages),
    });

    if (!transaction.success) {
      return {
        added: [],
        cleanupErrors: transaction.cleanupErrors,
        documentChanged: false,
        failures: sortedFailures([...failures, ...transaction.failures]),
        status: 'failed',
      };
    }

    await this.notifyAssetsChanged(
      staged.map(asset => asset.metadata.id),
      'committed',
    );
    return {
      added,
      cleanupErrors: transaction.cleanupErrors,
      documentChanged: true,
      failures: sortedFailures(failures),
      status: failures.length > 0 ? 'partial' : 'committed',
    };
  });

  replaceImage = (
    input: ReplaceCustomDesignImageInput,
  ): Promise<ReplaceCustomDesignImageResult> => this.enqueue(async () => {
    const currentIndex = input.currentImages.findIndex(
      image => image.id === input.imageItemId,
    );
    const current = input.currentImages[currentIndex];
    if (!current) {
      return {
        cleanupErrors: [],
        failure: transitionFailure(
          'document_rejected',
          new Error('The image to replace is no longer in this section.'),
          input.file.name,
          0,
        ),
        success: false,
      };
    }

    let preparedAsset: PreparedImageAsset;
    try {
      validateUploadCapacity(input.file, {
        currentImageCount: Math.max(0, input.currentImages.length - 1),
        currentSectionBytes: Math.max(
          0,
          sectionByteSize(input.currentImages) - current.fileSize,
        ),
      });
      preparedAsset = await prepareImageAsset(input.file, {
        assetId: input.createAssetId(input.file),
        ...(input.decodeImage ? { decodeImage: input.decodeImage } : {}),
        ...(input.generateThumbnail
          ? { generateThumbnail: input.generateThumbnail }
          : {}),
      });
    } catch (error) {
      const normalized = asError(error, 'The replacement image could not be processed.');
      const code = errorCode(normalized);
      return {
        cleanupErrors: [],
        failure: code
          ? {
              code: code as ImageUploadErrorCode,
              fileName: input.file.name,
              index: 0,
              message: normalized.message,
            }
          : {
              code: 'document_rejected',
              fileName: input.file.name,
              index: 0,
              message: normalized.message,
            },
        success: false,
      };
    }

    try {
      await this.repository.stage(preparedAsset);
      this.activeStagedIds.add(preparedAsset.metadata.id);
    } catch (error) {
      return {
        cleanupErrors: [],
        failure: storageFailure(error, input.file.name, 0),
        success: false,
      };
    }

    const replacement = replaceCustomDesignImage(current, {
      assetId: preparedAsset.metadata.id,
      fileName: preparedAsset.metadata.fileName,
      mimeType: preparedAsset.metadata.mimeType,
      fileSize: preparedAsset.metadata.byteSize,
      width: preparedAsset.metadata.width,
      height: preparedAsset.metadata.height,
      aspectRatio: preparedAsset.metadata.aspectRatio,
    });
    const nextImages = input.currentImages.map((image, index) =>
      index === currentIndex ? replacement : image);
    const transaction = await this.commitPreparedMutation({
      assets: [preparedAsset],
      fallbackFiles: [{ fileName: input.file.name, index: 0 }],
      prepareDocumentTransition: () => input.prepareDocumentTransition(nextImages),
    });

    if (!transaction.success) {
      return {
        cleanupErrors: transaction.cleanupErrors,
        failure: transaction.failures[0] ?? transitionFailure(
          'document_publish_failed',
          new Error('The replacement could not be committed safely.'),
          input.file.name,
          0,
        ),
        success: false,
      };
    }

    await this.notifyAssetsChanged(
      [current.assetId, replacement.assetId],
      'replaced',
    );
    return {
      cleanupErrors: transaction.cleanupErrors,
      image: replacement,
      reviewRequired: replacement.interactiveAreas.some(
        area => area.reviewStatus === 'needs_review',
      ),
      success: true,
    };
  });

  cleanupUnreferencedAssets = (): Promise<AssetCleanupResult> =>
    this.enqueue(async () => {
      const references = new Set(await this.getReachableAssetIds());
      this.activeStagedIds.forEach(assetId => references.add(assetId));
      return deleteUnreferencedAssets(this.repository, references, {
        confirmUnreferenced: async (assetId) => {
          if (this.activeStagedIds.has(assetId)) {
            return false;
          }
          return !(await this.getReachableAssetIds()).has(assetId);
        },
        onDeleted: async (assetId) => {
          await this.notifyAssetsChanged([assetId], 'deleted');
        },
      });
    });

  /** Awaited Reset-Lab boundary: clears committed and staged browser assets. */
  clearAllAssets = (): Promise<number> => this.enqueue(async () => {
    const summaries = await this.repository.list({ includeStaged: true });
    const assetIds = summaries.map(summary => summary.metadata.id);
    const cleared = await this.repository.clear();
    this.activeStagedIds.clear();
    await this.notifyAssetsChanged(assetIds, 'deleted');
    return cleared;
  });

  /** Deletes only caller-owned assets that are no longer reachable. */
  deleteAssetsIfUnreferenced = (
    assetIds: readonly string[],
  ): Promise<Error[]> => this.enqueue(async () =>
    this.deleteSpecificIfUnreferenced([...new Set(assetIds)]));

  reclaimStaleStages = (
    options: { now?: number; ttlMs?: number } = {},
  ): Promise<StagedAssetReclamationResult> => this.enqueue(async () =>
    reclaimStaleStagedAssets(this.repository, {
      confirmDiscard: async (assetId) => {
        if (this.activeStagedIds.has(assetId)) {
          return false;
        }
        return !(await this.getReachableAssetIds()).has(assetId);
      },
      protectedAssetIds: new Set(this.activeStagedIds),
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
    }));

  /**
   * Runs a document-reference mutation on the same queue as asset cleanup.
   * Callers must not invoke another coordinator method from inside `mutation`.
   */
  coordinateDocumentMutation = <T>(mutation: () => MaybePromise<T>): Promise<T> =>
    this.enqueue(async () => mutation());

  private commitPreparedMutation = async ({
    assets,
    fallbackFiles,
    prepareDocumentTransition,
  }: {
    assets: readonly PreparedImageAsset[];
    fallbackFiles: readonly { fileName: string; index: number }[];
    prepareDocumentTransition: () => MaybePromise<PreparedCustomDesignDocumentTransition>;
  }): Promise<{
    cleanupErrors: Error[];
    failures: CustomDesignUploadFailure[];
    success: boolean;
  }> => {
    const cleanupErrors: Error[] = [];
    let transition: PreparedCustomDesignDocumentTransition;
    try {
      transition = await prepareDocumentTransition();
    } catch (error) {
      cleanupErrors.push(...await this.discardStages(assets));
      return {
        cleanupErrors,
        failures: fallbackFiles.map(file => transitionFailure(
          'document_rejected',
          error,
          file.fileName,
          file.index,
        )),
        success: false,
      };
    }
    if (!transition.changed) {
      try {
        await transition.cancel?.();
      } catch (error) {
        cleanupErrors.push(asError(error, 'Document transaction cancellation failed.'));
      }
      cleanupErrors.push(...await this.discardStages(assets));
      return {
        cleanupErrors,
        failures: fallbackFiles.map(file => transitionFailure(
          'document_rejected',
          new Error('The validated document command did not produce a change.'),
          file.fileName,
          file.index,
        )),
        success: false,
      };
    }

    const assetIds = assets.map(asset => asset.metadata.id);
    let assetsCommitted = false;
    try {
      await this.repository.commitBatch(assetIds);
      assetsCommitted = true;
      assetIds.forEach(assetId => this.activeStagedIds.delete(assetId));
      if (!(await transition.publish())) {
        throw new Error('The prepared document changed before it could be published.');
      }
      return { cleanupErrors, failures: [], success: true };
    } catch (error) {
      assetIds.forEach(assetId => this.activeStagedIds.delete(assetId));
      try {
        await transition.cancel?.();
      } catch (cancelError) {
        cleanupErrors.push(asError(
          cancelError,
          'Document transaction cancellation failed.',
        ));
      }
      if (assetsCommitted) {
        cleanupErrors.push(...await this.deleteSpecificIfUnreferenced(assetIds));
      } else {
        cleanupErrors.push(...await this.discardStages(assets));
      }
      return {
        cleanupErrors,
        failures: fallbackFiles.map(file => transitionFailure(
          assetsCommitted ? 'document_publish_failed' : 'document_rejected',
          error,
          file.fileName,
          file.index,
        )),
        success: false,
      };
    }
  };

  private deleteSpecificIfUnreferenced = async (
    assetIds: readonly string[],
  ): Promise<Error[]> => {
    const errors: Error[] = [];
    for (const assetId of assetIds) {
      try {
        if ((await this.getReachableAssetIds()).has(assetId)) {
          continue;
        }
        if (await this.repository.delete(assetId)) {
          await this.notifyAssetsChanged([assetId], 'deleted');
        }
      } catch (error) {
        errors.push(asError(error, `Asset cleanup failed for ${assetId}.`));
      }
    }
    return errors;
  };

  private discardStages = async (
    assets: readonly PreparedImageAsset[],
  ): Promise<Error[]> => {
    const errors: Error[] = [];
    for (const asset of assets) {
      const assetId = asset.metadata.id;
      this.activeStagedIds.delete(assetId);
      try {
        await this.repository.discard(assetId);
      } catch (error) {
        errors.push(asError(error, `Staged asset cleanup failed for ${assetId}.`));
      }
    }
    return errors;
  };

  private notifyAssetsChanged = async (
    assetIds: readonly string[],
    reason: CustomDesignAssetChangeReason,
  ): Promise<void> => {
    if (!this.onAssetsChanged || assetIds.length === 0) {
      return;
    }
    try {
      await this.onAssetsChanged([...new Set(assetIds)], reason);
    } catch (error) {
      this.onError?.(asError(error, 'Asset change notification failed.'));
    }
  };

  private enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    if (this.closed) {
      return Promise.reject(new Error('The Custom Design asset coordinator is closed.'));
    }
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

// Keep these types reachable from this integration boundary for callers that
// provide browser-specific decode/thumbnail implementations.
export type { DecodedImage };
