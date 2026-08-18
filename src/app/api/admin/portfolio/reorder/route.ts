import { z } from 'zod';

import { logAuditEvent } from '@/libs/auditLog';
import {
  assertPhotoIdsBelongToSalon,
  requirePortfolioAdmin,
} from '@/libs/portfolioAdminContext.server';
import { reorderPortfolioPhotos } from '@/libs/portfolioMedia.server';
import { salonPortfolioPhotoSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const reorderSchema = z.object({
  salonSlug: z.string().trim().min(1),
  orderedPhotoIds: z.array(z.string().trim().min(1)).min(1).max(500),
});

/**
 * Persist an explicit owner ordering.
 *
 * Order is not only presentation: it decides which photos stay plan-eligible
 * when an allowance shrinks, so this is how an owner chooses what survives a
 * downgrade.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: 'INVALID_BODY', message: 'A JSON body is required' } },
      { status: 400 },
    );
  }

  const parsed = reorderSchema.safeParse(body);

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

  const unique = new Set(parsed.data.orderedPhotoIds);

  if (unique.size !== parsed.data.orderedPhotoIds.length) {
    return Response.json(
      { error: { code: 'DUPLICATE_PHOTO_ID', message: 'Each photo may appear only once' } },
      { status: 400 },
    );
  }

  const { error, context } = await requirePortfolioAdmin(parsed.data.salonSlug);

  if (error) {
    return error;
  }

  const owned = await assertPhotoIdsBelongToSalon({
    salonId: context.salon.id,
    photoIds: parsed.data.orderedPhotoIds,
    table: salonPortfolioPhotoSchema,
  });

  if (!owned) {
    return Response.json(
      { error: { code: 'PHOTO_NOT_FOUND', message: 'One or more photos were not found' } },
      { status: 404 },
    );
  }

  const reordered = await reorderPortfolioPhotos({
    salonId: context.salon.id,
    orderedPhotoIds: parsed.data.orderedPhotoIds,
  });

  await logAuditEvent({
    salonId: context.salon.id,
    actorType: 'admin',
    actorId: context.actorId,
    action: 'portfolio_photos_reordered',
    entityType: 'salon_portfolio_photo',
    entityId: context.salon.id,
    metadata: { count: reordered },
  });

  return Response.json({ reordered });
}
