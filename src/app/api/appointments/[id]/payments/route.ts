import crypto from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { buildAppointmentAuditRow } from '@/libs/appointmentAudit';
import {
  resolveCheckoutActor,
  sumNonVoidedPayments,
} from '@/libs/appointmentCheckoutServer';
import { computeBalance, derivePaymentStatus } from '@/libs/checkoutTotals';
import { db } from '@/libs/DB';
import { evaluateAndFlagIfNeeded } from '@/libs/fraudDetection';
import { computeEarnedPointsFromCents } from '@/libs/pointsCalculation';
import { updateSalonClientStats } from '@/libs/queries';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';
import {
  appointmentAuditLogSchema,
  appointmentPaymentLinkSchema,
  appointmentPaymentSchema,
  appointmentSchema,
  PAYMENT_METHODS,
} from '@/models/Schema';

// =============================================================================
// POST /api/appointments/[id]/payments — record a payment
// =============================================================================
// Supports multiple (partial) payments per appointment. amount_paid_cents is
// always recomputed from the non-voided payment rows under a row lock — never
// incremented — so concurrent recordings cannot drift it. Fraud/points fire
// exactly once, on the transition to fully paid.
// =============================================================================

const recordPaymentSchema = z.object({
  amountCents: z.number().int().min(1).max(5_000_000),
  method: z.enum(PAYMENT_METHODS).optional(),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

type ErrorBody = { error: { code: string; message: string; details?: unknown } };

function errorJson(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } } satisfies ErrorBody,
    { status },
  );
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;
    const access = await requireAppointmentManagerAccess(appointmentId, {
      assignedOnly: true,
      wrongRoleMessage: 'Only salon staff or admins can record payments',
      assignmentForbiddenMessage: 'You can only record payments for your own appointments',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
      salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
    });
    if (!access.ok) {
      return access.response;
    }

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // fall through to validation error
    }
    const validated = recordPaymentSchema.safeParse(body);
    if (!validated.success) {
      return errorJson(400, 'VALIDATION_ERROR', 'Invalid request data', validated.error.flatten());
    }
    const payment = validated.data;
    const actor = resolveCheckoutActor(access);
    const now = new Date();

    const result = await db.transaction(async (tx) => {
      // Row lock: serializes concurrent payment recordings for this appointment.
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
      if (appointment.status !== 'completed') {
        return {
          kind: 'error' as const,
          response: errorJson(409, 'INVALID_STATE', 'Payments can only be recorded on completed appointments'),
        };
      }
      if (appointment.paymentStatus === 'comp') {
        return {
          kind: 'error' as const,
          response: errorJson(409, 'INVALID_STATE', 'Complimentary appointments do not take payments'),
        };
      }

      const balance = computeBalance({
        finalPriceCents: appointment.finalPriceCents,
        taxAmountCents: appointment.taxAmountCents,
        tipCents: appointment.tipCents,
        amountPaidCents: await sumNonVoidedPayments(tx, appointmentId),
        paymentStatus: appointment.paymentStatus,
      });
      if (payment.amountCents > balance.balanceCents) {
        return {
          kind: 'error' as const,
          response: errorJson(422, 'PAYMENT_EXCEEDS_BALANCE', 'Payment exceeds the remaining balance', {
            balanceCents: balance.balanceCents,
          }),
        };
      }

      await tx.insert(appointmentPaymentSchema).values({
        id: `pay_${crypto.randomUUID()}`,
        appointmentId,
        salonId: appointment.salonId,
        amountCents: payment.amountCents,
        method: payment.method ?? null,
        reference: payment.reference ?? null,
        note: payment.note ?? null,
        recordedByType: actor.recordedByType,
        recordedById: actor.recordedById,
        recordedByName: actor.recordedByName,
        recordedAt: now,
      });

      // Recompute from source — never increment.
      const amountPaidCents = await sumNonVoidedPayments(tx, appointmentId);
      const previousStatus = appointment.paymentStatus ?? 'pending';
      const nextStatus = derivePaymentStatus(balance.totalDueCents, amountPaidCents);

      await tx
        .update(appointmentSchema)
        .set({
          amountPaidCents,
          paymentStatus: nextStatus,
          ...(appointment.paymentMethod === null && payment.method
            ? { paymentMethod: payment.method }
            : {}),
          updatedAt: now,
        })
        .where(eq(appointmentSchema.id, appointmentId));

      const auditRows = [
        buildAppointmentAuditRow({
          appointmentId,
          salonId: appointment.salonId,
          action: 'payment_recorded',
          performedBy: actor.performedBy,
          performedByRole: actor.performedByRole,
          performedByName: actor.performedByName ?? undefined,
          newValue: {
            amountCents: payment.amountCents,
            method: payment.method ?? null,
            reference: payment.reference ?? null,
            amountPaidCents,
          },
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

      // Once fully paid, the payment-instruction QR page has served its
      // purpose — revoke any outstanding links.
      if (nextStatus === 'paid') {
        await tx
          .update(appointmentPaymentLinkSchema)
          .set({ revokedAt: now })
          .where(
            and(
              eq(appointmentPaymentLinkSchema.appointmentId, appointmentId),
              isNull(appointmentPaymentLinkSchema.revokedAt),
            ),
          );
      }

      return {
        kind: 'recorded' as const,
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

    // Post-commit side effects on the transition to fully paid — mirrors the
    // completion route's paid path (fraud queries only see completed+paid rows).
    if (result.nextStatus === 'paid' && result.previousStatus !== 'paid') {
      const { appointment } = result;
      if (appointment.salonClientId) {
        const points = computeEarnedPointsFromCents(
          appointment.finalPriceCents ?? appointment.totalPrice,
        );
        evaluateAndFlagIfNeeded(
          appointment.salonId,
          appointment.salonClientId,
          appointmentId,
          points,
        ).catch((err) => {
          console.error('[FraudDetection] Evaluation failed (non-blocking):', err);
        });
      }
      try {
        await updateSalonClientStats(appointment.salonId, appointment.clientPhone);
      } catch (statsError) {
        console.error('Failed to update salon client stats (non-fatal):', statsError);
      }
    }

    return Response.json({
      data: {
        payment: {
          amountCents: validated.data.amountCents,
          method: validated.data.method ?? null,
          recordedAt: now,
        },
        paymentStatus: result.nextStatus,
        amountPaidCents: result.amountPaidCents,
        totalDueCents: result.totalDueCents,
        balanceCents: Math.max(0, result.totalDueCents - result.amountPaidCents),
      },
    });
  } catch (error) {
    console.error('Error recording payment:', error);
    return errorJson(500, 'INTERNAL_ERROR', 'Failed to record payment');
  }
}
