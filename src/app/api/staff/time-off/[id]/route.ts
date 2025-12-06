import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { technicianTimeOffSchema } from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const deleteTimeOffSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// =============================================================================
// DELETE /api/staff/time-off/[id] - Delete a time-off entry
// =============================================================================

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const timeOffId = params.id;
    const { searchParams } = new URL(request.url);
    const salonSlug = searchParams.get('salonSlug');

    // Validate query params
    const validated = deleteTimeOffSchema.safeParse({ salonSlug });
    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: validated.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Get salon
    const salon = await getSalonBySlug(validated.data.salonSlug);
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

    // Verify time-off entry exists and belongs to this salon
    const [existingEntry] = await db
      .select()
      .from(technicianTimeOffSchema)
      .where(
        and(
          eq(technicianTimeOffSchema.id, timeOffId),
          eq(technicianTimeOffSchema.salonId, salon.id),
        ),
      )
      .limit(1);

    if (!existingEntry) {
      return Response.json(
        {
          error: {
            code: 'TIME_OFF_NOT_FOUND',
            message: 'Time-off entry not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Delete the entry
    await db
      .delete(technicianTimeOffSchema)
      .where(eq(technicianTimeOffSchema.id, timeOffId));

    return Response.json({
      data: {
        deleted: true,
        id: timeOffId,
      },
    });
  } catch (error) {
    console.error('Error deleting time-off:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to delete time-off entry',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// GET /api/staff/time-off/[id] - Get a specific time-off entry
// =============================================================================

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const timeOffId = params.id;
    const { searchParams } = new URL(request.url);
    const salonSlug = searchParams.get('salonSlug');

    // Validate query params
    const validated = deleteTimeOffSchema.safeParse({ salonSlug });
    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: validated.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Get salon
    const salon = await getSalonBySlug(validated.data.salonSlug);
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

    // Get time-off entry
    const [entry] = await db
      .select()
      .from(technicianTimeOffSchema)
      .where(
        and(
          eq(technicianTimeOffSchema.id, timeOffId),
          eq(technicianTimeOffSchema.salonId, salon.id),
        ),
      )
      .limit(1);

    if (!entry) {
      return Response.json(
        {
          error: {
            code: 'TIME_OFF_NOT_FOUND',
            message: 'Time-off entry not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    return Response.json({
      data: {
        timeOff: {
          id: entry.id,
          technicianId: entry.technicianId,
          startDate: entry.startDate.toISOString(),
          endDate: entry.endDate.toISOString(),
          reason: entry.reason,
          notes: entry.notes,
          createdAt: entry.createdAt.toISOString(),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching time-off:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch time-off entry',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

