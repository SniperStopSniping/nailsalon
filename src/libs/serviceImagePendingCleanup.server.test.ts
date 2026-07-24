import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  deletePendingServiceImageAssetById,
  listPendingServiceImageAssetsPage,
  loadPendingServiceImageAsset,
  markCloudinaryServiceImageActive,
  serviceImageUrlReferencesManagedPublicId,
  selectWhere,
  setReferences,
} = vi.hoisted(() => {
  let references: unknown[] = [];
  const selectWhere = vi.fn(async () => references);

  return {
    deletePendingServiceImageAssetById: vi.fn(),
    listPendingServiceImageAssetsPage: vi.fn(),
    loadPendingServiceImageAsset: vi.fn(),
    markCloudinaryServiceImageActive: vi.fn(),
    serviceImageUrlReferencesManagedPublicId: vi.fn(),
    selectWhere,
    setReferences: (nextReferences: unknown[]) => {
      references = nextReferences;
    },
  };
});

vi.mock('@/core/logging/logger', () => ({
  logWarn: vi.fn(),
}));
vi.mock('@/libs/DB', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: selectWhere,
      })),
    })),
  },
}));
vi.mock('@/libs/serviceImageStorage.server', () => ({
  deletePendingServiceImageAssetById,
  listPendingServiceImageAssetsPage,
  loadPendingServiceImageAsset,
  markCloudinaryServiceImageActive,
  serviceImageUrlReferencesManagedPublicId,
}));

/* eslint-disable import/first */
import {
  cleanupPendingServiceImages,
  SERVICE_IMAGE_PENDING_ACTION_CONCURRENCY,
  SERVICE_IMAGE_PENDING_MAX_ACTIONS,
  SERVICE_IMAGE_PENDING_MAX_PAGES,
  SERVICE_IMAGE_PENDING_PAGE_SIZE,
} from './serviceImagePendingCleanup.server';
/* eslint-enable import/first */

const now = new Date('2026-07-23T18:00:00.000Z');

function asset(index: number, override: Partial<{
  assetId: string;
  publicId: string;
  salonId: string;
  serviceId: string;
  resourceType: 'image' | 'video' | 'raw';
  deliveryType: string;
  bytes: number;
  createdAt: Date;
}> = {}) {
  const salonId = override.salonId ?? `salon_${index}`;
  const serviceId = override.serviceId ?? `svc_${index}`;
  const resourceType = override.resourceType ?? 'image';
  const publicId = override.publicId
    ?? `salons/${salonId}/services/service_${serviceId}_AbCdEfGhIjKlMnOp_jpg`;

  return {
    assetId: override.assetId ?? `asset_${resourceType}_${index}`,
    publicId,
    salonId,
    serviceId,
    resourceType,
    deliveryType: override.deliveryType ?? 'upload',
    bytes: override.bytes ?? 1000,
    createdAt: override.createdAt
      ?? new Date('2026-07-23T16:00:00.000Z'),
  };
}

function imageUrlFor(
  pending: ReturnType<typeof asset>,
  version = 1,
): string {
  return `https://res.cloudinary.com/demo/image/upload/v${version}/${pending.publicId}.jpg`;
}

