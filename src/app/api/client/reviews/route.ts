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

import { Buffer } from 'node:buffer';

import { and, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { logReviewCreated } from '@/libs/auditLog';
import { db } from '@/libs/DB';
import { getAppointmentById, getSalonClientByPhone } from '@/libs/queries';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { reviewSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Decode the client session token and return the phone number.
 * Returns null if invalid or expired.
 */
function decodeSessionToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [phone, timestamp] = decoded.split(':');

    // Validate phone format (E.164)
    if (!phone || !phone.startsWith('+1') || phone.length !== 12) {
      return null;
    }

    // Validate timestamp exists and is a number
    if (!timestamp || Number.isNaN(Number(timestamp))) {
      return null;
    }

    // Check if session is older than 1 year (expired)
    const sessionAge = Date.now() - Number(timestamp);
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    if (sessionAge > oneYearMs) {
      return null;
    }

    return phone;
  } catch {
    return null;
  }
}

/**
 * Get authenticated client phone from session cookie.
 * Returns null if not authenticated.
 */
async function getAuthenticatedPhone(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('client_session');

  if (!sessionCookie?.value) {
    return null;
  }

  return decodeSessionToken(sessionCookie.value);
}

/**
 * Normalize phone to 10-digit format (removes +1 prefix and non-digits)
 */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
}

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

    // 1. Authenticate: get phone from session cookie (NOT from request body)
    const authenticatedPhone = await getAuthenticatedPhone();

    if (!authenticatedPhone) {
      return Response.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Please log in to submit a review',
          },
        } satisfies ErrorResponse,
        { status: 401 },
      );
    }

    const normalizedAuthPhone = normalizePhone(authenticatedPhone);

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

    // 3. Get salon and check reviewsEnabled
    const salon = await db.query.salonSchema.findFirst({
      where: (s, { eq: whereEq, and: whereAnd }) =>
        whereAnd(whereEq(s.slug, salonSlug), whereEq(s.isActive, true)),
    });

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
    const appointment = await getAppointmentById(appointmentId);

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
    const apptPhone = normalizePhone(appointment.clientPhone);
    if (apptPhone !== normalizedAuthPhone) {
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
    const salonClient = await getSalonClientByPhone(salon.id, normalizedAuthPhone);

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

    // 8. Check if review already exists (server-side check before DB unique constraint)
    const existingReview = await db
      .select({ id: reviewSchema.id })
      .from(reviewSchema)
      .where(eq(reviewSchema.appointmentId, appointmentId))
      .limit(1);

    if (existingReview.length > 0) {
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

    // 9. Create review with proper identity references
    const reviewId = `review_${crypto.randomUUID()}`;
    const [review] = await db
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
    const { searchParams } = new URL(request.url);
    const appointmentId = searchParams.get('appointmentId');
    const salonSlug = searchParams.get('salonSlug');

    if (!appointmentId || !salonSlug) {
      return Response.json(
        {
          error: {
            code: 'MISSING_PARAMS',
            message: 'appointmentId and salonSlug are required',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Get salon
    const salon = await db.query.salonSchema.findFirst({
      where: (s, { eq: whereEq, and: whereAnd }) =>
        whereAnd(whereEq(s.slug, salonSlug), whereEq(s.isActive, true)),
    });

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
