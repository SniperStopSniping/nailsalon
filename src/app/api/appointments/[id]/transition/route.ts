import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { canTransition } from '@/core/appointments/appointmentStateMachine';
import { resolveEffectivePolicy } from '@/core/appointments/policyResolver';
import type { AppointmentState, Transition } from '@/core/appointments/policyTypes';
import { logAppointmentChange, logAppointmentLocked } from '@/libs/appointmentAudit';
import { requireStaffAppointmentAccess } from '@/libs/staffApiGuards';
import { db } from '@/libs/DB';
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

    const [updated] = await db
      .update(appointmentSchema)
      .set(updateData)
      .where(
        and(
          eq(appointmentSchema.id, appointmentId),
          eq(appointmentSchema.salonId, session.salonId),
          eq(appointmentSchema.technicianId, session.technicianId),
        ),
      )
      .returning();

    // 14. Audit logging (Step 16A)
    // Log state transition
    await logAppointmentChange({
      appointmentId,
      salonId: session.salonId,
      action: 'status_changed',
      performedBy: `staff:${session.technicianId}`,
      performedByRole: 'staff',
      performedByName: technicianName,
      previousValue: { canvasState: currentCanvasState },
      newValue: { canvasState: to },
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
          id: updated!.id,
          canvasState: updated!.canvasState,
          canvasStateUpdatedAt: updated!.canvasStateUpdatedAt,
          startedAt: updated!.startedAt,
          completedAt: updated!.completedAt,
          lockedAt: updated!.lockedAt,
          lockedBy: updated!.lockedBy,
        },
      },
    });
  } catch (error) {
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
