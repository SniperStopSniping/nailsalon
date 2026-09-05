import {
  CUSTOM_DESIGN_MAX_FILE_BYTES,
  CUSTOM_DESIGN_MAX_IMAGE_DIMENSION,
  CUSTOM_DESIGN_MAX_IMAGE_PIXELS,
} from '../model/constants';
import { AssetStorageError, toAssetStorageError } from './errors';
import { readBlobArrayBuffer } from './image-processing';
import {
  type AssetListOptions,
  type AssetReadOptions,
  type AssetRepository,
  type AssetResolution,
  CUSTOM_DESIGN_ASSET_SCHEMA_VERSION,
  CUSTOM_DESIGN_MAX_THUMBNAIL_BYTES,
  CUSTOM_DESIGN_THUMBNAIL_MAX_EDGE_PX,
  type ImageAssetMetadata,
  type ImageAssetSummary,
  type PreparedImageAsset,
  type StoredImageAsset,
  SUPPORTED_IMAGE_MIME_TYPES,
} from './types';

export const CUSTOM_DESIGN_ASSET_DB_VERSION = 1;
export const DEFAULT_CUSTOM_DESIGN_ASSET_DB_NAME
  = 'luster-custom-design-assets';
export const CUSTOM_DESIGN_ASSET_SUMMARY_STORE_NAME
  = 'image-asset-summaries-v1';
/** Backwards-compatible alias for Phase 1 test and integration imports. */
export const CUSTOM_DESIGN_ASSET_STORE_NAME
  = CUSTOM_DESIGN_ASSET_SUMMARY_STORE_NAME;
export const CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME
  = 'image-asset-originals-v1';
export const CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME
  = 'image-asset-thumbnails-v1';

const ASSET_STORE_NAMES = [
  CUSTOM_DESIGN_ASSET_SUMMARY_STORE_NAME,
  CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
  CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
] as const;

type PersistedImageAssetSummary = ImageAssetSummary & {
  schemaVersion: typeof CUSTOM_DESIGN_ASSET_SCHEMA_VERSION;
};

type PersistedOriginalBlob = {
  assetId: string;
  blob: Blob;
  schemaVersion: typeof CUSTOM_DESIGN_ASSET_SCHEMA_VERSION;
  storageKind?: 'blob';
};

type PersistedThumbnailBlob = PersistedOriginalBlob;

type PersistedArrayBufferBinary = {
  assetId: string;
  data: ArrayBuffer;
  mimeType: (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];
  schemaVersion: typeof CUSTOM_DESIGN_ASSET_SCHEMA_VERSION;
  storageKind: 'array_buffer';
};

type PersistedBinaryRecord =
  | PersistedArrayBufferBinary
  | PersistedOriginalBlob;

type ResolvedPersistedBinary = { blob: Blob };

type FullAssetRecords = {
  original: unknown;
  summary: unknown;
  thumbnail: unknown;
};

export type IndexedDbAssetRepositoryOptions = {
  dbName?: string;
  indexedDB?: IDBFactory;
  now?: () => number;
};

const invalidAsset = (message: string): AssetStorageError =>
  new AssetStorageError('invalid_asset', message);

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isBlobLike = (value: unknown): value is Blob =>
  isObjectRecord(value)
  && Number.isSafeInteger(value.size)
  && typeof value.type === 'string'
  && typeof value.slice === 'function';

const arrayBufferByteLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
)?.get;

const isArrayBufferLike = (value: unknown): value is ArrayBuffer => {
  try {
    return typeof arrayBufferByteLength?.call(value) === 'number';
  } catch {
    return false;
  }
};

