import 'server-only';

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db, usesRuntimePostgres } from '@/libs/DB';
import type { DiscoverNailLength, DiscoverServiceFamily } from '@/libs/discoverTaxonomy';
import {
  PortfolioLimitError,
  resolvePortfolioAllowance,
  UNLIMITED_PORTFOLIO_PHOTOS,
} from '@/libs/portfolioLimits';
import {
  countStoredPortfolioPhotos,
  getPortfolioAllowance,
} from '@/libs/portfolioLimits.server';
import {
  type SalonPlan,
  salonPortfolioPhotoSchema,
  salonSchema,
} from '@/models/Schema';

/**
 * Portfolio media writes.
 *
 * Every mutation here is tenant-scoped by construction: each statement carries
 * `salon_id` alongside the row id, so a caller holding another salon's photo id
 * changes nothing. Public ids are addressing, never authorization.
 */

export const PUBLICATION_RIGHTS_VERSION = 'portfolio_publication_rights_v1';
export const PUBLICATION_RIGHTS_TEXT
  = 'I confirm I have permission to publicly display this image.';

function portfolioSlotLockKey(salonId: string): string {
  return `luster:portfolio-slot:${salonId}`;
}

/**
 * Serialize slot claims for one salon.
 *
 * A count-then-insert without this is exactly the race the existing technician
 * limit still has: two concurrent uploads both read `max - 1` and both succeed.
 * The advisory lock is transaction-scoped, so it releases on commit or
 * rollback with no cleanup path to forget.
 *
 * PGlite runs a single connection and cannot interleave transactions, so the
 * lock is a no-op there — the same carve-out `integrationOutbox` uses. The real
 * proof therefore lives in the Postgres concurrency suite, not in unit tests.
 */
