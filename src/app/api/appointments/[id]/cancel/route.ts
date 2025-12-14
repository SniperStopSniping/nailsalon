import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getAppointmentById, updateSalonClientStats } from '@/libs/queries';
import { appointmentSchema, CANCEL_REASONS, rewardSchema, salonClientSchema } from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const cancelAppointmentSchema = z.object({
  cancelReason: z.enum(CANCEL_REASONS),
  notes: z.string().optional(),
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
      cancelReason: string;
      cancelledAt: Date;
    };
  };
};

// =============================================================================
// PATCH /api/appointments/[id]/cancel - Cancel an appointment
// =============================================================================
// Staff endpoint to cancel an appointment with a reason.
// Valid reasons: 'rescheduled', 'client_request', 'no_show'
// This also unlinks any pending rewards tied to this appointment.
// =============================================================================

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;

    // 1. Parse and validate request body
    const body = await request.json();
    const validated = cancelAppointmentSchema.safeParse(body);

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

    // 3. Check appointment is in a valid state to cancel
    const validStates = ['pending', 'confirmed', 'in_progress'];
    if (!validStates.includes(appointment.status)) {
      return Response.json(
        {
          error: {
            code: 'INVALID_STATE',
            message: `Cannot cancel appointment in "${appointment.status}" status. Must be pending, confirmed, or in_progress.`,
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 4. Update appointment to cancelled
    const now = new Date();

    await db
      .update(appointmentSchema)
      .set({
        status: 'cancelled',
        cancelReason: validated.data.cancelReason,
        notes: validated.data.notes || appointment.notes,
        updatedAt: now,
      })
      .where(eq(appointmentSchema.id, appointmentId));

    // 5. Unlink any rewards that were pending use with this appointment
    // (Return them to 'active' status so they can be used for another booking)
    const linkedReward = await db
      .select()
      .from(rewardSchema)
      .where(eq(rewardSchema.usedInAppointmentId, appointmentId))
      .limit(1);

    if (linkedReward.length > 0) {
      const reward = linkedReward[0]!;
      // Only restore if it wasn't already used
      if (reward.status !== 'used') {
        await db
          .update(rewardSchema)
          .set({
            usedInAppointmentId: null,
            status: 'active',
          })
          .where(eq(rewardSchema.id, reward.id));
      }
    }

    // 5b. Refund any points that were redeemed on this appointment
    // Check if notes contain "[Points redeemed:" which indicates points were spent
    const notesText = appointment.notes || '';
    const pointsRedeemedMatch = notesText.match(/\[Points redeemed:.*?(\d{1,3}(?:,\d{3})*)\s*pts/);

    if (pointsRedeemedMatch) {
      // Extract the points number (remove commas)
      const pointsToRefund = Number.parseInt(pointsRedeemedMatch[1]!.replace(/,/g, ''), 10);

      if (pointsToRefund > 0) {
        // Find the client and refund their points
        const normalizedPhone = appointment.clientPhone.replace(/\D/g, '');
        const tenDigitPhone = normalizedPhone.length === 11 && normalizedPhone.startsWith('1')
          ? normalizedPhone.slice(1)
          : normalizedPhone;

        const phoneVariants = [
          tenDigitPhone,
          `+1${tenDigitPhone}`,
          appointment.clientPhone,
        ];

        await db
          .update(salonClientSchema)
          .set({
            loyaltyPoints: sql`COALESCE(${salonClientSchema.loyaltyPoints}, 0) + ${pointsToRefund}`,
          })
          .where(
            and(
              eq(salonClientSchema.salonId, appointment.salonId),
              inArray(salonClientSchema.phone, phoneVariants),
            ),
          );
      }
    }

    // 5d. Update salon client stats if this was a no-show
    // (Background, don't await - no-shows affect stats)
    if (validated.data.cancelReason === 'no_show') {
      updateSalonClientStats(appointment.salonId, appointment.clientPhone).catch((err) => {
        console.error('Failed to update salon client stats:', err);
      });
    }

    // 6. Return success response
    const response: SuccessResponse = {
      data: {
        appointment: {
          id: appointmentId,
          status: 'cancelled',
          cancelReason: validated.data.cancelReason,
          cancelledAt: now,
        },
      },
    };

    return Response.json(response);
  } catch (error) {
    console.error('Error cancelling appointment:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to cancel appointment',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
