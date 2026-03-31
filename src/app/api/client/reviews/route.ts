/**
 * Client Reviews API Route
 *
 * POST /api/client/reviews - Create a review for a completed appointment
 * GET /api/client/reviews?appointmentId=... - Check if review exists for appointment
 *
 * Requirements:
 * - Client must be authenticated via session cookie
 * - Appointment must be COMPLETED
 * - Appointment must belong to the authenticated client
 * - One review per appointment (enforced by unique constraint + server check)
 * - Salon must have reviewsEnabled = true
 */

import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logReviewCreated } from '@/libs/auditLog';
import {
  normalizeClientPhone,
  requireClientApiSession,
  requireClientSalonFromBody,
  requireClientSalonFromQuery,
} from '@/libs/clientApiGuards';
import { db } from '@/libs/DB';
import { getAppointmentById, getSalonClientByPhone } from '@/libs/queries';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { reviewSchema, technicianSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const createReviewSchema = z.object({
  appointmentId: z.string().min(1, 'Appointment ID is required'),
  salonSlug: z.string().min(1, 'Salon slug is required'),
  rating: z.number().int().min(1).max(5, 'Rating must be between 1 and 5'),
  comment: z.string().max(1000, 'Comment too long').optional(),
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

class ReviewAlreadyExistsError extends Error {
  constructor() {
    super('ALREADY_REVIEWED');
  }
}

// =============================================================================
// POST /api/client/reviews - Create review
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  try {
    // 0. Rate limit check
    const ip = getClientIp(request);
    const rateLimit = checkEndpointRateLimit('client/reviews', ip, 'REVIEW');
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit.retryAfterMs);
    }

    // 1. Require authenticated customer session
    const clientSession = await requireClientApiSession();
    if (!clientSession.ok) {
      return clientSession.response;
    }

    // 2. Parse request body (no phone/name - we use session)
    const body = await request.json();
    const parsed = createReviewSchema.safeParse(body);

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

    const { appointmentId, salonSlug, rating, comment } = parsed.data;

    // 3. Resolve and scope salon through the shared tenant guard
    const salonGuard = await requireClientSalonFromBody(salonSlug);
    if (!salonGuard.ok) {
      return salonGuard.response;
    }
    const { salon } = salonGuard;

    if (!salon.reviewsEnabled) {
      return Response.json(
        {
          error: {
            code: 'REVIEWS_DISABLED',
            message: 'Reviews are not enabled for this salon',
          },
        } satisfies ErrorResponse,
        { status: 403 },
      );
    }

    // 4. Get appointment and validate
    const appointment = await getAppointmentById(appointmentId, salon.id);

    if (!appointment) {
      return Response.json(
        {
          error: {
            code: 'APPOINTMENT_NOT_FOUND',
            message: 'Appointment not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 4b. Verify appointment belongs to this salon
    if (appointment.salonId !== salon.id) {
      return Response.json(
        {
          error: {
            code: 'APPOINTMENT_NOT_FOUND',
            message: 'Appointment not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 5. Verify appointment belongs to the AUTHENTICATED client (not request body)
    const apptPhone = normalizeClientPhone(appointment.clientPhone);
    if (!clientSession.phoneVariants.includes(apptPhone)) {
      return Response.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'You can only review your own appointments',
          },
        } satisfies ErrorResponse,
        { status: 403 },
      );
    }

    // 6. Verify appointment is completed
    if (appointment.status !== 'completed') {
      return Response.json(
        {
          error: {
            code: 'INVALID_STATUS',
            message: 'You can only review completed appointments',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 7. Get salonClient for identity linkage
    const salonClient = await getSalonClientByPhone(salon.id, clientSession.normalizedPhone);

    if (!salonClient) {
      return Response.json(
        {
          error: {
            code: 'CLIENT_NOT_FOUND',
            message: 'Client profile not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 8. Create review and update technician aggregate in one transaction
    const reviewId = `review_${crypto.randomUUID()}`;
    const [review] = await db.transaction(async (tx) => {
      const existingReview = await tx
        .select({ id: reviewSchema.id })
        .from(reviewSchema)
        .where(eq(reviewSchema.appointmentId, appointmentId))
        .limit(1);

      if (existingReview.length > 0) {
        throw new ReviewAlreadyExistsError();
      }

      const insertedReviews = await tx
        .insert(reviewSchema)
        .values({
          id: reviewId,
          salonId: salon.id,
          appointmentId,
          salonClientId: salonClient.id,
          clientNameSnapshot: salonClient.fullName ?? appointment.clientName,
          technicianId: appointment.technicianId,
          rating,
          comment: comment?.trim() || null,
        })
        .returning();

      if (appointment.technicianId) {
        const updatedTechnicians = await tx
          .update(technicianSchema)
          .set({
            reviewCount: sql`${technicianSchema.reviewCount} + 1`,
            rating: sql`round(((coalesce(${technicianSchema.rating}, 0::numeric) * ${technicianSchema.reviewCount}) + ${rating}) / (${technicianSchema.reviewCount} + 1), 1)`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(technicianSchema.id, appointment.technicianId),
              eq(technicianSchema.salonId, salon.id),
            ),
          )
          .returning();

        if (updatedTechnicians.length === 0) {
          throw new Error('TECHNICIAN_AGGREGATE_UPDATE_FAILED');
        }
      }

      return insertedReviews;
    });

    // Audit log (using salonClientId, not raw phone)
    void logReviewCreated(salon.id, reviewId, appointmentId, rating, salonClient.id, ip);

    return Response.json({
      success: true,
      data: {
        review: {
          id: review!.id,
          rating: review!.rating,
          comment: review!.comment,
          createdAt: review!.createdAt,
        },
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof ReviewAlreadyExistsError) {
      return Response.json(
        {
          error: {
            code: 'ALREADY_REVIEWED',
            message: 'You have already submitted a review for this appointment',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    // Handle unique constraint violation (race condition)
    if (error instanceof Error && error.message.includes('unique')) {
      return Response.json(
        {
          error: {
            code: 'ALREADY_REVIEWED',
            message: 'You have already submitted a review for this appointment',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    console.error('Error creating review:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// GET /api/client/reviews - Check if review exists for appointment
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const clientSession = await requireClientApiSession();
    if (!clientSession.ok) {
      return clientSession.response;
    }

    const { searchParams } = new URL(request.url);
    const appointmentId = searchParams.get('appointmentId');

    if (!appointmentId) {
      return Response.json(
        {
          error: {
            code: 'MISSING_PARAMS',
            message: 'appointmentId is required',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const salonGuard = await requireClientSalonFromQuery(searchParams);
    if (!salonGuard.ok) {
      return salonGuard.response;
    }
    const { salon } = salonGuard;

    const appointment = await getAppointmentById(appointmentId, salon.id);
    if (!appointment || appointment.salonId !== salon.id) {
      return Response.json(
        {
          error: {
            code: 'APPOINTMENT_NOT_FOUND',
            message: 'Appointment not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    const apptPhone = normalizeClientPhone(appointment.clientPhone);
    if (!clientSession.phoneVariants.includes(apptPhone)) {
      return Response.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'You can only view review status for your own appointments',
          },
        } satisfies ErrorResponse,
        { status: 403 },
      );
    }

    // Check if review exists
    const [review] = await db
      .select({
        id: reviewSchema.id,
        rating: reviewSchema.rating,
        comment: reviewSchema.comment,
        createdAt: reviewSchema.createdAt,
      })
      .from(reviewSchema)
      .where(
        and(
          eq(reviewSchema.appointmentId, appointmentId),
          eq(reviewSchema.salonId, salon.id),
        ),
      )
      .limit(1);

    return Response.json({
      data: {
        hasReview: !!review,
        review: review ?? null,
        reviewsEnabled: salon.reviewsEnabled ?? true,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error checking review:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