describe('pending service image cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setReferences([]);
    listPendingServiceImageAssetsPage.mockResolvedValue({
      assets: [],
      nextCursor: null,
      skippedUnsafe: 0,
    });
    deletePendingServiceImageAssetById.mockResolvedValue(true);
    loadPendingServiceImageAsset.mockImplementation(
      async (input: {
        assetId: string;
        publicId: string;
        salonId: string;
        serviceId: string;
      }) => ({
        ...input,
        resourceType: input.assetId.includes('_raw_')
          ? 'raw'
          : input.assetId.includes('_video_') ? 'video' : 'image',
        deliveryType: 'upload',
        createdAt: new Date('2026-07-23T16:00:00.000Z'),
      }),
    );
    markCloudinaryServiceImageActive.mockResolvedValue(true);
    serviceImageUrlReferencesManagedPublicId.mockReturnValue(false);
  });

  it('leaves finalized assets alone because the pending tag is no longer listed', async () => {
    const result = await cleanupPendingServiceImages({ now });

    expect(listPendingServiceImageAssetsPage).toHaveBeenCalledTimes(3);
    expect(loadPendingServiceImageAsset).not.toHaveBeenCalled();
    expect(deletePendingServiceImageAssetById).not.toHaveBeenCalled();
    expect(markCloudinaryServiceImageActive).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      scanned: 0,
      eligible: 0,
      actionsAttempted: 0,
      deleted: 0,
    });
  });

  it('deletes abandoned valid and oversized pending assets supplied by the validated listing helper', async () => {
    const assets = [
      asset(1),
      // Listing metadata is intentionally size-agnostic: finalization rejects
      // oversize bytes, while cleanup removes any old signed pending orphan.
      asset(2, { bytes: 5 * 1024 * 1024 + 1 }),
    ];
    listPendingServiceImageAssetsPage.mockImplementation(async (
      { resourceType }: { resourceType: 'image' | 'video' | 'raw' },
    ) => ({
      assets: assets.filter(asset => asset.resourceType === resourceType),
      nextCursor: null,
      skippedUnsafe: 0,
    }));

    const result = await cleanupPendingServiceImages({ now });

    expect(deletePendingServiceImageAssetById).toHaveBeenCalledTimes(2);
    expect(deletePendingServiceImageAssetById).toHaveBeenNthCalledWith(1, {
      assetId: assets[0]!.assetId,
      publicId: assets[0]!.publicId,
      salonId: assets[0]!.salonId,
      serviceId: assets[0]!.serviceId,
    });
    expect(result).toMatchObject({
      scanned: 2,
      eligible: 2,
      actionsAttempted: 2,
      deleted: 2,
      failures: 0,
    });
  });

  it('preserves any exact current URL reference, including a cross-salon reference, and repairs its pending tag', async () => {
    const pending = asset(1);
    listPendingServiceImageAssetsPage.mockImplementation(async (
      { resourceType }: { resourceType: string },
    ) => ({
      assets: resourceType === 'image' ? [pending] : [],
      nextCursor: null,
      skippedUnsafe: 0,
    }));
    setReferences([{
      id: 'svc_other',
      salonId: 'salon_other',
      imageUrl: imageUrlFor(pending),
    }]);
    serviceImageUrlReferencesManagedPublicId.mockReturnValue(true);

    const result = await cleanupPendingServiceImages({ now });

    expect(deletePendingServiceImageAssetById).not.toHaveBeenCalled();
    expect(markCloudinaryServiceImageActive).toHaveBeenCalledWith({
      publicId: pending.publicId,
      salonId: pending.salonId,
      serviceId: pending.serviceId,
    });
    expect(result).toMatchObject({
      referenced: 1,
      pendingCleared: 1,
      deleted: 0,
    });
  });

  it('preserves an intended service reference through version and transformation changes', async () => {
    const pending = asset(1);
    const versionedUrl = imageUrlFor(pending, 2).replace(
      '/upload/v2/',
      '/upload/c_fill,w_600/q_auto/v2/',
    );
    listPendingServiceImageAssetsPage.mockImplementation(async (
      { resourceType }: { resourceType: string },
    ) => ({
      assets: resourceType === 'image' ? [pending] : [],
      nextCursor: null,
      skippedUnsafe: 0,
    }));
    setReferences([{
      id: pending.serviceId,
      salonId: pending.salonId,
      imageUrl: versionedUrl,
    }]);
    serviceImageUrlReferencesManagedPublicId.mockReturnValue(true);

    const result = await cleanupPendingServiceImages({ now });

    expect(serviceImageUrlReferencesManagedPublicId).toHaveBeenCalledWith({
      imageUrl: versionedUrl,
      publicId: pending.publicId,
    });
    expect(deletePendingServiceImageAssetById).not.toHaveBeenCalled();
    expect(result.referenced).toBe(1);
  });

  it('does not preserve raw or video siblings that share a referenced image public id', async () => {
    const image = asset(1);
    const raw = asset(2, {
      assetId: 'asset_raw_2',
      publicId: image.publicId,
      salonId: image.salonId,
      serviceId: image.serviceId,
      resourceType: 'raw',
    });
    listPendingServiceImageAssetsPage.mockImplementation(async (
      { resourceType }: { resourceType: string },
    ) => ({
      assets: resourceType === 'image'
        ? [image]
        : resourceType === 'raw' ? [raw] : [],
      nextCursor: null,
      skippedUnsafe: 0,
    }));
    setReferences([{
      id: image.serviceId,
      salonId: image.salonId,
      imageUrl: imageUrlFor(image),
    }]);
    serviceImageUrlReferencesManagedPublicId.mockReturnValue(true);

    const result = await cleanupPendingServiceImages({ now });

    expect(markCloudinaryServiceImageActive).toHaveBeenCalledWith({
      publicId: image.publicId,
      salonId: image.salonId,
      serviceId: image.serviceId,
    });
    expect(deletePendingServiceImageAssetById).toHaveBeenCalledWith({
      assetId: raw.assetId,
      publicId: raw.publicId,
      salonId: raw.salonId,
      serviceId: raw.serviceId,
    });
    expect(result).toMatchObject({
      referenced: 1,
      deleted: 1,
    });
  });

  it('does not treat a non-upload delivery sibling as a referenced service image', async () => {
    const pending = asset(1, { deliveryType: 'authenticated' });
    listPendingServiceImageAssetsPage.mockImplementation(async (
      { resourceType }: { resourceType: string },
    ) => ({
      assets: resourceType === 'image' ? [pending] : [],
      nextCursor: null,
      skippedUnsafe: 0,
    }));
    setReferences([{
      id: pending.serviceId,
      salonId: pending.salonId,
      imageUrl: imageUrlFor(pending),
    }]);
    serviceImageUrlReferencesManagedPublicId.mockReturnValue(true);
    loadPendingServiceImageAsset.mockResolvedValueOnce({
      ...pending,
      deliveryType: 'authenticated',
    });

    const result = await cleanupPendingServiceImages({ now });

    expect(deletePendingServiceImageAssetById).toHaveBeenCalledWith({
      assetId: pending.assetId,
      publicId: pending.publicId,
      salonId: pending.salonId,
      serviceId: pending.serviceId,
    });
    expect(markCloudinaryServiceImageActive).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      referenced: 0,
      pendingCleared: 0,
      deleted: 1,
      failures: 0,
    });
  });

  it('keeps young pending uploads untouched', async () => {
    listPendingServiceImageAssetsPage.mockImplementation(async (
      { resourceType }: { resourceType: string },
    ) => ({
      assets: resourceType === 'image'
        ? [
            asset(1, {
              createdAt: new Date('2026-07-23T17:00:00.001Z'),
            }),
            asset(2, { createdAt: new Date('invalid') }),
          ]
        : [],
      nextCursor: null,
      skippedUnsafe: 0,
    }));

    const result = await cleanupPendingServiceImages({ now });

    expect(selectWhere).not.toHaveBeenCalled();
    expect(deletePendingServiceImageAssetById).not.toHaveBeenCalled();
    expect(markCloudinaryServiceImageActive).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      eligible: 0,
      skippedYoung: 1,
      skippedUnsafe: 1,
    });
  });

  it('enumerates bounded pages before mutations and caps actions and concurrency', async () => {
    const resourceTypes = ['image', 'video', 'raw'] as const;
    const pages = new Map<string, {
      assets: ReturnType<typeof asset>[];
      nextCursor: string;
      skippedUnsafe: number;
    }>();
    resourceTypes.forEach((resourceType, resourceIndex) => {
      for (
        let pageIndex = 0;
        pageIndex < SERVICE_IMAGE_PENDING_MAX_PAGES;
        pageIndex += 1
      ) {
        pages.set(`${resourceType}:${pageIndex}`, {
          assets: Array.from(
            { length: SERVICE_IMAGE_PENDING_PAGE_SIZE },
            (_, assetIndex) =>
              asset(
                (
                  resourceIndex
                  * SERVICE_IMAGE_PENDING_MAX_PAGES
                  * SERVICE_IMAGE_PENDING_PAGE_SIZE
                )
                + pageIndex * SERVICE_IMAGE_PENDING_PAGE_SIZE
                + assetIndex,
                { resourceType },
              ),
          ),
          nextCursor: `${resourceType}_cursor_${pageIndex + 1}`,
          skippedUnsafe: 0,
        });
      }
    });
    listPendingServiceImageAssetsPage.mockImplementation(
      async (
        {
          nextCursor,
          resourceType,
        }: {
          nextCursor?: string;
          resourceType: 'image' | 'video' | 'raw';
        },
      ) => {
        const pageIndex = nextCursor
          ? Number(nextCursor.split('_').at(-1))
          : 0;
        return pages.get(`${resourceType}:${pageIndex}`);
      },
    );
    let active = 0;
    let peak = 0;
    deletePendingServiceImageAssetById.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return true;
    });

    const result = await cleanupPendingServiceImages({ now });

    expect(listPendingServiceImageAssetsPage).toHaveBeenCalledTimes(
      SERVICE_IMAGE_PENDING_MAX_PAGES * resourceTypes.length,
    );
    expect(listPendingServiceImageAssetsPage).toHaveBeenNthCalledWith(1, {
      maxResults: SERVICE_IMAGE_PENDING_PAGE_SIZE,
      nextCursor: undefined,
      resourceType: 'image',
    });
    expect(listPendingServiceImageAssetsPage).toHaveBeenNthCalledWith(2, {
      maxResults: SERVICE_IMAGE_PENDING_PAGE_SIZE,
      nextCursor: 'image_cursor_1',
      resourceType: 'image',
    });
    expect(listPendingServiceImageAssetsPage).toHaveBeenNthCalledWith(
      SERVICE_IMAGE_PENDING_MAX_PAGES + 1,
      {
        maxResults: SERVICE_IMAGE_PENDING_PAGE_SIZE,
        nextCursor: undefined,
        resourceType: 'video',
      },
    );
    expect(selectWhere.mock.invocationCallOrder[0]).toBeLessThan(
      deletePendingServiceImageAssetById.mock.invocationCallOrder[0]!,
    );
    expect(loadPendingServiceImageAsset.mock.invocationCallOrder[0]).toBeLessThan(
      deletePendingServiceImageAssetById.mock.invocationCallOrder[0]!,
    );
    expect(selectWhere.mock.invocationCallOrder[1]).toBeLessThan(
      deletePendingServiceImageAssetById.mock.invocationCallOrder[0]!,
    );
    expect(deletePendingServiceImageAssetById).toHaveBeenCalledTimes(
      SERVICE_IMAGE_PENDING_MAX_ACTIONS,
    );
    expect(peak).toBeLessThanOrEqual(
      SERVICE_IMAGE_PENDING_ACTION_CONCURRENCY,
    );
    expect(result).toMatchObject({
      pagesScanned:
        SERVICE_IMAGE_PENDING_MAX_PAGES * resourceTypes.length,
      scanned: SERVICE_IMAGE_PENDING_MAX_PAGES
        * SERVICE_IMAGE_PENDING_PAGE_SIZE
        * resourceTypes.length,
      eligible: SERVICE_IMAGE_PENDING_MAX_PAGES
        * SERVICE_IMAGE_PENDING_PAGE_SIZE
        * resourceTypes.length,
      actionsAttempted: SERVICE_IMAGE_PENDING_MAX_ACTIONS,
      deleted: SERVICE_IMAGE_PENDING_MAX_ACTIONS,
      truncated: true,
    });
  });

  it('fails closed before Cloudinary mutations when database reference lookup fails', async () => {
    listPendingServiceImageAssetsPage.mockImplementation(async (
      { resourceType }: { resourceType: string },
    ) => ({
      assets: resourceType === 'image' ? [asset(1)] : [],
      nextCursor: null,
      skippedUnsafe: 0,
    }));
    selectWhere.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(cleanupPendingServiceImages({ now })).rejects.toThrow(
      'database unavailable',
    );
    expect(deletePendingServiceImageAssetById).not.toHaveBeenCalled();
    expect(markCloudinaryServiceImageActive).not.toHaveBeenCalled();
  });

  it('preserves an asset that becomes referenced during its cleanup recheck', async () => {
    const pending = asset(1);
    listPendingServiceImageAssetsPage.mockImplementation(async (
      { resourceType }: { resourceType: string },
    ) => ({
      assets: resourceType === 'image' ? [pending] : [],
      nextCursor: null,
      skippedUnsafe: 0,
    }));
    selectWhere
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'svc_other',
        salonId: 'salon_other',
        imageUrl: imageUrlFor(pending),
      }]);
    serviceImageUrlReferencesManagedPublicId.mockReturnValue(true);

    const result = await cleanupPendingServiceImages({ now });

    expect(loadPendingServiceImageAsset).toHaveBeenCalledWith({
      assetId: pending.assetId,
      publicId: pending.publicId,
      salonId: pending.salonId,
      serviceId: pending.serviceId,
    });
    expect(deletePendingServiceImageAssetById).not.toHaveBeenCalled();
    expect(markCloudinaryServiceImageActive).toHaveBeenCalledWith({
      publicId: pending.publicId,
      salonId: pending.salonId,
      serviceId: pending.serviceId,
    });
    expect(result).toMatchObject({
      referenced: 1,
      pendingCleared: 1,
      deleted: 0,
    });
  });

  it('does not delete when immutable revalidation no longer proves the pending asset', async () => {
    const pending = asset(1);
    listPendingServiceImageAssetsPage.mockImplementation(async (
      { resourceType }: { resourceType: string },
    ) => ({
      assets: resourceType === 'image' ? [pending] : [],
      nextCursor: null,
      skippedUnsafe: 0,
    }));
    loadPendingServiceImageAsset.mockResolvedValueOnce(null);

    const result = await cleanupPendingServiceImages({ now });

    expect(deletePendingServiceImageAssetById).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      deleted: 0,
      failures: 0,
      skippedUnsafe: 1,
    });
  });

  it('continues after one bounded action fails and safely reprocesses the same stale listing', async () => {
    const assets = [asset(1), asset(2)];
    listPendingServiceImageAssetsPage.mockImplementation(async (
      { resourceType }: { resourceType: string },
    ) => ({
      assets: resourceType === 'image' ? assets : [],
      nextCursor: null,
      skippedUnsafe: 0,
    }));
    deletePendingServiceImageAssetById
      .mockRejectedValueOnce(new Error('transient Cloudinary failure'))
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const first = await cleanupPendingServiceImages({ now });
    const second = await cleanupPendingServiceImages({ now });

    expect(first).toMatchObject({
      actionsAttempted: 2,
      deleted: 1,
      failures: 1,
    });
    expect(second).toMatchObject({
      actionsAttempted: 2,
      deleted: 1,
      failures: 0,
    });
    expect(deletePendingServiceImageAssetById).toHaveBeenCalledTimes(4);
  });
});
