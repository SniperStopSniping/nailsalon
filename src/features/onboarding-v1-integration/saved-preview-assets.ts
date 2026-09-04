'use client';

import type {
  AssetListOptions,
  AssetReadOptions,
  AssetRepository,
  ImageAssetMetadata,
  ImageAssetSummary,
  PreparedImageAsset,
  StoredImageAsset,
  SupportedImageMimeType,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/assets/types';
import type { SavedPreviewMedia } from './saved-preview';

const SUPPORTED_MIME_TYPES = new Set<SupportedImageMimeType>([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const readOnlyError = (): Error => new Error('Saved site media is read-only in Preview.');

const byteSize = (item: SavedPreviewMedia): number =>
  Math.max(1, item.fileSize ?? 1);

const dimensions = (item: SavedPreviewMedia): { height: number; width: number } => ({
  height: Math.max(1, item.height ?? 1),
  width: Math.max(1, item.width ?? 1),
});

/**
 * Read-only bridge from stable logical Custom Design IDs to tenant-authorized
 * same-origin media responses. Object URLs remain transient and are leased by
 * the accepted CustomDesignAssetProvider.
 */
export class SavedPreviewAssetRepository implements AssetRepository {
  private readonly byAssetId: ReadonlyMap<string, SavedPreviewMedia>;
  private readonly blobRequests = new Map<string, Promise<Blob | null>>();

  constructor(media: readonly SavedPreviewMedia[]) {
    this.byAssetId = new Map(
      media
        .filter(item => item.role === 'custom_design')
        .map(item => [item.assetId, item]),
    );
  }

  private metadata(item: SavedPreviewMedia): ImageAssetMetadata | null {
    if (!SUPPORTED_MIME_TYPES.has(item.mimeType as SupportedImageMimeType)) {
      return null;
    }
    const { height, width } = dimensions(item);
    return {
      aspectRatio: width / height,
      byteSize: byteSize(item),
      createdAt: '1970-01-01T00:00:00.000Z',
      fileName: item.fileName,
      height,
      id: item.assetId,
      mimeType: item.mimeType as SupportedImageMimeType,
      orientation: 1,
      width,
    };
  }

  private blob(item: SavedPreviewMedia): Promise<Blob | null> {
    const existing = this.blobRequests.get(item.assetId);
    if (existing) {
      return existing;
    }
    const request = fetch(item.publicUrl, {
      cache: 'no-store',
      credentials: 'same-origin',
    }).then(async (response) => {
      if (!response.ok) {
        return null;
      }
      const blob = await response.blob();
      return SUPPORTED_MIME_TYPES.has(blob.type as SupportedImageMimeType)
        ? blob
        : null;
    }).catch(() => null);
    this.blobRequests.set(item.assetId, request);
    return request;
  }

  clear(): Promise<number> {
    return Promise.reject(readOnlyError());
  }

  close(): void {
    this.blobRequests.clear();
  }

  commit(_assetId: string): Promise<ImageAssetMetadata> {
    return Promise.reject(readOnlyError());
  }

  commitBatch(_assetIds: readonly string[]): Promise<ImageAssetMetadata[]> {
    return Promise.reject(readOnlyError());
  }

  delete(_assetId: string): Promise<boolean> {
    return Promise.reject(readOnlyError());
  }

  deleteDatabase(): Promise<void> {
    return Promise.reject(readOnlyError());
  }

  discard(_assetId: string): Promise<boolean> {
    return Promise.reject(readOnlyError());
  }

  async get(assetId: string, _options?: AssetReadOptions): Promise<StoredImageAsset | null> {
    const item = this.byAssetId.get(assetId);
    if (!item) {
      return null;
    }
    const [blob, metadata] = await Promise.all([
      this.blob(item),
      this.getMetadata(assetId),
    ]);
    return blob && metadata
      ? {
          blob,
          metadata,
          stagedAt: metadata.createdAt,
          state: 'committed',
        }
      : null;
  }

  getMetadata(assetId: string, _options?: AssetReadOptions): Promise<ImageAssetMetadata | null> {
    const item = this.byAssetId.get(assetId);
    return Promise.resolve(item ? this.metadata(item) : null);
  }

  getOriginal(assetId: string, _options?: AssetReadOptions): Promise<Blob | null> {
    const item = this.byAssetId.get(assetId);
    return item ? this.blob(item) : Promise.resolve(null);
  }

  getThumbnail(assetId: string, _options?: AssetReadOptions): Promise<Blob | null> {
    return this.getOriginal(assetId);
  }

  async has(assetId: string, _options?: AssetReadOptions): Promise<boolean> {
    return Boolean(await this.getMetadata(assetId));
  }

  list(_options?: AssetListOptions): Promise<ImageAssetSummary[]> {
    return Promise.resolve([...this.byAssetId.values()].flatMap((item) => {
      const metadata = this.metadata(item);
      return metadata ? [{ metadata, stagedAt: metadata.createdAt, state: 'committed' as const }] : [];
    }));
  }

  stage(_asset: PreparedImageAsset): Promise<ImageAssetMetadata> {
    return Promise.reject(readOnlyError());
  }
}
