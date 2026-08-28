import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';

import { AssetStorageError, toAssetStorageError } from './errors';
import {
  CUSTOM_DESIGN_ASSET_STORE_NAME,
  CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
  CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
  IndexedDbAssetRepository,
  resolveStoredAsset,
} from './IndexedDbAssetRepository';
import { readBlobArrayBuffer } from './image-processing';
import {
  CUSTOM_DESIGN_MAX_THUMBNAIL_BYTES,
  type AssetRepository,
  type PreparedImageAsset,
} from './types';

const makeAsset = (id: string): PreparedImageAsset => {
  const blob = new NodeBlob([`original-${id}`], {
    type: 'image/png',
  }) as unknown as Blob;
  const thumbnailBlob = new NodeBlob([`thumb-${id}`], {
    type: 'image/webp',
  }) as unknown as Blob;
  return {
    blob,
    metadata: {
      aspectRatio: 2,
      byteSize: blob.size,
      createdAt: '2026-08-27T12:00:00.000Z',
      fileName: `${id}.png`,
      height: 100,
      id,
      mimeType: 'image/png',
      orientation: 1,
      thumbnail: {
        byteSize: thumbnailBlob.size,
        height: 50,
        mimeType: 'image/webp',
        width: 100,
      },
      width: 200,
    },
    thumbnailBlob,
  };
};

const readBlobText = async (blob: Blob): Promise<string> =>
  new TextDecoder().decode(await readBlobArrayBuffer(blob));

