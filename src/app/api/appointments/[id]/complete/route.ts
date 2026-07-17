import crypto from 'node:crypto';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/libs/DB';
import { evaluateAndFlagIfNeeded } from '@/libs/fraudDetection';
import { computeEarnedPointsFromCents } from '@/libs/pointsCalculation';
import { getAppointmentById, getOrCreateSalonClient, updateSalonClientStats } from '@/libs/queries';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';
import {
  addOnSchema,
  appointmentAddOnSchema,
  appointmentPhotoSchema,
  appointmentSchema,
  appointmentServicesSchema,
  salonClientSchema,
  serviceSchema,
} from '@/models/Schema';

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const paymentMethodEnum = z.enum(['cash', 'debit', 'credit', 'e_transfer', 'other']);

const completeAppointmentSchema = z.object({
  // paymentStatus is NOT configurable - always 'paid' on completion
  // This ensures fraud queries (which filter payment_status='paid') stay consistent
  // If you need non-paid completions, use a different endpoint or status
  skipPhotoValidation: z.boolean().optional().default(false),

  // Completion record filled by the tech (all optional for back-compat with
  // the previous no-body behavior). finalPriceCents defaults to the booked total.
  finalPriceCents: z.number().int().min(0).max(1_000_000).optional(),
  tipCents: z.number().int().min(0).max(100_000).optional(),
  paymentMethod: paymentMethodEnum.optional(),
  techNotes: z.string().trim().max(2000).optional(),

  // What was actually performed (rewrites the service/add-on snapshot rows).
  // When omitted, the originally-booked services/add-ons are kept as-is.
  performedServiceIds: z.array(z.string()).max(20).optional(),
  performedAddOnIds: z.array(z.string()).max(20).optional(),
});

