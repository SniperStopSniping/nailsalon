import { and, eq, isNull } from 'drizzle-orm';

import { listPayments } from '@/libs/appointmentCheckoutServer';
import {
  APPOINTMENT_FINANCIAL_OVERPAYMENT_RECONCILIATION_REQUIRED,
  appointmentFinancialOverpayment,
  resolveAppointmentDepositFinancials,
} from '@/libs/appointmentDepositFinancials';
import { resolveAppointmentPaymentLedger } from '@/libs/appointmentPaymentLedger';
import { validateAppointmentTaxSnapshotChain } from '@/libs/appointmentTaxSnapshot';
import { buildPaymentReference } from '@/libs/checkoutTotals';
import { db } from '@/libs/DB';
import { loadAppointmentDepositCreditRows } from '@/libs/depositCredit.server';
import { hashOpaqueToken } from '@/libs/lusterSecurity';
import { resolveEtransferSettings } from '@/libs/taxConfig';
import {
  appointmentPaymentLinkSchema,
  appointmentSchema,
  salonSchema,
} from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

export const dynamic = 'force-dynamic';

// =============================================================================
// GET /api/public/pay/[token] — payment-instruction page data
// =============================================================================
// Public by design (the QR is scanned from a client's phone), guarded by a
// 256-bit unguessable token stored sha256-hashed. Returns ONLY salon-side
// payment facts: salon display name, amount due, e-Transfer recipient,
// reference, and instructions. No client name/phone/notes/CRM data — ever.
// 404 for unknown or revoked tokens (revoked on full payment and on reopen).
// =============================================================================

