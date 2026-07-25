import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { getActiveAppointmentsForCanonicalClientWithHandle } from '@/libs/activeAppointments';
import { buildAppointmentAuditRow } from '@/libs/appointmentAudit';
import { resolveCheckoutActor } from '@/libs/appointmentCheckoutServer';
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

class ReopenConflictError extends Error {}

function errorJson(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

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

    const reopened = await withClientLifecycleTransactionRetry(() =>
      db.transaction(async (tx) => {
        const handle = tx as LifecycleSqlHandle;
        const snapshot = access.appointment;
        const preliminaryIdentity = snapshot.salonClientId
          ? { terminal: await resolveTerminalSalonClientWithHandle(handle, {
              salonId: snapshot.salonId,
              clientId: snapshot.salonClientId,
              allowArchived: true,
            }) }
          : await resolveCanonicalSalonClientIdentityWithHandle(handle, {
            salonId: snapshot.salonId,
            phone: snapshot.clientPhone,
            email: snapshot.clientEmail,
            allowArchived: true,
          });
        if (!preliminaryIdentity) {
          throw new ReopenConflictError();
        }

        // Global order: terminal client, technician advisory lock, appointment.
        const terminal = await lockOperationalSalonClientContactWithHandle(
          handle,
          {
            salonId: snapshot.salonId,
            clientId: preliminaryIdentity.terminal.id,
            allowArchived: true,
          },
        );
        if (snapshot.technicianId) {
          await lockTechnicianAndAssertSlotFree(tx, {
            salonId: snapshot.salonId,
            technicianId: snapshot.technicianId,
            startTime: snapshot.startTime,
            blockedEndTime: blockedEndTime(snapshot),
            excludedAppointmentId: appointmentId,
          });
        }

        const [lockedAppointment] = await tx
          .select()
          .from(appointmentSchema)
          .where(and(
            eq(appointmentSchema.id, appointmentId),
            eq(appointmentSchema.salonId, snapshot.salonId),
          ))
          .for('update')
          .limit(1);
        if (
          !lockedAppointment
          || lockedAppointment.technicianId !== snapshot.technicianId
          || lockedAppointment.startTime.getTime() !== snapshot.startTime.getTime()
          || lockedAppointment.endTime.getTime() !== snapshot.endTime.getTime()
          || lockedAppointment.totalDurationMinutes
          !== snapshot.totalDurationMinutes
          || lockedAppointment.bufferMinutes !== snapshot.bufferMinutes
          || lockedAppointment.blockedDurationMinutes
          !== snapshot.blockedDurationMinutes
        ) {
          throw new ReopenConflictError();
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
        if (!lockedIdentity || lockedIdentity.terminal.id !== terminal.id) {
          throw new ReopenConflictError();
        }

        const activeAppointments
          = await getActiveAppointmentsForCanonicalClientWithHandle(handle, {
            salonId: lockedAppointment.salonId,
            terminalClientId: terminal.id,
            horizon: 'lineage-active',
            excludeAppointmentId: appointmentId,
            allowArchived: true,
          });
        if (activeAppointments.length > 0) {
          throw new ReopenConflictError();
        }

        // CAS: only a completed appointment can win. Dependent mutations are
        // gated on the returned row and remain in this transaction.
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
              eq(appointmentSchema.salonId, snapshot.salonId),
              eq(appointmentSchema.status, 'completed'),
              isNotNull(appointmentSchema.completedAt),
              isNull(appointmentSchema.deletedAt),
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
            salonId: snapshot.salonId,
            action: 'reopened',
            performedBy: actor.performedBy,
            performedByRole: actor.performedByRole,
            performedByName: actor.performedByName ?? undefined,
            previousValue: { status: 'completed' },
            newValue: { status: 'in_progress' },
            reason: validated.data.reason,
          }),
        );

        return {
          appointment: updateResult[0]!,
          operationalPhone: terminal.phone,
        };
      }));

    if (!reopened) {
      return errorJson(409, 'INVALID_STATE', 'Only completed appointments can be reopened');
    }

    try {
      await updateSalonClientStats(
        reopened.appointment.salonId,
        reopened.operationalPhone,
      );
    } catch (statsError) {
      console.error('Failed to update salon client stats (non-fatal):', statsError);
    }

    return Response.json({
      data: {
        appointment: {
          id: reopened.appointment.id,
          status: 'in_progress',
          completedAt: null,
        },
      },
    });
  } catch (error) {
    if (
      error instanceof ReopenConflictError
      || error instanceof SlotConflictError
      || error instanceof ClientLifecycleStabilizationError
    ) {
      return errorJson(
        409,
        'CLIENT_ACTIVE_APPOINTMENT_CONFLICT',
        'This client already has an active appointment.',
      );
    }
    console.error('Error reopening appointment:', error);
    return errorJson(500, 'INTERNAL_ERROR', 'Failed to reopen appointment');
  }
}
