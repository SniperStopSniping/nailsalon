import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { evaluateAndFlagIfNeeded } from '@/libs/fraudDetection';
import { computeEarnedPointsFromCents } from '@/libs/pointsCalculation';
import { getAppointmentById, getOrCreateSalonClient, updateSalonClientStats } from '@/libs/queries';
import { appointmentPhotoSchema, appointmentSchema } from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const completeAppointmentSchema = z.object({
  // paymentStatus is NOT configurable - always 'paid' on completion
  // This ensures fraud queries (which filter payment_status='paid') stay consistent
  // If you need non-paid completions, use a different endpoint or status
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

    // 2. Verify appointment exists (initial check for 404 and photo validation)
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

    // 3. Check for required "after" photos (unless bypassed)
    // Do this BEFORE the atomic update to fail fast
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

    // 4. ATOMIC UPDATE + STATS in transaction
    // This prevents race conditions and ensures points are awarded atomically with completion
    const now = new Date();
    const validStates = ['confirmed', 'in_progress'] as const;

    // Use transaction to ensure atomic status update + stats update
    const result = await db.transaction(async (tx) => {
      // 4a. Atomic update - only succeeds if in valid state AND not already completed
      // completedAt IS NULL prevents double-completion even if status check passes
      // paymentStatus is ALWAYS 'paid' - this ensures consistency with fraud queries
      const updateResult = await tx
        .update(appointmentSchema)
        .set({
          status: 'completed',
          paymentStatus: 'paid', // HARD-CODED: fraud queries filter payment_status='paid'
          completedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(appointmentSchema.id, appointmentId),
            inArray(appointmentSchema.status, [...validStates]),
            isNull(appointmentSchema.completedAt), // Extra safety: prevent re-completion
          ),
        )
        .returning();

      if (updateResult.length === 0) {
        // Atomic update failed - will handle outside transaction
        return { success: false as const, idempotent: true as const, updatedAppointment: null };
      }

      const completedAppointment = updateResult[0]!;

      // 4b. Award points INSIDE transaction - only if atomic update succeeded
      // This ensures points are awarded exactly once
      try {
        await updateSalonClientStats(
          completedAppointment.salonId,
          completedAppointment.clientPhone,
        );
      } catch (statsError) {
        // Log but don't fail the transaction - points can be recalculated
        // The critical thing is the completion status is set
        console.error('Failed to update salon client stats (non-fatal):', statsError);
      }

      return { success: true as const, idempotent: false as const, updatedAppointment: completedAppointment };
    });

    // 5. Handle transaction result
    // CRITICAL: Check idempotent flag EXPLICITLY - fraud eval MUST NOT run on idempotent completions
    if (!result.success) {
      // Atomic update failed - re-fetch to determine why
      const currentAppointment = await getAppointmentById(appointmentId);

      if (currentAppointment?.status === 'completed') {
        // IDEMPOTENT: Already completed - return current state
        // DO NOT run fraud eval or points - already processed on first completion
        return Response.json({
          data: {
            appointment: {
              id: appointmentId,
              status: 'completed',
              paymentStatus: currentAppointment.paymentStatus ?? 'paid',
              completedAt: currentAppointment.completedAt ?? now,
            },
          },
        } satisfies SuccessResponse);
      }

      // Invalid state (cancelled, no_show, pending, etc.)
      return Response.json(
        {
          error: {
            code: 'INVALID_STATE',
            message: `Cannot complete appointment in "${currentAppointment?.status ?? 'unknown'}" status. Must be confirmed or in_progress.`,
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // =========================================================================
    // 6. SUCCESS PATH - Delegate to isolated function
    // Structurally impossible for fraud eval to run on idempotent path
    // because this code is only reachable when result.success === true
    // =========================================================================

    // DEFENSIVE CHECK: If idempotent=true reached here, something is wrong in code logic
    // Don't throw (would cause 500 on legit retries) - log and return idempotent response
    if (result.idempotent) {
      console.warn('[BUG] Unexpected: success=true but idempotent=true - returning idempotent response', {
        appointmentId,
      });
      // Return idempotent 200 - no points/fraud eval (they already ran on first completion)
      return Response.json({
        data: {
          appointment: {
            id: appointmentId,
            status: 'completed',
            paymentStatus: 'paid',
            completedAt: now,
          },
        },
      } satisfies SuccessResponse);
    }

    // Type guard: updatedAppointment should be non-null when success=true
    const updatedAppointment = result.updatedAppointment;
    if (!updatedAppointment) {
      console.warn('[BUG] Unexpected: success=true but updatedAppointment is null', {
        appointmentId,
      });
      // Return success without fraud eval - better than 500
      return Response.json({
        data: {
          appointment: {
            id: appointmentId,
            status: 'completed',
            paymentStatus: 'paid',
            completedAt: now,
          },
        },
      } satisfies SuccessResponse);
    }

    return await handleSuccessfulCompletion(
      updatedAppointment, // Now guaranteed non-null by explicit check
      appointmentId,
      now,
    );
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
// HELPER: Process successful (non-idempotent) completion
// =============================================================================
// Structurally isolated so fraud eval ONLY runs on fresh completions.
// This function is ONLY called when result.success === true.
// =============================================================================

async function handleSuccessfulCompletion(
  completedAppointment: NonNullable<typeof appointmentSchema.$inferSelect>,
  appointmentId: string,
  now: Date,
): Promise<Response> {
  // DEFENSIVE CHECK: completedAt must be set (set by atomic update above)
  // This prevents partial/corrupted records from triggering fraud eval
  if (!completedAppointment.completedAt) {
    console.error('[BUG] handleSuccessfulCompletion called with null completedAt', {
      appointmentId,
      status: completedAppointment.status,
    });
    // Still return success (appointment is completed), but skip fraud eval
    return Response.json({
      data: {
        appointment: {
          id: appointmentId,
          status: 'completed',
          paymentStatus: 'paid',
          completedAt: now,
        },
      },
    } satisfies SuccessResponse);
  }

  // 6a. Get or repair salonClientId if missing (legacy data)
  // MUST await this and succeed before fraud eval
  // Use null (not undefined) for "missing" - consistent with DB NULL
  let salonClientId: string | null = completedAppointment.salonClientId;

  if (!salonClientId) {
    // Self-healing: resolve and repair for legacy appointments
    try {
      const salonClient = await getOrCreateSalonClient(
        completedAppointment.salonId,
        completedAppointment.clientPhone,
        completedAppointment.clientName ?? undefined,
      );
      if (salonClient?.id) {
        // Repair the appointment row - await and verify exactly 1 row updated
        const updateResult = await db
          .update(appointmentSchema)
          .set({ salonClientId: salonClient.id })
          .where(eq(appointmentSchema.id, appointmentId))
          .returning();

        if (updateResult.length === 1) {
          // Repair succeeded - use the resolved ID for fraud eval
          salonClientId = salonClient.id;
        } else {
          // Unexpected: row not found or multiple rows
          console.error('[FraudDetection] Legacy repair: unexpected update count', {
            appointmentId,
            salonId: completedAppointment.salonId,
            expectedRows: 1,
            actualRows: updateResult.length,
          });
          // salonClientId stays null - fraud eval will be skipped
        }
      } else {
        // getOrCreateSalonClient returned null (invalid phone) - skip fraud eval
        // Import normalizePhone inline to get normalized value for logging
        const { normalizePhone } = await import('@/libs/phone');
        console.warn('[FraudDetection] Legacy repair skipped: invalid phone', {
          appointmentId,
          salonId: completedAppointment.salonId,
          rawPhone: completedAppointment.clientPhone,
          normalizedPhone: normalizePhone(completedAppointment.clientPhone),
        });
        // salonClientId stays null - fraud eval will be skipped
      }
    } catch (repairError) {
      // Repair failed - log with structured fields and skip fraud eval
      // Do NOT write anything to DB - salonClientId stays null
      const { normalizePhone } = await import('@/libs/phone');
      console.error('[FraudDetection] Legacy repair failed', {
        appointmentId,
        salonId: completedAppointment.salonId,
        rawPhone: completedAppointment.clientPhone,
        normalizedPhone: normalizePhone(completedAppointment.clientPhone),
        error: repairError instanceof Error ? repairError.message : String(repairError),
      });
      // salonClientId stays null - fraud eval will be skipped
    }
  }

  // 6b. Evaluate fraud signals (fire-and-forget)
  // ONLY run if salonClientId exists
  //
  // IMPORTANT: paymentStatus is always 'paid' (hard-coded in atomic update above).
  // If you ever re-introduce unpaid/comp completions:
  //   - Add: if (completedAppointment.paymentStatus !== 'paid') skip points + fraud
  //   - Enforce it HERE (this one place), not elsewhere
  //   - Fraud queries filter payment_status='paid', so unpaid must skip eval
  //
  if (salonClientId) {
    // Observability: log when fraud eval is triggered (helps debugging)
    console.info('[FraudDetection] fraud_eval_triggered', {
      appointmentId,
      salonClientId,
      salonId: completedAppointment.salonId,
    });

    const pointsEarnedThisAppt = computeEarnedPointsFromCents(completedAppointment.totalPrice);
    // Fire-and-forget - don't block response
    evaluateAndFlagIfNeeded(
      completedAppointment.salonId,
      salonClientId,
      appointmentId,
      pointsEarnedThisAppt,
    ).catch((err) => {
      console.error('[FraudDetection] Evaluation failed (non-blocking):', err);
    });
  }

  // 7. Return success response
  // paymentStatus is always 'paid' (hard-coded in atomic update)
  return Response.json({
    data: {
      appointment: {
        id: appointmentId,
        status: 'completed',
        paymentStatus: 'paid',
        completedAt: completedAppointment.completedAt,
      },
    },
  } satisfies SuccessResponse);
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
