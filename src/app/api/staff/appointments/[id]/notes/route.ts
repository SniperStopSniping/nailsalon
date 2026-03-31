/**
 * Staff Appointment Notes API
 *
 * Step 16A - Private tech notes that only the assigned technician can see/edit.
 *
 * PUT /api/staff/appointments/[id]/notes
 * - Updates tech_notes field on appointment
 * - Only the assigned technician can edit
 * - Audit logged (without exposing note content)
 */

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { logNotesUpdated } from '@/libs/appointmentAudit';
import { requireStaffAppointmentAccess } from '@/libs/staffApiGuards';
import { db } from '@/libs/DB';
import { appointmentSchema } from '@/models/Schema';

// =============================================================================
// Types
// =============================================================================

type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

// =============================================================================
// Request Validation
// =============================================================================

const updateNotesSchema = z.object({
  techNotes: z.string().max(2000).optional(), // Allow clearing notes with empty string
});

// =============================================================================
// PUT /api/staff/appointments/[id]/notes
// =============================================================================

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: appointmentId } = await params;
    const access = await requireStaffAppointmentAccess(appointmentId, {
      assignedOnly: true,
      assignmentForbiddenMessage: 'You can only edit notes for your own appointments',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
    });
    if (!access.ok) {
      return access.response;
    }
    const { session } = access;

    // 4. Parse request body
    const body = await request.json();
    const parsed = updateNotesSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 5. Update the tech notes
    const [updated] = await db
      .update(appointmentSchema)
      .set({
        techNotes: parsed.data.techNotes ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(appointmentSchema.id, appointmentId),
          eq(appointmentSchema.salonId, session.salonId),
          eq(appointmentSchema.technicianId, session.technicianId),
        ),
      )
      .returning();

    // 6. Audit log (note content is NOT logged for privacy)
    await logNotesUpdated(
      appointmentId,
      session.salonId,
      session.technicianId,
      session.technicianName,
    );

    return Response.json({
      data: {
        appointment: {
          id: updated!.id,
          techNotes: updated!.techNotes,
          updatedAt: updated!.updatedAt,
        },
      },
    });
  } catch (error) {
    console.error('Error updating appointment notes:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update appointment notes',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// GET /api/staff/appointments/[id]/notes
// =============================================================================

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id: appointmentId } = await params;
    const access = await requireStaffAppointmentAccess(appointmentId, {
      assignedOnly: true,
      assignmentForbiddenMessage: 'You can only view notes for your own appointments',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
    });
    if (!access.ok) {
      return access.response;
    }
    const { appointment } = access;

    return Response.json({
      data: {
        techNotes: appointment.techNotes,
      },
    });
  } catch (error) {
    console.error('Error fetching appointment notes:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch appointment notes',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
