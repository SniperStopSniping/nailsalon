import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { type BookingStep, normalizeBookingFlow } from '@/libs/bookingFlow';
import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { salonSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const BOOKING_STEPS = ['service', 'tech', 'time', 'confirm'] as const;

const getQuerySchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

const updateSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  bookingFlow: z.array(z.enum(BOOKING_STEPS)),
});

// =============================================================================
// GET /api/admin/settings/booking-flow - Get booking flow settings
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    // Validate query params
    const validated = getQuerySchema.safeParse(queryParams);
    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: validated.error.flatten(),
          },
        },
        { status: 400 },
      );
    }

    const { salonSlug } = validated.data;

    // Get salon
    const salon = await getSalonBySlug(salonSlug);
    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Salon not found',
          },
        },
        { status: 404 },
      );
    }

    return Response.json({
      data: {
        bookingFlowCustomizationEnabled: salon.bookingFlowCustomizationEnabled ?? false,
        bookingFlow: salon.bookingFlow as BookingStep[] | null,
      },
    });
  } catch (error) {
    console.error('Error fetching booking flow settings:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch booking flow settings',
        },
      },
      { status: 500 },
    );
  }
}

// =============================================================================
// PUT /api/admin/settings/booking-flow - Update booking flow
// =============================================================================

export async function PUT(request: Request): Promise<Response> {
  try {
    const body = await request.json();

    // Validate request body
    const validated = updateSchema.safeParse(body);
    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: validated.error.flatten(),
          },
        },
        { status: 400 },
      );
    }

    const { salonSlug, bookingFlow } = validated.data;

    // Get salon
    const salon = await getSalonBySlug(salonSlug);
    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Salon not found',
          },
        },
        { status: 404 },
      );
    }

    // Check if feature is enabled for this salon
    if (!salon.bookingFlowCustomizationEnabled) {
      return Response.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Booking flow customization is not enabled for this salon',
          },
        },
        { status: 403 },
      );
    }

    // Normalize the booking flow to ensure validity
    const normalizedFlow = normalizeBookingFlow(bookingFlow);

    // Update salon
    const [updated] = await db
      .update(salonSchema)
      .set({
        bookingFlow: normalizedFlow,
      })
      .where(eq(salonSchema.id, salon.id))
      .returning();

    return Response.json({
      data: {
        bookingFlowCustomizationEnabled: updated!.bookingFlowCustomizationEnabled ?? false,
        bookingFlow: updated!.bookingFlow as BookingStep[] | null,
      },
    });
  } catch (error) {
    console.error('Error updating booking flow:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update booking flow',
        },
      },
      { status: 500 },
    );
  }
}
