import { z } from 'zod';

import { ONBOARDING_MEDIA_MAX_FILE_BYTES } from '@/features/onboarding-v1-integration/media-limits';
import { OnboardingMediaRequestTooLarge, readOnboardingMediaForm } from '@/features/onboarding-v1-integration/media-request.server';
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
  uploadPortfolioImage,
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
  if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
    return uploadMultipart(request);
  }
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

/** Same bounded multipart transport as onboarding; Portfolio keeps its own ownership and rows. */
async function uploadMultipart(request: Request): Promise<Response> {
  const { error, context } = await requirePortfolioAdmin(new URL(request.url).searchParams.get('salonSlug'));
  if (error) {
    return error;
  }
  const failure = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });
  let form: FormData;
  try {
    form = await readOnboardingMediaForm(request);
  } catch (error) {
    return error instanceof OnboardingMediaRequestTooLarge
      ? failure(413, 'FILE_TOO_LARGE', 'This photo is too large to send. Choose a smaller photo.')
      : failure(400, 'INVALID_BODY', 'Choose an image to upload.');
  }
  if (form.get('publicationRightsConfirmed') !== 'true') {
    return failure(400, 'PUBLICATION_RIGHTS_REQUIRED', PUBLICATION_RIGHTS_TEXT);
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return failure(400, 'INVALID_BODY', 'Choose an image to upload.');
  }
  if (file.size > ONBOARDING_MEDIA_MAX_FILE_BYTES) {
    return failure(413, 'FILE_TOO_LARGE', 'This photo is too large to send. Choose a smaller photo.');
  }
  let stored: Awaited<ReturnType<typeof uploadPortfolioImage>>;
  try {
    const capacity = await canAcceptPortfolioUpload(context.salon.id);
    if (!capacity.allowed) {
      return limitResponse(capacity);
    }
    stored = await uploadPortfolioImage({ file, salonId: context.salon.id });
  } catch (error) {
    if (error instanceof PortfolioImageValidationError) {
      return failure(error.code.startsWith('IMAGE_STORAGE') ? 503 : 400, error.code, error.message);
    }
    return failure(500, 'UPLOAD_FAILED', 'The server could not prepare this upload. Please try again.');
  }

  let created: Awaited<ReturnType<typeof createPortfolioPhoto>>;
  try {
    created = await createPortfolioPhoto({
      salonId: context.salon.id,
      cloudinaryPublicId: stored.publicId,
      locationId: null,
      technicianId: null,
      altText: null,
      imageUrl: stored.imageUrl,
      originalWidth: stored.width,
      originalHeight: stored.height,
      mimeType: 'image/webp',
      fileSizeBytes: stored.bytes,
      publicationRightsConfirmedBy: context.actorId,
    });
  } catch (error) {
    await deletePortfolioImage({ publicId: stored.publicId, salonId: context.salon.id }).catch(() => {});
    if (error instanceof PortfolioLimitError) {
      return limitResponse(error);
    }
    return failure(500, 'PHOTO_SAVE_FAILED', 'The photo could not be saved to your portfolio. Please try again.');
  }
  // Once the row exists, an ancillary failure must never delete its image.
  await markPortfolioImageActive({ publicId: stored.publicId, salonId: context.salon.id }).catch(() => {});
  await logAuditEvent({
    salonId: context.salon.id,
    actorType: 'admin',
    actorId: context.actorId,
    action: 'portfolio_photo_created',
    entityType: 'salon_portfolio_photo',
    entityId: created.id,
    metadata: { publicationRightsVersion: PUBLICATION_RIGHTS_VERSION },
  }).catch(() => {});
  return Response.json({ photo: created }, { status: 201 });
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