const isSupportedMimeType = (value: unknown): boolean =>
  typeof value === 'string'
  && (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(value);

const validateMetadata: (
  value: unknown,
) => asserts value is ImageAssetMetadata = (value) => {
  if (!isObjectRecord(value)) {
    throw invalidAsset('The stored image metadata is malformed.');
  }

  if (
    typeof value.id !== 'string'
    || !value.id.trim()
    || typeof value.fileName !== 'string'
    || !value.fileName.trim()
    || !Number.isSafeInteger(value.byteSize)
    || (value.byteSize as number) <= 0
    || (value.byteSize as number) > CUSTOM_DESIGN_MAX_FILE_BYTES
    || !Number.isSafeInteger(value.width)
    || !Number.isSafeInteger(value.height)
    || (value.width as number) <= 0
    || (value.height as number) <= 0
    || (value.width as number) > CUSTOM_DESIGN_MAX_IMAGE_DIMENSION
    || (value.height as number) > CUSTOM_DESIGN_MAX_IMAGE_DIMENSION
    || (value.width as number) * (value.height as number)
    > CUSTOM_DESIGN_MAX_IMAGE_PIXELS
    || typeof value.aspectRatio !== 'number'
    || !Number.isFinite(value.aspectRatio)
    || value.aspectRatio <= 0
    || Math.abs(
      value.aspectRatio - (value.width as number) / (value.height as number),
    ) > 0.000_001
    || !isSupportedMimeType(value.mimeType)
    || typeof value.createdAt !== 'string'
    || !Number.isFinite(Date.parse(value.createdAt))
    || !Number.isInteger(value.orientation)
    || (value.orientation as number) < 1
    || (value.orientation as number) > 8
  ) {
    throw invalidAsset('The stored image metadata is invalid.');
  }

  if (value.thumbnail !== undefined) {
    const thumbnail = value.thumbnail;
    if (
      !isObjectRecord(thumbnail)
      || !Number.isSafeInteger(thumbnail.byteSize)
      || !Number.isSafeInteger(thumbnail.width)
      || !Number.isSafeInteger(thumbnail.height)
      || (thumbnail.byteSize as number) <= 0
      || (thumbnail.byteSize as number) > CUSTOM_DESIGN_MAX_THUMBNAIL_BYTES
      || (thumbnail.width as number) <= 0
      || (thumbnail.height as number) <= 0
      || (thumbnail.width as number) > CUSTOM_DESIGN_THUMBNAIL_MAX_EDGE_PX
      || (thumbnail.height as number) > CUSTOM_DESIGN_THUMBNAIL_MAX_EDGE_PX
      || !isSupportedMimeType(thumbnail.mimeType)
    ) {
      throw invalidAsset('The stored image thumbnail metadata is invalid.');
    }
  }
};

const validatePreparedAsset: (
  value: unknown,
) => asserts value is PreparedImageAsset = (value) => {
  if (!isObjectRecord(value)) {
    throw invalidAsset('The image asset is malformed.');
  }
  validateMetadata(value.metadata);
  const metadata = value.metadata;

  if (
    !isBlobLike(value.blob)
    || value.blob.size !== metadata.byteSize
    || value.blob.type !== metadata.mimeType
  ) {
    throw invalidAsset(
      'The image asset metadata does not match the uploaded file.',
    );
  }

  if (metadata.thumbnail !== undefined) {
    if (
      !isBlobLike(value.thumbnailBlob)
      || value.thumbnailBlob.size !== metadata.thumbnail.byteSize
      || value.thumbnailBlob.type !== metadata.thumbnail.mimeType
    ) {
      throw invalidAsset(
        'The image thumbnail metadata does not match the stored thumbnail.',
      );
    }
  } else if (value.thumbnailBlob !== undefined) {
    throw invalidAsset(
      'Thumbnail metadata is required when a thumbnail is stored.',
    );
  }
};

const validateSummary: (
  value: unknown,
) => asserts value is PersistedImageAssetSummary = (value) => {
  if (
    !isObjectRecord(value)
    || value.schemaVersion !== CUSTOM_DESIGN_ASSET_SCHEMA_VERSION
    || (value.state !== 'staged' && value.state !== 'committed')
    || typeof value.stagedAt !== 'string'
    || !Number.isFinite(Date.parse(value.stagedAt))
  ) {
    throw invalidAsset(
      'This stored image uses an unsupported or corrupt asset summary format.',
    );
  }
  validateMetadata(value.metadata);
};

const validateBinaryRecord = (
  value: unknown,
  expected: {
    assetId: string;
    byteSize: number;
    mimeType: (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];
  },
  errorMessage: string,
): ResolvedPersistedBinary => {
  if (
    !isObjectRecord(value)
    || value.schemaVersion !== CUSTOM_DESIGN_ASSET_SCHEMA_VERSION
    || value.assetId !== expected.assetId
  ) {
    throw invalidAsset(errorMessage);
  }

  if (
    (value.storageKind === undefined || value.storageKind === 'blob')
    && isBlobLike(value.blob)
    && value.blob.size === expected.byteSize
    && value.blob.type === expected.mimeType
  ) {
    return {
      blob: value.blob,
    };
  }

  if (
    value.storageKind === 'array_buffer'
    && isArrayBufferLike(value.data)
    && value.data.byteLength === expected.byteSize
    && value.mimeType === expected.mimeType
  ) {
    return {
      blob: new Blob([value.data], { type: expected.mimeType }),
    };
  }

  throw invalidAsset(errorMessage);
};

const validateOriginalRecord = (
  value: unknown,
  summary: PersistedImageAssetSummary,
): ResolvedPersistedBinary => {
  return validateBinaryRecord(
    value,
    {
      assetId: summary.metadata.id,
      byteSize: summary.metadata.byteSize,
      mimeType: summary.metadata.mimeType,
    },
    'The stored original image does not match its asset summary.',
  );
};

const validateThumbnailRecord = (
  value: unknown,
  summary: PersistedImageAssetSummary,
): ResolvedPersistedBinary | undefined => {
  const thumbnail = summary.metadata.thumbnail;
  if (thumbnail === undefined) {
    if (value !== undefined) {
      throw invalidAsset(
        'A thumbnail blob exists without matching thumbnail metadata.',
      );
    }
    return undefined;
  }

  return validateBinaryRecord(
    value,
    {
      assetId: summary.metadata.id,
      byteSize: thumbnail.byteSize,
      mimeType: thumbnail.mimeType,
    },
    'The stored thumbnail does not match its asset summary.',
  );
};

const reconstructStoredAsset = (
  records: FullAssetRecords,
): StoredImageAsset | null => {
  if (records.summary === undefined) {
    if (records.original !== undefined || records.thumbnail !== undefined) {
      throw invalidAsset('Orphaned image blob records were found.');
    }
    return null;
  }

  validateSummary(records.summary);
  const summary = records.summary;
  const original = validateOriginalRecord(records.original, summary);
  const thumbnail = validateThumbnailRecord(records.thumbnail, summary);
  return {
    blob: original.blob,
    metadata: summary.metadata,
    stagedAt: summary.stagedAt,
    state: summary.state,
    ...(thumbnail ? { thumbnailBlob: thumbnail.blob } : {}),
  };
};

const isVisible = (
  summary: PersistedImageAssetSummary,
  options?: AssetReadOptions,
): boolean => options?.includeStaged === true || summary.state === 'committed';

const requestError = (request: IDBRequest): unknown =>
  request.error ?? new Error('IndexedDB request failed.');

const normalizeError = (error: unknown, message: string): AssetStorageError =>
  toAssetStorageError(error, message);

class BlobStructuredCloneError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super('IndexedDB could not clone an image Blob.');
    this.name = 'BlobStructuredCloneError';
    this.cause = cause;
  }
}

