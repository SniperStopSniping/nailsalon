import { and, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';

import { canTransition, canvasStateToLegacyStatus } from '@/core/appointments/appointmentStateMachine';
import { resolveEffectivePolicy } from '@/core/appointments/policyResolver';
import type { AppointmentState, Transition } from '@/core/appointments/policyTypes';
import { getActiveAppointmentsForCanonicalClientWithHandle } from '@/libs/activeAppointments';
import { logAppointmentChange, logAppointmentLocked } from '@/libs/appointmentAudit';
import {
  lockTechnicianAndAssertSlotFree,
  SlotConflictError,
} from '@/libs/bookingConflictGuard';
import {
  ClientLifecycleStabilizationError,
  type LifecycleSqlHandle,
  lockOperationalSalonClientContactWithHandle,
  resolveCanonicalSalonClientIdentityWithHandle,
  resolveTerminalSalonClientWithHandle,
  withClientLifecycleTransactionRetry,
} from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import { enqueueGoogleCalendarDelete } from '@/libs/integrationOutbox';
import { requireStaffAppointmentAccess } from '@/libs/staffApiGuards';
import {
  appointmentArtifactsSchema,
  appointmentSchema,
  salonPoliciesSchema,
  superAdminPoliciesSchema,
} from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const transitionRequestSchema = z.object({
  to: z.enum(['working', 'wrap_up', 'complete', 'cancelled', 'no_show']),
});

class TransitionConflictError extends Error {}

function blockedEndTime(appointment: {
  startTime: Date;
  endTime: Date;
  blockedDurationMinutes: number | null;
  totalDurationMinutes: number;
  bufferMinutes: number | null;
}): Date {
  const blockedMinutes = appointment.blockedDurationMinutes
    ?? appointment.totalDurationMinutes + (appointment.bufferMinutes ?? 0);
  return new Date(Math.max(
    appointment.endTime.getTime(),
    appointment.startTime.getTime() + blockedMinutes * 60_000,
  ));
}

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    reason?: string;
  };
};

