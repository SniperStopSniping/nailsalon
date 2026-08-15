import { and, eq } from 'drizzle-orm';

import { buildAppointmentAuditRow } from '@/libs/appointmentAudit';
import {
  listPayments,
  resolveCheckoutActor,
} from '@/libs/appointmentCheckoutServer';
import {
  appointmentFinancialOverpayment,
  resolveAppointmentDepositFinancials,
} from '@/libs/appointmentDepositFinancials';
import { resolveAppointmentPaymentLedger } from '@/libs/appointmentPaymentLedger';
import { validateAppointmentTaxSnapshotChain } from '@/libs/appointmentTaxSnapshot';
import { derivePaymentStatus } from '@/libs/checkoutTotals';
import { db } from '@/libs/DB';
import { loadAppointmentDepositCreditRows } from '@/libs/depositCredit.server';
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

function errorJson(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status },
  );
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

      const depositRows = await loadAppointmentDepositCreditRows({
        salonId: appointment.salonId,
        appointmentId,
        database: tx,
        forUpdate: true,
        appointmentLockHeld: true,
      });

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

      const taxChain = validateAppointmentTaxSnapshotChain(appointment);
      if (!taxChain.ok) {
        return {
          kind: 'error' as const,
          response: errorJson(
            409,
            'TAX_SNAPSHOT_INVALID',
            taxChain.detail,
            { reason: taxChain.code },
          ),
        };
      }

      const paymentRowsBefore = await listPayments(tx, appointmentId);
      const paymentLedgerBefore = resolveAppointmentPaymentLedger({
        cachedAmountPaidCents: appointment.amountPaidCents,
        paymentRows: paymentRowsBefore,
        expectedSalonId: appointment.salonId,
        appointmentStatus: appointment.status,
        paymentStatus: appointment.paymentStatus,
      });
      if (!paymentLedgerBefore.ok) {
        return {
          kind: 'error' as const,
          response: errorJson(409, paymentLedgerBefore.code, paymentLedgerBefore.detail),
        };
      }
      const amountPaidBefore = paymentLedgerBefore.ledgerPaymentsCents;
      const amountPaidCents = amountPaidBefore - payment.amountCents;
      const depositFinancials = resolveAppointmentDepositFinancials({
        deposits: depositRows,
        invoiceCurrency: taxChain.invoiceCurrency,
        finalPriceCents: appointment.finalPriceCents,
        taxAmountCents: appointment.taxAmountCents,
        tipCents: appointment.tipCents,
        appointmentPaymentsCents: amountPaidCents,
        appointmentStatus: appointment.status,
        paymentStatus: appointment.paymentStatus,
      });
      if (!depositFinancials.depositResolution.ok) {
        return {
          kind: 'error' as const,
          response: errorJson(
            409,
            depositFinancials.depositResolution.code,
            depositFinancials.depositResolution.detail,
          ),
        };
      }
      if (!depositFinancials.financials.ok || !depositFinancials.balance) {
        return {
          kind: 'error' as const,
          response: errorJson(422, 'INVALID_FINANCIAL_DATA', 'The stored appointment money is invalid'),
        };
      }
      const beforeFinancials = resolveAppointmentDepositFinancials({
        deposits: depositRows,
        invoiceCurrency: taxChain.invoiceCurrency,
        finalPriceCents: appointment.finalPriceCents,
        taxAmountCents: appointment.taxAmountCents,
        tipCents: appointment.tipCents,
        appointmentPaymentsCents: amountPaidBefore,
        appointmentStatus: appointment.status,
        paymentStatus: appointment.paymentStatus,
      });
      if (!beforeFinancials.financials.ok) {
        return {
          kind: 'error' as const,
          response: errorJson(422, 'INVALID_FINANCIAL_DATA', 'The stored appointment money is invalid'),
        };
      }
      const previousStatus = appointment.paymentStatus === 'comp'
        ? 'comp'
        : derivePaymentStatus(
          beforeFinancials.financials.totalDueCents,
          beforeFinancials.financials.amountAlreadyPaidCents,
        );
      // 'comp' is an explicit state, never derived — leave it untouched.
      const nextStatus = previousStatus === 'comp'
        ? 'comp'
        : appointmentFinancialOverpayment(depositFinancials)
          ? 'pending'
          : derivePaymentStatus(
            depositFinancials.financials.totalDueCents,
            depositFinancials.financials.amountAlreadyPaidCents,
          );

      await tx
        .update(appointmentPaymentSchema)
        .set({ voidedAt: now, voidedBy: actor.recordedById })
        .where(eq(appointmentPaymentSchema.id, paymentId));

      const paymentRowsAfter = await listPayments(tx, appointmentId);
      const paymentLedgerAfter = resolveAppointmentPaymentLedger({
        cachedAmountPaidCents: amountPaidCents,
        paymentRows: paymentRowsAfter,
        expectedSalonId: appointment.salonId,
        appointmentStatus: appointment.status,
        paymentStatus: appointment.paymentStatus,
      });
      if (!paymentLedgerAfter.ok) {
        throw new Error(paymentLedgerAfter.code);
      }

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
        depositCredit: depositFinancials.depositCredit,
        financials: depositFinancials.financials,
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
        depositCredit: result.depositCredit,
        depositCreditAppliedCents: result.financials.depositCreditAppliedCents,
        amountAlreadyPaidCents: result.financials.amountAlreadyPaidCents,
        totalDueCents: result.financials.totalDueCents,
        balanceCents: result.financials.remainingBalanceCents,
      },
    });
  } catch (error) {
    console.error('Error voiding payment:', error);
    return errorJson(500, 'INTERNAL_ERROR', 'Failed to void payment');
  }
}
