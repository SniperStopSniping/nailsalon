import 'server-only';

import { inArray, or, sql } from 'drizzle-orm';

import { logWarn } from '@/core/logging/logger';
import { db } from '@/libs/DB';
import {
  deletePendingServiceImageAssetById,
  listPendingServiceImageAssetsPage,
  loadPendingServiceImageAsset,
  markCloudinaryServiceImageActive,
  type PendingServiceImageAsset,
  serviceImageUrlReferencesManagedPublicId,
} from '@/libs/serviceImageStorage.server';
import { serviceSchema } from '@/models/Schema';

export const SERVICE_IMAGE_PENDING_MAX_AGE_MS = 60 * 60 * 1000;
export const SERVICE_IMAGE_PENDING_PAGE_SIZE = 100;
export const SERVICE_IMAGE_PENDING_MAX_PAGES = 3;
export const SERVICE_IMAGE_PENDING_MAX_ACTIONS = 50;
export const SERVICE_IMAGE_PENDING_ACTION_CONCURRENCY = 5;

const SERVICE_IMAGE_PENDING_RESOURCE_TYPES = [
  'image',
  'video',
  'raw',
] as const;

type ServiceImageReference = {
  id: string;
  salonId: string;
  imageUrl: string | null;
};

export type ServiceImagePendingCleanupResult = {
  pagesScanned: number;
  scanned: number;
  eligible: number;
  actionsAttempted: number;
  deleted: number;
  referenced: number;
  pendingCleared: number;
  skippedYoung: number;
  skippedUnsafe: number;
  failures: number;
  truncated: boolean;
};

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

async function loadServiceImageReferences(
  assets: PendingServiceImageAsset[],
): Promise<ServiceImageReference[]> {
  const serviceIds = [...new Set(assets.map(asset => asset.serviceId))];

  if (serviceIds.length === 0) {
    return [];
  }

  // Include exact public-ID path fragments so a service in any tenant that
  // currently references the candidate is protected. The strict managed-URL
  // reference matcher below is still authoritative; strpos only bounds which
  // rows load and intentionally does not require an output extension.
  const publicIdReferenceConditions = assets.map(asset =>
    sql<boolean>`strpos(${serviceSchema.imageUrl}, ${`/${asset.publicId}`}) > 0`);

  return db
    .select({
      id: serviceSchema.id,
      salonId: serviceSchema.salonId,
      imageUrl: serviceSchema.imageUrl,
    })
    .from(serviceSchema)
    .where(
      or(
        inArray(serviceSchema.id, serviceIds),
        ...publicIdReferenceConditions,
      ),
    );
}

function referencedAssetIds(
  assets: PendingServiceImageAsset[],
  references: ServiceImageReference[],
): Set<string> {
  const assetIds = new Set<string>();

  for (const asset of assets) {
    // Service imageUrl values can reference only public image/upload assets.
    // A raw/video or non-upload sibling sharing this public ID is not active.
    const isReferenced
      = asset.resourceType === 'image'
      && asset.deliveryType === 'upload'
      && references.some(reference =>
        reference.imageUrl
        && serviceImageUrlReferencesManagedPublicId({
          imageUrl: reference.imageUrl,
          publicId: asset.publicId,
        }));

    if (isReferenced) {
      assetIds.add(asset.assetId);
    }
  }

  return assetIds;
}

async function isCurrentlyReferenced(
  asset: PendingServiceImageAsset,
): Promise<boolean> {
  const references = await loadServiceImageReferences([asset]);
  return referencedAssetIds([asset], references).has(asset.assetId);
}

