import {
  CUSTOM_DESIGN_BACKUP_WARNING,
  CUSTOM_DESIGN_SUPPORTED_MIME_TYPES,
} from './constants';
import type {
  CustomDesignImageItem,
  CustomDesignMimeType,
  CustomDesignSettings,
  CustomDesignValidationResult,
} from './types';

export const CUSTOM_DESIGN_BACKUP_ENVELOPE_VERSION = 1 as const;
export const CUSTOM_DESIGN_ASSET_MANIFEST_VERSION = 1 as const;

export type CustomDesignAssetManifestEntry = {
  assetId: string;
  fileName: string;
  mimeType: CustomDesignMimeType;
  fileSize: number;
  width: number;
  height: number;
  imageItemIds: string[];
};

export type CustomDesignAssetManifest = {
  version: typeof CUSTOM_DESIGN_ASSET_MANIFEST_VERSION;
  assetsIncluded: false;
  warning: typeof CUSTOM_DESIGN_BACKUP_WARNING;
  assets: CustomDesignAssetManifestEntry[];
};

export type CustomDesignBackupEnvelope<TDocument = unknown> = {
  kind: 'luster_site_builder_backup';
  version: typeof CUSTOM_DESIGN_BACKUP_ENVELOPE_VERSION;
  exportedAt: string;
  document: TDocument;
  customDesignAssets: CustomDesignAssetManifest;
};

export type CustomDesignManifestResolution = {
  assetId: string;
  status: 'available' | 'missing';
  imageItemIds: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => Object.keys(value).every(key => expected.includes(key));

const containsAssetBytesOrEphemeralUrl = (
  value: unknown,
  visited = new WeakSet<object>(),
): boolean => {
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return true;
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return true;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized.startsWith('data:') || normalized.startsWith('blob:');
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (visited.has(value)) {
    return false;
  }
  visited.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    // Accessors are rejected by isJsonPortable. Never invoke them while looking
    // for bytes: backup validation must remain side-effect free.
    if (!descriptor || !('value' in descriptor)) {
      continue;
    }
    if (containsAssetBytesOrEphemeralUrl(descriptor.value, visited)) {
      return true;
    }
  }
  return false;
};

const isJsonPortable = (
  value: unknown,
  ancestors = new WeakSet<object>(),
): boolean => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'object') {
    return false;
  }
  if (containsAssetBytesOrEphemeralUrl(value)) {
    return false;
  }
  if (ancestors.has(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some(key => typeof key === 'symbol')) {
    return false;
  }
  for (
    let candidate: object | null = value;
    candidate !== null;
    candidate = Object.getPrototypeOf(candidate)
  ) {
    const toJsonDescriptor = Object.getOwnPropertyDescriptor(candidate, 'toJSON');
    if (
      toJsonDescriptor
      && (!('value' in toJsonDescriptor) || typeof toJsonDescriptor.value === 'function')
    ) {
      return false;
    }
  }

  const enumerableKeys = Object.keys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const hasOnlyEnumerableDataProperties = enumerableKeys.every((key) => {
    const descriptor = descriptors[key];
    return Boolean(descriptor?.enumerable && 'value' in descriptor);
  });
  if (!hasOnlyEnumerableDataProperties) {
    return false;
  }

  ancestors.add(value);
  const portable = Array.isArray(value)
    ? (() => {
        const isDenseArrayWithoutDroppedProperties
          = enumerableKeys.length === value.length
          && enumerableKeys.every((key, index) => key === String(index))
          && ownKeys.length === value.length + 1
          && ownKeys.includes('length');
        return isDenseArrayWithoutDroppedProperties
          && enumerableKeys.every(key =>
            isJsonPortable(descriptors[key]?.value, ancestors));
      })()
    : ownKeys.length === enumerableKeys.length
      && enumerableKeys.every(key =>
        isJsonPortable(descriptors[key]?.value, ancestors));
  ancestors.delete(value);
  return portable;
};