export async function GET(_request: Request, props: { params: Promise<{ token: string }> }): Promise<Response> {
  const params = await props.params;
  try {
    const tokenHash = hashOpaqueToken(params.token);
    const [row] = await db
      .select({
        appointment: appointmentSchema,
        salonName: salonSchema.name,
        salonSettings: salonSchema.settings,
      })
      .from(appointmentPaymentLinkSchema)
      .innerJoin(appointmentSchema, and(
        eq(appointmentSchema.id, appointmentPaymentLinkSchema.appointmentId),
        eq(appointmentSchema.salonId, appointmentPaymentLinkSchema.salonId),
      ))
      .innerJoin(salonSchema, eq(salonSchema.id, appointmentPaymentLinkSchema.salonId))
      .where(and(
        eq(appointmentPaymentLinkSchema.tokenHash, tokenHash),
        isNull(appointmentPaymentLinkSchema.revokedAt),
      ))
      .limit(1);

    if (!row) {
      return Response.json(
        { error: { code: 'PAYMENT_LINK_INVALID', message: 'This payment link is invalid or no longer active.' } },
        { status: 404 },
      );
    }

    const settings = (row.salonSettings as SalonSettings | null | undefined) ?? null;
    const etransfer = resolveEtransferSettings(settings);
    if (!etransfer.enabled || !etransfer.qrPageEnabled) {
      return Response.json(
        { error: { code: 'PAYMENT_LINK_INVALID', message: 'This payment link is invalid or no longer active.' } },
        { status: 404 },
      );
    }

    const { appointment } = row;
    if (appointment.status !== 'completed') {
      return Response.json(
        { error: { code: 'PAYMENT_LINK_INVALID', message: 'This payment link is invalid or no longer active.' } },
        { status: 404 },
      );
    }
    const taxChain = validateAppointmentTaxSnapshotChain(appointment);
    if (!taxChain.ok) {
      return Response.json(
        {
          error: {
            code: 'TAX_SNAPSHOT_INVALID',
            reason: taxChain.code,
            message: 'This payment amount is under review. Please contact the salon before sending payment.',
          },
        },
        { status: 409 },
      );
    }
    const [paymentRows, depositRows] = await Promise.all([
      listPayments(db, appointment.id),
      loadAppointmentDepositCreditRows({
        salonId: appointment.salonId,
        appointmentId: appointment.id,
      }),
    ]);
    const paymentLedger = resolveAppointmentPaymentLedger({
      cachedAmountPaidCents: appointment.amountPaidCents,
      paymentRows,
      expectedSalonId: appointment.salonId,
      appointmentStatus: appointment.status,
      paymentStatus: appointment.paymentStatus,
    });
    if (!paymentLedger.ok) {
      return Response.json(
        {
          error: {
            code: paymentLedger.code,
            message: 'This payment amount is under review. Please contact the salon before sending payment.',
          },
        },
        { status: 409 },
      );
    }
    // Completed checkouts have authoritative snapshots; before completion the
    // booked total is the best honest figure (finalized at checkout).
    const invoiceCurrency = taxChain.invoiceCurrency;
    if (!invoiceCurrency) {
      return Response.json(
        {
          error: {
            code: 'INVOICE_CURRENCY_UNAVAILABLE',
            message: 'This historical payment amount cannot be collected safely. Please contact the salon.',
          },
        },
        { status: 409 },
      );
    }
    const depositFinancials = resolveAppointmentDepositFinancials({
      deposits: depositRows,
      invoiceCurrency,
      finalPriceCents: appointment.status === 'completed'
        ? appointment.finalPriceCents
        : taxChain.active.snapshot?.serviceSubtotalCents ?? appointment.totalPrice,
      taxAmountCents: appointment.status === 'completed'
        ? appointment.taxAmountCents
        : taxChain.active.snapshot?.taxAmountCents ?? 0,
      tipCents: appointment.status === 'completed' ? appointment.tipCents : 0,
      appointmentPaymentsCents: paymentLedger.appointmentPaymentsCents,
      appointmentStatus: appointment.status,
      paymentStatus: appointment.paymentStatus,
    });
    if (!depositFinancials.depositResolution.ok) {
      return Response.json(
        {
          error: {
            code: depositFinancials.depositResolution.code,
            message: 'This payment amount is under review. Please contact the salon before sending payment.',
          },
        },
        { status: 409 },
      );
    }
    if (!depositFinancials.financials.ok || !depositFinancials.balance) {
      return Response.json(
        { error: { code: 'INVALID_FINANCIAL_DATA', message: 'This payment amount is unavailable.' } },
        { status: 409 },
      );
    }
    if (depositFinancials.financials.excessDepositCents > 0) {
      return Response.json(
        {
          error: {
            code: 'DEPOSIT_EXCESS_REQUIRES_REFUND',
            message: 'The salon must resolve the deposit before another payment is sent.',
          },
        },
        { status: 409 },
      );
    }
    if (appointmentFinancialOverpayment(depositFinancials)) {
      return Response.json(
        {
          error: {
            code: APPOINTMENT_FINANCIAL_OVERPAYMENT_RECONCILIATION_REQUIRED,
            message: 'This payment amount is under review because collected money exceeds the invoice.',
          },
        },
        { status: 409 },
      );
    }
    const amountDue = depositFinancials.financials;

    return Response.json({
      data: {
        salonName: row.salonName,
        amountDueCents: amountDue.remainingBalanceCents,
        totalCents: amountDue.totalDueCents,
        serviceInvoiceTotalCents: amountDue.serviceInvoiceCents,
        depositCreditCents: amountDue.depositCreditAppliedCents,
        depositRefundedCents: depositFinancials.depositCredit.refundedCents,
        depositForfeitedCents: depositFinancials.depositCredit.forfeitedCents,
        appointmentPaymentsCents: amountDue.tenderedCents,
        amountAlreadyPaidCents: amountDue.amountAlreadyPaidCents,
        currency: invoiceCurrency,
        isFinalized: appointment.status === 'completed',
        reference: buildPaymentReference(appointment.id),
        recipient: etransfer.recipient,
        recipientName: etransfer.recipientName,
        autodepositEnabled: etransfer.autodepositEnabled,
        requireReference: etransfer.requireReference,
        instructions: etransfer.instructions,
      },
    });
  } catch (error) {
    console.error('Error loading payment page:', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to load payment details' } },
      { status: 500 },
    );
  }
}