const isBlobSerializationError = (error: unknown): boolean =>
  isObjectRecord(error)
  && (error.name === 'DataCloneError'
    // WebKit can fail asynchronously while preparing a Blob for IndexedDB,
    // reporting UnknownError rather than the structured-clone error above.
    // Do not retry unrelated UnknownErrors, quota failures, or permission errors.
    || (error.name === 'UnknownError'
      && typeof error.message === 'string'
      && error.message.includes('Error preparing Blob/File data to be stored in object store')));

const asBlobCloneError = (error: unknown): BlobStructuredCloneError | null =>
  isBlobSerializationError(error) ? new BlobStructuredCloneError(error) : null;

const stageRecords = (
  database: IDBDatabase,
  summary: PersistedImageAssetSummary,
  original: PersistedBinaryRecord,
  thumbnail: PersistedBinaryRecord | undefined,
  allowBlobCloneFallback: boolean,
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    let operationError: AssetStorageError | BlobStructuredCloneError | undefined;
    let settled = false;
    const transaction = database.transaction(ASSET_STORE_NAMES, 'readwrite');

    const rejectOnce = (error: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };
    transaction.oncomplete = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };
    transaction.onerror = () => {
      operationError ??= normalizeError(
        transaction.error,
        'The image could not be staged in browser storage.',
      );
    };
    transaction.onabort = () =>
      rejectOnce(
        operationError
        ?? normalizeError(
          transaction.error,
          'The image could not be staged in browser storage.',
        ),
      );

    const addRecord = (
      storeName: (typeof ASSET_STORE_NAMES)[number],
      record: PersistedBinaryRecord | PersistedImageAssetSummary,
      isBlobPayload: boolean,
    ): boolean => {
      try {
        const request = transaction.objectStore(storeName).add(record);
        request.onerror = () => {
          const error = requestError(request);
          operationError
            ??= allowBlobCloneFallback && isBlobPayload
              ? (asBlobCloneError(error)
                ?? normalizeError(
                  error,
                  'The image could not be staged in browser storage.',
                ))
              : normalizeError(
                error,
                'The image could not be staged in browser storage.',
              );
        };
        return true;
      } catch (error) {
        operationError
          = allowBlobCloneFallback && isBlobPayload
            ? (asBlobCloneError(error)
              ?? normalizeError(
                error,
                'The image could not be staged in browser storage.',
              ))
            : normalizeError(
              error,
              'The image could not be staged in browser storage.',
            );
        try {
          transaction.abort();
        } catch (abortError) {
          rejectOnce(operationError ?? abortError);
        }
        return false;
      }
    };

    if (
      !addRecord(
        CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
        original,
        'blob' in original,
      )
    ) {
      return;
    }
    if (
      thumbnail
      && !addRecord(
        CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
        thumbnail,
        'blob' in thumbnail,
      )
    ) {
      return;
    }
    addRecord(CUSTOM_DESIGN_ASSET_SUMMARY_STORE_NAME, summary, false);
  });

