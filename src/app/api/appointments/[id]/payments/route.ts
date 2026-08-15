import crypto from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { buildAppointmentAuditRow } from '@/libs/appointmentAudit';
import {
  listPayments,
  resolveCheckoutActor,
} from '@/libs/appointmentCheckoutServer';
import {
  APPOINTMENT_FINANCIAL_OVERPAYMENT_RECONCILIATION_REQUIRED,
  appointmentFinancialOverpayment,
  resolveAppointmentDepositFinancials,
} from '@/libs/appointmentDepositFinancials';
import { resolveAppointmentPaymentLedger } from '@/libs/appointmentPaymentLedger';
import { validateAppointmentTaxSnapshotChain } from '@/libs/appointmentTaxSnapshot';
import { derivePaymentStatus } from '@/libs/checkoutTotals';
import { db } from '@/libs/DB';
import { loadAppointmentDepositCreditRows } from '@/libs/depositCredit.server';
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
  // Required at the API boundary: without a durable business identity a
  // transport retry can create a second real payment while balance remains.
  idempotencyKey: z.string().trim().min(8).max(120),
  method: z.enum(PAYMENT_METHODS).optional(),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

const paymentReplaySnapshotSchema = z.object({
  paymentId: z.string().min(1),
  idempotencyKey: z.string().min(8),
  paymentStatus: z.string().min(1),
  amountPaidCents: z.number().int().nonnegative(),
  depositCreditAppliedCents: z.number().int().nonnegative(),
  amountAlreadyPaidCents: z.number().int().nonnegative(),
  totalDueCents: z.number().int().nonnegative(),
  balanceCents: z.number().int().nonnegative(),
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

      // A committed business operation owns its retry key permanently. Replay
      // it before validating today's mutable appointment/refund state so a lost
      // HTTP response stays stable even if the appointment changes afterward.
      const [existingPayment] = await tx
        .select()
        .from(appointmentPaymentSchema)
        .where(and(
          eq(appointmentPaymentSchema.salonId, appointment.salonId),
          eq(appointmentPaymentSchema.appointmentId, appointmentId),
          eq(appointmentPaymentSchema.idempotencyKey, payment.idempotencyKey),
        ))
        .limit(1);
      if (existingPayment) {
        const sameRequest = existingPayment.amountCents === payment.amountCents
          && existingPayment.method === (payment.method ?? null)
          && existingPayment.reference === (payment.reference ?? null)
          && existingPayment.note === (payment.note ?? null);
        if (!sameRequest) {
          return {
            kind: 'error' as const,
            response: errorJson(
              409,
              'IDEMPOTENCY_KEY_REUSED',
              'This payment retry key was already used for different payment details.',
            ),
          };
        }
        if (existingPayment.voidedAt !== null) {
          return {
            kind: 'error' as const,
            response: errorJson(
              409,
              'IDEMPOTENT_PAYMENT_VOIDED',
              'This payment retry key belongs to a payment that was later voided.',
            ),
          };
        }

        const replayAudits = await tx.select({
          newValue: appointmentAuditLogSchema.newValue,
        }).from(appointmentAuditLogSchema).where(and(
          eq(appointmentAuditLogSchema.salonId, appointment.salonId),
          eq(appointmentAuditLogSchema.appointmentId, appointmentId),
          eq(appointmentAuditLogSchema.action, 'payment_recorded'),
        ));
        const replaySnapshot = replayAudits
          .map(row => paymentReplaySnapshotSchema.safeParse(row.newValue))
          .find(parsed => parsed.success
            && parsed.data.paymentId === existingPayment.id
            && parsed.data.idempotencyKey === payment.idempotencyKey);
        if (!replaySnapshot?.success) {
          return {
            kind: 'error' as const,
            response: errorJson(
              409,
              'PAYMENT_REPLAY_RECONCILIATION_REQUIRED',
              'The original payment was recorded, but its immutable retry response is unavailable. Reconcile the payment before retrying.',
            ),
          };
        }

        return {
          kind: 'idempotent' as const,
          appointment,
          existingPayment,
          amountPaidCents: replaySnapshot.data.amountPaidCents,
          previousStatus: replaySnapshot.data.paymentStatus,
          nextStatus: replaySnapshot.data.paymentStatus,
          financials: {
            depositCreditAppliedCents: replaySnapshot.data.depositCreditAppliedCents,
            amountAlreadyPaidCents: replaySnapshot.data.amountAlreadyPaidCents,
            totalDueCents: replaySnapshot.data.totalDueCents,
            remainingBalanceCents: replaySnapshot.data.balanceCents,
          },
        };
      }

      // A durable retry above must replay its original response even if this
      // mutable invoice evidence later needs reconciliation. New money may
      // only be collected from a valid, scalar-consistent final snapshot.
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

      const depositRows = await loadAppointmentDepositCreditRows({
        salonId: appointment.salonId,
        appointmentId,
        database: tx,
        forUpdate: true,
        appointmentLockHeld: true,
      });
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
      const before = resolveAppointmentDepositFinancials({
        deposits: depositRows,
        invoiceCurrency: taxChain.invoiceCurrency,
        finalPriceCents: appointment.finalPriceCents,
        taxAmountCents: appointment.taxAmountCents,
        tipCents: appointment.tipCents,
        appointmentPaymentsCents: paymentLedgerBefore.appointmentPaymentsCents,
        appointmentStatus: appointment.status,
        paymentStatus: appointment.paymentStatus,
      });
      if (!before.depositResolution.ok) {
        return {
          kind: 'error' as const,
          response: errorJson(409, before.depositResolution.code, before.depositResolution.detail),
        };
      }
      if (!before.financials.ok) {
        return {
          kind: 'error' as const,
          response: errorJson(422, before.financials.code, 'The stored appointment money is invalid'),
        };
      }
      if (before.financials.excessDepositCents > 0) {
        return {
          kind: 'error' as const,
          response: errorJson(
            409,
            'DEPOSIT_EXCESS_REQUIRES_REFUND',
            'Refund the deposit in full and wait for reconciliation before collecting this invoice.',
            { excessDepositCents: before.financials.excessDepositCents },
          ),
        };
      }
      const beforeOverpayment = appointmentFinancialOverpayment(before);
      if (beforeOverpayment) {
        return {
          kind: 'error' as const,
          response: errorJson(
            409,
            APPOINTMENT_FINANCIAL_OVERPAYMENT_RECONCILIATION_REQUIRED,
            'Collected money exceeds the frozen invoice. Reconcile it before recording another payment.',
            beforeOverpayment,
          ),
        };
      }

      if (payment.amountCents > before.financials.remainingBalanceCents) {
        return {
          kind: 'error' as const,
          response: errorJson(422, 'PAYMENT_EXCEEDS_BALANCE', 'Payment exceeds the remaining balance', {
            balanceCents: before.financials.remainingBalanceCents,
          }),
        };
      }

      const paymentId = `pay_${crypto.randomUUID()}`;
      await tx.insert(appointmentPaymentSchema).values({
        id: paymentId,
        appointmentId,
        salonId: appointment.salonId,
        amountCents: payment.amountCents,
        idempotencyKey: payment.idempotencyKey,
        method: payment.method ?? null,
        reference: payment.reference ?? null,
        note: payment.note ?? null,
        recordedByType: actor.recordedByType,
        recordedById: actor.recordedById,
        recordedByName: actor.recordedByName,
        recordedAt: now,
      });

      // Recompute from source and prove it agrees with the cache value this
      // transaction is about to persist.
      const paymentRowsAfter = await listPayments(tx, appointmentId);
      const amountPaidCents = amountPaidBefore + payment.amountCents;
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
      const previousStatus = derivePaymentStatus(
        before.financials.totalDueCents,
        before.financials.amountAlreadyPaidCents,
      );
      const after = resolveAppointmentDepositFinancials({
        deposits: depositRows,
        invoiceCurrency: taxChain.invoiceCurrency,
        finalPriceCents: appointment.finalPriceCents,
        taxAmountCents: appointment.taxAmountCents,
        tipCents: appointment.tipCents,
        appointmentPaymentsCents: amountPaidCents,
        appointmentStatus: appointment.status,
        paymentStatus: appointment.paymentStatus,
      });
      if (!after.financials.ok || !after.balance) {
        throw new Error('INVALID_APPOINTMENT_FINANCIALS_AFTER_PAYMENT');
      }
      const nextStatus = derivePaymentStatus(
        after.financials.totalDueCents,
        after.financials.amountAlreadyPaidCents,
      );

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
            paymentId,
            idempotencyKey: payment.idempotencyKey,
            amountCents: payment.amountCents,
            method: payment.method ?? null,
            reference: payment.reference ?? null,
            paymentStatus: nextStatus,
            amountPaidCents,
            depositCreditAppliedCents: after.financials.depositCreditAppliedCents,
            amountAlreadyPaidCents: after.financials.amountAlreadyPaidCents,
            totalDueCents: after.financials.totalDueCents,
            balanceCents: after.financials.remainingBalanceCents,
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
        financials: after.financials,
      };
    });

    if (result.kind === 'error') {
      return result.response;
    }

    // Post-commit side effects on the transition to fully paid — mirrors the
    // completion route's paid path (fraud queries only see completed+paid rows).
    if (result.nextStatus === 'paid' && result.previousStatus !== 'paid') {
      const { appointment } = result;
      if (
        appointment.salonClientId
        && result.financials.depositCreditAppliedCents === 0
      ) {
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

    const recordedAt = result.kind === 'idempotent'
      ? result.existingPayment.recordedAt
      : now;
    return Response.json({
      data: {
        payment: {
          amountCents: validated.data.amountCents,
          method: validated.data.method ?? null,
          recordedAt,
        },
        paymentStatus: result.nextStatus,
        amountPaidCents: result.amountPaidCents,
        depositCreditAppliedCents: result.financials.depositCreditAppliedCents,
        amountAlreadyPaidCents: result.financials.amountAlreadyPaidCents,
        totalDueCents: result.financials.totalDueCents,
        balanceCents: result.financials.remainingBalanceCents,
        idempotentReplay: result.kind === 'idempotent',
      },
    });
  } catch (error) {
    console.error('Error recording payment:', error);
    return errorJson(500, 'INTERNAL_ERROR', 'Failed to record payment');
  }
}
