import { eq, and } from 'drizzle-orm';
import { z } from 'zod';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { technicianSchema, type WeeklySchedule } from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const dayScheduleSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
  end: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
}).nullable();

const updateAvailabilitySchema = z.object({
  technicianId: z.string().min(1, 'Technician ID is required'),
  salonSlug: z.string().min(1, 'Salon slug is required'),
  weeklySchedule: z.object({
    sunday: dayScheduleSchema.optional(),
    monday: dayScheduleSchema.optional(),
    tuesday: dayScheduleSchema.optional(),
    wednesday: dayScheduleSchema.optional(),
    thursday: dayScheduleSchema.optional(),
    friday: dayScheduleSchema.optional(),
    saturday: dayScheduleSchema.optional(),
  }),
});

const getAvailabilitySchema = z.object({
  technicianId: z.string().min(1, 'Technician ID is required'),
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
// GET /api/staff/availability - Get technician's weekly schedule
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const technicianId = searchParams.get('technicianId');
    const salonSlug = searchParams.get('salonSlug');

    // Validate query params
    const validated = getAvailabilitySchema.safeParse({ technicianId, salonSlug });
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

    // Get technician (scoped to salon)
    const [technician] = await db
      .select()
      .from(technicianSchema)
      .where(
        and(
          eq(technicianSchema.id, validated.data.technicianId),
          eq(technicianSchema.salonId, salon.id),
        ),
      )
      .limit(1);

    if (!technician) {
      return Response.json(
        {
          error: {
            code: 'TECHNICIAN_NOT_FOUND',
            message: 'Technician not found in this salon',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    return Response.json({
      data: {
        technician: {
          id: technician.id,
          name: technician.name,
        },
        weeklySchedule: technician.weeklySchedule || {
          sunday: null,
          monday: null,
          tuesday: null,
          wednesday: null,
          thursday: null,
          friday: null,
          saturday: null,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching availability:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch availability',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// PUT /api/staff/availability - Update technician's weekly schedule
// =============================================================================

export async function PUT(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const validated = updateAvailabilitySchema.safeParse(body);

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

    // Verify technician belongs to this salon
    const [existingTech] = await db
      .select()
      .from(technicianSchema)
      .where(
        and(
          eq(technicianSchema.id, validated.data.technicianId),
          eq(technicianSchema.salonId, salon.id),
        ),
      )
      .limit(1);

    if (!existingTech) {
      return Response.json(
        {
          error: {
            code: 'TECHNICIAN_NOT_FOUND',
            message: 'Technician not found in this salon',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Update the schedule
    const newSchedule: WeeklySchedule = validated.data.weeklySchedule;

    const [updatedTech] = await db
      .update(technicianSchema)
      .set({
        weeklySchedule: newSchedule,
        updatedAt: new Date(),
      })
      .where(eq(technicianSchema.id, validated.data.technicianId))
      .returning();

    return Response.json({
      data: {
        technician: {
          id: updatedTech?.id,
          name: updatedTech?.name,
        },
        weeklySchedule: updatedTech?.weeklySchedule,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error updating availability:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update availability',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