export class IndexedDbAssetRepository implements AssetRepository {
  private readonly dbName: string;
  private readonly factory: IDBFactory;
  private readonly now: () => number;
  private databasePromise: Promise<IDBDatabase> | null = null;
  private closed = false;

  constructor(options: IndexedDbAssetRepositoryOptions = {}) {
    const factory = options.indexedDB ?? globalThis.indexedDB;
    if (!factory) {
      throw new AssetStorageError(
        'unavailable',
        'This browser does not support the storage needed for uploaded designs.',
      );
    }

    this.factory = factory;
    this.dbName = options.dbName ?? DEFAULT_CUSTOM_DESIGN_ASSET_DB_NAME;
    this.now = options.now ?? Date.now;
  }

  clear = async (): Promise<number> => {
    const database = await this.openDatabase();

    try {
      return await new Promise<number>((resolve, reject) => {
        let operationError: AssetStorageError | undefined;
        const transaction = database.transaction(ASSET_STORE_NAMES, 'readwrite');
        const summaryStore = transaction.objectStore(
          CUSTOM_DESIGN_ASSET_SUMMARY_STORE_NAME,
        );
        const countRequest = summaryStore.count();
        const requests = [
          summaryStore.clear(),
          transaction
            .objectStore(CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME)
            .clear(),
          transaction
            .objectStore(CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME)
            .clear(),
        ];

        countRequest.onerror = () => {
          operationError = normalizeError(
            requestError(countRequest),
            'Stored design images could not be counted.',
          );
        };
        for (const request of requests) {
          request.onerror = () => {
            operationError = normalizeError(
              requestError(request),
              'Stored design images could not be cleared.',
            );
          };
        }
        transaction.oncomplete = () => resolve(countRequest.result);
        transaction.onerror = () =>
          reject(
            operationError
            ?? normalizeError(
              transaction.error,
              'Stored design images could not be cleared.',
            ),
          );
        transaction.onabort = transaction.onerror;
      });
    } catch (error) {
      throw normalizeError(error, 'Stored design images could not be cleared.');
    }
  };

  close = (): void => {
    this.closed = true;
    const databasePromise = this.databasePromise;
    this.databasePromise = null;
    void databasePromise?.then(database => database.close()).catch(() => undefined);
  };

  deleteDatabase = async (): Promise<void> => {
    if (this.closed) {
      throw new AssetStorageError(
        'closed',
        'The image storage repository has been closed.',
      );
    }

    const databasePromise = this.databasePromise;
    this.databasePromise = null;
    if (databasePromise) {
      const database = await databasePromise;
      database.close();
    }

    await new Promise<void>((resolve, reject) => {
      const request = this.factory.deleteDatabase(this.dbName);
      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(
          normalizeError(
            requestError(request),
            'Browser image storage could not be deleted.',
          ),
        );
      request.onblocked = () =>
        reject(
          new AssetStorageError(
            'blocked',
            'Image storage is blocked by another open browser tab.',
          ),
        );
    });
  };

  stage = async (asset: PreparedImageAsset): Promise<ImageAssetMetadata> => {
    validatePreparedAsset(asset);
    const stagedDate = new Date(this.now());
    if (!Number.isFinite(stagedDate.getTime())) {
      throw invalidAsset('The staged image timestamp is invalid.');
    }

    const summary: PersistedImageAssetSummary = {
      metadata: asset.metadata,
      schemaVersion: CUSTOM_DESIGN_ASSET_SCHEMA_VERSION,
      stagedAt: stagedDate.toISOString(),
      state: 'staged',
    };
    validateSummary(summary);
    const original: PersistedOriginalBlob = {
      assetId: asset.metadata.id,
      blob: asset.blob,
      schemaVersion: CUSTOM_DESIGN_ASSET_SCHEMA_VERSION,
    };
    const thumbnail: PersistedThumbnailBlob | undefined = asset.thumbnailBlob
      ? {
          assetId: asset.metadata.id,
          blob: asset.thumbnailBlob,
          schemaVersion: CUSTOM_DESIGN_ASSET_SCHEMA_VERSION,
        }
      : undefined;
    const database = await this.openDatabase();

    try {
      try {
        await stageRecords(database, summary, original, thumbnail, true);
      } catch (error) {
        if (!(error instanceof BlobStructuredCloneError)) {
          throw error;
        }

        // A failed structured clone aborts its transaction. Convert only on
        // this compatibility path, and do so before opening the one retry
        // transaction so it cannot become inactive while awaiting bytes.
        const [originalBytes, thumbnailBytes] = await Promise.all([
          readBlobArrayBuffer(asset.blob),
          asset.thumbnailBlob
            ? readBlobArrayBuffer(asset.thumbnailBlob)
            : Promise.resolve(undefined),
        ]);
        const arrayBufferOriginal: PersistedArrayBufferBinary = {
          assetId: asset.metadata.id,
          data: originalBytes,
          mimeType: asset.metadata.mimeType,
          schemaVersion: CUSTOM_DESIGN_ASSET_SCHEMA_VERSION,
          storageKind: 'array_buffer',
        };
        const arrayBufferThumbnail: PersistedArrayBufferBinary | undefined
          = asset.metadata.thumbnail && thumbnailBytes
            ? {
                assetId: asset.metadata.id,
                data: thumbnailBytes,
                mimeType: asset.metadata.thumbnail.mimeType,
                schemaVersion: CUSTOM_DESIGN_ASSET_SCHEMA_VERSION,
                storageKind: 'array_buffer',
              }
            : undefined;

        await stageRecords(
          database,
          summary,
          arrayBufferOriginal,
          arrayBufferThumbnail,
          false,
        );
      }
      return asset.metadata;
    } catch (error) {
      throw normalizeError(
        error,
        'The image could not be staged in browser storage.',
      );
    }
  };

