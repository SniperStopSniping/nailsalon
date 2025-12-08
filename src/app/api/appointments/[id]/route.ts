import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { getAppointmentById, getSalonById, getTechnicianById, updateAppointmentStatus } from '@/libs/queries';
import { sendCancellationConfirmation, sendCancellationNotificationToTech } from '@/libs/SMS';
import {
  APPOINTMENT_STATUSES,
  appointmentServicesSchema,
  CANCEL_REASONS,
  referralSchema,
  rewardSchema,
  serviceSchema,
} from '@/models/Schema';

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

    // 6. If status changed to 'cancelled', send SMS notifications
    if (data.status === 'cancelled' && data.cancelReason !== 'rescheduled') {
      // Get salon info for SMS
      const salon = await getSalonById(existingAppointment.salonId);
      const salonName = salon?.name || 'the salon';

      // Send cancellation SMS to client
      await sendCancellationConfirmation({
        phone: existingAppointment.clientPhone,
        clientName: existingAppointment.clientName || undefined,
        appointmentId,
        salonName,
      });

      // Notify technician if one was assigned
      if (existingAppointment.technicianId) {
        const technician = await getTechnicianById(existingAppointment.technicianId, existingAppointment.salonId);
        if (technician) {
          // Get services for the appointment
          const appointmentServices = await db
            .select({ name: serviceSchema.name })
            .from(appointmentServicesSchema)
            .innerJoin(serviceSchema, eq(appointmentServicesSchema.serviceId, serviceSchema.id))
            .where(eq(appointmentServicesSchema.appointmentId, appointmentId));

          await sendCancellationNotificationToTech({
            technicianName: technician.name,
            // Note: technicianPhone not currently stored in schema, will log instead of SMS
            technicianPhone: undefined,
            clientName: existingAppointment.clientName || 'Guest',
            startTime: existingAppointment.startTime.toISOString(),
            services: appointmentServices.map(s => s.name),
            cancelReason: 'cancelled',
          });
        }
      }
    }

    // 7. If status changed to 'completed', handle reward completion
    if (data.status === 'completed') {
      // Mark any reward linked to this appointment as 'used'
      const linkedReward = await db
        .select()
        .from(rewardSchema)
        .where(eq(rewardSchema.usedInAppointmentId, appointmentId))
        .limit(1);

      if (linkedReward.length > 0) {
        const reward = linkedReward[0]!;
        await db
          .update(rewardSchema)
          .set({
            status: 'used',
            usedAt: new Date(),
          })
          .where(eq(rewardSchema.id, reward.id));

        // If this is a referee reward, update the referral status and create referrer reward
        if (reward.type === 'referral_referee' && reward.referralId) {
          // Update referral status to reward_earned
          await db
            .update(referralSchema)
            .set({ status: 'reward_earned' })
            .where(eq(referralSchema.id, reward.referralId));

          // Get the referral to find the referrer info
          const [referral] = await db
            .select()
            .from(referralSchema)
            .where(eq(referralSchema.id, reward.referralId))
            .limit(1);

          if (referral) {
            // Create a reward for the referrer (2500 points = free gel manicure)
            await db.insert(rewardSchema).values({
              id: `reward_${crypto.randomUUID()}`,
              salonId: referral.salonId,
              clientPhone: referral.referrerPhone,
              clientName: referral.referrerName,
              referralId: referral.id,
              type: 'referral_referrer',
              points: 2500,
              eligibleServiceName: 'Gel Manicure',
              status: 'active',
              // Referrer reward doesn't expire (or give them 30 days)
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            });
          }
        }
      }
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

