import { and, eq, gte } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

import { db } from '@/libs/DB';
import { getSalonBySlug } from '@/libs/queries';
import { technicianSchema, technicianTimeOffSchema, TIME_OFF_REASONS } from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const createTimeOffSchema = z.object({
  technicianId: z.string().min(1, 'Technician ID is required'),
  salonSlug: z.string().min(1, 'Salon slug is required'),
  startDate: z.string().datetime({ message: 'Invalid start date format' }),
  endDate: z.string().datetime({ message: 'Invalid end date format' }),
  reason: z.enum(TIME_OFF_REASONS).optional(),
  notes: z.string().optional(),
});

const getTimeOffSchema = z.object({
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
// GET /api/staff/time-off - List time-off entries for a technician
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const technicianId = searchParams.get('technicianId');
    const salonSlug = searchParams.get('salonSlug');

    // Validate query params
    const validated = getTimeOffSchema.safeParse({ technicianId, salonSlug });
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

    // Verify technician belongs to this salon
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

    // Get time-off entries (only future or current)
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const timeOffEntries = await db
      .select()
      .from(technicianTimeOffSchema)
      .where(
        and(
          eq(technicianTimeOffSchema.technicianId, validated.data.technicianId),
          eq(technicianTimeOffSchema.salonId, salon.id),
          gte(technicianTimeOffSchema.endDate, now),
        ),
      )
      .orderBy(technicianTimeOffSchema.startDate);

    return Response.json({
      data: {
        timeOff: timeOffEntries.map((entry) => ({
          id: entry.id,
          startDate: entry.startDate.toISOString(),
          endDate: entry.endDate.toISOString(),
          reason: entry.reason,
          notes: entry.notes,
          createdAt: entry.createdAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching time-off:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch time-off entries',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// POST /api/staff/time-off - Create a new time-off entry
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const validated = createTimeOffSchema.safeParse(body);

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

    // Validate dates
    const startDate = new Date(validated.data.startDate);
    const endDate = new Date(validated.data.endDate);

    if (endDate < startDate) {
      return Response.json(
        {
          error: {
            code: 'INVALID_DATE_RANGE',
            message: 'End date must be after start date',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Create time-off entry
    const timeOffId = `timeoff_${nanoid()}`;

    const [newEntry] = await db
      .insert(technicianTimeOffSchema)
      .values({
        id: timeOffId,
        technicianId: validated.data.technicianId,
        salonId: salon.id,
        startDate,
        endDate,
        reason: validated.data.reason || null,
        notes: validated.data.notes || null,
      })
      .returning();

    return Response.json(
      {
        data: {
          timeOff: {
            id: newEntry?.id,
            startDate: newEntry?.startDate.toISOString(),
            endDate: newEntry?.endDate.toISOString(),
            reason: newEntry?.reason,
            notes: newEntry?.notes,
            createdAt: newEntry?.createdAt.toISOString(),
          },
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('Error creating time-off:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create time-off entry',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

