import { z } from 'zod';

import { logAuditEvent } from '@/libs/auditLog';
import { requirePortfolioAdmin } from '@/libs/portfolioAdminContext.server';
import { deletePortfolioImage } from '@/libs/portfolioImageStorage.server';
import {
  deletePortfolioPhoto,
  setPortfolioPhotoCrop,
} from '@/libs/portfolioMedia.server';

export const dynamic = 'force-dynamic';

const fraction = z.number().min(0).max(1);

const cropSchema = z.object({
  salonSlug: z.string().trim().min(1),
  crop: z
    .object({
      x: fraction,
      y: fraction,
      width: z.number().gt(0).max(1),
      height: z.number().gt(0).max(1),
      focalX: fraction.nullable().default(null),
      focalY: fraction.nullable().default(null),
    })
    .refine(c => c.x + c.width <= 1 && c.y + c.height <= 1, {
      message: 'The crop must stay inside the image',
    }),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: 'INVALID_BODY', message: 'A JSON body is required' } },
      { status: 400 },
    );
  }

  const parsed = cropSchema.safeParse(body);

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

  const applied = await setPortfolioPhotoCrop({
    salonId: context.salon.id,
    photoId: id,
    crop: {
      cropX: parsed.data.crop.x,
      cropY: parsed.data.crop.y,
      cropWidth: parsed.data.crop.width,
      cropHeight: parsed.data.crop.height,
      focalX: parsed.data.crop.focalX,
      focalY: parsed.data.crop.focalY,
    },
  });

  if (!applied) {
    return Response.json(
      { error: { code: 'PHOTO_NOT_FOUND', message: 'Photo not found' } },
      { status: 404 },
    );
  }

  await logAuditEvent({
    salonId: context.salon.id,
    actorType: 'admin',
    actorId: context.actorId,
    action: 'portfolio_photo_crop_updated',
    entityType: 'salon_portfolio_photo',
    entityId: id,
  });

  return Response.json({ updated: true });
}

/**
 * Soft-delete the row, then remove the stored object.
 *
 * The row goes first: capacity must be freed even if the storage call fails,
 * and a stored object with no active row is collectable, whereas an active row
 * pointing at a destroyed object is a broken portfolio.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { error, context } = await requirePortfolioAdmin(searchParams.get('salonSlug'));

  if (error) {
    return error;
  }

  const deleted = await deletePortfolioPhoto({ salonId: context.salon.id, photoId: id });

  if (!deleted) {
    return Response.json(
      { error: { code: 'PHOTO_NOT_FOUND', message: 'Photo not found' } },
      { status: 404 },
    );
  }

  await deletePortfolioImage({
    publicId: deleted.cloudinaryPublicId,
    salonId: context.salon.id,
  }).catch(() => {});

  await logAuditEvent({
    salonId: context.salon.id,
    actorType: 'admin',
    actorId: context.actorId,
    action: 'portfolio_photo_deleted',
    entityType: 'salon_portfolio_photo',
    entityId: id,
  });

  return Response.json({ deleted: true });
}
