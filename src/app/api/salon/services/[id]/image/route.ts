import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { isCloudinaryConfigured } from '@/libs/Cloudinary';
import { db } from '@/libs/DB';
import {
  assertManagedServiceImagePublicId,
  deleteCloudinaryServiceImageByPublicId,
  deleteManagedServiceImage,
  managedCloudinaryPublicIdFromUrl,
  saveLocalServiceImage,
  SERVICE_IMAGE_ALLOWED_CONTENT_TYPES,
  SERVICE_IMAGE_MAX_BYTES,
  ServiceImageValidationError,
  verifyCloudinaryServiceImage,
  verifyServiceImageFinalizeToken,
} from '@/libs/serviceImageStorage.server';
import { type Service, serviceSchema } from '@/models/Schema';
import type { ServiceResponse } from '@/types/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const cloudinaryFinalizeSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  publicId: z.string().min(1).max(512),
  expectedImageUrl: z.string().max(2048).nullable(),
  timestamp: z.number().int().positive(),
  finalizeToken: z.string().regex(/^[a-f0-9]{64}$/),
});

function buildServicePayload(service: Service): ServiceResponse {
  return {
    id: service.id,
    name: service.name,
    slug: service.slug ?? null,
    description: service.description,
    descriptionItems: service.descriptionItems ?? null,
    price: service.price,
    priceDisplayText: service.priceDisplayText ?? null,
    durationMinutes: service.durationMinutes,
    preparationBufferMinutes: service.preparationBufferMinutes,
    cleanupBufferMinutes: service.cleanupBufferMinutes,
    category: service.category,
    bookingCategory: service.bookingCategory,
    templateKey: service.templateKey ?? null,
    imageUrl: service.imageUrl,
    sortOrder: service.sortOrder,
    featuredOrder: service.featuredOrder ?? null,
    isActive: service.isActive,
    isIntroPrice: service.isIntroPrice ?? false,
    introPriceLabel: service.introPriceLabel ?? null,
    introPriceExpiresAt: service.introPriceExpiresAt
      ? service.introPriceExpiresAt.toISOString()
      : null,
  };
}

