import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getAppointmentById, updateSalonClientStats } from '@/libs/queries';
import { appointmentPhotoSchema, appointmentSchema, PAYMENT_STATUSES } from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const completeAppointmentSchema = z.object({
  paymentStatus: z.enum(PAYMENT_STATUSES).default('paid'),
  // Allow bypassing photo requirement for non-nail services
  skipPhotoValidation: z.boolean().optional().default(false),
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

type SuccessResponse = {
  data: {
    appointment: {
      id: string;
      status: string;
      paymentStatus: string;
      completedAt: Date;
    };
  };
};

// =============================================================================
// PATCH /api/appointments/[id]/complete - Mark appointment as completed
// =============================================================================
// Staff endpoint to complete an appointment.
// For nail services, requires at least 1 "after" photo to be uploaded.
// Sets status to 'completed', paymentStatus to 'paid', and records completedAt.
// =============================================================================

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;

    // 1. Parse and validate request body
    let body = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is okay, we have defaults
    }

    const validated = completeAppointmentSchema.safeParse(body);

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

    // 2. Verify appointment exists
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

    // 3. Check appointment is in a valid state to complete
    const validStates = ['confirmed', 'in_progress'];
    if (!validStates.includes(appointment.status)) {
      return Response.json(
        {
          error: {
            code: 'INVALID_STATE',
            message: `Cannot complete appointment in "${appointment.status}" status. Must be confirmed or in_progress.`,
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 4. Check for required "after" photos (unless bypassed)
    if (!validated.data.skipPhotoValidation) {
      const afterPhotos = await db
        .select({ id: appointmentPhotoSchema.id })
        .from(appointmentPhotoSchema)
        .where(
          and(
            eq(appointmentPhotoSchema.appointmentId, appointmentId),
            eq(appointmentPhotoSchema.photoType, 'after'),
          ),
        )
        .limit(1);

      if (afterPhotos.length === 0) {
        return Response.json(
          {
            error: {
              code: 'PHOTOS_REQUIRED',
              message: 'At least one "after" photo must be uploaded before completing the appointment. Upload photos via POST /api/appointments/[id]/photos',
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }
    }

    // 5. Update appointment to completed
    const now = new Date();

    await db
      .update(appointmentSchema)
      .set({
        status: 'completed',
        paymentStatus: validated.data.paymentStatus,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(appointmentSchema.id, appointmentId));

    // 5b. Update salon client stats (runs in background, don't await)
    updateSalonClientStats(appointment.salonId, appointment.clientPhone).catch((err) => {
      console.error('Failed to update salon client stats:', err);
    });

    // 6. Return success response
    const response: SuccessResponse = {
      data: {
        appointment: {
          id: appointmentId,
          status: 'completed',
          paymentStatus: validated.data.paymentStatus,
          completedAt: now,
        },
      },
    };

    return Response.json(response);
  } catch (error) {
    console.error('Error completing appointment:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to complete appointment',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}

// =============================================================================
// POST /api/appointments/[id]/start - Start an appointment (optional)
// =============================================================================
// Sets status to 'in_progress' and records startedAt.
// Used when tech begins working on client.
// =============================================================================

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;

    // 1. Verify appointment exists
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

    // 2. Check appointment is in valid state to start
    if (appointment.status !== 'confirmed') {
      return Response.json(
        {
          error: {
            code: 'INVALID_STATE',
            message: `Cannot start appointment in "${appointment.status}" status. Must be confirmed.`,
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 3. Update appointment to in_progress
    const now = new Date();

    await db
      .update(appointmentSchema)
      .set({
        status: 'in_progress',
        startedAt: now,
        updatedAt: now,
      })
      .where(eq(appointmentSchema.id, appointmentId));

    // 4. Return success response
    return Response.json({
      data: {
        appointment: {
          id: appointmentId,
          status: 'in_progress',
          startedAt: now,
        },
      },
    });
  } catch (error) {
    console.error('Error starting appointment:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to start appointment',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
