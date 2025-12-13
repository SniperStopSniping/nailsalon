import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { STAFF_STATUSES, technicianSchema } from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const updateStatusSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  currentStatus: z.enum(STAFF_STATUSES),
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
// PUT /api/admin/technicians/[id]/status - Quick status toggle
// =============================================================================

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = updateStatusSchema.safeParse(body);

    if (!validated.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: validated.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const { salonSlug, currentStatus } = validated.data;

    // Get salon
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

    // Verify technician exists and belongs to salon
    const [existing] = await db
      .select()
      .from(technicianSchema)
      .where(
        and(
          eq(technicianSchema.id, id),
          eq(technicianSchema.salonId, salon.id),
        ),
      )
      .limit(1);

    if (!existing) {
      return Response.json(
        {
          error: {
            code: 'TECHNICIAN_NOT_FOUND',
            message: 'Technician not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Update status
    const [updated] = await db
      .update(technicianSchema)
      .set({
        currentStatus,
        updatedAt: new Date(),
      })
      .where(eq(technicianSchema.id, id))
      .returning();

    return Response.json({
      data: {
        technician: {
          id: updated!.id,
          name: updated!.name,
          currentStatus: updated!.currentStatus,
          previousStatus: existing.currentStatus,
        },
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error updating technician status:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update technician status',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