  commit = async (assetId: string): Promise<ImageAssetMetadata> => {
    const [metadata] = await this.commitBatch([assetId]);
    if (!metadata) {
      throw new AssetStorageError(
        'transaction_failed',
        'The image could not be committed.',
      );
    }
    return metadata;
  };

  commitBatch = async (
    assetIds: readonly string[],
  ): Promise<ImageAssetMetadata[]> => {
    if (assetIds.length === 0) {
      return [];
    }
    if (
      assetIds.some(assetId => typeof assetId !== 'string' || !assetId.trim())
      || new Set(assetIds).size !== assetIds.length
    ) {
      throw invalidAsset('Staged image IDs must be non-empty and unique.');
    }
    const database = await this.openDatabase();

    return new Promise<ImageAssetMetadata[]>((resolve, reject) => {
      let operationError: AssetStorageError | undefined;
      let result: ImageAssetMetadata[] | undefined;
      let completedReads = 0;
      const transaction = database.transaction(ASSET_STORE_NAMES, 'readwrite');
      const summaryStore = transaction.objectStore(
        CUSTOM_DESIGN_ASSET_SUMMARY_STORE_NAME,
      );
      const originalStore = transaction.objectStore(
        CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
      );
      const thumbnailStore = transaction.objectStore(
        CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
      );
      const records = assetIds.map(assetId => ({
        assetId,
        originalKeyRequest: originalStore.getKey(assetId),
        summaryRequest: summaryStore.get(assetId) as IDBRequest<unknown>,
        thumbnailKeyRequest: thumbnailStore.getKey(assetId),
      }));
      const requests = records.flatMap(record => [
        record.summaryRequest,
        record.originalKeyRequest,
        record.thumbnailKeyRequest,
      ]);

      const maybeCommit = (): void => {
        completedReads += 1;
        if (completedReads !== requests.length || operationError) {
          return;
        }

        try {
          const committed = records.map((record) => {
            const summary = record.summaryRequest.result;
            if (summary === undefined) {
              throw new AssetStorageError(
                'not_found',
                `The staged image could not be found: ${record.assetId}.`,
              );
            }
            validateSummary(summary);
            if (summary.state !== 'staged') {
              throw new AssetStorageError(
                'not_staged',
                'Only staged images can be committed.',
              );
            }
            const hasOriginal = record.originalKeyRequest.result !== undefined;
            const hasThumbnail = record.thumbnailKeyRequest.result !== undefined;
            if (
              !hasOriginal
              || hasThumbnail !== (summary.metadata.thumbnail !== undefined)
            ) {
              throw invalidAsset(
                'The staged image stores do not match its asset summary.',
              );
            }
            return {
              ...summary,
              state: 'committed' as const,
            };
          });
          result = committed.map(summary => summary.metadata);
          committed.forEach(summary => summaryStore.put(summary));
        } catch (error) {
          operationError = normalizeError(
            error,
            'A staged image record is invalid.',
          );
          transaction.abort();
        }
      };

      for (const request of requests) {
        request.onsuccess = maybeCommit;
        request.onerror = () => {
          operationError = normalizeError(
            requestError(request),
            'The staged images could not be read.',
          );
        };
      }
      transaction.oncomplete = () => {
        if (!result) {
          reject(
            new AssetStorageError(
              'transaction_failed',
              'The image could not be committed.',
            ),
          );
          return;
        }
        resolve(result);
      };
      transaction.onerror = () =>
        reject(
          operationError
          ?? normalizeError(
            transaction.error,
            'The images could not be committed.',
          ),
        );
      transaction.onabort = transaction.onerror;
    });
  };