// =============================================================================
// POST /api/appointments/[id]/transition
// =============================================================================

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;
    const access = await requireStaffAppointmentAccess(appointmentId, {
      assignedOnly: true,
      assignmentForbiddenMessage: 'You can only transition your own appointments',
    });
    if (!access.ok) {
      return access.response;
    }
    const { appointment, session } = access;

    // 6. Parse request body
    const body = await request.json();
    const parsed = transitionRequestSchema.safeParse(body);

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

    const { to } = parsed.data;

    // 7. Determine current canvas state
    const currentCanvasState: AppointmentState
      = (appointment.canvasState as AppointmentState) ?? 'waiting';

    // Check if already in terminal state
    const terminalStates: AppointmentState[] = ['complete', 'cancelled', 'no_show'];
    if (terminalStates.includes(currentCanvasState)) {
      return Response.json(
        {
          error: {
            code: 'ALREADY_TERMINAL',
            message: `Appointment is already in terminal state: ${currentCanvasState}`,
            reason: 'already_terminal',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    // 8. Load artifacts
    const artifacts = await db.query.appointmentArtifactsSchema.findFirst({
      where: eq(appointmentArtifactsSchema.appointmentId, appointmentId),
    });

    const beforePhotoUploaded = !!artifacts?.beforePhotoUrl;
    const afterPhotoUploaded = !!artifacts?.afterPhotoUrl;

    // 9. Load policies
    const salonPolicyRow = await db.query.salonPoliciesSchema.findFirst({
      where: eq(salonPoliciesSchema.salonId, session.salonId),
    });

    const superAdminPolicyRow = await db.query.superAdminPoliciesSchema.findFirst({
      where: eq(superAdminPoliciesSchema.id, 'singleton'),
    });

    // Build policy objects with defaults
    const salonPolicy = {
      requireBeforePhotoToStart: salonPolicyRow?.requireBeforePhotoToStart ?? 'off',
      requireAfterPhotoToFinish: salonPolicyRow?.requireAfterPhotoToFinish ?? 'off',
      requireAfterPhotoToPay: salonPolicyRow?.requireAfterPhotoToPay ?? 'off',
      autoPostEnabled: salonPolicyRow?.autoPostEnabled ?? false,
      autoPostPlatforms: (salonPolicyRow?.autoPostPlatforms ?? []) as Array<'instagram' | 'facebook' | 'tiktok'>,
      autoPostIncludePrice: salonPolicyRow?.autoPostIncludePrice ?? false,
      autoPostIncludeColor: salonPolicyRow?.autoPostIncludeColor ?? false,
      autoPostIncludeBrand: salonPolicyRow?.autoPostIncludeBrand ?? false,
      autoPostAIcaptionEnabled: salonPolicyRow?.autoPostAiCaptionEnabled ?? false,
    };

    const superAdminPolicy = {
      requireBeforePhotoToStart: superAdminPolicyRow?.requireBeforePhotoToStart ?? undefined,
      requireAfterPhotoToFinish: superAdminPolicyRow?.requireAfterPhotoToFinish ?? undefined,
      requireAfterPhotoToPay: superAdminPolicyRow?.requireAfterPhotoToPay ?? undefined,
      autoPostEnabled: superAdminPolicyRow?.autoPostEnabled ?? undefined,
      autoPostAIcaptionEnabled: superAdminPolicyRow?.autoPostAiCaptionEnabled ?? undefined,
    };

    // 10. Resolve effective policy
    const effectivePolicy = resolveEffectivePolicy({
      salon: salonPolicy,
      superAdmin: superAdminPolicy,
    });

    // 10b. A deposit hold is not transitionable by anyone. THIS IS THE PAYMENT
    // BYPASS FENCE, and it is deliberately evaluated BEFORE canTransition:
    // this route otherwise gates only on `canvas_state` and CASes against the
    // row's own status, so the assigned technician could drive a hold
    // waiting -> working (status becomes 'in_progress') in a single call and
    // then complete it — serving an unpaid deposit booking, stranding the
    // deposit row at 'checkout_created' forever (the reaper keys on
    // status='awaiting_payment'), and mis-routing D5's confirm CAS to its
    // late-payment branch. Placing it ahead of the policy check also means the
    // refusal cannot be masked by a salon whose photo policy happens to block
    // the same transition for an unrelated reason.
    if (appointment.status === 'awaiting_payment') {
      return Response.json(
        {
          error: {
            code: 'HOLD_LOCKED',
            message: 'This appointment is awaiting a deposit payment and cannot be changed.',
            reason: 'hold_locked',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    // 11. Check transition with state machine
    const transition = { from: currentCanvasState, to } as Transition;
    const result = canTransition({
      transition,
      policy: effectivePolicy,
      artifacts: { beforePhotoUploaded, afterPhotoUploaded },
    });

    if (!result.allowed) {
      return Response.json(
        {
          error: {
            code: 'TRANSITION_BLOCKED',
            message: 'Transition blocked by policy',
            reason: result.reason,
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    const technicianName = session.technicianName;

    // 13. Update appointment
    const now = new Date();
    const updateData: Record<string, unknown> = {
      canvasState: to,
      canvasStateUpdatedAt: now,
      updatedAt: now,
    };

    // Keep the legacy status column in sync so the owner dashboard,
    // availability engine, and analytics see staff-driven state changes.
    const legacyStatus = canvasStateToLegacyStatus(to);
    if (legacyStatus) {
      updateData.status = legacyStatus;
      if (legacyStatus === 'no_show' || legacyStatus === 'cancelled') {
        updateData.cancelReason = legacyStatus === 'no_show' ? 'no_show' : 'client_request';
      }
    }

    // Set startedAt if transitioning to 'working' and not already set
    if (to === 'working' && !appointment.startedAt) {
      updateData.startedAt = now;
    }

    // STEP 16A: Lock appointment when transitioning to 'working'
    // This prevents edits once service starts (except admin override)
    if (to === 'working' && !appointment.lockedAt) {
      updateData.lockedAt = now;
      updateData.lockedBy = session.technicianId;
    }

    // Set completedAt if transitioning to terminal state and not already set
    if (terminalStates.includes(to as AppointmentState) && !appointment.completedAt) {
      updateData.completedAt = now;
    }

    const updated = await withClientLifecycleTransactionRetry(() =>
      db.transaction(async (tx) => {
        const handle = tx as LifecycleSqlHandle;
        // waiting -> working enters service and must serialize with booking.
        // working -> wrap_up remains the same already-active appointment, so
        // its appointment CAS is sufficient and old operational profiles are
        // not newly required merely to advance the staff canvas.
        const activatesAppointment = legacyStatus === 'in_progress'
          && appointment.status !== 'in_progress';
        let terminalClientId: string | null = null;

        if (activatesAppointment) {
          const preliminaryIdentity = appointment.salonClientId
            ? { terminal: await resolveTerminalSalonClientWithHandle(handle, {
                salonId: appointment.salonId,
                clientId: appointment.salonClientId,
                allowArchived: true,
              }) }
            : await resolveCanonicalSalonClientIdentityWithHandle(handle, {
              salonId: appointment.salonId,
              phone: appointment.clientPhone,
              email: appointment.clientEmail,
              allowArchived: true,
            });
          if (!preliminaryIdentity) {
            throw new TransitionConflictError();
          }
          const terminal = await lockOperationalSalonClientContactWithHandle(
            handle,
            {
              salonId: appointment.salonId,
              clientId: preliminaryIdentity.terminal.id,
              allowArchived: true,
            },
          );
          terminalClientId = terminal.id;

          if (appointment.technicianId) {
            await lockTechnicianAndAssertSlotFree(tx, {
              salonId: appointment.salonId,
              technicianId: appointment.technicianId,
              startTime: appointment.startTime,
              blockedEndTime: blockedEndTime(appointment),
              excludedAppointmentId: appointmentId,
            });
          }
        }

        const [lockedAppointment] = await tx
          .select()
          .from(appointmentSchema)
          .where(and(
            eq(appointmentSchema.id, appointmentId),
            eq(appointmentSchema.salonId, session.salonId),
            eq(appointmentSchema.technicianId, session.technicianId),
          ))
          .for('update')
          .limit(1);
        if (
          !lockedAppointment
          || lockedAppointment.status !== appointment.status
          || lockedAppointment.canvasState !== appointment.canvasState
        ) {
          return null;
        }

        if (activatesAppointment) {
          if (
            !terminalClientId
            || lockedAppointment.technicianId !== appointment.technicianId
            || lockedAppointment.startTime.getTime() !== appointment.startTime.getTime()
            || lockedAppointment.endTime.getTime() !== appointment.endTime.getTime()
            || lockedAppointment.totalDurationMinutes
            !== appointment.totalDurationMinutes
            || lockedAppointment.bufferMinutes !== appointment.bufferMinutes
            || lockedAppointment.blockedDurationMinutes
            !== appointment.blockedDurationMinutes
          ) {
            throw new TransitionConflictError();
          }
          const lockedIdentity = lockedAppointment.salonClientId
            ? { terminal: await resolveTerminalSalonClientWithHandle(handle, {
                salonId: lockedAppointment.salonId,
                clientId: lockedAppointment.salonClientId,
                allowArchived: true,
              }) }
            : await resolveCanonicalSalonClientIdentityWithHandle(handle, {
              salonId: lockedAppointment.salonId,
              phone: lockedAppointment.clientPhone,
              email: lockedAppointment.clientEmail,
              allowArchived: true,
            });
          if (!lockedIdentity || lockedIdentity.terminal.id !== terminalClientId) {
            throw new TransitionConflictError();
          }
          const activeAppointments
            = await getActiveAppointmentsForCanonicalClientWithHandle(handle, {
              salonId: lockedAppointment.salonId,
              terminalClientId,
              horizon: 'lineage-active',
              excludeAppointmentId: appointmentId,
              allowArchived: true,
            });
          if (activeAppointments.length > 0) {
            throw new TransitionConflictError();
          }
        }

        const [winner] = await tx
          .update(appointmentSchema)
          .set(updateData)
          .where(
            and(
              eq(appointmentSchema.id, appointmentId),
              eq(appointmentSchema.salonId, session.salonId),
              eq(appointmentSchema.technicianId, session.technicianId),
              eq(appointmentSchema.status, appointment.status),
              // Belt and braces for the pre-read guard above: a row that became
              // a hold between the pre-read and this CAS must not be moved.
              ne(appointmentSchema.status, 'awaiting_payment'),
              appointment.canvasState == null
                ? isNull(appointmentSchema.canvasState)
                : eq(appointmentSchema.canvasState, appointment.canvasState),
              isNull(appointmentSchema.deletedAt),
            ),
          )
          .returning();
        return winner ?? null;
      }));

    if (!updated) {
      return Response.json(
        {
          error: {
            code: 'STALE_STATE',
            message: 'Appointment state changed before this transition completed.',
            reason: 'stale_state',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    // Staff cancellations and no-shows release the technician's time; the
    // linked Google Calendar event must be removed like the owner cancel path.
    if (legacyStatus === 'cancelled' || legacyStatus === 'no_show') {
      await enqueueGoogleCalendarDelete({
        appointmentId,
        salonId: session.salonId,
        googleCalendarEventId: appointment.googleCalendarEventId,
      });
    }

    // 14. Audit logging (Step 16A)
    // Log state transition
    await logAppointmentChange({
      appointmentId,
      salonId: session.salonId,
      action: 'status_changed',
      performedBy: `staff:${session.technicianId}`,
      performedByRole: 'staff',
      performedByName: technicianName,
      previousValue: { canvasState: currentCanvasState, status: appointment.status },
      newValue: { canvasState: to, ...(legacyStatus ? { status: legacyStatus } : {}) },
    });

    // Log locking if it happened
    if (to === 'working' && !appointment.lockedAt && appointment.technicianId) {
      await logAppointmentLocked(
        appointmentId,
        session.salonId,
        session.technicianId,
        technicianName,
      );
    }

    // 15. Return updated appointment
    return Response.json({
      data: {
        appointment: {
          id: updated.id,
          canvasState: updated.canvasState,
          canvasStateUpdatedAt: updated.canvasStateUpdatedAt,
          startedAt: updated.startedAt,
          completedAt: updated.completedAt,
          lockedAt: updated.lockedAt,
          lockedBy: updated.lockedBy,
        },
      },
    });
  } catch (error) {
    if (
      error instanceof TransitionConflictError
      || error instanceof SlotConflictError
      || error instanceof ClientLifecycleStabilizationError
    ) {
      return Response.json(
        {
          error: {
            code: 'CLIENT_ACTIVE_APPOINTMENT_CONFLICT',
            message: 'This client already has an active appointment.',
            reason: 'client_active_appointment',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }
    console.error('Error transitioning appointment:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to transition appointment',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  }
}
