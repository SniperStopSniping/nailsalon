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
import { cookies } from 'next/headers';
import { z } from 'zod';

import { logNotesUpdated } from '@/libs/appointmentAudit';
import { db } from '@/libs/DB';
import {
  appointmentSchema,
  salonSchema,
  technicianSchema,
} from '@/models/Schema';

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
// Helper: Get Staff Session
// =============================================================================

async function getStaffSession(): Promise<
  | { technician: { id: string; name: string }; salon: { id: string; slug: string } }
  | { error: Response }
> {
  const cookieStore = await cookies();
  const staffSession = cookieStore.get('staff_session');
  const staffPhone = cookieStore.get('staff_phone');
  const staffSalon = cookieStore.get('staff_salon');

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

  // Get salon
  const [salon] = await db
    .select({ id: salonSchema.id, slug: salonSchema.slug })
    .from(salonSchema)
    .where(eq(salonSchema.slug, staffSalon.value))
    .limit(1);

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

  // Normalize phone
  const normalizedPhone = staffPhone.value.replace(/\D/g, '');
  const tenDigitPhone = normalizedPhone.length === 11 && normalizedPhone.startsWith('1')
    ? normalizedPhone.slice(1)
    : normalizedPhone;

  // Get technician
  const [technician] = await db
    .select({ id: technicianSchema.id, name: technicianSchema.name })
    .from(technicianSchema)
    .where(
      and(
        eq(technicianSchema.salonId, salon.id),
        eq(technicianSchema.phone, tenDigitPhone),
        eq(technicianSchema.isActive, true),
      ),
    )
    .limit(1);

  if (!technician) {
    return {
      error: Response.json(
        {
          error: {
            code: 'TECHNICIAN_NOT_FOUND',
            message: 'Staff member not found or inactive',
          },
        } satisfies ErrorResponse,
        { status: 403 },
      ),
    };
  }

  return {
    technician: { id: technician.id, name: technician.name },
    salon: { id: salon.id, slug: salon.slug },
  };
}

// =============================================================================
// PUT /api/staff/appointments/[id]/notes
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
    const { id: appointmentId } = await params;

    // 1. Get the appointment
    const [appointment] = await db
      .select()
      .from(appointmentSchema)
      .where(eq(appointmentSchema.id, appointmentId))
      .limit(1);

    if (!appointment) {
      return Response.json(
        {
          error: {
            code: 'APPOINTMENT_NOT_FOUND',
            message: 'Appointment not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 2. Verify appointment belongs to this salon
    if (appointment.salonId !== salon.id) {
      return Response.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Appointment does not belong to your salon',
          },
        } satisfies ErrorResponse,
        { status: 403 },
      );
    }

    // 3. Verify the logged-in tech is assigned to this appointment
    if (appointment.technicianId !== technician.id) {
      return Response.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'You can only edit notes for your own appointments',
          },
        } satisfies ErrorResponse,
        { status: 403 },
      );
    }

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
      .where(eq(appointmentSchema.id, appointmentId))
      .returning();

    // 6. Audit log (note content is NOT logged for privacy)
    await logNotesUpdated(
      appointmentId,
      salon.id,
      technician.id,
      technician.name,
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
    const session = await getStaffSession();
    if ('error' in session) {
      return session.error;
    }

    const { technician, salon } = session;
    const { id: appointmentId } = await params;

    // 1. Get the appointment
    const [appointment] = await db
      .select({
        id: appointmentSchema.id,
        techNotes: appointmentSchema.techNotes,
        technicianId: appointmentSchema.technicianId,
        salonId: appointmentSchema.salonId,
      })
      .from(appointmentSchema)
      .where(eq(appointmentSchema.id, appointmentId))
      .limit(1);

    if (!appointment) {
      return Response.json(
        {
          error: {
            code: 'APPOINTMENT_NOT_FOUND',
            message: 'Appointment not found',
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 2. Verify appointment belongs to this salon
    if (appointment.salonId !== salon.id) {
      return Response.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Appointment does not belong to your salon',
          },
        } satisfies ErrorResponse,
        { status: 403 },
      );
    }

    // 3. Verify the logged-in tech is assigned to this appointment
    if (appointment.technicianId !== technician.id) {
      return Response.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'You can only view notes for your own appointments',
          },
        } satisfies ErrorResponse,
        { status: 403 },
      );
    }

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