  discard = async (assetId: string): Promise<boolean> =>
    this.removeAsset(assetId, true);

  get = async (
    assetId: string,
    options?: AssetReadOptions,
  ): Promise<StoredImageAsset | null> => {
    const records = await this.readFullRecords(assetId);
    const asset = reconstructStoredAsset(records);
    if (!asset || (!options?.includeStaged && asset.state !== 'committed')) {
      return null;
    }
    return asset;
  };

  getMetadata = async (
    assetId: string,
    options?: AssetReadOptions,
  ): Promise<ImageAssetMetadata | null> => {
    const summary = await this.readSummary(assetId);
    if (!summary || !isVisible(summary, options)) {
      return null;
    }
    return summary.metadata;
  };

  getOriginal = async (
    assetId: string,
    options?: AssetReadOptions,
  ): Promise<Blob | null> => {
    const database = await this.openDatabase();

    try {
      const records = await new Promise<{
        original: unknown;
        summary: unknown;
      }>((resolve, reject) => {
        let operationError: AssetStorageError | undefined;
        const transaction = database.transaction(
          [
            CUSTOM_DESIGN_ASSET_SUMMARY_STORE_NAME,
            CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
          ],
          'readonly',
        );
        const summaryRequest = transaction
          .objectStore(CUSTOM_DESIGN_ASSET_SUMMARY_STORE_NAME)
          .get(assetId) as IDBRequest<unknown>;
        const originalRequest = transaction
          .objectStore(CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME)
          .get(assetId) as IDBRequest<unknown>;
        for (const request of [summaryRequest, originalRequest]) {
          request.onerror = () => {
            operationError = normalizeError(
              requestError(request),
              'The stored original image could not be read.',
            );
          };
        }
        transaction.oncomplete = () =>
          resolve({
            original: originalRequest.result,
            summary: summaryRequest.result,
          });
        transaction.onerror = () =>
          reject(
            operationError
            ?? normalizeError(
              transaction.error,
              'The stored original image could not be read.',
            ),
          );
        transaction.onabort = transaction.onerror;
      });

      if (records.summary === undefined) {
        if (records.original !== undefined) {
          throw invalidAsset('An orphaned original image blob was found.');
        }
        return null;
      }
      validateSummary(records.summary);
      const original = validateOriginalRecord(records.original, records.summary);
      return isVisible(records.summary, options) ? original.blob : null;
    } catch (error) {
      throw normalizeError(error, 'The stored original image could not be read.');
    }
  };

  getThumbnail = async (
    assetId: string,
    options?: AssetReadOptions,
  ): Promise<Blob | null> => {
    const database = await this.openDatabase();

    try {
      const records = await new Promise<{
        summary: unknown;
        thumbnail: unknown;
      }>((resolve, reject) => {
        let operationError: AssetStorageError | undefined;
        const transaction = database.transaction(
          [
            CUSTOM_DESIGN_ASSET_SUMMARY_STORE_NAME,
            CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
          ],
          'readonly',
        );
        const summaryRequest = transaction
          .objectStore(CUSTOM_DESIGN_ASSET_SUMMARY_STORE_NAME)
          .get(assetId) as IDBRequest<unknown>;
        const thumbnailRequest = transaction
          .objectStore(CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME)
          .get(assetId) as IDBRequest<unknown>;
        for (const request of [summaryRequest, thumbnailRequest]) {
          request.onerror = () => {
            operationError = normalizeError(
              requestError(request),
              'The stored image thumbnail could not be read.',
            );
          };
        }
        transaction.oncomplete = () =>
          resolve({
            summary: summaryRequest.result,
            thumbnail: thumbnailRequest.result,
          });
        transaction.onerror = () =>
          reject(
            operationError
            ?? normalizeError(
              transaction.error,
              'The stored image thumbnail could not be read.',
            ),
          );
        transaction.onabort = transaction.onerror;
      });

      if (records.summary === undefined) {
        if (records.thumbnail !== undefined) {
          throw invalidAsset('An orphaned thumbnail blob was found.');
        }
        return null;
      }
      validateSummary(records.summary);
      if (!isVisible(records.summary, options)) {
        return null;
      }
      return (
        validateThumbnailRecord(records.thumbnail, records.summary)?.blob ?? null
      );
    } catch (error) {
      throw normalizeError(error, 'The stored image thumbnail could not be read.');
    }
  };