type CompletePayload = z.infer<typeof completeAppointmentSchema>;

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
      finalPriceCents?: number | null;
      tipCents?: number | null;
      paymentMethod?: string | null;
    };
    // Whether the post-appointment review prompt should be shown to the tech.
    // False once the client is marked as already reviewed on Google.
    showReviewPrompt?: boolean;
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
    const access = await requireAppointmentManagerAccess(appointmentId, {
      assignedOnly: true,
      wrongRoleMessage: 'Only salon staff or admins can complete this appointment',
      assignmentForbiddenMessage: 'You can only complete your own appointments',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
      salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
    });
    if (!access.ok) {
      return access.response;
    }
    const { appointment: existingAppointment } = access;

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
    // 3. Check for required "after" photos (unless bypassed)
    // Do this BEFORE the atomic update to fail fast
    if (!validated.data.skipPhotoValidation) {
      const afterPhotos = await db
        .select({ id: appointmentPhotoSchema.id })
        .from(appointmentPhotoSchema)
        .where(
          and(
            eq(appointmentPhotoSchema.appointmentId, appointmentId),
            eq(appointmentPhotoSchema.salonId, existingAppointment.salonId),
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
          canvasState: 'complete',
          canvasStateUpdatedAt: now,
          completedAt: now,
          updatedAt: now,
          // Completion record — money truth, written atomically with completion.
          // finalPriceCents defaults to the booked total when the tech leaves it blank.
          finalPriceCents: validated.data.finalPriceCents ?? existingAppointment.totalPrice,
          tipCents: validated.data.tipCents ?? 0,
          ...(validated.data.paymentMethod !== undefined ? { paymentMethod: validated.data.paymentMethod } : {}),
          ...(validated.data.techNotes !== undefined ? { techNotes: validated.data.techNotes } : {}),
        })
        .where(
          and(
            eq(appointmentSchema.id, appointmentId),
            eq(appointmentSchema.salonId, existingAppointment.salonId),
            ...(access.actorRole === 'staff'
              ? [eq(appointmentSchema.technicianId, access.session.technicianId)]
              : []),
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

      // NOTE: client stats (visits/spend/points) are recomputed AFTER this
      // transaction commits — see handleSuccessfulCompletion. Doing it here
      // would read the not-yet-committed 'completed' row on a separate
      // connection and undercount the visit by one.
      return { success: true as const, idempotent: false as const, updatedAppointment: completedAppointment };
    });

    // 5. Handle transaction result
    // CRITICAL: Check idempotent flag EXPLICITLY - fraud eval MUST NOT run on idempotent completions
    if (!result.success) {
      // Atomic update failed - re-fetch to determine why
      const currentAppointment = await getAppointmentById(
        appointmentId,
        existingAppointment.salonId,
      );

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
      validated.data,
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

/**
 * Rewrite the service/add-on snapshot rows to reflect what the tech actually
 * performed. Non-fatal: if this fails, the appointment is still completed and
 * the originally-booked rows remain. Builds snapshots from the salon catalog.
 */
async function rewritePerformedItems(
  appointment: NonNullable<typeof appointmentSchema.$inferSelect>,
  payload: CompletePayload,
): Promise<void> {
  const { performedServiceIds, performedAddOnIds } = payload;

  if (performedServiceIds && performedServiceIds.length > 0) {
    const services = await db
      .select()
      .from(serviceSchema)
      .where(and(
        eq(serviceSchema.salonId, appointment.salonId),
        inArray(serviceSchema.id, performedServiceIds),
      ));

    if (services.length > 0) {
      await db.delete(appointmentServicesSchema).where(eq(appointmentServicesSchema.appointmentId, appointment.id));
      await db.insert(appointmentServicesSchema).values(services.map(service => ({
        id: `apptSvc_${crypto.randomUUID()}`,
        appointmentId: appointment.id,
        serviceId: service.id,
        priceAtBooking: service.price,
        durationAtBooking: service.durationMinutes,
        nameSnapshot: service.name,
        categorySnapshot: service.category,
        priceCentsSnapshot: service.price,
        durationMinutesSnapshot: service.durationMinutes,
        priceDisplayTextSnapshot: service.priceDisplayText ?? null,
        resolvedIntroPriceLabelSnapshot: null,
      })));
    }
  }

  if (performedAddOnIds) {
    const addOns = performedAddOnIds.length > 0
      ? await db
        .select()
        .from(addOnSchema)
        .where(and(
          eq(addOnSchema.salonId, appointment.salonId),
          inArray(addOnSchema.id, performedAddOnIds),
        ))
      : [];

    // Replace the whole add-on set (empty array clears them).
    await db.delete(appointmentAddOnSchema).where(eq(appointmentAddOnSchema.appointmentId, appointment.id));
    if (addOns.length > 0) {
      await db.insert(appointmentAddOnSchema).values(addOns.map(addOn => ({
        id: `apptAddon_${crypto.randomUUID()}`,
        appointmentId: appointment.id,
        addOnId: addOn.id,
        quantitySnapshot: 1,
        nameSnapshot: addOn.name,
        categorySnapshot: addOn.category,
        pricingTypeSnapshot: addOn.pricingType,
        unitPriceCentsSnapshot: addOn.priceCents,
        durationMinutesSnapshot: addOn.durationMinutes,
        lineTotalCentsSnapshot: addOn.priceCents,
        lineDurationMinutesSnapshot: addOn.durationMinutes,
      })));
    }
  }
}

async function handleSuccessfulCompletion(
  completedAppointment: NonNullable<typeof appointmentSchema.$inferSelect>,
  appointmentId: string,
  now: Date,
  payload: CompletePayload,
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
          .where(
            and(
              eq(appointmentSchema.id, appointmentId),
              eq(appointmentSchema.salonId, completedAppointment.salonId),
            ),
          )
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
    // eslint-disable-next-line no-console -- intentional info-level observability log
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

  // 6c. Rewrite performed services/add-ons (non-fatal — money truth already saved)
  try {
    await rewritePerformedItems(completedAppointment, payload);
  } catch (rewriteError) {
    console.error('Failed to rewrite performed services/add-ons (non-fatal):', rewriteError);
  }

  // 6c-2. Recompute client stats (visits/spend/points) POST-COMMIT so the just-
  // completed appointment is counted. Non-fatal — stats are recomputable.
  try {
    await updateSalonClientStats(
      completedAppointment.salonId,
      completedAppointment.clientPhone,
    );
  } catch (statsError) {
    console.error('Failed to update salon client stats (non-fatal):', statsError);
  }

  // 6d. Decide whether to show the post-appointment review prompt.
  // Suppressed once the client is marked as already reviewed on Google.
  let showReviewPrompt = false;
  try {
    if (salonClientId) {
      const [client] = await db
        .select({ hasGoogleReview: salonClientSchema.hasGoogleReview })
        .from(salonClientSchema)
        .where(eq(salonClientSchema.id, salonClientId))
        .limit(1);
      showReviewPrompt = !client?.hasGoogleReview;
    } else {
      showReviewPrompt = true;
    }
  } catch (reviewLookupError) {
    console.error('Failed to resolve review prompt state (non-fatal):', reviewLookupError);
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
        finalPriceCents: completedAppointment.finalPriceCents,
        tipCents: completedAppointment.tipCents,
        paymentMethod: completedAppointment.paymentMethod,
      },
      showReviewPrompt,
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
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;
    const access = await requireAppointmentManagerAccess(appointmentId, {
      assignedOnly: true,
      wrongRoleMessage: 'Only salon staff or admins can start this appointment',
      assignmentForbiddenMessage: 'You can only start your own appointments',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
      salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
    });
    if (!access.ok) {
      return access.response;
    }
    const { appointment } = access;

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
        canvasState: 'working',
        canvasStateUpdatedAt: now,
        startedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(appointmentSchema.id, appointmentId),
          eq(appointmentSchema.salonId, appointment.salonId),
          ...(access.actorRole === 'staff'
            ? [eq(appointmentSchema.technicianId, access.session.technicianId)]
            : []),
        ),
      );

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
