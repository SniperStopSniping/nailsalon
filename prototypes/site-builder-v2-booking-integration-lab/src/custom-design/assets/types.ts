import { CUSTOM_DESIGN_SUPPORTED_MIME_TYPES } from '../model/constants';
import type { CustomDesignMimeType } from '../model/types';

export const CUSTOM_DESIGN_ASSET_SCHEMA_VERSION = 1 as const;
export const CUSTOM_DESIGN_MAX_THUMBNAIL_BYTES = 1024 * 1024;
export const CUSTOM_DESIGN_THUMBNAIL_MAX_EDGE_PX = 320;

export const SUPPORTED_IMAGE_MIME_TYPES = CUSTOM_DESIGN_SUPPORTED_MIME_TYPES;

export type SupportedImageMimeType = CustomDesignMimeType;

export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type ImageAssetThumbnailMetadata = {
  byteSize: number;
  height: number;
  mimeType: SupportedImageMimeType;
  width: number;
};

export type ImageAssetMetadata = {
  aspectRatio: number;
  byteSize: number;
  createdAt: string;
  fileName: string;
  height: number;
  id: string;
  mimeType: SupportedImageMimeType;
  orientation: ExifOrientation;
  thumbnail?: ImageAssetThumbnailMetadata;
  width: number;
};

export type PreparedImageAsset = {
  blob: Blob;
  metadata: ImageAssetMetadata;
  thumbnailBlob?: Blob;
};

export type AssetRecordState = 'committed' | 'staged';

export type StoredImageAsset = PreparedImageAsset & {
  stagedAt: string;
  state: AssetRecordState;
};

export type ImageAssetSummary = {
  metadata: ImageAssetMetadata;
  stagedAt: string;
  state: AssetRecordState;
};

export type AssetListOptions = {
  includeStaged?: boolean;
};

export type AssetReadOptions = {
  includeStaged?: boolean;
};

export type AssetRepository = {
  clear: () => Promise<number>;
  close: () => void;
  commit: (assetId: string) => Promise<ImageAssetMetadata>;
  /**
   * Makes every supplied staged asset visible in one IndexedDB transaction.
   * The operation is all-or-nothing and preserves the caller's ID order.
   */
  commitBatch: (
    assetIds: readonly string[],
  ) => Promise<ImageAssetMetadata[]>;
  delete: (assetId: string) => Promise<boolean>;
  deleteDatabase: () => Promise<void>;
  discard: (assetId: string) => Promise<boolean>;
  get: (
    assetId: string,
    options?: AssetReadOptions,
  ) => Promise<StoredImageAsset | null>;
  getMetadata: (
    assetId: string,
    options?: AssetReadOptions,
  ) => Promise<ImageAssetMetadata | null>;
  getOriginal: (
    assetId: string,
    options?: AssetReadOptions,
  ) => Promise<Blob | null>;
  getThumbnail: (
    assetId: string,
    options?: AssetReadOptions,
  ) => Promise<Blob | null>;
  has: (assetId: string, options?: AssetReadOptions) => Promise<boolean>;
  list: (options?: AssetListOptions) => Promise<ImageAssetSummary[]>;
  stage: (asset: PreparedImageAsset) => Promise<ImageAssetMetadata>;
};

export type AssetResolution =
  | { asset: StoredImageAsset; status: 'ready' }
  | { status: 'missing' }
  | { error: Error; status: 'error' };