const openRawDatabase = (
  indexedDB: IDBFactory,
  dbName: string,
): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const readRawRecord = async (
  indexedDB: IDBFactory,
  dbName: string,
  assetId: string,
  storeName = CUSTOM_DESIGN_ASSET_STORE_NAME,
): Promise<Record<string, unknown>> => {
  const database = await openRawDatabase(indexedDB, dbName);
  try {
    return await new Promise((resolve, reject) => {
      const request = database
        .transaction(storeName, 'readonly')
        .objectStore(storeName)
        .get(assetId);
      request.onsuccess = () => resolve(request.result as Record<string, unknown>);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
};

const writeRawRecord = async (
  indexedDB: IDBFactory,
  dbName: string,
  record: Record<string, unknown>,
  storeName = CUSTOM_DESIGN_ASSET_STORE_NAME,
): Promise<void> => {
  const database = await openRawDatabase(indexedDB, dbName);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        storeName,
        'readwrite',
      );
      const request = transaction
        .objectStore(storeName)
        .put(record);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
};

const hasRawKey = async (
  indexedDB: IDBFactory,
  dbName: string,
  storeName: string,
  assetId: string,
): Promise<boolean> => {
  const database = await openRawDatabase(indexedDB, dbName);
  try {
    return await new Promise((resolve, reject) => {
      const request = database
        .transaction(storeName, 'readonly')
        .objectStore(storeName)
        .getKey(assetId);
      request.onsuccess = () => resolve(request.result !== undefined);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
};

const deleteRawRecord = async (
  indexedDB: IDBFactory,
  dbName: string,
  storeName: string,
  assetId: string,
): Promise<void> => {
  const database = await openRawDatabase(indexedDB, dbName);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).delete(assetId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
};

type BinaryWriteProbe = {
  arrayBufferWrites: number;
  blobWrites: number;
  restore: () => void;
  transactions: IDBTransaction[];
};

const interceptBinaryWrites = (options: {
  arrayBufferError?: DOMException;
  blobError?: DOMException;
  blobErrorStore?: string;
  failSummaryWithDataClone?: boolean;
}): BinaryWriteProbe => {
  const originalAdd = IDBObjectStore.prototype.add;
  const transactions: IDBTransaction[] = [];
  let arrayBufferWrites = 0;
  let blobWrites = 0;
  const addSpy = vi
    .spyOn(IDBObjectStore.prototype, 'add')
    .mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ): IDBRequest<IDBValidKey> {
      const record = value as {
        blob?: unknown;
        storageKind?: unknown;
      };
      const isBinaryStore =
        this.name === CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME ||
        this.name === CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME;

      if (isBinaryStore && record.blob instanceof NodeBlob) {
        blobWrites += 1;
        transactions.push(this.transaction);
        if (
          options.blobError &&
          (!options.blobErrorStore || options.blobErrorStore === this.name)
        ) {
          throw options.blobError;
        }
      }
      if (isBinaryStore && record.storageKind === 'array_buffer') {
        arrayBufferWrites += 1;
        transactions.push(this.transaction);
        if (options.arrayBufferError) throw options.arrayBufferError;
      }
      if (
        this.name === CUSTOM_DESIGN_ASSET_STORE_NAME &&
        options.failSummaryWithDataClone
      ) {
        throw new DOMException('Summary clone failed.', 'DataCloneError');
      }

      return Reflect.apply(
        originalAdd,
        this,
        key === undefined ? [value] : [value, key],
      ) as IDBRequest<IDBValidKey>;
    });

  return {
    get arrayBufferWrites() {
      return arrayBufferWrites;
    },
    get blobWrites() {
      return blobWrites;
    },
    restore: () => addSpy.mockRestore(),
    transactions,
  };
};

describe('IndexedDbAssetRepository', () => {
  it('stages invisibly, commits, and retrieves original and thumbnail blobs', async () => {
    const repository = new IndexedDbAssetRepository({
      dbName: 'lifecycle',
      indexedDB: new IDBFactory(),
    });
    const asset = makeAsset('asset-one');

    await repository.stage(asset);
    expect(await repository.has('asset-one')).toBe(false);
    expect(await repository.has('asset-one', { includeStaged: true })).toBe(true);
    expect(await repository.get('asset-one')).toBeNull();
    const stagedSummary = (await repository.list({ includeStaged: true }))[0];
    expect(stagedSummary?.state).toBe('staged');
    expect(stagedSummary).not.toHaveProperty('blob');

    await repository.commit('asset-one');
    const stored = await repository.get('asset-one');
    expect(stored?.state).toBe('committed');
    expect(stored && (await readBlobText(stored.blob))).toBe('original-asset-one');
    const thumbnail = await repository.getThumbnail('asset-one');
    expect(thumbnail && (await readBlobText(thumbnail))).toBe('thumb-asset-one');
    expect(await repository.getMetadata('asset-one')).toEqual(asset.metadata);
    expect(await repository.has('asset-one')).toBe(true);
    repository.close();
  });

  it('keeps the normal write path Blob-backed when IndexedDB accepts Blobs', async () => {
    const indexedDB = new IDBFactory();
    const dbName = 'normal-blob-payload';
    const repository = new IndexedDbAssetRepository({ dbName, indexedDB });
    const probe = interceptBinaryWrites({});

    try {
      await repository.stage(makeAsset('normal-blob'));
      await repository.commit('normal-blob');
      const original = await readRawRecord(
        indexedDB,
        dbName,
        'normal-blob',
        CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
      );
      const thumbnail = await readRawRecord(
        indexedDB,
        dbName,
        'normal-blob',
        CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
      );

      expect(original.blob).toBeInstanceOf(NodeBlob);
      expect(thumbnail.blob).toBeInstanceOf(NodeBlob);
      expect(original.storageKind).toBeUndefined();
      expect(original.data).toBeUndefined();
      expect(probe.blobWrites).toBe(2);
      expect(probe.arrayBufferWrites).toBe(0);
    } finally {
      probe.restore();
      repository.close();
    }
  });

  it('retries a Blob DataCloneError once in a fresh transaction with ArrayBuffers', async () => {
    const indexedDB = new IDBFactory();
    const dbName = 'array-buffer-fallback';
    const repository = new IndexedDbAssetRepository({ dbName, indexedDB });
    const probe = interceptBinaryWrites({
      blobError: new DOMException(
        'BlobURLs are not yet supported',
        'DataCloneError',
      ),
    });

    try {
      await repository.stage(makeAsset('fallback'));
      expect(await repository.has('fallback')).toBe(false);
      expect(await repository.has('fallback', { includeStaged: true })).toBe(true);
      await repository.commit('fallback');

      const rawOriginal = await readRawRecord(
        indexedDB,
        dbName,
        'fallback',
        CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
      );
      const rawThumbnail = await readRawRecord(
        indexedDB,
        dbName,
        'fallback',
        CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
      );
      expect(rawOriginal).toMatchObject({
        assetId: 'fallback',
        mimeType: 'image/png',
        storageKind: 'array_buffer',
      });
      expect(rawThumbnail).toMatchObject({
        assetId: 'fallback',
        mimeType: 'image/webp',
        storageKind: 'array_buffer',
      });
      expect((rawOriginal.data as ArrayBuffer).byteLength).toBe(
        makeAsset('fallback').metadata.byteSize,
      );
      expect((rawThumbnail.data as ArrayBuffer).byteLength).toBe(
        makeAsset('fallback').metadata.thumbnail?.byteSize,
      );
      expect(rawOriginal.blob).toBeUndefined();
      expect(rawThumbnail.blob).toBeUndefined();

      const original = await repository.getOriginal('fallback');
      const thumbnail = await repository.getThumbnail('fallback');
      expect(original).toBeInstanceOf(Blob);
      expect(original?.type).toBe('image/png');
      expect(original && (await readBlobText(original))).toBe('original-fallback');
      expect(thumbnail).toBeInstanceOf(Blob);
      expect(thumbnail?.type).toBe('image/webp');
      expect(thumbnail && (await readBlobText(thumbnail))).toBe('thumb-fallback');

      expect(probe.blobWrites).toBe(1);
      expect(probe.arrayBufferWrites).toBe(2);
      expect(new Set(probe.transactions).size).toBe(2);
      expect(probe.transactions[0]).not.toBe(probe.transactions[1]);
      expect(probe.transactions[1]).toBe(probe.transactions[2]);
    } finally {
      probe.restore();
      repository.close();
    }
  });

  it('aborts and retries both binaries when only the thumbnail Blob clone fails', async () => {
    const indexedDB = new IDBFactory();
    const dbName = 'thumbnail-array-buffer-fallback';
    const repository = new IndexedDbAssetRepository({ dbName, indexedDB });
    const probe = interceptBinaryWrites({
      blobError: new DOMException(
        'BlobURLs are not yet supported',
        'DataCloneError',
      ),
      blobErrorStore: CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
    });

    try {
      await repository.stage(makeAsset('thumbnail-fallback'));
      await repository.commit('thumbnail-fallback');
      const rawOriginal = await readRawRecord(
        indexedDB,
        dbName,
        'thumbnail-fallback',
        CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
      );
      const rawThumbnail = await readRawRecord(
        indexedDB,
        dbName,
        'thumbnail-fallback',
        CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
      );
      expect(rawOriginal.storageKind).toBe('array_buffer');
      expect(rawThumbnail.storageKind).toBe('array_buffer');
      expect(probe.blobWrites).toBe(2);
      expect(probe.arrayBufferWrites).toBe(2);
      expect(new Set(probe.transactions).size).toBe(2);
      expect(probe.transactions[0]).toBe(probe.transactions[1]);
      expect(probe.transactions[1]).not.toBe(probe.transactions[2]);
      expect(probe.transactions[2]).toBe(probe.transactions[3]);
    } finally {
      probe.restore();
      repository.close();
    }
  });

  it('reads a mixed database of legacy Blob and ArrayBuffer-backed assets', async () => {
    const indexedDB = new IDBFactory();
    const dbName = 'mixed-binary-records';
    const repository = new IndexedDbAssetRepository({ dbName, indexedDB });
    await repository.stage(makeAsset('legacy-blob'));
    await repository.commit('legacy-blob');

    const probe = interceptBinaryWrites({
      blobError: new DOMException(
        'BlobURLs are not yet supported',
        'DataCloneError',
      ),
    });
    try {
      await repository.stage(makeAsset('fallback-buffer'));
      await repository.commit('fallback-buffer');
    } finally {
      probe.restore();
    }

    const legacyRecord = await readRawRecord(
      indexedDB,
      dbName,
      'legacy-blob',
      CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
    );
    const fallbackRecord = await readRawRecord(
      indexedDB,
      dbName,
      'fallback-buffer',
      CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
    );
    expect(legacyRecord.blob).toBeInstanceOf(NodeBlob);
    expect(legacyRecord.storageKind).toBeUndefined();
    expect(fallbackRecord.storageKind).toBe('array_buffer');
    expect((fallbackRecord.data as ArrayBuffer).byteLength).toBe(
      makeAsset('fallback-buffer').metadata.byteSize,
    );
    expect(await readBlobText((await repository.get('legacy-blob'))!.blob)).toBe(
      'original-legacy-blob',
    );
    expect(
      await readBlobText((await repository.get('fallback-buffer'))!.blob),
    ).toBe('original-fallback-buffer');
    repository.close();
  });

  it('discards every ArrayBuffer-backed staged record on cancellation', async () => {
    const indexedDB = new IDBFactory();
    const dbName = 'discard-fallback-stage';
    const repository = new IndexedDbAssetRepository({ dbName, indexedDB });
    const probe = interceptBinaryWrites({
      blobError: new DOMException(
        'BlobURLs are not yet supported',
        'DataCloneError',
      ),
    });
    try {
      await repository.stage(makeAsset('cancelled-fallback'));
      await expect(
        repository.has('cancelled-fallback', { includeStaged: true }),
      ).resolves.toBe(true);
      await expect(repository.discard('cancelled-fallback')).resolves.toBe(true);
      for (const storeName of [
        CUSTOM_DESIGN_ASSET_STORE_NAME,
        CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
        CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
      ]) {
        expect(
          await hasRawKey(
            indexedDB,
            dbName,
            storeName,
            'cancelled-fallback',
          ),
        ).toBe(false);
      }
    } finally {
      probe.restore();
      repository.close();
    }
  });

  it('does not retry quota, security, or summary DataClone failures', async () => {
    for (const scenario of [
      {
        dbName: 'no-fallback-quota',
        errorCode: 'quota_exceeded',
        options: {
          blobError: new DOMException('full', 'QuotaExceededError'),
        },
      },
      {
        dbName: 'no-fallback-security',
        errorCode: 'security',
        options: {
          blobError: new DOMException('denied', 'SecurityError'),
        },
      },
      {
        dbName: 'no-fallback-unknown',
        errorCode: 'unknown',
        options: {
          blobError: new DOMException('unrelated failure', 'UnknownError'),
        },
      },
      {
        dbName: 'no-fallback-summary-clone',
        errorCode: 'unknown',
        options: { failSummaryWithDataClone: true },
      },
    ] as const) {
      const indexedDB = new IDBFactory();
      const repository = new IndexedDbAssetRepository({
        dbName: scenario.dbName,
        indexedDB,
      });
      const probe = interceptBinaryWrites(scenario.options);
      try {
        await expect(repository.stage(makeAsset('not-retried'))).rejects.toMatchObject({
          code: scenario.errorCode,
        });
        expect(probe.arrayBufferWrites).toBe(0);
        for (const storeName of [
          CUSTOM_DESIGN_ASSET_STORE_NAME,
          CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
          CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
        ]) {
          expect(
            await hasRawKey(indexedDB, scenario.dbName, storeName, 'not-retried'),
          ).toBe(false);
        }
      } finally {
        probe.restore();
        repository.close();
      }
    }
  });

  it('does not retry again when the one ArrayBuffer transaction fails', async () => {
    const indexedDB = new IDBFactory();
    const dbName = 'bounded-fallback';
    const repository = new IndexedDbAssetRepository({ dbName, indexedDB });
    const probe = interceptBinaryWrites({
      arrayBufferError: new DOMException('full', 'QuotaExceededError'),
      blobError: new DOMException(
        'BlobURLs are not yet supported',
        'DataCloneError',
      ),
    });

    try {
      await expect(repository.stage(makeAsset('bounded'))).rejects.toMatchObject({
        code: 'quota_exceeded',
      });
      expect(probe.blobWrites).toBe(1);
      expect(probe.arrayBufferWrites).toBe(1);
      expect(new Set(probe.transactions).size).toBe(2);
      for (const storeName of [
        CUSTOM_DESIGN_ASSET_STORE_NAME,
        CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
        CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
      ]) {
        expect(await hasRawKey(indexedDB, dbName, storeName, 'bounded')).toBe(false);
      }
    } finally {
      probe.restore();
      repository.close();
    }
  });

  it('persists committed assets for another repository in the same browser', async () => {
    const indexedDB = new IDBFactory();
    const first = new IndexedDbAssetRepository({ dbName: 'reload', indexedDB });
    await first.stage(makeAsset('persistent'));
    await first.commit('persistent');
    first.close();

    const afterReload = new IndexedDbAssetRepository({
      dbName: 'reload',
      indexedDB,
    });
    expect((await afterReload.get('persistent'))?.metadata.fileName).toBe(
      'persistent.png',
    );
    afterReload.close();
  });

  it('commits a staged batch atomically and preserves caller order', async () => {
    const repository = new IndexedDbAssetRepository({
      dbName: 'atomic-batch-commit',
      indexedDB: new IDBFactory(),
    });
    await repository.stage(makeAsset('first'));
    await repository.stage(makeAsset('second'));

    await expect(repository.commitBatch(['second', 'first'])).resolves.toEqual([
      expect.objectContaining({ id: 'second' }),
      expect.objectContaining({ id: 'first' }),
    ]);
    await expect(repository.has('first')).resolves.toBe(true);
    await expect(repository.has('second')).resolves.toBe(true);
    repository.close();
  });

  it('leaves every record staged when one batch member cannot commit', async () => {
    const repository = new IndexedDbAssetRepository({
      dbName: 'atomic-batch-rollback',
      indexedDB: new IDBFactory(),
    });
    await repository.stage(makeAsset('kept-staged'));

    await expect(
      repository.commitBatch(['kept-staged', 'missing']),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(repository.has('kept-staged')).resolves.toBe(false);
    await expect(
      repository.has('kept-staged', { includeStaged: true }),
    ).resolves.toBe(true);
    await expect(
      repository.commitBatch(['kept-staged', 'kept-staged']),
    ).rejects.toMatchObject({ code: 'invalid_asset' });
    repository.close();
  });

  it('keeps metadata-only operations off the original blob value path', async () => {
    const indexedDB = new IDBFactory();
    const repository = new IndexedDbAssetRepository({
      dbName: 'metadata-read-contract',
      indexedDB,
    });
    await repository.stage(makeAsset('metadata-only'));
    await repository.commit('metadata-only');
    const getSpy = vi.spyOn(IDBObjectStore.prototype, 'get');
    const getAllSpy = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    const getKeySpy = vi.spyOn(IDBObjectStore.prototype, 'getKey');

    try {
      await expect(repository.list()).resolves.toHaveLength(1);
      await expect(repository.getMetadata('metadata-only')).resolves.toMatchObject({
        id: 'metadata-only',
      });
      await expect(repository.has('metadata-only')).resolves.toBe(true);
      await expect(repository.getThumbnail('metadata-only')).resolves.toBeInstanceOf(
        NodeBlob,
      );

      const storesFor = (spy: typeof getSpy): string[] =>
        spy.mock.instances.map(
          (store) => (store as unknown as IDBObjectStore).name,
        );
      expect(storesFor(getSpy)).not.toContain(
        CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
      );
      expect(storesFor(getAllSpy as unknown as typeof getSpy)).not.toContain(
        CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
      );
      expect(storesFor(getKeySpy as unknown as typeof getSpy)).toContain(
        CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
      );
    } finally {
      getSpy.mockRestore();
      getAllSpy.mockRestore();
      getKeySpy.mockRestore();
      repository.close();
    }
  });

  it('reads an original without opening the thumbnail value path', async () => {
    const indexedDB = new IDBFactory();
    const repository = new IndexedDbAssetRepository({
      dbName: 'original-only-read',
      indexedDB,
    });
    await repository.stage(makeAsset('committed-original'));
    await repository.commit('committed-original');
    await repository.stage(makeAsset('staged-original'));
    const getSpy = vi.spyOn(IDBObjectStore.prototype, 'get');

    try {
      const committed = await repository.getOriginal('committed-original');
      expect(committed && (await readBlobText(committed))).toBe(
        'original-committed-original',
      );
      await expect(repository.getOriginal('staged-original')).resolves.toBeNull();
      const staged = await repository.getOriginal('staged-original', {
        includeStaged: true,
      });
      expect(staged && (await readBlobText(staged))).toBe(
        'original-staged-original',
      );
      const stores = getSpy.mock.instances.map(
        (store) => (store as unknown as IDBObjectStore).name,
      );
      expect(stores).toContain(CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME);
      expect(stores).not.toContain(CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME);
    } finally {
      getSpy.mockRestore();
      repository.close();
    }
  });

  it('deletes and discards by key without cloning original or thumbnail blobs', async () => {
    const indexedDB = new IDBFactory();
    const repository = new IndexedDbAssetRepository({
      dbName: 'key-only-removal',
      indexedDB,
    });
    await repository.stage(makeAsset('delete-by-key'));
    await repository.commit('delete-by-key');
    await repository.stage(makeAsset('discard-by-key'));
    const getSpy = vi.spyOn(IDBObjectStore.prototype, 'get');
    const getKeySpy = vi.spyOn(IDBObjectStore.prototype, 'getKey');

    try {
      await expect(repository.delete('delete-by-key')).resolves.toBe(true);
      await expect(repository.discard('discard-by-key')).resolves.toBe(true);
      const getStores = getSpy.mock.instances.map(
        (store) => (store as unknown as IDBObjectStore).name,
      );
      const getKeyStores = getKeySpy.mock.instances.map(
        (store) => (store as unknown as IDBObjectStore).name,
      );
      expect(getStores).not.toContain(CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME);
      expect(getStores).not.toContain(CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME);
      expect(
        getKeyStores.filter(
          (storeName) => storeName === CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
        ),
      ).toHaveLength(2);
      expect(
        getKeyStores.filter(
          (storeName) => storeName === CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
        ),
      ).toHaveLength(2);
    } finally {
      getSpy.mockRestore();
      getKeySpy.mockRestore();
      repository.close();
    }
  });

  it('permanently deletes every surviving record when the original is missing', async () => {
    const indexedDB = new IDBFactory();
    const dbName = 'delete-missing-original';
    const repository = new IndexedDbAssetRepository({ dbName, indexedDB });
    await repository.stage(makeAsset('missing-original'));
    await repository.commit('missing-original');
    await deleteRawRecord(
      indexedDB,
      dbName,
      CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
      'missing-original',
    );

    await expect(repository.delete('missing-original')).resolves.toBe(true);
    for (const storeName of [
      CUSTOM_DESIGN_ASSET_STORE_NAME,
      CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
      CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
    ]) {
      expect(await hasRawKey(indexedDB, dbName, storeName, 'missing-original')).toBe(
        false,
      );
    }
    repository.close();
  });

  it('discards every surviving staged record when the thumbnail is missing', async () => {
    const indexedDB = new IDBFactory();
    const dbName = 'discard-missing-thumbnail';
    const repository = new IndexedDbAssetRepository({ dbName, indexedDB });
    await repository.stage(makeAsset('missing-thumbnail'));
    await deleteRawRecord(
      indexedDB,
      dbName,
      CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
      'missing-thumbnail',
    );

    await expect(repository.discard('missing-thumbnail')).resolves.toBe(true);
    for (const storeName of [
      CUSTOM_DESIGN_ASSET_STORE_NAME,
      CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
      CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
    ]) {
      expect(await hasRawKey(indexedDB, dbName, storeName, 'missing-thumbnail')).toBe(
        false,
      );
    }
    repository.close();
  });

  it('aborts all new records when one store collides during stage', async () => {
    const indexedDB = new IDBFactory();
    const dbName = 'atomic-stage';
    const repository = new IndexedDbAssetRepository({ dbName, indexedDB });
    await repository.has('initialize-stores');
    await writeRawRecord(
      indexedDB,
      dbName,
      {
        assetId: 'atomic',
        blob: new NodeBlob(['orphan'], { type: 'image/webp' }) as unknown as Blob,
        schemaVersion: 1,
      },
      CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
    );

    await expect(repository.stage(makeAsset('atomic'))).rejects.toMatchObject({
      code: 'invalid_asset',
    });
    expect(
      await hasRawKey(
        indexedDB,
        dbName,
        CUSTOM_DESIGN_ASSET_STORE_NAME,
        'atomic',
      ),
    ).toBe(false);
    expect(
      await hasRawKey(
        indexedDB,
        dbName,
        CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
        'atomic',
      ),
    ).toBe(false);
    expect(
      await hasRawKey(
        indexedDB,
        dbName,
        CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
        'atomic',
      ),
    ).toBe(true);
    repository.close();
  });

  it('does not overwrite a staged or committed asset with a duplicate ID', async () => {
    const repository = new IndexedDbAssetRepository({
      dbName: 'collision',
      indexedDB: new IDBFactory(),
    });
    await repository.stage(makeAsset('same-id'));

    await expect(repository.stage(makeAsset('same-id'))).rejects.toMatchObject({
      code: 'invalid_asset',
    });
    await repository.commit('same-id');
    await expect(repository.stage(makeAsset('same-id'))).rejects.toMatchObject({
      code: 'invalid_asset',
    });
    const stored = await repository.get('same-id');
    expect(stored && (await readBlobText(stored.blob))).toBe('original-same-id');
    repository.close();
  });

  it('rejects malformed runtime metadata, unsupported MIME, and mismatched bytes', async () => {
    const repository = new IndexedDbAssetRepository({
      dbName: 'invalid',
      indexedDB: new IDBFactory(),
    });
    const unsupported = makeAsset('unsupported');
    unsupported.metadata.mimeType = 'image/gif' as 'image/png';
    Object.defineProperty(unsupported.blob, 'type', { value: 'image/gif' });
    await expect(repository.stage(unsupported)).rejects.toMatchObject({
      code: 'invalid_asset',
    });

    const mismatched = makeAsset('mismatch');
    mismatched.metadata.byteSize += 1;
    await expect(repository.stage(mismatched)).rejects.toMatchObject({
      code: 'invalid_asset',
    });

    const fractional = makeAsset('fractional');
    fractional.metadata.width = 200.5;
    fractional.metadata.aspectRatio = fractional.metadata.width / 100;
    await expect(repository.stage(fractional)).rejects.toMatchObject({
      code: 'invalid_asset',
    });

    const invalidOrientation = makeAsset('orientation');
    invalidOrientation.metadata.orientation = 1.5 as 1;
    await expect(repository.stage(invalidOrientation)).rejects.toMatchObject({
      code: 'invalid_asset',
    });

    const oversizedThumbnail = makeAsset('large-thumbnail');
    if (oversizedThumbnail.metadata.thumbnail) {
      oversizedThumbnail.metadata.thumbnail.width = 321;
    }
    await expect(repository.stage(oversizedThumbnail)).rejects.toMatchObject({
      code: 'invalid_asset',
    });

    const excessiveThumbnailBytes = makeAsset('excessive-thumbnail-bytes');
    const largeThumbnailBlob = new NodeBlob(
      [new Uint8Array(CUSTOM_DESIGN_MAX_THUMBNAIL_BYTES + 1)],
      { type: 'image/webp' },
    ) as unknown as Blob;
    excessiveThumbnailBytes.thumbnailBlob = largeThumbnailBlob;
    if (excessiveThumbnailBytes.metadata.thumbnail) {
      excessiveThumbnailBytes.metadata.thumbnail.byteSize =
        largeThumbnailBlob.size;
    }
    await expect(
      repository.stage(excessiveThumbnailBytes),
    ).rejects.toMatchObject({ code: 'invalid_asset' });

    const zeroThumbnail = makeAsset('zero-thumbnail');
    const emptyThumbnailBlob = new NodeBlob([], {
      type: 'image/webp',
    }) as unknown as Blob;
    zeroThumbnail.thumbnailBlob = emptyThumbnailBlob;
    if (zeroThumbnail.metadata.thumbnail) {
      zeroThumbnail.metadata.thumbnail.byteSize = 0;
    }
    await expect(repository.stage(zeroThumbnail)).rejects.toMatchObject({
      code: 'invalid_asset',
    });

    const unexpectedThumbnailMime = makeAsset('unexpected-thumbnail-mime');
    const gifThumbnailBlob = new NodeBlob(['gif'], {
      type: 'image/gif',
    }) as unknown as Blob;
    unexpectedThumbnailMime.thumbnailBlob = gifThumbnailBlob;
    if (unexpectedThumbnailMime.metadata.thumbnail) {
      unexpectedThumbnailMime.metadata.thumbnail.byteSize =
        gifThumbnailBlob.size;
      unexpectedThumbnailMime.metadata.thumbnail.mimeType =
        'image/gif' as 'image/webp';
    }
    await expect(
      repository.stage(unexpectedThumbnailMime),
    ).rejects.toMatchObject({ code: 'invalid_asset' });
    repository.close();
  });

  it('discards only staged records and reports missing commit states', async () => {
    const indexedDB = new IDBFactory();
    const dbName = 'discard';
    const repository = new IndexedDbAssetRepository({
      dbName,
      indexedDB,
    });
    await repository.stage(makeAsset('staged'));
    expect(await repository.discard('staged')).toBe(true);
    for (const storeName of [
      CUSTOM_DESIGN_ASSET_STORE_NAME,
      CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
      CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
    ]) {
      expect(await hasRawKey(indexedDB, dbName, storeName, 'staged')).toBe(false);
    }
    expect(await repository.discard('staged')).toBe(false);
    await expect(repository.commit('staged')).rejects.toMatchObject({
      code: 'not_found',
    });

    await repository.stage(makeAsset('committed'));
    await repository.commit('committed');
    expect(await repository.discard('committed')).toBe(false);
    expect(await repository.has('committed')).toBe(true);
    await expect(repository.commit('committed')).rejects.toMatchObject({
      code: 'not_staged',
    });
    expect(await repository.delete('committed')).toBe(true);
    for (const storeName of [
      CUSTOM_DESIGN_ASSET_STORE_NAME,
      CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
      CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
    ]) {
      expect(await hasRawKey(indexedDB, dbName, storeName, 'committed')).toBe(
        false,
      );
    }
    repository.close();
  });

  it('rejects and preserves an old-schema record on read', async () => {
    const indexedDB = new IDBFactory();
    const dbName = 'old-schema-read';
    const repository = new IndexedDbAssetRepository({ dbName, indexedDB });
    await repository.stage(makeAsset('old'));
    await repository.commit('old');
    const record = await readRawRecord(indexedDB, dbName, 'old');
    record.schemaVersion = 0;
    await writeRawRecord(indexedDB, dbName, record);

    await expect(repository.get('old')).rejects.toMatchObject({
      code: 'invalid_asset',
    });
    expect((await readRawRecord(indexedDB, dbName, 'old')).schemaVersion).toBe(0);
    repository.close();
  });

  it('validates every summary during list and preserves malformed metadata', async () => {
    const indexedDB = new IDBFactory();
    const dbName = 'corrupt-list';
    const repository = new IndexedDbAssetRepository({ dbName, indexedDB });
    for (const id of ['valid', 'corrupt']) {
      await repository.stage(makeAsset(id));
      await repository.commit(id);
    }
    const record = await readRawRecord(indexedDB, dbName, 'corrupt');
    const metadata = record.metadata as Record<string, unknown>;
    metadata.width = 'not-a-width';
    await writeRawRecord(indexedDB, dbName, record);

    await expect(repository.list()).rejects.toMatchObject({
      code: 'invalid_asset',
    });
    expect(
      (
        (await readRawRecord(indexedDB, dbName, 'corrupt'))
          .metadata as Record<string, unknown>
      ).width,
    ).toBe(
      'not-a-width',
    );
    repository.close();
  });

  it('validates original blob records during full get and preserves corruption', async () => {
    const indexedDB = new IDBFactory();
    const dbName = 'corrupt-original';
    const repository = new IndexedDbAssetRepository({ dbName, indexedDB });
    await repository.stage(makeAsset('corrupt-original'));
    await repository.commit('corrupt-original');
    const record = await readRawRecord(
      indexedDB,
      dbName,
      'corrupt-original',
      CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
    );
    record.blob = 'not-a-blob';
    await writeRawRecord(
      indexedDB,
      dbName,
      record,
      CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
    );

    await expect(repository.get('corrupt-original')).rejects.toMatchObject({
      code: 'invalid_asset',
    });
    expect(
      (
        await readRawRecord(
          indexedDB,
          dbName,
          'corrupt-original',
          CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
        )
      ).blob,
    ).toBe('not-a-blob');
    repository.close();
  });

  it('rejects corrupt ArrayBuffer bytes or MIME without deleting the record', async () => {
    const indexedDB = new IDBFactory();
    const dbName = 'corrupt-array-buffer';
    const repository = new IndexedDbAssetRepository({ dbName, indexedDB });
    const probe = interceptBinaryWrites({
      blobError: new DOMException(
        'BlobURLs are not yet supported',
        'DataCloneError',
      ),
    });
    try {
      await repository.stage(makeAsset('corrupt-buffer'));
      await repository.commit('corrupt-buffer');
    } finally {
      probe.restore();
    }

    const record = await readRawRecord(
      indexedDB,
      dbName,
      'corrupt-buffer',
      CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
    );
    record.mimeType = 'image/jpeg';
    record.data = new Uint8Array([1, 2, 3]).buffer;
    await writeRawRecord(
      indexedDB,
      dbName,
      record,
      CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
    );

    await expect(repository.get('corrupt-buffer')).rejects.toMatchObject({
      code: 'invalid_asset',
    });
    expect(
      (
        await readRawRecord(
          indexedDB,
          dbName,
          'corrupt-buffer',
          CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
        )
      ).storageKind,
    ).toBe('array_buffer');
    repository.close();
  });

  it('validates a staged record before commit and preserves invalid state', async () => {
    const indexedDB = new IDBFactory();
    const dbName = 'corrupt-commit';
    const repository = new IndexedDbAssetRepository({ dbName, indexedDB });
    await repository.stage(makeAsset('invalid-state'));
    const record = await readRawRecord(indexedDB, dbName, 'invalid-state');
    record.state = 'unknown';
    await writeRawRecord(indexedDB, dbName, record);

    await expect(repository.commit('invalid-state')).rejects.toMatchObject({
      code: 'invalid_asset',
    });
    expect((await readRawRecord(indexedDB, dbName, 'invalid-state')).state).toBe(
      'unknown',
    );
    repository.close();
  });

  it('rejects persisted thumbnail correspondence corruption without deleting it', async () => {
    const indexedDB = new IDBFactory();
    const dbName = 'corrupt-thumbnail';
    const repository = new IndexedDbAssetRepository({ dbName, indexedDB });
    await repository.stage(makeAsset('thumbnail'));
    await repository.commit('thumbnail');
    const record = await readRawRecord(
      indexedDB,
      dbName,
      'thumbnail',
      CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
    );
    record.blob = new NodeBlob(['wrong'], {
      type: 'image/jpeg',
    }) as unknown as Blob;
    await writeRawRecord(
      indexedDB,
      dbName,
      record,
      CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
    );

    await expect(repository.getThumbnail('thumbnail')).rejects.toMatchObject({
      code: 'invalid_asset',
    });
    expect(
      (
        await readRawRecord(
          indexedDB,
          dbName,
          'thumbnail',
          CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
        )
      ).blob,
    ).toBeDefined();
    repository.close();
  });

  it('clears all records and can delete and recreate its versioned database', async () => {
    const indexedDB = new IDBFactory();
    const dbName = 'reset';
    const repository = new IndexedDbAssetRepository({
      dbName,
      indexedDB,
    });
    await repository.stage(makeAsset('first'));
    await repository.commit('first');
    await repository.stage(makeAsset('staged'));
    expect(await repository.clear()).toBe(2);
    expect(await repository.list({ includeStaged: true })).toEqual([]);
    for (const storeName of [
      CUSTOM_DESIGN_ASSET_STORE_NAME,
      CUSTOM_DESIGN_ORIGINAL_BLOB_STORE_NAME,
      CUSTOM_DESIGN_THUMBNAIL_BLOB_STORE_NAME,
    ]) {
      expect(await hasRawKey(indexedDB, dbName, storeName, 'first')).toBe(false);
      expect(await hasRawKey(indexedDB, dbName, storeName, 'staged')).toBe(false);
    }

    await repository.stage(makeAsset('second'));
    await repository.commit('second');
    await repository.deleteDatabase();
    expect(await repository.get('second')).toBeNull();
    repository.close();
  });

  it('drops a closed handle after an external database reset and reopens safely', async () => {
    const indexedDB = new IDBFactory();
    const repository = new IndexedDbAssetRepository({
      dbName: 'version-change',
      indexedDB,
    });
    expect(await repository.has('missing')).toBe(false);

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('version-change');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Database reset was blocked.'));
    });

    expect(await repository.has('missing')).toBe(false);
    await repository.stage(makeAsset('after-reset'));
    await repository.commit('after-reset');
    expect(await repository.has('after-reset')).toBe(true);
    repository.close();
  });

  it('returns explicit ready, missing, and error resolution states', async () => {
    const repository = new IndexedDbAssetRepository({
      dbName: 'resolution',
      indexedDB: new IDBFactory(),
    });
    await repository.stage(makeAsset('ready'));
    await repository.commit('ready');
    expect(await resolveStoredAsset(repository, 'ready')).toMatchObject({
      status: 'ready',
    });
    expect(await resolveStoredAsset(repository, 'missing')).toEqual({
      status: 'missing',
    });

    const failing = {
      get: vi.fn().mockRejectedValue(new Error('denied')),
    } as unknown as AssetRepository;
    expect(await resolveStoredAsset(failing, 'denied')).toMatchObject({
      error: expect.any(Error),
      status: 'error',
    });
    repository.close();
  });

  it('keeps document-facing metadata serializable without image bytes', () => {
    const metadataJson = JSON.stringify(makeAsset('manifest-only').metadata);
    expect(metadataJson).toContain('manifest-only.png');
    expect(metadataJson).not.toContain('original-manifest-only');
    expect(metadataJson).not.toContain('data:image');
  });

  it('exposes typed quota, storage-denial, blocked, and closed failures', async () => {
    expect(
      toAssetStorageError(
        new DOMException('full', 'QuotaExceededError'),
        'fallback',
      ),
    ).toMatchObject({ code: 'quota_exceeded' });
    expect(
      toAssetStorageError(new DOMException('denied', 'SecurityError'), 'fallback'),
    ).toMatchObject({ code: 'security' });

    const blockedRequest = {} as IDBOpenDBRequest;
    const blockedFactory = {
      open: vi.fn(() => {
        queueMicrotask(() =>
          blockedRequest.onblocked?.(
            {
              newVersion: 1,
              oldVersion: 0,
              type: 'blocked',
            } as IDBVersionChangeEvent,
          ),
        );
        return blockedRequest;
      }),
    } as unknown as IDBFactory;
    const blockedRepository = new IndexedDbAssetRepository({
      dbName: 'blocked',
      indexedDB: blockedFactory,
    });
    await expect(blockedRepository.has('asset')).rejects.toMatchObject({
      code: 'blocked',
    });

    const closedRepository = new IndexedDbAssetRepository({
      dbName: 'closed',
      indexedDB: new IDBFactory(),
    });
    closedRepository.close();
    await expect(closedRepository.has('asset')).rejects.toEqual(
      expect.objectContaining<Partial<AssetStorageError>>({ code: 'closed' }),
    );
  });
});
