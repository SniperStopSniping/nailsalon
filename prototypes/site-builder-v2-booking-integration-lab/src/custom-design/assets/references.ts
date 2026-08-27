import { AssetStorageError } from './errors';
import type { AssetRepository } from './types';

export const DEFAULT_STAGED_ASSET_TTL_MS = 24 * 60 * 60 * 1000;

export type AssetReferenceSettings = {
  images: readonly { assetId: string }[];
};

export type AssetCleanupFailure = {
  assetId: string;
  error: Error;
  phase: 'confirmation' | 'delete' | 'notification';
};

export type AssetCleanupResult = {
  deleted: string[];
  failed: AssetCleanupFailure[];
  retained: string[];
};

export type DeleteUnreferencedAssetOptions = {
  /** Return true only if the asset is still absent from current + history state. */
  confirmUnreferenced: (assetId: string) => Promise<boolean>;
  /** Phase 2 uses this to invalidate a live ObjectUrlRegistry entry. */
  onDeleted?: (assetId: string) => Promise<void> | void;
};

export type StagedAssetReclamationOptions = {
  /**
   * Must be evaluated by a coordinator that serializes document/history
   * mutations. IndexedDB alone cannot make this check atomic across tabs.
   */
  confirmDiscard: (assetId: string, stagedAt: string) => Promise<boolean>;
  now?: number;
  onDiscarded?: (assetId: string) => Promise<void> | void;
  protectedAssetIds: ReadonlySet<string>;
  ttlMs?: number;
};

export type StagedAssetReclamationResult = {
  discarded: string[];
  failed: AssetCleanupFailure[];
  retained: string[];
};

export const collectReferencedAssetIds = (
  settings: readonly AssetReferenceSettings[],
): Set<string> => {
  const references = new Set<string>();
  for (const sectionSettings of settings) {
    for (const image of sectionSettings.images) {
      if (image.assetId.trim()) {
        references.add(image.assetId);
      }
    }
  }
  return references;
};

/**
 * Conservatively finds assetId fields in document/history-like snapshots. A
 * false positive retains an asset, which is safer than deleting a blob still
 * reachable through Undo or restore.
 */
export const collectReferencedAssetIdsFromSnapshots = (
  snapshots: readonly unknown[],
): Set<string> => {
  const references = new Set<string>();
  const visited = new WeakSet<object>();

  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || visited.has(value)) {
      return;
    }
    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    const record = value as Record<string, unknown>;
    if (typeof record.assetId === 'string' && record.assetId.trim()) {
      references.add(record.assetId);
    }
    for (const nested of Object.values(record)) {
      visit(nested);
    }
  };

  for (const snapshot of snapshots) {
    visit(snapshot);
  }
  return references;
};

export const mergeAssetReferenceSets = (
  ...referenceSets: readonly ReadonlySet<string>[]
): Set<string> => {
  const merged = new Set<string>();
  for (const referenceSet of referenceSets) {
    for (const assetId of referenceSet) {
      merged.add(assetId);
    }
  }
  return merged;
};

export const deleteUnreferencedAssets = async (
  repository: AssetRepository,
  references: ReadonlySet<string>,
  options: DeleteUnreferencedAssetOptions,
): Promise<AssetCleanupResult> => {
  // list() intentionally excludes staged uploads. Cleanup must never race an
  // upload transaction that has not yet been committed to document state.
  const committedAssets = await repository.list();
  const result: AssetCleanupResult = {
    deleted: [],
    failed: [],
    retained: [],
  };

  for (const asset of committedAssets) {
    const assetId = asset.metadata.id;
    if (references.has(assetId)) {
      result.retained.push(assetId);
      continue;
    }

    let confirmed = false;
    try {
      confirmed = await options.confirmUnreferenced(assetId);
    } catch (error) {
      result.failed.push({
        assetId,
        error:
          error instanceof Error
            ? error
            : new Error('Asset reference confirmation failed.'),
        phase: 'confirmation',
      });
      continue;
    }
    if (!confirmed) {
      result.retained.push(assetId);
      continue;
    }

    let deleted = false;
    try {
      // No awaited work may be inserted between the authoritative confirmation
      // above and this delete. The Phase 2 coordinator serializes mutations.
      deleted = await repository.delete(assetId);
    } catch (error) {
      result.failed.push({
        assetId,
        error:
          error instanceof Error ? error : new Error('Asset deletion failed.'),
        phase: 'delete',
      });
      continue;
    }
    if (!deleted) {
      result.retained.push(assetId);
      continue;
    }

    result.deleted.push(assetId);
    try {
      await options.onDeleted?.(assetId);
    } catch (error) {
      result.failed.push({
        assetId,
        error:
          error instanceof Error
            ? error
            : new Error('Asset deletion notification failed.'),
        phase: 'notification',
      });
    }
  }

  result.deleted.sort();
  result.failed.sort((left, right) => left.assetId.localeCompare(right.assetId));
  result.retained.sort();
  return result;
};

/**
 * Conservatively reclaims abandoned staged uploads. The caller must coordinate
 * `confirmDiscard` with document/history mutations (and, in a multi-tab Lab,
 * with its chosen cross-tab serialization strategy). This helper intentionally
 * does not claim that IndexedDB provides a document/asset transaction.
 */
export const reclaimStaleStagedAssets = async (
  repository: AssetRepository,
  options: StagedAssetReclamationOptions,
): Promise<StagedAssetReclamationResult> => {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_STAGED_ASSET_TTL_MS;
  if (!Number.isFinite(now) || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new AssetStorageError(
      'invalid_asset',
      'The staged-asset cleanup time window is invalid.',
    );
  }

  const result: StagedAssetReclamationResult = {
    discarded: [],
    failed: [],
    retained: [],
  };
  const stagedAssets = (await repository.list({ includeStaged: true })).filter(
    (asset) => asset.state === 'staged',
  );

  for (const asset of stagedAssets) {
    const assetId = asset.metadata.id;
    const stagedAtEpoch = Date.parse(asset.stagedAt);
    const expired =
      Number.isFinite(stagedAtEpoch) &&
      stagedAtEpoch <= now &&
      now - stagedAtEpoch >= ttlMs;
    if (!expired || options.protectedAssetIds.has(assetId)) {
      result.retained.push(assetId);
      continue;
    }

    let confirmed = false;
    try {
      confirmed = await options.confirmDiscard(assetId, asset.stagedAt);
    } catch (error) {
      result.failed.push({
        assetId,
        error:
          error instanceof Error
            ? error
            : new Error('Staged-asset confirmation failed.'),
        phase: 'confirmation',
      });
      continue;
    }
    if (!confirmed) {
      result.retained.push(assetId);
      continue;
    }

    let discarded = false;
    try {
      // As above, keep the final check adjacent to the destructive operation.
      discarded = await repository.discard(assetId);
    } catch (error) {
      result.failed.push({
        assetId,
        error:
          error instanceof Error
            ? error
            : new Error('Staged asset could not be discarded.'),
        phase: 'delete',
      });
      continue;
    }
    if (!discarded) {
      result.retained.push(assetId);
      continue;
    }

    result.discarded.push(assetId);
    try {
      await options.onDiscarded?.(assetId);
    } catch (error) {
      result.failed.push({
        assetId,
        error:
          error instanceof Error
            ? error
            : new Error('Staged-asset notification failed.'),
        phase: 'notification',
      });
    }
  }

  result.discarded.sort();
  result.failed.sort((left, right) => left.assetId.localeCompare(right.assetId));
  result.retained.sort();
  return result;
};
