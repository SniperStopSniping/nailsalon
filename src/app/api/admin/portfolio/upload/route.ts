import { z } from 'zod';

import { logAuditEvent } from '@/libs/auditLog';
import { requirePortfolioAdmin } from '@/libs/portfolioAdminContext.server';
import {
  createPortfolioUploadSignature,
  deletePortfolioImage,
  generatePortfolioImagePublicId,
  markPortfolioImageActive,
  PORTFOLIO_IMAGE_ALLOWED_CONTENT_TYPES,
  PORTFOLIO_IMAGE_MAX_BYTES,
  portfolioImageFormatForContentType,
  PortfolioImageValidationError,
  verifyCloudinaryPortfolioImage,
  verifyPortfolioFinalizeToken,
} from '@/libs/portfolioImageStorage.server';
import { PortfolioLimitError } from '@/libs/portfolioLimits';
import {
  canAcceptPortfolioUpload,
  createPortfolioPhoto,
  PUBLICATION_RIGHTS_TEXT,
  PUBLICATION_RIGHTS_VERSION,
} from '@/libs/portfolioMedia.server';

export const dynamic = 'force-dynamic';

const presignSchema = z.object({
  salonSlug: z.string().trim().min(1),
  contentType: z.enum(PORTFOLIO_IMAGE_ALLOWED_CONTENT_TYPES),
  fileSize: z.number().int().positive().max(PORTFOLIO_IMAGE_MAX_BYTES),
  /**
   * Publication rights are confirmed before an upload is authorized, not after
   * the file exists. The durable record is written with the photo row.
   */
  publicationRightsConfirmed: z.literal(true, {
    errorMap: () => ({ message: PUBLICATION_RIGHTS_TEXT }),
  }),
});

const finalizeSchema = z.object({
  salonSlug: z.string().trim().min(1),
  assetId: z.string().trim().min(1),
  publicId: z.string().trim().min(1),
  finalizeToken: z.string().trim().min(1),
  timestamp: z.number().int().positive(),
  publicationRightsConfirmed: z.literal(true),
  locationId: z.string().trim().min(1).nullable().default(null),
  technicianId: z.string().trim().min(1).nullable().default(null),
  altText: z.string().trim().max(300).nullable().default(null),
});

function invalidBody(): Response {
  return Response.json(
    { error: { code: 'INVALID_BODY', message: 'A JSON body is required' } },
    { status: 400 },
  );
}

function limitResponse(usage: { stored: number; max: number }): Response {
  return Response.json(
    {
      error: {
        code: 'PORTFOLIO_PHOTO_LIMIT_REACHED',
        message: `You've used all ${usage.max} portfolio photos on your current plan.`,
        details: { stored: usage.stored, max: usage.max },
      },
    },
    { status: 403 },
  );
}

/** Authorize one upload and hand back a signed, app-scoped Cloudinary target. */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return invalidBody();
  }

  const parsed = presignSchema.safeParse(body);

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

  // Fail fast before a pointless round trip to Cloudinary. The authoritative
  // decision is still made under lock when the row is inserted.
  const capacity = await canAcceptPortfolioUpload(context.salon.id);

  if (!capacity.allowed) {
    return limitResponse(capacity);
  }

  try {
    const format = portfolioImageFormatForContentType(parsed.data.contentType);
    const publicId = generatePortfolioImagePublicId({ salonId: context.salon.id, format });

    return Response.json({
      upload: createPortfolioUploadSignature({ publicId, salonId: context.salon.id }),
      publicationRights: {
        text: PUBLICATION_RIGHTS_TEXT,
        version: PUBLICATION_RIGHTS_VERSION,
      },
    });
  } catch (uploadError) {
    if (uploadError instanceof PortfolioImageValidationError) {
      return Response.json(
        { error: { code: uploadError.code, message: uploadError.message } },
        { status: uploadError.code === 'IMAGE_STORAGE_UNAVAILABLE' ? 503 : 400 },
      );
    }

    throw uploadError;
  }
}

/**
 * Finalize: re-derive the truth from Cloudinary, then claim a slot atomically.
 *
 * If the claim is refused the uploaded object is destroyed before returning —
 * a rejected upload must never leave an orphan behind.
 */
export async function PUT(request: Request): Promise<Response> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return invalidBody();
  }

  const parsed = finalizeSchema.safeParse(body);

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

  const tokenValid = verifyPortfolioFinalizeToken({
    token: parsed.data.finalizeToken,
    publicId: parsed.data.publicId,
    salonId: context.salon.id,
    timestamp: parsed.data.timestamp,
  });

  if (!tokenValid) {
    return Response.json(
      {
        error: {
          code: 'UPLOAD_AUTHORIZATION_EXPIRED',
          message: 'This upload authorization is no longer valid. Please try again.',
        },
      },
      { status: 400 },
    );
  }

  let verified: Awaited<ReturnType<typeof verifyCloudinaryPortfolioImage>>;

  try {
    verified = await verifyCloudinaryPortfolioImage({
      assetId: parsed.data.assetId,
      publicId: parsed.data.publicId,
      salonId: context.salon.id,
    });
  } catch (verifyError) {
    if (verifyError instanceof PortfolioImageValidationError) {
      await deletePortfolioImage({
        publicId: parsed.data.publicId,
        salonId: context.salon.id,
      }).catch(() => {});

      return Response.json(
        { error: { code: verifyError.code, message: verifyError.message } },
        { status: verifyError.code === 'IMAGE_STORAGE_UNAVAILABLE' ? 503 : 400 },
      );
    }

    throw verifyError;
  }

  try {
    const created = await createPortfolioPhoto({
      salonId: context.salon.id,
      locationId: parsed.data.locationId,
      technicianId: parsed.data.technicianId,
      cloudinaryPublicId: parsed.data.publicId,
      imageUrl: verified.imageUrl,
      originalWidth: verified.width,
      originalHeight: verified.height,
      mimeType: `image/${verified.format === 'jpg' ? 'jpeg' : verified.format}`,
      fileSizeBytes: verified.bytes,
      altText: parsed.data.altText,
      publicationRightsConfirmedBy: context.actorId,
    });

    await markPortfolioImageActive({
      publicId: parsed.data.publicId,
      salonId: context.salon.id,
    }).catch(() => {});

    await logAuditEvent({
      salonId: context.salon.id,
      actorType: 'admin',
      actorId: context.actorId,
      action: 'portfolio_photo_created',
      entityType: 'salon_portfolio_photo',
      entityId: created.id,
      metadata: { publicationRightsVersion: PUBLICATION_RIGHTS_VERSION },
    });

    return Response.json({ photo: created }, { status: 201 });
  } catch (createError) {
    // The slot was refused, so nothing active exists for this object.
    await deletePortfolioImage({
      publicId: parsed.data.publicId,
      salonId: context.salon.id,
    }).catch(() => {});

    if (createError instanceof PortfolioLimitError) {
      return limitResponse({ stored: createError.stored, max: createError.max });
    }

    throw createError;
  }
}