async function lockPortfolioSlots(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  salonId: string,
): Promise<void> {
  if (!usesRuntimePostgres) {
    return;
  }

  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${portfolioSlotLockKey(salonId)}, 0))`,
  );
}

export type CreatePortfolioPhotoInput = {
  salonId: string;
  locationId: string | null;
  technicianId: string | null;
  cloudinaryPublicId: string;
  imageUrl: string;
  originalWidth: number;
  originalHeight: number;
  mimeType: string;
  fileSizeBytes: number;
  altText: string | null;
  /** Actor id recorded as durable publication-rights evidence. */
  publicationRightsConfirmedBy: string;
};

/**
 * Insert one portfolio photo, enforcing the stored-photo allowance atomically.
 *
 * Throws `PortfolioLimitError` when the salon is at or over its allowance. The
 * caller is responsible for removing the uploaded Cloudinary object when this
 * throws — no active record is created, so a rejected upload must not leave an
 * orphaned asset behind.
 */
export async function createPortfolioPhoto(
  input: CreatePortfolioPhotoInput,
): Promise<{ id: string; publicId: string }> {
  return db.transaction(async (tx) => {
    await lockPortfolioSlots(tx, input.salonId);

    const [salon] = await tx
      .select({
        plan: salonSchema.plan,
        maxPortfolioPhotos: salonSchema.maxPortfolioPhotos,
      })
      .from(salonSchema)
      .where(eq(salonSchema.id, input.salonId))
      .limit(1);

    if (!salon) {
      throw new PortfolioLimitError({ stored: 0, max: 0, plan: 'free' });
    }

    const allowance = resolvePortfolioAllowance({
      plan: salon.plan as SalonPlan | null,
      maxPortfolioPhotos: salon.maxPortfolioPhotos,
    });

    if (allowance.max !== UNLIMITED_PORTFOLIO_PHOTOS) {
      const [countRow] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(salonPortfolioPhotoSchema)
        .where(
          and(
            eq(salonPortfolioPhotoSchema.salonId, input.salonId),
            isNull(salonPortfolioPhotoSchema.deletedAt),
          ),
        );

      const stored = Number(countRow?.count ?? 0);

      if (stored >= allowance.max) {
        throw new PortfolioLimitError({
          stored,
          max: allowance.max,
          plan: allowance.plan,
        });
      }
    }

    const [maxOrder] = await tx
      .select({ value: sql<number>`coalesce(max(${salonPortfolioPhotoSchema.sortOrder}), -1)` })
      .from(salonPortfolioPhotoSchema)
      .where(
        and(
          eq(salonPortfolioPhotoSchema.salonId, input.salonId),
          isNull(salonPortfolioPhotoSchema.deletedAt),
        ),
      );

    const id = nanoid();
    const publicId = nanoid(16);

    await tx.insert(salonPortfolioPhotoSchema).values({
      id,
      publicId,
      salonId: input.salonId,
      locationId: input.locationId,
      technicianId: input.technicianId,
      cloudinaryPublicId: input.cloudinaryPublicId,
      imageUrl: input.imageUrl,
      originalWidth: input.originalWidth,
      originalHeight: input.originalHeight,
      mimeType: input.mimeType,
      fileSizeBytes: input.fileSizeBytes,
      sortOrder: Number(maxOrder?.value ?? -1) + 1,
      altText: input.altText,
      publicationRightsConfirmedAt: new Date(),
      publicationRightsConfirmedBy: input.publicationRightsConfirmedBy,
      publicationRightsVersion: PUBLICATION_RIGHTS_VERSION,
    });

    return { id, publicId };
  });
}

/**
 * Fast, non-authoritative pre-check used before handing out an upload
 * signature. Failing here saves a pointless round trip to Cloudinary; the
 * authoritative decision is still made under lock in `createPortfolioPhoto`.
 */
export async function canAcceptPortfolioUpload(salonId: string): Promise<{
  allowed: boolean;
  stored: number;
  max: number;
  plan: SalonPlan;
}> {
  const [allowance, stored] = await Promise.all([
    getPortfolioAllowance(salonId),
    countStoredPortfolioPhotos(salonId),
  ]);

  return {
    allowed: allowance.max === UNLIMITED_PORTFOLIO_PHOTOS || stored < allowance.max,
    stored,
    max: allowance.max,
    plan: allowance.plan,
  };
}

export async function listPortfolioPhotos(salonId: string) {
  return db
    .select()
    .from(salonPortfolioPhotoSchema)
    .where(
      and(
        eq(salonPortfolioPhotoSchema.salonId, salonId),
        isNull(salonPortfolioPhotoSchema.deletedAt),
      ),
    )
    .orderBy(
      asc(salonPortfolioPhotoSchema.sortOrder),
      asc(salonPortfolioPhotoSchema.createdAt),
      asc(salonPortfolioPhotoSchema.id),
    );
}

export type PortfolioPhotoPatch = {
  serviceFamily?: DiscoverServiceFamily;
  nailLength?: DiscoverNailLength;
  discoverIncluded?: boolean;
  ownerVisible?: boolean;
  altText?: string | null;
  locationId?: string | null;
  technicianId?: string | null;
};

/**
 * Apply one patch to many photos in a single statement — the batch-tagging
 * primitive. An owner with 30-75 photos must not tag them one at a time.
 *
 * Scoped by `salonId` as well as id, so ids belonging to another tenant simply
 * match nothing.
 */
export async function updatePortfolioPhotos({
  salonId,
  photoIds,
  patch,
}: {
  salonId: string;
  photoIds: string[];
  patch: PortfolioPhotoPatch;
}): Promise<number> {
  if (photoIds.length === 0 || Object.keys(patch).length === 0) {
    return 0;
  }

  const updated = await db
    .update(salonPortfolioPhotoSchema)
    .set(patch)
    .where(
      and(
        eq(salonPortfolioPhotoSchema.salonId, salonId),
        inArray(salonPortfolioPhotoSchema.id, photoIds),
        isNull(salonPortfolioPhotoSchema.deletedAt),
      ),
    )
    .returning();

  return updated.length;
}

export type PortfolioCrop = {
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  focalX: number | null;
  focalY: number | null;
};

export async function setPortfolioPhotoCrop({
  salonId,
  photoId,
  crop,
}: {
  salonId: string;
  photoId: string;
  crop: PortfolioCrop;
}): Promise<boolean> {
  const updated = await db
    .update(salonPortfolioPhotoSchema)
    .set({
      cropX: crop.cropX.toFixed(5),
      cropY: crop.cropY.toFixed(5),
      cropWidth: crop.cropWidth.toFixed(5),
      cropHeight: crop.cropHeight.toFixed(5),
      focalX: crop.focalX === null ? null : crop.focalX.toFixed(5),
      focalY: crop.focalY === null ? null : crop.focalY.toFixed(5),
    })
    .where(
      and(
        eq(salonPortfolioPhotoSchema.salonId, salonId),
        eq(salonPortfolioPhotoSchema.id, photoId),
        isNull(salonPortfolioPhotoSchema.deletedAt),
      ),
    )
    .returning();

  return updated.length > 0;
}

/**
 * Persist an explicit owner ordering.
 *
 * Order is load-bearing beyond presentation: it decides which photos stay
 * plan-eligible when an allowance shrinks, which is how an owner chooses what
 * survives a downgrade.
 */
export async function reorderPortfolioPhotos({
  salonId,
  orderedPhotoIds,
}: {
  salonId: string;
  orderedPhotoIds: string[];
}): Promise<number> {
  if (orderedPhotoIds.length === 0) {
    return 0;
  }

  return db.transaction(async (tx) => {
    let applied = 0;

    for (const [index, photoId] of orderedPhotoIds.entries()) {
      const updated = await tx
        .update(salonPortfolioPhotoSchema)
        .set({ sortOrder: index })
        .where(
          and(
            eq(salonPortfolioPhotoSchema.salonId, salonId),
            eq(salonPortfolioPhotoSchema.id, photoId),
            isNull(salonPortfolioPhotoSchema.deletedAt),
          ),
        )
        .returning();

      applied += updated.length;
    }

    return applied;
  });
}

/**
 * Soft-delete. The row is retained for auditability but stops consuming
 * allowance immediately, so deleting always frees capacity.
 */
export async function deletePortfolioPhoto({
  salonId,
  photoId,
}: {
  salonId: string;
  photoId: string;
}): Promise<{ cloudinaryPublicId: string } | null> {
  const [deleted] = await db
    .update(salonPortfolioPhotoSchema)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(salonPortfolioPhotoSchema.salonId, salonId),
        eq(salonPortfolioPhotoSchema.id, photoId),
        isNull(salonPortfolioPhotoSchema.deletedAt),
      ),
    )
    .returning();

  return deleted ? { cloudinaryPublicId: deleted.cloudinaryPublicId } : null;
}