  has = async (assetId: string, options?: AssetReadOptions): Promise<boolean> => {
    const database = await this.openDatabase();

    try {
      const result = await new Promise<{
        originalKey: IDBValidKey | undefined;
        summary: unknown;
      }>((resolve, reject) => {
        let operationError: AssetStorageError | undefined;
        const transaction = database.transaction(
          [
            CUSTOM_DESIGN_ASSET_SUMMARY_STORE_NAME,
            CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
          ],
          'readonly',
        );
        const summaryRequest = transaction
          .objectStore(CUSTOM_DESIGN_ASSET_SUMMARY_STORE_NAME)
          .get(assetId) as IDBRequest<unknown>;
        const originalKeyRequest = transaction
          .objectStore(CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME)
          .getKey(assetId);
        for (const request of [summaryRequest, originalKeyRequest]) {
          request.onerror = () => {
            operationError = normalizeError(
              requestError(request),
              'The stored image could not be checked.',
            );
          };
        }
        transaction.oncomplete = () =>
          resolve({
            originalKey: originalKeyRequest.result,
            summary: summaryRequest.result,
          });
        transaction.onerror = () =>
          reject(
            operationError
            ?? normalizeError(
              transaction.error,
              'The stored image could not be checked.',
            ),
          );
        transaction.onabort = transaction.onerror;
      });

      if (result.summary === undefined) {
        return false;
      }
      validateSummary(result.summary);
      return (
        isVisible(result.summary, options) && result.originalKey !== undefined
      );
    } catch (error) {
      throw normalizeError(error, 'The stored image could not be checked.');
    }
  };

  list = async (options?: AssetListOptions): Promise<ImageAssetSummary[]> => {
    const database = await this.openDatabase();

    try {
      const records = await new Promise<unknown[]>((resolve, reject) => {
        const transaction = database.transaction(
          CUSTOM_DESIGN_ASSET_SUMMARY_STORE_NAME,
          'readonly',
        );
        const request = transaction
          .objectStore(CUSTOM_DESIGN_ASSET_SUMMARY_STORE_NAME)
          .getAll() as IDBRequest<unknown[]>;
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(requestError(request));
      });
      const summaries = records.map((record) => {
        validateSummary(record);
        return record;
      });
      return summaries
        .filter(
          summary => options?.includeStaged || summary.state === 'committed',
        )
        .map(({ metadata, stagedAt, state }) => ({ metadata, stagedAt, state }))
        .sort((left, right) =>
          left.metadata.createdAt.localeCompare(right.metadata.createdAt),
        );
    } catch (error) {
      throw normalizeError(error, 'Stored images could not be listed.');
    }
  };

  delete = async (assetId: string): Promise<boolean> =>
    this.removeAsset(assetId, false);

