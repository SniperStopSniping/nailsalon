import { and, eq } from 'drizzle-orm';

import { buildAppointmentAuditRow } from '@/libs/appointmentAudit';
import {
  resolveCheckoutActor,
  sumNonVoidedPayments,
} from '@/libs/appointmentCheckoutServer';
import { computeBalance, derivePaymentStatus } from '@/libs/checkoutTotals';
import { db } from '@/libs/DB';
import { updateSalonClientStats } from '@/libs/queries';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';
import {
  appointmentAuditLogSchema,
  appointmentPaymentSchema,
  appointmentSchema,
} from '@/models/Schema';

// =============================================================================
// POST /api/appointments/[id]/payments/[paymentId]/void — void a payment
// =============================================================================
// Admin-only. Payments are never deleted; corrections are voids so payment
// history stays intact. amount_paid_cents and payment status are recomputed
// from the remaining non-voided rows.
// =============================================================================

function errorJson(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: { id: string; paymentId: string } },
): Promise<Response> {
  try {
    const { id: appointmentId, paymentId } = params;
    const access = await requireAppointmentManagerAccess(appointmentId, {
      assignedOnly: true,
      wrongRoleMessage: 'Only salon admins can void payments',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
      salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
    });
    if (!access.ok) {
      return access.response;
    }
    if (access.actorRole !== 'admin') {
      return errorJson(403, 'FORBIDDEN', 'Only salon admins can void payments');
    }

    const actor = resolveCheckoutActor(access);
    const now = new Date();

    const result = await db.transaction(async (tx) => {
      const [appointment] = await tx
        .select()
        .from(appointmentSchema)
        .where(
          and(
            eq(appointmentSchema.id, appointmentId),
            eq(appointmentSchema.salonId, access.appointment.salonId),
          ),
        )
        .for('update')
        .limit(1);
      if (!appointment) {
        return { kind: 'error' as const, response: errorJson(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found') };
      }

      const [payment] = await tx
        .select()
        .from(appointmentPaymentSchema)
        .where(
          and(
            eq(appointmentPaymentSchema.id, paymentId),
            eq(appointmentPaymentSchema.appointmentId, appointmentId),
            eq(appointmentPaymentSchema.salonId, appointment.salonId),
          ),
        )
        .limit(1);
      if (!payment) {
        return { kind: 'error' as const, response: errorJson(404, 'PAYMENT_NOT_FOUND', 'Payment not found') };
      }
      if (payment.voidedAt) {
        return { kind: 'error' as const, response: errorJson(409, 'ALREADY_VOIDED', 'Payment is already voided') };
      }

      await tx
        .update(appointmentPaymentSchema)
        .set({ voidedAt: now, voidedBy: actor.recordedById })
        .where(eq(appointmentPaymentSchema.id, paymentId));

      const amountPaidCents = await sumNonVoidedPayments(tx, appointmentId);
      const balance = computeBalance({
        finalPriceCents: appointment.finalPriceCents,
        taxAmountCents: appointment.taxAmountCents,
        tipCents: appointment.tipCents,
        amountPaidCents,
        paymentStatus: appointment.paymentStatus,
      });
      const previousStatus = appointment.paymentStatus ?? 'pending';
      // 'comp' is an explicit state, never derived — leave it untouched.
      const nextStatus = previousStatus === 'comp'
        ? 'comp'
        : derivePaymentStatus(balance.totalDueCents, amountPaidCents);

      await tx
        .update(appointmentSchema)
        .set({ amountPaidCents, paymentStatus: nextStatus, updatedAt: now })
        .where(eq(appointmentSchema.id, appointmentId));

      const auditRows = [
        buildAppointmentAuditRow({
          appointmentId,
          salonId: appointment.salonId,
          action: 'payment_voided',
          performedBy: actor.performedBy,
          performedByRole: actor.performedByRole,
          performedByName: actor.performedByName ?? undefined,
          previousValue: {
            paymentId,
            amountCents: payment.amountCents,
            method: payment.method,
          },
          newValue: { amountPaidCents },
        }),
      ];
      if (nextStatus !== previousStatus) {
        auditRows.push(buildAppointmentAuditRow({
          appointmentId,
          salonId: appointment.salonId,
          action: 'payment_status_changed',
          performedBy: actor.performedBy,
          performedByRole: actor.performedByRole,
          performedByName: actor.performedByName ?? undefined,
          previousValue: { paymentStatus: previousStatus },
          newValue: { paymentStatus: nextStatus },
        }));
      }
      await tx.insert(appointmentAuditLogSchema).values(auditRows);

      return {
        kind: 'voided' as const,
        appointment,
        amountPaidCents,
        previousStatus,
        nextStatus,
        totalDueCents: balance.totalDueCents,
      };
    });

    if (result.kind === 'error') {
      return result.response;
    }

    // Spend-based stats must drop the voided amount when the row leaves 'paid'.
    if (result.previousStatus === 'paid' && result.nextStatus !== 'paid') {
      try {
        await updateSalonClientStats(result.appointment.salonId, result.appointment.clientPhone);
      } catch (statsError) {
        console.error('Failed to update salon client stats (non-fatal):', statsError);
      }
    }

    return Response.json({
      data: {
        paymentStatus: result.nextStatus,
        amountPaidCents: result.amountPaidCents,
        totalDueCents: result.totalDueCents,
        balanceCents: Math.max(0, result.totalDueCents - result.amountPaidCents),
      },
    });
  } catch (error) {
    console.error('Error voiding payment:', error);
    return errorJson(500, 'INTERNAL_ERROR', 'Failed to void payment');
  }
}