export const createCustomDesignAssetManifest = (
  settings: readonly CustomDesignSettings[],
): CustomDesignAssetManifest => {
  const entries = new Map<string, CustomDesignAssetManifestEntry>();
  for (const image of settings.flatMap(candidate => candidate.images)) {
    const current = entries.get(image.assetId);
    if (current) {
      if (
        current.fileName !== image.fileName
        || current.mimeType !== image.mimeType
        || current.fileSize !== image.fileSize
        || current.width !== image.width
        || current.height !== image.height
      ) {
        throw new Error(`Asset ${image.assetId} has conflicting manifest metadata.`);
      }
      if (!current.imageItemIds.includes(image.id)) {
        current.imageItemIds.push(image.id);
      }
      continue;
    }
    entries.set(image.assetId, {
      assetId: image.assetId,
      fileName: image.fileName,
      mimeType: image.mimeType,
      fileSize: image.fileSize,
      width: image.width,
      height: image.height,
      imageItemIds: [image.id],
    });
  }
  return {
    version: CUSTOM_DESIGN_ASSET_MANIFEST_VERSION,
    assetsIncluded: false,
    warning: CUSTOM_DESIGN_BACKUP_WARNING,
    assets: [...entries.values()].sort((first, second) =>
      first.assetId.localeCompare(second.assetId)),
  };
};

export const createCustomDesignBackupEnvelope = <TDocument>({
  document,
  settings,
  exportedAt = new Date().toISOString(),
}: {
  document: TDocument;
  settings: readonly CustomDesignSettings[];
  exportedAt?: string;
}): CustomDesignBackupEnvelope<TDocument> => {
  if (containsAssetBytesOrEphemeralUrl(document)) {
    throw new Error('Document contains image bytes or an ephemeral object URL.');
  }
  if (!isJsonPortable(document)) {
    throw new Error('Document contains a value that cannot be represented truthfully in JSON.');
  }
  if (!Number.isFinite(Date.parse(exportedAt))) {
    throw new TypeError('Backup exportedAt must be an ISO-compatible date.');
  }
  return {
    kind: 'luster_site_builder_backup',
    version: CUSTOM_DESIGN_BACKUP_ENVELOPE_VERSION,
    exportedAt,
    document,
    customDesignAssets: createCustomDesignAssetManifest(settings),
  };
};

export const serializeCustomDesignBackupEnvelope = <TDocument>(
  envelope: CustomDesignBackupEnvelope<TDocument>,
): string => {
  if (containsAssetBytesOrEphemeralUrl(envelope)) {
    throw new Error('Backup document contains image bytes or an ephemeral URL.');
  }
  if (!isJsonPortable(envelope)) {
    throw new Error('Backup envelope is not truthfully JSON-serializable.');
  }
  const validation = parseCustomDesignBackupEnvelope(envelope);
  if (!validation.success) {
    throw new Error(`Backup envelope is invalid: ${validation.issues.join(' ')}`);
  }
  const serialized = JSON.stringify(validation.value, null, 2);
  const roundTrip = parseCustomDesignBackupEnvelope(JSON.parse(serialized));
  if (!roundTrip.success) {
    throw new Error(`Serialized backup failed validation: ${roundTrip.issues.join(' ')}`);
  }
  return serialized;
};

const parseManifestEntry = (
  value: unknown,
): CustomDesignAssetManifestEntry | null => {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      'assetId',
      'fileName',
      'mimeType',
      'fileSize',
      'width',
      'height',
      'imageItemIds',
    ])
    || typeof value.assetId !== 'string'
    || value.assetId.length === 0
    || typeof value.fileName !== 'string'
    || value.fileName.length === 0
    || !CUSTOM_DESIGN_SUPPORTED_MIME_TYPES.includes(value.mimeType as never)
    || typeof value.fileSize !== 'number'
    || !Number.isSafeInteger(value.fileSize)
    || value.fileSize <= 0
    || typeof value.width !== 'number'
    || !Number.isSafeInteger(value.width)
    || value.width <= 0
    || typeof value.height !== 'number'
    || !Number.isSafeInteger(value.height)
    || value.height <= 0
    || !Array.isArray(value.imageItemIds)
    || value.imageItemIds.length === 0
    || !value.imageItemIds.every(id => typeof id === 'string' && id.length > 0)
  ) {
    return null;
  }
  return {
    assetId: value.assetId,
    fileName: value.fileName,
    mimeType: value.mimeType as CustomDesignMimeType,
    fileSize: value.fileSize,
    width: value.width,
    height: value.height,
    imageItemIds: [...new Set(value.imageItemIds as string[])],
  };
};