  private openDatabase = async (): Promise<IDBDatabase> => {
    if (this.closed) {
      throw new AssetStorageError(
        'closed',
        'The image storage repository has been closed.',
      );
    }

    if (!this.databasePromise) {
      this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
        let settled = false;
        const request = this.factory.open(
          this.dbName,
          CUSTOM_DESIGN_ASSET_DB_VERSION,
        );
        request.onupgradeneeded = () => {
          const database = request.result;
          if (
            !database.objectStoreNames.contains(
              CUSTOM_DESIGN_ASSET_SUMMARY_STORE_NAME,
            )
          ) {
            database.createObjectStore(CUSTOM_DESIGN_ASSET_SUMMARY_STORE_NAME, {
              keyPath: 'metadata.id',
            });
          }
          if (
            !database.objectStoreNames.contains(
              CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
            )
          ) {
            database.createObjectStore(CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME, {
              keyPath: 'assetId',
            });
          }
          if (
            !database.objectStoreNames.contains(
              CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
            )
          ) {
            database.createObjectStore(
              CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
              { keyPath: 'assetId' },
            );
          }
        };
        request.onerror = () => {
          settled = true;
          reject(
            normalizeError(
              requestError(request),
              'Browser image storage could not be opened.',
            ),
          );
        };
        request.onblocked = () => {
          settled = true;
          reject(
            new AssetStorageError(
              'blocked',
              'Image storage is blocked by another open browser tab.',
            ),
          );
        };
        request.onsuccess = () => {
          const database = request.result;
          if (settled || this.closed) {
            database.close();
            if (!settled) {
              reject(
                new AssetStorageError(
                  'closed',
                  'The image storage repository has been closed.',
                ),
              );
            }
            return;
          }
          database.onversionchange = () => {
            database.close();
            this.databasePromise = null;
          };
          resolve(database);
        };
      }).catch((error) => {
        this.databasePromise = null;
        throw normalizeError(
          error,
          'Browser image storage could not be opened.',
        );
      });
    }

    return this.databasePromise;
  };

  private readFullRecords = async (assetId: string): Promise<FullAssetRecords> => {
    const database = await this.openDatabase();

    try {
      return await new Promise<FullAssetRecords>((resolve, reject) => {
        let operationError: AssetStorageError | undefined;
        const transaction = database.transaction(ASSET_STORE_NAMES, 'readonly');
        const summaryRequest = transaction
          .objectStore(CUSTOM_DESIGN_ASSET_SUMMARY_STORE_NAME)
          .get(assetId) as IDBRequest<unknown>;
        const originalRequest = transaction
          .objectStore(CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME)
          .get(assetId) as IDBRequest<unknown>;
        const thumbnailRequest = transaction
          .objectStore(CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME)
          .get(assetId) as IDBRequest<unknown>;
        for (const request of [
          summaryRequest,
          originalRequest,
          thumbnailRequest,
        ]) {
          request.onerror = () => {
            operationError = normalizeError(
              requestError(request),
              'The stored image could not be read.',
            );
          };
        }
        transaction.oncomplete = () =>
          resolve({
            original: originalRequest.result,
            summary: summaryRequest.result,
            thumbnail: thumbnailRequest.result,
          });
        transaction.onerror = () =>
          reject(
            operationError
            ?? normalizeError(
              transaction.error,
              'The stored image could not be read.',
            ),
          );
        transaction.onabort = transaction.onerror;
      });
    } catch (error) {
      throw normalizeError(error, 'The stored image could not be read.');
    }
  };

  private readSummary = async (
    assetId: string,
  ): Promise<PersistedImageAssetSummary | null> => {
    const database = await this.openDatabase();

    try {
      const record = await new Promise<unknown>((resolve, reject) => {
        const request = database
          .transaction(CUSTOM_DESIGN_ASSET_SUMMARY_STORE_NAME, 'readonly')
          .objectStore(CUSTOM_DESIGN_ASSET_SUMMARY_STORE_NAME)
          .get(assetId) as IDBRequest<unknown>;
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(requestError(request));
      });
      if (record === undefined) {
        return null;
      }
      validateSummary(record);
      return record;
    } catch (error) {
      throw normalizeError(error, 'The stored image metadata could not be read.');
    }
  };

  private removeAsset = async (
    assetId: string,
    stagedOnly: boolean,
  ): Promise<boolean> => {
    const database = await this.openDatabase();

    return new Promise<boolean>((resolve, reject) => {
      let operationError: AssetStorageError | undefined;
      let removed = false;
      let completedReads = 0;
      const transaction = database.transaction(ASSET_STORE_NAMES, 'readwrite');
      const summaryStore = transaction.objectStore(
        CUSTOM_DESIGN_ASSET_SUMMARY_STORE_NAME,
      );
      const originalStore = transaction.objectStore(
        CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
      );
      const thumbnailStore = transaction.objectStore(
        CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
      );
      const summaryRequest = summaryStore.get(assetId) as IDBRequest<unknown>;
      const originalKeyRequest = originalStore.getKey(assetId);
      const thumbnailKeyRequest = thumbnailStore.getKey(assetId);
      const requests = [summaryRequest, originalKeyRequest, thumbnailKeyRequest];

      const maybeRemove = (): void => {
        completedReads += 1;
        if (completedReads !== requests.length || operationError) {
          return;
        }
        try {
          const summary = summaryRequest.result;
          if (summary === undefined) {
            if (
              !stagedOnly
              && (originalKeyRequest.result !== undefined
                || thumbnailKeyRequest.result !== undefined)
            ) {
              // An authorized permanent deletion may also purge orphaned
              // companions. Reads still report this corruption explicitly.
              summaryStore.delete(assetId);
              originalStore.delete(assetId);
              thumbnailStore.delete(assetId);
              removed = true;
            }
            return;
          }
          validateSummary(summary);
          if (stagedOnly && summary.state !== 'staged') {
            return;
          }

          // Removal is deliberately tolerant of absent companion records. A
          // missing blob is a recoverable read error, not a reason to leak the
          // surviving records after reference-aware cleanup is authorized.
          summaryStore.delete(assetId);
          originalStore.delete(assetId);
          thumbnailStore.delete(assetId);
          removed = true;
        } catch (error) {
          operationError = normalizeError(
            error,
            'The stored image record is invalid.',
          );
          transaction.abort();
        }
      };

      for (const request of requests) {
        request.onsuccess = maybeRemove;
        request.onerror = () => {
          operationError = normalizeError(
            requestError(request),
            'The stored image could not be read before removal.',
          );
        };
      }
      transaction.oncomplete = () => resolve(removed);
      transaction.onerror = () =>
        reject(
          operationError
          ?? normalizeError(
            transaction.error,
            'The stored image could not be removed.',
          ),
        );
      transaction.onabort = transaction.onerror;
    });
  };
}

export const resolveStoredAsset = async (
  repository: AssetRepository,
  assetId: string,
): Promise<AssetResolution> => {
  try {
    const asset = await repository.get(assetId);
    return asset ? { asset, status: 'ready' } : { status: 'missing' };
  } catch (error) {
    return {
      error: error instanceof Error ? error : new Error('Image storage failed.'),
      status: 'error',
    };
  }
};
