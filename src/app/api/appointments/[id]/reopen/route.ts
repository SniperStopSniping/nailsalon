import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { buildAppointmentAuditRow } from '@/libs/appointmentAudit';
import { resolveCheckoutActor } from '@/libs/appointmentCheckoutServer';
import { db } from '@/libs/DB';
import { updateSalonClientStats } from '@/libs/queries';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';
import {
  appointmentAuditLogSchema,
  appointmentPaymentLinkSchema,
  appointmentSchema,
} from '@/models/Schema';

// =============================================================================
// POST /api/appointments/[id]/reopen — reopen a completed appointment
// =============================================================================
// Admin-only escape hatch for completion mistakes. Returns the appointment to
// 'in_progress'; the checkout snapshots (final items, tax, payments) are kept
// and replaced wholesale by the next completion. Payments are NEVER deleted —
// the balance simply recomputes against the new totals. Client stats/points
// recompute post-commit (spend drops while reopened; the reconcile floors at
// zero and preserves non-spend bonuses).
// =============================================================================

const reopenSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

function errorJson(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;
    const access = await requireAppointmentManagerAccess(appointmentId, {
      wrongRoleMessage: 'Only salon admins can reopen a completed appointment',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
      salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
    });
    if (!access.ok) {
      return access.response;
    }
    if (access.actorRole !== 'admin') {
      return errorJson(403, 'FORBIDDEN', 'Only salon admins can reopen a completed appointment');
    }

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // empty body is fine
    }
    const validated = reopenSchema.safeParse(body);
    if (!validated.success) {
      return errorJson(400, 'VALIDATION_ERROR', 'Invalid request data');
    }

    const actor = resolveCheckoutActor(access);
    const now = new Date();

    const reopened = await db.transaction(async (tx) => {
      // CAS: only a completed appointment can be reopened; double-reopen is a no-op.
      const updateResult = await tx
        .update(appointmentSchema)
        .set({
          status: 'in_progress',
          canvasState: 'working',
          canvasStateUpdatedAt: now,
          completedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(appointmentSchema.id, appointmentId),
            eq(appointmentSchema.salonId, access.appointment.salonId),
            eq(appointmentSchema.status, 'completed'),
            isNotNull(appointmentSchema.completedAt),
          ),
        )
        .returning();

      if (updateResult.length === 0) {
        return null;
      }

      // The payment-instruction page reflects a completed checkout — revoke.
      await tx
        .update(appointmentPaymentLinkSchema)
        .set({ revokedAt: now })
        .where(
          and(
            eq(appointmentPaymentLinkSchema.appointmentId, appointmentId),
            isNull(appointmentPaymentLinkSchema.revokedAt),
          ),
        );

      await tx.insert(appointmentAuditLogSchema).values(
        buildAppointmentAuditRow({
          appointmentId,
          salonId: access.appointment.salonId,
          action: 'reopened',
          performedBy: actor.performedBy,
          performedByRole: actor.performedByRole,
          performedByName: actor.performedByName ?? undefined,
          previousValue: { status: 'completed' },
          newValue: { status: 'in_progress' },
          reason: validated.data.reason,
        }),
      );

      return updateResult[0]!;
    });

    if (!reopened) {
      return errorJson(409, 'INVALID_STATE', 'Only completed appointments can be reopened');
    }

    try {
      await updateSalonClientStats(reopened.salonId, reopened.clientPhone);
    } catch (statsError) {
      console.error('Failed to update salon client stats (non-fatal):', statsError);
    }

    return Response.json({
      data: {
        appointment: {
          id: appointmentId,
          status: 'in_progress',
          completedAt: null,
        },
      },
    });
  } catch (error) {
    console.error('Error reopening appointment:', error);
    return errorJson(500, 'INTERNAL_ERROR', 'Failed to reopen appointment');
  }
}
