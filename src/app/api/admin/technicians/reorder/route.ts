import { eq, and, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { technicianSchema } from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const reorderSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  technicians: z.array(
    z.object({
      id: z.string().min(1),
      displayOrder: z.number().int().min(0),
    })
  ).min(1, 'At least one technician is required'),
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
// PUT /api/admin/technicians/reorder - Reorder technicians
// =============================================================================

export async function PUT(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const validated = reorderSchema.safeParse(body);

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

    const { salonSlug, technicians } = validated.data;

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

    // Get all technician IDs from the request
    const techIds = technicians.map(t => t.id);

    // Verify ALL technician IDs belong to this salon
    const existingTechs = await db
      .select({ id: technicianSchema.id })
      .from(technicianSchema)
      .where(
        and(
          eq(technicianSchema.salonId, salon.id),
          inArray(technicianSchema.id, techIds),
        ),
      );

    const existingIds = new Set(existingTechs.map(t => t.id));
    const invalidIds = techIds.filter(id => !existingIds.has(id));

    if (invalidIds.length > 0) {
      return Response.json(
        {
          error: {
            code: 'INVALID_TECHNICIAN_IDS',
            message: 'Some technician IDs do not belong to this salon',
            details: { invalidIds },
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Update all technicians' displayOrder in a transaction
    await db.transaction(async (tx) => {
      for (const tech of technicians) {
        await tx
          .update(technicianSchema)
          .set({
            displayOrder: tech.displayOrder,
            updatedAt: new Date(),
          })
          .where(eq(technicianSchema.id, tech.id));
      }
    });

    return Response.json({
      data: {
        success: true,
        updated: technicians.length,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error reordering technicians:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to reorder technicians',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
