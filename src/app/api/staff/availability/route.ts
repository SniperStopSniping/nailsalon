/**
 * Staff Availability API
 *
 * SECURITY: All operations are scoped to the authenticated staff member.
 * technicianId and salonId are DERIVED from session cookies, NEVER from client input.
 */

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { requireStaffSession } from '@/libs/staffAuth';
import { technicianSchema, type WeeklySchedule } from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const dayScheduleSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
  end: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
}).nullable();

const updateAvailabilitySchema = z.object({
  weeklySchedule: z.object({
    sunday: dayScheduleSchema.optional(),
    monday: dayScheduleSchema.optional(),
    tuesday: dayScheduleSchema.optional(),
    wednesday: dayScheduleSchema.optional(),
    thursday: dayScheduleSchema.optional(),
    friday: dayScheduleSchema.optional(),
    saturday: dayScheduleSchema.optional(),
  }),
  // NOTE: technicianId and salonSlug are IGNORED if provided - we use session values
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    reason?: string;
    details?: unknown;
  };
};

// =============================================================================
// GET /api/staff/availability - Get logged-in technician's weekly schedule
// =============================================================================
// SECURITY: technicianId is derived from session, NOT from query params.
// If technicianId query param is provided and doesn't match session, return 404.
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    // 1. Require staff session - derive technicianId and salonId from cookies
    const auth = await requireStaffSession();
    if (!auth.ok) {
      return auth.response;
    }

    const { session } = auth;

    // 2. Check if client tried to pass a different technicianId (security check)
    const { searchParams } = new URL(request.url);
    const requestedTechnicianId = searchParams.get('technicianId');

    // If client requested a different tech's data, deny with 404 (don't leak existence)
    if (requestedTechnicianId && requestedTechnicianId !== session.technicianId) {
      return Response.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Technician not found',
            reason: 'cross_tenant_access_denied',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 3. Fetch technician's schedule (scoped to session salonId + technicianId)
    const [technician] = await db
      .select()
      .from(technicianSchema)
      .where(
        and(
          eq(technicianSchema.id, session.technicianId),
          eq(technicianSchema.salonId, session.salonId),
        ),
      )
      .limit(1);

    if (!technician) {
      return Response.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Technician not found',
            reason: 'technician_not_found',
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
// PUT /api/staff/availability - Update logged-in technician's weekly schedule
// =============================================================================
// SECURITY: Updates are ALWAYS scoped to the logged-in staff member.
// Any technicianId or salonSlug in the request body is IGNORED.
// =============================================================================

export async function PUT(request: Request): Promise<Response> {
  try {
    // 1. Require staff session - derive technicianId and salonId from cookies
    const auth = await requireStaffSession();
    if (!auth.ok) {
      return auth.response;
    }

    const { session } = auth;

    // 2. Parse and validate request body (ignore technicianId/salonSlug if provided)
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

    // 3. Verify technician exists in this salon (double-check ownership)
    const [existingTech] = await db
      .select()
      .from(technicianSchema)
      .where(
        and(
          eq(technicianSchema.id, session.technicianId),
          eq(technicianSchema.salonId, session.salonId),
        ),
      )
      .limit(1);

    if (!existingTech) {
      return Response.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Technician not found',
            reason: 'technician_not_found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 4. Update the schedule (using session-derived IDs, NOT client input)
    const newSchedule: WeeklySchedule = validated.data.weeklySchedule;

    const [updatedTech] = await db
      .update(technicianSchema)
      .set({
        weeklySchedule: newSchedule,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(technicianSchema.id, session.technicianId),
          eq(technicianSchema.salonId, session.salonId),
        ),
      )
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
