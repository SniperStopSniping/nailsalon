import { z } from 'zod';

import { getAppointmentById, updateAppointmentStatus } from '@/libs/queries';
import { APPOINTMENT_STATUSES, CANCEL_REASONS } from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const updateAppointmentSchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  cancelReason: z.enum(CANCEL_REASONS).optional(),
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
// PATCH /api/appointments/[id] - Update appointment status
// =============================================================================

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;

    // 1. Parse and validate request body
    const body = await request.json();
    const parsed = updateAppointmentSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: parsed.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const data = parsed.data;

    // 2. Verify appointment exists
    const existingAppointment = await getAppointmentById(appointmentId);
    if (!existingAppointment) {
      return Response.json(
        {
          error: {
            code: 'APPOINTMENT_NOT_FOUND',
            message: `Appointment with ID "${appointmentId}" not found`,
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    // 3. Validate the update makes sense
    if (!data.status && !data.cancelReason) {
      return Response.json(
        {
          error: {
            code: 'NO_UPDATE_PROVIDED',
            message: 'At least one of status or cancelReason must be provided',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 4. If cancelReason is provided, status should be 'cancelled'
    if (data.cancelReason && data.status && data.status !== 'cancelled') {
      return Response.json(
        {
          error: {
            code: 'INVALID_STATUS_FOR_CANCEL_REASON',
            message: 'cancelReason can only be set when status is "cancelled"',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 5. Update the appointment
    const updatedAppointment = await updateAppointmentStatus(
      appointmentId,
      data.status ?? existingAppointment.status,
      data.cancelReason,
    );

    if (!updatedAppointment) {
      throw new Error('Failed to update appointment');
    }

    return Response.json({
      data: { appointment: updatedAppointment },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    console.error('Error updating appointment:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while updating the appointment',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// GET /api/appointments/[id] - Get appointment by ID
// =============================================================================

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;

    const appointment = await getAppointmentById(appointmentId);
    if (!appointment) {
      return Response.json(
        {
          error: {
            code: 'APPOINTMENT_NOT_FOUND',
            message: `Appointment with ID "${appointmentId}" not found`,
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }

    return Response.json({
      data: { appointment },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    console.error('Error fetching appointment:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while fetching the appointment',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

