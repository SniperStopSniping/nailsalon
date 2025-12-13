/**
 * Admin Reviews API Route
 *
 * GET /api/admin/reviews?salonSlug=... - List all reviews for the salon
 */

import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { reviewSchema, salonClientSchema, technicianSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const listQuerySchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  technicianId: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

// =============================================================================
// GET /api/admin/reviews - List reviews
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    // 1. Parse and validate query params
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());
    const parsed = listQuerySchema.safeParse(queryParams);

    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request parameters',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const { salonSlug, technicianId, limit, offset } = parsed.data;

    // 2. Get salon
    const salon = await getSalonBySlug(salonSlug);
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

    // 3. Build conditions
    const conditions = [eq(reviewSchema.salonId, salon.id)];

    if (technicianId) {
      conditions.push(eq(reviewSchema.technicianId, technicianId));
    }

    // 4. Get reviews with technician and client info
    const reviews = await db
      .select({
        id: reviewSchema.id,
        appointmentId: reviewSchema.appointmentId,
        salonClientId: reviewSchema.salonClientId,
        clientName: reviewSchema.clientNameSnapshot,
        clientPhone: salonClientSchema.phone,
        technicianId: reviewSchema.technicianId,
        technicianName: technicianSchema.name,
        rating: reviewSchema.rating,
        comment: reviewSchema.comment,
        isPublic: reviewSchema.isPublic,
        adminHidden: reviewSchema.adminHidden,
        createdAt: reviewSchema.createdAt,
      })
      .from(reviewSchema)
      .leftJoin(technicianSchema, eq(reviewSchema.technicianId, technicianSchema.id))
      .leftJoin(salonClientSchema, eq(reviewSchema.salonClientId, salonClientSchema.id))
      .where(and(...conditions))
      .orderBy(desc(reviewSchema.createdAt))
      .limit(limit)
      .offset(offset);

    // 5. Calculate stats for this salon
    const allReviews = await db
      .select({ rating: reviewSchema.rating })
      .from(reviewSchema)
      .where(eq(reviewSchema.salonId, salon.id));

    const totalReviews = allReviews.length;
    const averageRating = totalReviews > 0
      ? allReviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
      : 0;

    const ratingDistribution = {
      1: allReviews.filter(r => r.rating === 1).length,
      2: allReviews.filter(r => r.rating === 2).length,
      3: allReviews.filter(r => r.rating === 3).length,
      4: allReviews.filter(r => r.rating === 4).length,
      5: allReviews.filter(r => r.rating === 5).length,
    };

    return Response.json({
      data: {
        reviews,
        stats: {
          totalReviews,
          averageRating: Math.round(averageRating * 10) / 10,
          ratingDistribution,
        },
      },
      meta: {
        timestamp: new Date().toISOString(),
        limit,
        offset,
        total: totalReviews,
      },
    });
  } catch (error) {
    console.error('Error listing reviews:', error);

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
