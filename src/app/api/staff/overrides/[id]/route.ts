import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';

import { db } from '@/libs/DB';
import { guardModuleOr403 } from '@/libs/featureGating';
import { getSalonBySlug, getTechnicianByPhone } from '@/libs/queries';
import {
  SCHEDULE_OVERRIDE_TYPES,
  type ScheduleOverrideType,
  technicianScheduleOverrideSchema,
} from '@/models/Schema';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

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
// HELPERS
// =============================================================================

// Validate HH:mm format
function isValidTimeFormat(time: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(time);
}

// Compare times (returns true if start < end)
function isStartBeforeEnd(start: string, end: string): boolean {
  const [startH = 0, startM = 0] = start.split(':').map(Number);
  const [endH = 0, endM = 0] = end.split(':').map(Number);
  return startH * 60 + startM < endH * 60 + endM;
}

// Get staff session from cookies (returns technician + salon or error response)
async function getStaffSession(): Promise<
  | { technician: { id: string; name: string }; salon: { id: string; slug: string } }
  | { error: Response }
> {
  const cookieStore = await cookies();
  const staffSession = cookieStore.get('staff_session');
  const staffPhone = cookieStore.get('staff_phone');
  const staffSalon = cookieStore.get('staff_salon');

  // Check for dev mode override
  if (process.env.NODE_ENV !== 'production') {
    const { isDevModeServer, readDevRoleFromCookies, getMockStaffMeResponse } = await import(
      '@/libs/devRole.server'
    );
    if (isDevModeServer()) {
      const devRole = readDevRoleFromCookies();
      if (devRole === 'staff') {
        const mockData = getMockStaffMeResponse();
        return {
          technician: { id: mockData.data.technician.id, name: mockData.data.technician.name },
          salon: { id: mockData.data.salon.id, slug: mockData.data.salon.slug },
        };
      }
      if (devRole) {
        return {
          error: Response.json(
            { error: { code: 'UNAUTHORIZED', message: 'Dev role mismatch' } } satisfies ErrorResponse,
            { status: 401 },
          ),
        };
      }
    }
  }

  // Verify session exists
  if (!staffSession?.value || !staffPhone?.value || !staffSalon?.value) {
    return {
      error: Response.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Not logged in. Please sign in first.',
          },
        } satisfies ErrorResponse,
        { status: 401 },
      ),
    };
  }

  // Resolve salon
  const salon = await getSalonBySlug(staffSalon.value);
  if (!salon) {
    return {
      error: Response.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: 'Salon not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      ),
    };
  }

  // Get technician by phone
  const technician = await getTechnicianByPhone(staffPhone.value, salon.id);
  if (!technician) {
    return {
      error: Response.json(
        {
          error: {
            code: 'TECHNICIAN_NOT_FOUND',
            message: 'Technician profile not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      ),
    };
  }

  return {
    technician: { id: technician.id, name: technician.name },
    salon: { id: salon.id, slug: salon.slug },
  };
}

// =============================================================================
// PUT /api/staff/overrides/[id] - Update a schedule override
// =============================================================================
// Body: { type, startTime?, endTime?, note? }
// Only allows updating overrides owned by the logged-in technician
// =============================================================================

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await getStaffSession();
    if ('error' in session) {
      return session.error;
    }

    const { technician, salon } = session;

    // Step 16.3: Check if scheduleOverrides module is enabled
    const moduleGuard = await guardModuleOr403({ salonId: salon.id, module: 'scheduleOverrides' });
    if (moduleGuard) {
      return moduleGuard;
    }

    const { id } = await params;

    // Find the override
    const [existing] = await db
      .select()
      .from(technicianScheduleOverrideSchema)
      .where(eq(technicianScheduleOverrideSchema.id, id))
      .limit(1);

    if (!existing) {
      return Response.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Schedule override not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Verify ownership
    if (existing.technicianId !== technician.id || existing.salonId !== salon.id) {
      return Response.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'You can only edit your own schedule overrides',
          },
        } satisfies ErrorResponse,
        { status: 403 },
      );
    }

    // Parse body
    const body = await request.json();
    const { type, startTime, endTime, note } = body as {
      type?: string;
      startTime?: string;
      endTime?: string;
      note?: string;
    };

    // Validate type if provided
    if (type && !SCHEDULE_OVERRIDE_TYPES.includes(type as ScheduleOverrideType)) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: `type must be one of: ${SCHEDULE_OVERRIDE_TYPES.join(', ')}`,
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Determine the effective type (updated or existing)
    const effectiveType = type || existing.type;

    // Validate times for 'hours' type
    if (effectiveType === 'hours') {
      const effectiveStartTime = startTime ?? existing.startTime;
      const effectiveEndTime = endTime ?? existing.endTime;

      if (!effectiveStartTime || !effectiveEndTime) {
        return Response.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'startTime and endTime are required when type is "hours"',
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }

      if (!isValidTimeFormat(effectiveStartTime) || !isValidTimeFormat(effectiveEndTime)) {
        return Response.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Times must be in HH:mm format (e.g., "09:00", "17:30")',
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }

      if (!isStartBeforeEnd(effectiveStartTime, effectiveEndTime)) {
        return Response.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'startTime must be before endTime',
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }
    }

    // Build update object
    const updateData: Partial<{
      type: string;
      startTime: string | null;
      endTime: string | null;
      note: string | null;
      updatedAt: Date;
    }> = {
      updatedAt: new Date(),
    };

    if (type !== undefined) {
      updateData.type = type;
    }

    // Handle times based on type
    if (effectiveType === 'off') {
      updateData.startTime = null;
      updateData.endTime = null;
    } else if (effectiveType === 'hours') {
      if (startTime !== undefined) {
        updateData.startTime = startTime;
      }
      if (endTime !== undefined) {
        updateData.endTime = endTime;
      }
    }

    if (note !== undefined) {
      updateData.note = note || null;
    }

    // Update the override
    const [updated] = await db
      .update(technicianScheduleOverrideSchema)
      .set(updateData)
      .where(eq(technicianScheduleOverrideSchema.id, id))
      .returning();

    return Response.json({
      data: {
        override: updated,
      },
    });
  } catch (error) {
    console.error('Error updating schedule override:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update schedule override',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// DELETE /api/staff/overrides/[id] - Delete a schedule override
// =============================================================================
// Only allows deleting overrides owned by the logged-in technician
// =============================================================================

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await getStaffSession();
    if ('error' in session) {
      return session.error;
    }

    const { technician, salon } = session;

    // Step 16.3: Check if scheduleOverrides module is enabled
    const moduleGuard = await guardModuleOr403({ salonId: salon.id, module: 'scheduleOverrides' });
    if (moduleGuard) {
      return moduleGuard;
    }

    const { id } = await params;

    // Find the override
    const [existing] = await db
      .select()
      .from(technicianScheduleOverrideSchema)
      .where(eq(technicianScheduleOverrideSchema.id, id))
      .limit(1);

    if (!existing) {
      return Response.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Schedule override not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // Verify ownership
    if (existing.technicianId !== technician.id || existing.salonId !== salon.id) {
      return Response.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'You can only delete your own schedule overrides',
          },
        } satisfies ErrorResponse,
        { status: 403 },
      );
    }

    // Delete the override
    await db
      .delete(technicianScheduleOverrideSchema)
      .where(eq(technicianScheduleOverrideSchema.id, id));

    return Response.json({
      data: {
        success: true,
        deletedId: id,
      },
    });
  } catch (error) {
    console.error('Error deleting schedule override:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to delete schedule override',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
