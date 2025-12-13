import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { resolveEffectivePolicy } from '@/core/appointments/policyResolver';
import { getIdempotencyKey, getPresignKey, TTL } from '@/core/redis/keys';
import { isRedisAvailable, redis } from '@/core/redis/redisClient';
import { verifyUploadExists } from '@/core/storage/storageClient';
import { db } from '@/libs/DB';
import { getAppointmentById, getSalonBySlug } from '@/libs/queries';
import {
  appointmentArtifactsSchema,
  appointmentSchema,
  autopostQueueSchema,
  salonPoliciesSchema,
  superAdminPoliciesSchema,
} from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const confirmRequestSchema = z.object({
  kind: z.enum(['before', 'after']),
  objectKey: z.string().min(1),
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
// POST /api/appointments/[id]/photos/confirm
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

    // 2. Auth: Read staff cookies
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

    // 3. Require Idempotency-Key header
    const idempotencyKeyHeader = request.headers.get('Idempotency-Key');
    if (!idempotencyKeyHeader) {
      return Response.json(
        {
          error: {
            code: 'MISSING_IDEMPOTENCY_KEY',
            message: 'Idempotency-Key header is required',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 4. Parse and validate request body
    const body = await request.json();
    const parsed = confirmRequestSchema.safeParse(body);

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

    const { kind, objectKey } = parsed.data;

    // 5. Check idempotency cache in Redis
    const idempotencyCacheKey = getIdempotencyKey(idempotencyKeyHeader);
    const cachedResultJson = await redis!.get(idempotencyCacheKey);

    if (cachedResultJson) {
      // Already confirmed with this idempotency key - return cached result
      const cachedResult = JSON.parse(cachedResultJson);
      return Response.json({
        data: { ...cachedResult, alreadyConfirmed: true },
      });
    }

    // 6. Resolve salon
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

    // 7. Verify appointment exists and belongs to salon
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

    // 8. Validate against pending presign in Redis (replay safety)
    const presignKey = getPresignKey(appointmentId, kind as 'before' | 'after');
    const storedObjectKey = await redis!.get(presignKey);

    if (!storedObjectKey) {
      return Response.json(
        {
          error: {
            code: 'PRESIGN_NOT_FOUND',
            message: 'No pending presign found or it has expired. Please request a new upload URL.',
            details: { reason: 'presign_expired_or_invalid' },
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    if (storedObjectKey !== objectKey) {
      return Response.json(
        {
          error: {
            code: 'OBJECT_KEY_MISMATCH',
            message: 'Object key does not match the presigned upload.',
            details: { reason: 'object_key_mismatch' },
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    // 9. Verify upload exists in storage
    const verifyResult = await verifyUploadExists(objectKey);
    if (!verifyResult.exists) {
      return Response.json(
        {
          error: {
            code: 'UPLOAD_NOT_FOUND',
            message: 'Upload not found in storage. Please upload the file first.',
            details: { reason: 'upload_not_found' },
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    // 10. Upsert appointment_artifacts
    const now = new Date();
    const existingArtifacts = await db.query.appointmentArtifactsSchema.findFirst({
      where: eq(appointmentArtifactsSchema.appointmentId, appointmentId),
    });

    let artifacts;
    if (existingArtifacts) {
      // Update existing
      const updateData
        = kind === 'before'
          ? {
              beforePhotoUrl: verifyResult.url,
              beforePhotoUploadedAt: now,
              updatedAt: now,
            }
          : {
              afterPhotoUrl: verifyResult.url,
              afterPhotoUploadedAt: now,
              updatedAt: now,
            };

      [artifacts] = await db
        .update(appointmentArtifactsSchema)
        .set(updateData)
        .where(eq(appointmentArtifactsSchema.appointmentId, appointmentId))
        .returning();
    } else {
      // Insert new
      const insertData = {
        id: `art_${nanoid()}`,
        appointmentId,
        beforePhotoUrl: kind === 'before' ? verifyResult.url : null,
        afterPhotoUrl: kind === 'after' ? verifyResult.url : null,
        beforePhotoUploadedAt: kind === 'before' ? now : null,
        afterPhotoUploadedAt: kind === 'after' ? now : null,
        createdAt: now,
        updatedAt: now,
      };

      [artifacts] = await db
        .insert(appointmentArtifactsSchema)
        .values(insertData)
        .returning();
    }

    // 11. Update appointment canvasStateUpdatedAt
    await db
      .update(appointmentSchema)
      .set({
        canvasStateUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(appointmentSchema.id, appointmentId));

    // 12. Enqueue autopost if kind === 'after' and autoPostEnabled
    if (kind === 'after') {
      // Load policies
      const salonPolicyRow = await db.query.salonPoliciesSchema.findFirst({
        where: eq(salonPoliciesSchema.salonId, salon.id),
      });

      const superAdminPolicyRow = await db.query.superAdminPoliciesSchema.findFirst({
        where: eq(superAdminPoliciesSchema.id, 'singleton'),
      });

      // Build policy objects with defaults
      const salonPolicy = {
        requireBeforePhotoToStart: salonPolicyRow?.requireBeforePhotoToStart ?? 'off',
        requireAfterPhotoToFinish: salonPolicyRow?.requireAfterPhotoToFinish ?? 'off',
        requireAfterPhotoToPay: salonPolicyRow?.requireAfterPhotoToPay ?? 'off',
        autoPostEnabled: salonPolicyRow?.autoPostEnabled ?? false,
        autoPostPlatforms: (salonPolicyRow?.autoPostPlatforms ?? []) as Array<'instagram' | 'facebook' | 'tiktok'>,
        autoPostIncludePrice: salonPolicyRow?.autoPostIncludePrice ?? false,
        autoPostIncludeColor: salonPolicyRow?.autoPostIncludeColor ?? false,
        autoPostIncludeBrand: salonPolicyRow?.autoPostIncludeBrand ?? false,
        autoPostAIcaptionEnabled: salonPolicyRow?.autoPostAiCaptionEnabled ?? false,
      };

      const superAdminPolicy = {
        requireBeforePhotoToStart: superAdminPolicyRow?.requireBeforePhotoToStart ?? undefined,
        requireAfterPhotoToFinish: superAdminPolicyRow?.requireAfterPhotoToFinish ?? undefined,
        requireAfterPhotoToPay: superAdminPolicyRow?.requireAfterPhotoToPay ?? undefined,
        autoPostEnabled: superAdminPolicyRow?.autoPostEnabled ?? undefined,
        autoPostAIcaptionEnabled: superAdminPolicyRow?.autoPostAiCaptionEnabled ?? undefined,
      };

      const effectivePolicy = resolveEffectivePolicy({
        salon: salonPolicy,
        superAdmin: superAdminPolicy,
      });

      if (effectivePolicy.autoPostEnabled && effectivePolicy.autoPostPlatforms.length > 0) {
        // Enqueue one row per platform
        for (const platform of effectivePolicy.autoPostPlatforms) {
          await db.insert(autopostQueueSchema).values({
            id: `aq_${nanoid()}`,
            salonId: salon.id,
            appointmentId,
            status: 'queued',
            platform,
            payloadJson: {
              payloadVersion: 1,
              appointmentId,
              salonId: salon.id,
              salonName: salon.name, // Include salon name for captions
              afterPhotoObjectKey: objectKey,
              includePrice: effectivePolicy.autoPostIncludePrice,
              includeColor: effectivePolicy.autoPostIncludeColor,
              includeBrand: effectivePolicy.autoPostIncludeBrand,
              aiCaptionEnabled: effectivePolicy.autoPostAIcaptionEnabled,
            },
            createdAt: now,
          });
        }
      }
    }

    // 13. Store result in idempotency cache
    const resultData = { artifacts };
    await redis!.set(
      idempotencyCacheKey,
      JSON.stringify(resultData),
      'EX',
      TTL.IDEMPOTENCY,
    );

    // 14. Clear presign key (consumed)
    await redis!.del(presignKey);

    // 15. Return success
    return Response.json({
      data: resultData,
    });
  } catch (error) {
    console.error('Error confirming photo upload:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to confirm photo upload',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