export function parseCustomDesignBackupEnvelope(value: unknown): CustomDesignValidationResult<CustomDesignBackupEnvelope> {
  const issues: string[] = [];
  const containsNonportableAssetData = containsAssetBytesOrEphemeralUrl(value);
  if (!isJsonPortable(value)) {
    return {
      success: false,
      issues: [containsNonportableAssetData
        ? 'Backup contains nonportable image bytes or an object URL.'
        : 'Backup contains a value that is not JSON-portable.'],
    };
  }
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ['kind', 'version', 'exportedAt', 'document', 'customDesignAssets'])
    || !Object.hasOwn(value, 'document')
  ) {
    return { success: false, issues: ['Backup envelope shape is invalid.'] };
  }
  if (value.kind !== 'luster_site_builder_backup') {
    issues.push('Backup kind is invalid.');
  }
  if (value.version !== CUSTOM_DESIGN_BACKUP_ENVELOPE_VERSION) {
    issues.push('Backup version is unsupported.');
  }
  if (
    typeof value.exportedAt !== 'string'
    || !Number.isFinite(Date.parse(value.exportedAt))
  ) {
    issues.push('Backup date is invalid.');
  }
  if (containsAssetBytesOrEphemeralUrl(value.document)) {
    issues.push('Backup document contains nonportable image bytes or an object URL.');
  } else if (!isJsonPortable(value.document)) {
    issues.push('Backup document contains a value that is not JSON-portable.');
  }
  const manifest = value.customDesignAssets;
  if (
    !isRecord(manifest)
    || !hasOnlyKeys(manifest, ['version', 'assetsIncluded', 'warning', 'assets'])
    || manifest.version !== CUSTOM_DESIGN_ASSET_MANIFEST_VERSION
    || manifest.assetsIncluded !== false
    || manifest.warning !== CUSTOM_DESIGN_BACKUP_WARNING
    || !Array.isArray(manifest.assets)
  ) {
    issues.push('Custom Design asset manifest is invalid.');
  }
  const assets = Array.isArray(manifest && isRecord(manifest) ? manifest.assets : null)
    ? (manifest as Record<string, unknown>).assets as unknown[]
    : [];
  const parsedAssets = assets.map(parseManifestEntry);
  if (parsedAssets.includes(null)) {
    issues.push('Custom Design asset manifest contains an invalid entry.');
  }
  const resolvedAssets = parsedAssets.filter(
    (entry): entry is CustomDesignAssetManifestEntry => entry !== null,
  );
  if (new Set(resolvedAssets.map(entry => entry.assetId)).size !== resolvedAssets.length) {
    issues.push('Custom Design asset manifest contains duplicate asset IDs.');
  }
  if (issues.length > 0 || typeof value.exportedAt !== 'string') {
    return { success: false, issues };
  }
  return {
    success: true,
    value: {
      kind: 'luster_site_builder_backup',
      version: CUSTOM_DESIGN_BACKUP_ENVELOPE_VERSION,
      exportedAt: value.exportedAt,
      document: value.document,
      customDesignAssets: {
        version: CUSTOM_DESIGN_ASSET_MANIFEST_VERSION,
        assetsIncluded: false,
        warning: CUSTOM_DESIGN_BACKUP_WARNING,
        assets: resolvedAssets,
      },
    },
  };
}

export const resolveCustomDesignAssetManifest = (
  manifest: CustomDesignAssetManifest,
  availableAssetIds: ReadonlySet<string>,
): CustomDesignManifestResolution[] => manifest.assets.map(asset => ({
  assetId: asset.assetId,
  status: availableAssetIds.has(asset.assetId) ? 'available' : 'missing',
  imageItemIds: [...asset.imageItemIds],
}));

export const imageMetadataToManifestEntry = (
  image: CustomDesignImageItem,
): CustomDesignAssetManifestEntry => ({
  assetId: image.assetId,
  fileName: image.fileName,
  mimeType: image.mimeType,
  fileSize: image.fileSize,
  width: image.width,
  height: image.height,
  imageItemIds: [image.id],
});
