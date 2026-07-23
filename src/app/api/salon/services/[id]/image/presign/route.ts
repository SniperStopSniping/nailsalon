import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { isCloudinaryConfigured } from '@/libs/Cloudinary';
import { db } from '@/libs/DB';
import {
  createServiceImageFinalizeToken,
  createServiceImageUploadSignature,
  generateServiceImagePublicId,
  SERVICE_IMAGE_ALLOWED_CONTENT_TYPES,
  SERVICE_IMAGE_MAX_BYTES,
  serviceImageFormatForContentType,
} from '@/libs/serviceImageStorage.server';
import { serviceSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const requestSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  contentType: z.enum(SERVICE_IMAGE_ALLOWED_CONTENT_TYPES),
  fileSize: z
    .number()
    .int()
    .positive('Image file is empty')
    .max(SERVICE_IMAGE_MAX_BYTES, 'Image must be 5 MB or smaller'),
  expectedImageUrl: z.string().max(2048).nullable(),
});

function errorJson(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorJson(
      400,
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? 'Invalid image details',
    );
  }

  const { salonSlug, contentType, expectedImageUrl } = parsed.data;
  const { error, salon } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error!;
  }

  const [service] = await db
    .select({
      id: serviceSchema.id,
      imageUrl: serviceSchema.imageUrl,
    })
    .from(serviceSchema)
    .where(
      and(
        eq(serviceSchema.id, params.id),
        eq(serviceSchema.salonId, salon.id),
      ),
    )
    .limit(1);

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

  if (!isCloudinaryConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      return errorJson(
        503,
        'IMAGE_STORAGE_UNAVAILABLE',
        'Service image storage is not configured.',
      );
    }

    return Response.json({
      data: {
        strategy: 'local' as const,
      },
    });
  }

  const format = serviceImageFormatForContentType(contentType);
  const publicId = generateServiceImagePublicId({
    salonId: salon.id,
    serviceId: service.id,
    format,
  });
  const signedUpload = createServiceImageUploadSignature(publicId);
  const finalizeToken = createServiceImageFinalizeToken({
    publicId,
    salonId: salon.id,
    serviceId: service.id,
    expectedImageUrl,
    timestamp: signedUpload.timestamp,
  });

  return Response.json({
    data: {
      strategy: 'cloudinary' as const,
      uploadUrl: signedUpload.uploadUrl,
      apiKey: signedUpload.apiKey,
      cloudName: signedUpload.cloudName,
      timestamp: signedUpload.timestamp,
      signature: signedUpload.signature,
      uploadPreset: signedUpload.uploadPreset,
      publicId: signedUpload.publicId,
      overwrite: signedUpload.overwrite,
      finalizeToken,
    },
  });
}