function errorJson(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

async function loadOwnedService(serviceId: string, salonId: string) {
  const [service] = await db
    .select()
    .from(serviceSchema)
    .where(
      and(
        eq(serviceSchema.id, serviceId),
        eq(serviceSchema.salonId, salonId),
      ),
    )
    .limit(1);

  return service ?? null;
}

async function conditionallySetImageUrl({
  serviceId,
  salonId,
  expectedImageUrl,
  nextImageUrl,
}: {
  serviceId: string;
  salonId: string;
  expectedImageUrl: string | null;
  nextImageUrl: string | null;
}) {
  return db
    .update(serviceSchema)
    .set({
      imageUrl: nextImageUrl,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(serviceSchema.id, serviceId),
        eq(serviceSchema.salonId, salonId),
        expectedImageUrl === null
          ? isNull(serviceSchema.imageUrl)
          : eq(serviceSchema.imageUrl, expectedImageUrl),
      ),
    )
    .returning();
}

async function bestEffortDeleteManagedImage({
  imageUrl,
  salonId,
  serviceId,
}: {
  imageUrl: string | null;
  salonId: string;
  serviceId: string;
}) {
  if (!imageUrl) {
    return;
  }

  try {
    await deleteManagedServiceImage({ imageUrl, salonId, serviceId });
  } catch (cleanupError) {
    console.error('Service image cleanup failed after the database update:', cleanupError);
  }
}

async function bestEffortDeleteNewCloudinaryImage({
  publicId,
  salonId,
  serviceId,
}: {
  publicId: string;
  salonId: string;
  serviceId: string;
}): Promise<Service | null> {
  try {
    const currentService = await loadOwnedService(serviceId, salonId);
    if (
      currentService?.imageUrl
      && managedCloudinaryPublicIdFromUrl({
        imageUrl: currentService.imageUrl,
        salonId,
        serviceId,
      }) === publicId
    ) {
      return currentService;
    }
  } catch (reloadError) {
    console.error(
      'Could not verify whether an uploaded service image is active; preserving it:',
      reloadError,
    );
    return null;
  }

  try {
    await deleteCloudinaryServiceImageByPublicId({
      publicId,
      salonId,
      serviceId,
    });
  } catch (cleanupError) {
    console.error('New service image cleanup failed:', cleanupError);
  }
  return null;
}

async function finalizeCloudinaryImage(
  request: Request,
  serviceId: string,
): Promise<Response> {
  const parsed = cloudinaryFinalizeSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return errorJson(
      400,
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? 'Invalid image details',
    );
  }

  const {
    salonSlug,
    publicId,
    expectedImageUrl,
    timestamp,
    finalizeToken,
  } = parsed.data;
  const { error, salon } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error!;
  }

  const service = await loadOwnedService(serviceId, salon.id);
  if (!service) {
    return errorJson(404, 'SERVICE_NOT_FOUND', 'Service not found');
  }

  if ((service.imageUrl ?? null) !== expectedImageUrl) {
    return errorJson(
      409,
      'SERVICE_IMAGE_STALE',
      'The service image changed. Refresh and try again.',
    );
  }
  const previousImageUrl = service.imageUrl ?? null;

  if (!isCloudinaryConfigured()) {
    return errorJson(
      503,
      'IMAGE_STORAGE_UNAVAILABLE',
      'Service image storage is not configured.',
    );
  }

  try {
    assertManagedServiceImagePublicId({
      publicId,
      salonId: salon.id,
      serviceId: service.id,
    });
  } catch {
    return errorJson(
      400,
      'INVALID_IMAGE_UPLOAD',
      'The uploaded image does not belong to this service.',
    );
  }
  if (!verifyServiceImageFinalizeToken({
    token: finalizeToken,
    publicId,
    salonId: salon.id,
    serviceId: service.id,
    expectedImageUrl,
    timestamp,
  })) {
    return errorJson(
      400,
      'INVALID_IMAGE_UPLOAD',
      'The image upload authorization is invalid or expired.',
    );
  }

  if (
    previousImageUrl
    && managedCloudinaryPublicIdFromUrl({
      imageUrl: previousImageUrl,
      salonId: salon.id,
      serviceId: service.id,
    }) === publicId
  ) {
    return Response.json({ data: { service: buildServicePayload(service) } });
  }

  let verifiedImage: Awaited<ReturnType<typeof verifyCloudinaryServiceImage>>;
  try {
    verifiedImage = await verifyCloudinaryServiceImage({
      publicId,
      salonId: salon.id,
      serviceId: service.id,
    });
  } catch (verifyError) {
    if (verifyError instanceof ServiceImageValidationError) {
      await bestEffortDeleteNewCloudinaryImage({
        publicId,
        salonId: salon.id,
        serviceId: service.id,
      });
      return errorJson(400, verifyError.code, verifyError.message);
    }

    // A transient Cloudinary lookup error does not prove the asset is invalid.
    // Preserve it because another in-flight finalization may already be using
    // the same one-time public ID.
    return errorJson(
      502,
      'IMAGE_VERIFICATION_FAILED',
      'The uploaded image could not be verified.',
    );
  }

  try {
    const updatedRows = await conditionallySetImageUrl({
      serviceId: service.id,
      salonId: salon.id,
      expectedImageUrl: previousImageUrl,
      nextImageUrl: verifiedImage.imageUrl,
    });
    const updated = updatedRows[0];

    if (!updated) {
      const activeService = await bestEffortDeleteNewCloudinaryImage({
        publicId,
        salonId: salon.id,
        serviceId: service.id,
      });
      if (activeService) {
        return Response.json({
          data: { service: buildServicePayload(activeService) },
        });
      }
      return errorJson(
        409,
        'SERVICE_IMAGE_STALE',
        'The service image changed. Refresh and try again.',
      );
    }

    await bestEffortDeleteManagedImage({
      imageUrl: previousImageUrl,
      salonId: salon.id,
      serviceId: service.id,
    });

    return Response.json({ data: { service: buildServicePayload(updated) } });
  } catch {
    // A database client error can be ambiguous: the update may have committed
    // before the connection failed. Re-read to recognize that success; if it
    // cannot be proven, preserve the new asset.
    let currentService: Service | null;
    try {
      currentService = await loadOwnedService(service.id, salon.id);
    } catch (reloadError) {
      console.error(
        'Could not verify service image state after a database error; preserving the uploaded asset:',
        reloadError,
      );
      return errorJson(
        500,
        'IMAGE_SAVE_FAILED',
        'The service image save could not be confirmed.',
      );
    }

    if (currentService?.imageUrl === verifiedImage.imageUrl) {
      await bestEffortDeleteManagedImage({
        imageUrl: previousImageUrl,
        salonId: salon.id,
        serviceId: service.id,
      });
      return Response.json({
        data: { service: buildServicePayload(currentService) },
      });
    }

    // The database error is ambiguous and a same-token retry may still commit
    // this public ID. Preserve the upload rather than risk deleting an active
    // image; an orphan is safer than a broken service image reference.
    return errorJson(
      500,
      'IMAGE_SAVE_FAILED',
      'The service image could not be saved.',
    );
  }
}

