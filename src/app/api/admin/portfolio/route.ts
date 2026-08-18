import { z } from 'zod';

import { logAuditEvent } from '@/libs/auditLog';
import {
  isDiscoverNailLength,
  isDiscoverServiceFamily,
} from '@/libs/discoverTaxonomy';
import {
  assertPhotoIdsBelongToSalon,
  loadEligibilityContext,
  requirePortfolioAdmin,
} from '@/libs/portfolioAdminContext.server';
import {
  computePortfolioEligibility,
  type EligibilityPhoto,
  summarizeDiscoverReadiness,
} from '@/libs/portfolioEligibility';
import { getPortfolioUsage } from '@/libs/portfolioLimits.server';
import { listPortfolioPhotos, updatePortfolioPhotos } from '@/libs/portfolioMedia.server';
import { salonPortfolioPhotoSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const MAX_BATCH_PHOTOS = 200;

const batchPatchSchema = z.object({
  salonSlug: z.string().trim().min(1),
  photoIds: z.array(z.string().trim().min(1)).min(1).max(MAX_BATCH_PHOTOS),
  patch: z
    .object({
      serviceFamily: z.string().refine(isDiscoverServiceFamily, 'Unknown service family').optional(),
      nailLength: z.string().refine(isDiscoverNailLength, 'Unknown nail length').optional(),
      discoverIncluded: z.boolean().optional(),
      ownerVisible: z.boolean().optional(),
      altText: z.string().trim().max(300).nullable().optional(),
    })
    .refine(patch => Object.keys(patch).length > 0, 'At least one field is required'),
});

function toEligibilityPhoto(
  photo: typeof salonPortfolioPhotoSchema.$inferSelect,
): EligibilityPhoto {
  return {
    id: photo.id,
    sortOrder: photo.sortOrder,
    createdAt: photo.createdAt,
    ownerVisible: photo.ownerVisible,
    discoverIncluded: photo.discoverIncluded,
    serviceFamily: photo.serviceFamily,
    nailLength: photo.nailLength,
    moderationState: photo.moderationState,
    deletedAt: photo.deletedAt,
    cropX: photo.cropX,
    cropY: photo.cropY,
    cropWidth: photo.cropWidth,
    cropHeight: photo.cropHeight,
  };
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const { error, context } = await requirePortfolioAdmin(searchParams.get('salonSlug'));

  if (error) {
    return error;
  }

  const [photos, usage, eligibilityContext] = await Promise.all([
    listPortfolioPhotos(context.salon.id),
    getPortfolioUsage(context.salon.id),
    loadEligibilityContext(context.salon),
  ]);

  const eligibilityPhotos = photos.map(toEligibilityPhoto);
  const eligibility = computePortfolioEligibility(
    eligibilityPhotos,
    usage.max,
    eligibilityContext,
  );

  return Response.json({
    usage,
    readiness: summarizeDiscoverReadiness(eligibilityPhotos, usage.max, eligibilityContext),
    bookableFamilies: [...eligibilityContext.bookableFamilies].sort(),
    photos: photos.map(photo => ({
      id: photo.id,
      publicId: photo.publicId,
      imageUrl: photo.imageUrl,
      width: photo.originalWidth,
      height: photo.originalHeight,
      sortOrder: photo.sortOrder,
      ownerVisible: photo.ownerVisible,
      discoverIncluded: photo.discoverIncluded,
      serviceFamily: photo.serviceFamily,
      nailLength: photo.nailLength,
      altText: photo.altText,
      moderationState: photo.moderationState,
      crop: photo.cropX === null
        ? null
        : {
            x: Number(photo.cropX),
            y: Number(photo.cropY),
            width: Number(photo.cropWidth),
            height: Number(photo.cropHeight),
            focalX: photo.focalX === null ? null : Number(photo.focalX),
            focalY: photo.focalY === null ? null : Number(photo.focalY),
          },
      eligibility: eligibility.get(photo.id) ?? null,
    })),
  });
}

/**
 * Batch tagging.
 *
 * One request applies one patch to many photos: an owner with 30-75 photos
 * must not tag them one at a time. Ids that do not belong to this salon cause
 * the whole request to fail rather than being silently skipped, so a caller
 * cannot probe another tenant's ids by watching partial success.
 */
export async function PATCH(request: Request): Promise<Response> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: 'INVALID_BODY', message: 'A JSON body is required' } },
      { status: 400 },
    );
  }

  const parsed = batchPatchSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: parsed.error.issues[0]?.message ?? 'Invalid request',
        },
      },
      { status: 400 },
    );
  }

  const { error, context } = await requirePortfolioAdmin(parsed.data.salonSlug);

  if (error) {
    return error;
  }

  const owned = await assertPhotoIdsBelongToSalon({
    salonId: context.salon.id,
    photoIds: parsed.data.photoIds,
    table: salonPortfolioPhotoSchema,
  });

  if (!owned) {
    return Response.json(
      { error: { code: 'PHOTO_NOT_FOUND', message: 'One or more photos were not found' } },
      { status: 404 },
    );
  }

  const updated = await updatePortfolioPhotos({
    salonId: context.salon.id,
    photoIds: parsed.data.photoIds,
    patch: parsed.data.patch,
  });

  await logAuditEvent({
    salonId: context.salon.id,
    actorType: 'admin',
    actorId: context.actorId,
    action: 'portfolio_photos_updated',
    entityType: 'salon_portfolio_photo',
    entityId: context.salon.id,
    metadata: { count: updated, fields: Object.keys(parsed.data.patch) },
  });

  return Response.json({ updated });
}
