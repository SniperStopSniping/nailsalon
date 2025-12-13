import { cookies } from 'next/headers';
import { z } from 'zod';

import { logWarn } from '@/core/logging/logger';
import { getPresignKey, getRateLimitKey, getRateLimitMax, TTL } from '@/core/redis/keys';
import { isRedisAvailable, redis } from '@/core/redis/redisClient';
import {
  generateObjectKey,
  generatePresignedUpload,
  isStorageConfigured,
  type PhotoKind,
} from '@/core/storage/storageClient';
import { getAppointmentById, getSalonBySlug } from '@/libs/queries';

// =============================================================================
// CONSTANTS
// =============================================================================

const MAX_FILE_SIZE = 10_000_000; // 10 MB
const PRESIGN_EXPIRY_SECONDS = 900; // 15 minutes

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const presignRequestSchema = z.object({
  kind: z.enum(['before', 'after']),
  contentType: z.string().refine(
    ct => ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(ct),
    { message: 'Invalid content type. Allowed: jpeg, png, webp, heic' },
  ),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE, {
    message: `File size must not exceed ${MAX_FILE_SIZE / 1_000_000} MB`,
  }),
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

// =============================================================================
// POST /api/appointments/[id]/photos/presign
// =============================================================================

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;

    // 1. Check Redis is available (fail closed)
    if (!await isRedisAvailable()) {
      return Response.json(
        {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Service temporarily unavailable. Please try again later.',
          },
        } satisfies ErrorResponse,
        { status: 503 },
      );
    }

    // 2. Check storage is configured
    if (!isStorageConfigured()) {
      return Response.json(
        {
          error: {
            code: 'STORAGE_NOT_CONFIGURED',
            message: 'Photo upload is not available. Storage is not configured.',
          },
        } satisfies ErrorResponse,
        { status: 503 },
      );
    }

    // 3. Auth: Read staff cookies
    const cookieStore = await cookies();
    const staffSession = cookieStore.get('staff_session');
    const staffPhone = cookieStore.get('staff_phone');
    const staffSalon = cookieStore.get('staff_salon');

    if (!staffSession?.value || !staffPhone?.value || !staffSalon?.value) {
      return Response.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Not logged in. Please sign in first.',
          },
        } satisfies ErrorResponse,
        { status: 401 },
      );
    }

    // 4. Resolve salon
    const salon = await getSalonBySlug(staffSalon.value);
    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: 'Salon not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 5. Verify appointment exists and belongs to salon
    const appointment = await getAppointmentById(appointmentId);
    if (!appointment) {
      return Response.json(
        {
          error: {
            code: 'APPOINTMENT_NOT_FOUND',
            message: `Appointment with ID "${appointmentId}" not found`,
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    if (appointment.salonId !== salon.id) {
      return Response.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have access to this appointment',
          },
        } satisfies ErrorResponse,
        { status: 403 },
      );
    }

    // 6. Rate limit check (ATOMIC: INCR + conditional EXPIRE)
    const techId = `${salon.id}:${staffPhone.value}`;
    const rateLimitKey = getRateLimitKey(techId);
    const maxPresigns = getRateLimitMax();

    const currentCount = await redis!.incr(rateLimitKey);
    if (currentCount === 1) {
      // First request in window, set expiry
      await redis!.expire(rateLimitKey, TTL.RATE_LIMIT);
    }

    if (currentCount > maxPresigns) {
      logWarn('presign.rate_limit_exceeded', {
        salonId: salon.id,
        techId,
        currentCount,
        limit: maxPresigns,
      });

      return Response.json(
        {
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many upload requests. Please try again later.',
          },
        } satisfies ErrorResponse,
        { status: 429 },
      );
    }

    // 7. Parse and validate request body
    const body = await request.json();
    const parsed = presignRequestSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: parsed.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const { kind, contentType } = parsed.data;

    // 8. Generate object key and presigned upload
    const objectKey = generateObjectKey(appointmentId, kind as PhotoKind, contentType);
    const presign = generatePresignedUpload(objectKey, PRESIGN_EXPIRY_SECONDS);

    // 9. Store presign in Redis for replay protection
    const presignKey = getPresignKey(appointmentId, kind as 'before' | 'after');
    await redis!.set(presignKey, objectKey, 'EX', TTL.PRESIGN);

    // 10. Return presign data
    return Response.json({
      objectKey: presign.objectKey,
      uploadUrl: presign.uploadUrl,
      signature: presign.signature,
      timestamp: presign.timestamp,
      apiKey: presign.apiKey,
      cloudName: presign.cloudName,
      expiresInSeconds: presign.expiresInSeconds,
    });
  } catch (error) {
    console.error('Error generating presigned upload:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to generate upload URL',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