export async function cleanupPendingServiceImages(args?: {
  now?: Date;
}): Promise<ServiceImagePendingCleanupResult> {
  const now = args?.now ?? new Date();
  const cutoffMs = now.getTime() - SERVICE_IMAGE_PENDING_MAX_AGE_MS;
  const result: ServiceImagePendingCleanupResult = {
    pagesScanned: 0,
    scanned: 0,
    eligible: 0,
    actionsAttempted: 0,
    deleted: 0,
    referenced: 0,
    pendingCleared: 0,
    skippedYoung: 0,
    skippedUnsafe: 0,
    failures: 0,
    truncated: false,
  };
  const eligibleAssets: PendingServiceImageAsset[] = [];

  // Enumerate every bounded page before changing tags or deleting assets.
  // Mutating a tag-backed result set while following its cursor can skip rows.
  for (const resourceType of SERVICE_IMAGE_PENDING_RESOURCE_TYPES) {
    let nextCursor: string | undefined;

    for (
      let pageIndex = 0;
      pageIndex < SERVICE_IMAGE_PENDING_MAX_PAGES;
      pageIndex += 1
    ) {
      const page = await listPendingServiceImageAssetsPage({
        maxResults: SERVICE_IMAGE_PENDING_PAGE_SIZE,
        nextCursor,
        resourceType,
      });

      result.pagesScanned += 1;
      result.scanned += page.assets.length;
      result.skippedUnsafe += page.skippedUnsafe;

      for (const asset of page.assets) {
        const createdAtMs = asset.createdAt.getTime();
        if (!Number.isFinite(createdAtMs)) {
          result.skippedUnsafe += 1;
          continue;
        }
        if (createdAtMs >= cutoffMs) {
          result.skippedYoung += 1;
          continue;
        }
        eligibleAssets.push(asset);
      }

      if (!page.nextCursor) {
        break;
      }
      nextCursor = page.nextCursor;
      if (pageIndex === SERVICE_IMAGE_PENDING_MAX_PAGES - 1) {
        result.truncated = true;
      }
    }
  }

  result.eligible = eligibleAssets.length;
  const actionCandidates = eligibleAssets.slice(
    0,
    SERVICE_IMAGE_PENDING_MAX_ACTIONS,
  );
  if (eligibleAssets.length > actionCandidates.length) {
    result.truncated = true;
  }
  if (actionCandidates.length === 0) {
    return result;
  }

  // Fail closed: a database lookup error must occur before any Cloudinary
  // mutation, because the database is authoritative for active service URLs.
  const references = await loadServiceImageReferences(actionCandidates);
  const referenced = referencedAssetIds(actionCandidates, references);

  for (
    const actionBatch of chunk(
      actionCandidates,
      SERVICE_IMAGE_PENDING_ACTION_CONCURRENCY,
    )
  ) {
    const outcomes = await Promise.all(actionBatch.map(async (asset) => {
      try {
        if (referenced.has(asset.assetId)) {
          if (
            asset.resourceType === 'image'
            && asset.deliveryType === 'upload'
          ) {
            await markCloudinaryServiceImageActive({
              publicId: asset.publicId,
              salonId: asset.salonId,
              serviceId: asset.serviceId,
            });
            return { kind: 'referenced' as const, succeeded: true };
          }
          return { kind: 'referenced' as const, succeeded: false };
        }

        // Re-read by immutable Cloudinary asset ID and revalidate the signed
        // pending metadata. Public IDs can otherwise be reused or renamed.
        const freshAsset = await loadPendingServiceImageAsset({
          assetId: asset.assetId,
          publicId: asset.publicId,
          salonId: asset.salonId,
          serviceId: asset.serviceId,
        });
        if (!freshAsset) {
          return { kind: 'skipped' as const, succeeded: true };
        }
        const freshCreatedAtMs = freshAsset.createdAt.getTime();
        if (!Number.isFinite(freshCreatedAtMs)) {
          return { kind: 'skipped' as const, succeeded: true };
        }
        if (freshCreatedAtMs >= cutoffMs) {
          return { kind: 'young' as const, succeeded: true };
        }

        // Recheck the database immediately before deletion. Cleanup only
        // considers uploads older than one hour, while finalization tokens
        // expire after 15 minutes, so no valid app finalization can race here.
        if (await isCurrentlyReferenced(freshAsset)) {
          if (
            freshAsset.resourceType === 'image'
            && freshAsset.deliveryType === 'upload'
          ) {
            await markCloudinaryServiceImageActive({
              publicId: freshAsset.publicId,
              salonId: freshAsset.salonId,
              serviceId: freshAsset.serviceId,
            });
            return { kind: 'referenced' as const, succeeded: true };
          }
          return { kind: 'referenced' as const, succeeded: false };
        }

        const deleted = await deletePendingServiceImageAssetById({
          assetId: freshAsset.assetId,
          publicId: freshAsset.publicId,
          salonId: freshAsset.salonId,
          serviceId: freshAsset.serviceId,
        });
        return deleted
          ? { kind: 'deleted' as const, succeeded: true }
          : { kind: 'skipped' as const, succeeded: true };
      } catch {
        logWarn('service_image.pending_cleanup_action_failed', {
          action: referenced.has(asset.assetId) ? 'clear_pending' : 'delete',
        });
        return { kind: 'failed' as const, succeeded: false };
      }
    }));

    for (const outcome of outcomes) {
      result.actionsAttempted += 1;
      if (outcome.kind === 'referenced') {
        result.referenced += 1;
        if (outcome.succeeded) {
          result.pendingCleared += 1;
        } else {
          result.failures += 1;
        }
      } else if (outcome.succeeded) {
        if (outcome.kind === 'deleted') {
          result.deleted += 1;
        } else if (outcome.kind === 'young') {
          result.skippedYoung += 1;
        } else {
          result.skippedUnsafe += 1;
        }
      } else {
        result.failures += 1;
      }
    }
  }

  return result;
}
