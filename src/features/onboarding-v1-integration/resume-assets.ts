'use client';

import {
  type AssetListOptions,
  type AssetReadOptions,
  type AssetRepository,
  type ImageAssetMetadata,
  type ImageAssetSummary,
  IndexedDbAssetRepository,
  type PreparedImageAsset,
  type StoredImageAsset,
} from '../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/assets';
import type { SavedPreviewMediaRecord } from './saved-preview';
import { SavedPreviewAssetRepository } from './saved-preview-assets';

/**
 * Read-through account media plus writable device-local media for a resumed
 * draft. Existing revision bytes stay server-owned; newly selected files use
 * the accepted IndexedDB repository until the next idempotent claim.
 */
export class ResumedOnboardingAssetRepository implements AssetRepository {
  private readonly local: AssetRepository;
  private readonly remote: SavedPreviewAssetRepository;
  private readonly remoteAssetIdByLogicalId: ReadonlyMap<string, string>;

  constructor(
    media: readonly SavedPreviewMediaRecord[],
    local: AssetRepository = new IndexedDbAssetRepository(),
  ) {
    this.local = local;
    this.remote = new SavedPreviewAssetRepository(media);
    this.remoteAssetIdByLogicalId = new Map(
      media
        .filter(item => (
          item.role === 'custom_design'
          && item.publicUrl === `/api/onboarding/v1/media/${encodeURIComponent(item.assetId)}`
        ))
        .map(item => [item.localItemId, item.assetId]),
    );
  }

  private remoteAssetId(logicalAssetId: string): string | undefined {
    return this.remoteAssetIdByLogicalId.get(logicalAssetId);
  }

  private withLogicalId<T extends ImageAssetMetadata>(
    metadata: T,
    logicalAssetId: string,
  ): T {
    return { ...metadata, id: logicalAssetId };
  }

  private async remoteMetadata(
    logicalAssetId: string,
    options?: AssetReadOptions,
  ): Promise<ImageAssetMetadata | null> {
    const remoteAssetId = this.remoteAssetId(logicalAssetId);
    if (!remoteAssetId) {
      return null;
    }
    const metadata = await this.remote.getMetadata(remoteAssetId, options);
    return metadata ? this.withLogicalId(metadata, logicalAssetId) : null;
  }

  clear(): Promise<number> {
    return this.local.clear();
  }

  close(): void {
    this.remote.close();
    this.local.close();
  }

  async commit(assetId: string): Promise<ImageAssetMetadata> {
    if (!this.remoteAssetId(assetId)) {
      return this.local.commit(assetId);
    }
    const metadata = await this.remoteMetadata(assetId);
    if (!metadata) {
      throw new Error('The saved website image is unavailable.');
    }
    return metadata;
  }

  async commitBatch(assetIds: readonly string[]): Promise<ImageAssetMetadata[]> {
    const localIds = assetIds.filter(assetId => !this.remoteAssetId(assetId));
    const committed = localIds.length > 0
      ? await this.local.commitBatch(localIds)
      : [];
    const localById = new Map(committed.map(item => [item.id, item]));
    return Promise.all(assetIds.map(async (assetId) => {
      const local = localById.get(assetId);
      if (local) {
        return local;
      }
      const remote = await this.remoteMetadata(assetId);
      if (!remote) {
        throw new Error('The saved website image is unavailable.');
      }
      return remote;
    }));
  }

  delete(assetId: string): Promise<boolean> {
    return this.remoteAssetId(assetId) ? Promise.resolve(false) : this.local.delete(assetId);
  }

  deleteDatabase(): Promise<void> {
    return this.local.deleteDatabase();
  }

  discard(assetId: string): Promise<boolean> {
    return this.remoteAssetId(assetId) ? Promise.resolve(false) : this.local.discard(assetId);
  }

  async get(assetId: string, options?: AssetReadOptions): Promise<StoredImageAsset | null> {
    const remoteAssetId = this.remoteAssetId(assetId);
    if (!remoteAssetId) {
      return this.local.get(assetId, options);
    }
    const stored = await this.remote.get(remoteAssetId, options);
    return stored
      ? { ...stored, metadata: this.withLogicalId(stored.metadata, assetId) }
      : null;
  }

  getMetadata(
    assetId: string,
    options?: AssetReadOptions,
  ): Promise<ImageAssetMetadata | null> {
    return this.remoteAssetId(assetId)
      ? this.remoteMetadata(assetId, options)
      : this.local.getMetadata(assetId, options);
  }

  getOriginal(assetId: string, options?: AssetReadOptions): Promise<Blob | null> {
    const remoteAssetId = this.remoteAssetId(assetId);
    return remoteAssetId
      ? this.remote.getOriginal(remoteAssetId, options)
      : this.local.getOriginal(assetId, options);
  }

  getThumbnail(assetId: string, options?: AssetReadOptions): Promise<Blob | null> {
    const remoteAssetId = this.remoteAssetId(assetId);
    return remoteAssetId
      ? this.remote.getThumbnail(remoteAssetId, options)
      : this.local.getThumbnail(assetId, options);
  }

  has(assetId: string, options?: AssetReadOptions): Promise<boolean> {
    return this.remoteAssetId(assetId)
      ? this.remoteMetadata(assetId, options).then(Boolean)
      : this.local.has(assetId, options);
  }

  async list(options?: AssetListOptions): Promise<ImageAssetSummary[]> {
    const [remote, local] = await Promise.all([
      Promise.all([...this.remoteAssetIdByLogicalId].map(async ([logicalId]) => {
        const metadata = await this.remoteMetadata(logicalId, options);
        return metadata
          ? { metadata, stagedAt: metadata.createdAt, state: 'committed' as const }
          : null;
      })),
      this.local.list(options),
    ]);
    return [...remote.flatMap(item => item ? [item] : []), ...local];
  }

  stage(asset: PreparedImageAsset): Promise<ImageAssetMetadata> {
    if (this.remoteAssetId(asset.metadata.id)) {
      return Promise.reject(new Error('Choose a new image before replacing saved media.'));
    }
    return this.local.stage(asset);
  }
}