async function finalizeLocalImage(
  request: Request,
  serviceId: string,
): Promise<Response> {
  if (process.env.NODE_ENV === 'production' || isCloudinaryConfigured()) {
    return errorJson(
      400,
      'DIRECT_UPLOAD_REQUIRED',
      'Use the signed image upload flow.',
    );
  }

  const formData = await request.formData();
  const file = formData.get('file');
  const salonSlug = formData.get('salonSlug');
  const expectedImageUrlValue = formData.get('expectedImageUrl');
  const expectedImageUrl
    = typeof expectedImageUrlValue === 'string' && expectedImageUrlValue.length > 0
      ? expectedImageUrlValue
      : null;

  if (typeof salonSlug !== 'string' || salonSlug.length === 0) {
    return errorJson(400, 'VALIDATION_ERROR', 'Salon slug is required');
  }
  if (!(file instanceof File)) {
    return errorJson(400, 'NO_FILE_PROVIDED', 'No image file was provided');
  }
  if (
    !SERVICE_IMAGE_ALLOWED_CONTENT_TYPES.includes(
      file.type as (typeof SERVICE_IMAGE_ALLOWED_CONTENT_TYPES)[number],
    )
  ) {
    return errorJson(
      400,
      'INVALID_FILE_TYPE',
      'Only JPEG, PNG, and WebP images are allowed',
    );
  }
  if (file.size <= 0 || file.size > SERVICE_IMAGE_MAX_BYTES) {
    return errorJson(
      400,
      'FILE_TOO_LARGE',
      'Image must be 5 MB or smaller',
    );
  }

  const { error, salon } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error!;
  }

  const service = await loadOwnedService(serviceId, salon.id);
  if (!service) {
    return errorJson(404, 'SERVICE_NOT_FOUND', 'Service not found');
  }
  if ((service.imageUrl ?? null) !== expectedImageUrl) {
    return errorJson(
      409,
      'SERVICE_IMAGE_STALE',
      'The service image changed. Refresh and try again.',
    );
  }
  const previousImageUrl = service.imageUrl ?? null;

  let localImage: Awaited<ReturnType<typeof saveLocalServiceImage>>;
  try {
    localImage = await saveLocalServiceImage({
      file,
      salonId: salon.id,
      serviceId: service.id,
    });
  } catch (saveError) {
    if (saveError instanceof ServiceImageValidationError) {
      return errorJson(400, saveError.code, saveError.message);
    }
    return errorJson(
      500,
      'IMAGE_UPLOAD_FAILED',
      'The service image could not be processed.',
    );
  }

  try {
    const updatedRows = await conditionallySetImageUrl({
      serviceId: service.id,
      salonId: salon.id,
      expectedImageUrl: previousImageUrl,
      nextImageUrl: localImage.imageUrl,
    });
    const updated = updatedRows[0];

    if (!updated) {
      await bestEffortDeleteManagedImage({
        imageUrl: localImage.imageUrl,
        salonId: salon.id,
        serviceId: service.id,
      });
      return errorJson(
        409,
        'SERVICE_IMAGE_STALE',
        'The service image changed. Refresh and try again.',
      );
    }

    await bestEffortDeleteManagedImage({
      imageUrl: previousImageUrl,
      salonId: salon.id,
      serviceId: service.id,
    });

    return Response.json({ data: { service: buildServicePayload(updated) } });
  } catch {
    let currentService: Service | null;
    try {
      currentService = await loadOwnedService(service.id, salon.id);
    } catch (reloadError) {
      console.error(
        'Could not verify local service image state after a database error; preserving the uploaded file:',
        reloadError,
      );
      return errorJson(
        500,
        'IMAGE_SAVE_FAILED',
        'The service image save could not be confirmed.',
      );
    }

    if (currentService?.imageUrl === localImage.imageUrl) {
      await bestEffortDeleteManagedImage({
        imageUrl: previousImageUrl,
        salonId: salon.id,
        serviceId: service.id,
      });
      return Response.json({
        data: { service: buildServicePayload(currentService) },
      });
    }

    // As with Cloudinary, a rejected database promise does not prove the write
    // failed. Keep the generated file so a committed URL can never be broken.
    return errorJson(
      500,
      'IMAGE_SAVE_FAILED',
      'The service image could not be saved.',
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.startsWith('application/json')) {
    return finalizeCloudinaryImage(request, params.id);
  }
  if (contentType.startsWith('multipart/form-data')) {
    return finalizeLocalImage(request, params.id);
  }

  return errorJson(
    415,
    'UNSUPPORTED_MEDIA_TYPE',
    'Unsupported image request format.',
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const salonSlug = searchParams.get('salonSlug');
  const expectedImageUrl = searchParams.get('expectedImageUrl');

  if (!salonSlug || !expectedImageUrl) {
    return errorJson(
      400,
      'VALIDATION_ERROR',
      'Salon slug and expected image URL are required.',
    );
  }

  const { error, salon } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error!;
  }

  const service = await loadOwnedService(params.id, salon.id);
  if (!service) {
    return errorJson(404, 'SERVICE_NOT_FOUND', 'Service not found');
  }
  if ((service.imageUrl ?? null) !== expectedImageUrl) {
    return errorJson(
      409,
      'SERVICE_IMAGE_STALE',
      'The service image changed. Refresh and try again.',
    );
  }
  const previousImageUrl = service.imageUrl;

  const updatedRows = await conditionallySetImageUrl({
    serviceId: service.id,
    salonId: salon.id,
    expectedImageUrl: previousImageUrl,
    nextImageUrl: null,
  });
  const updated = updatedRows[0];

  if (!updated) {
    return errorJson(
      409,
      'SERVICE_IMAGE_STALE',
      'The service image changed. Refresh and try again.',
    );
  }

  await bestEffortDeleteManagedImage({
    imageUrl: previousImageUrl,
    salonId: salon.id,
    serviceId: service.id,
  });

  return Response.json({ data: { service: buildServicePayload(updated) } });
}
