import crypto from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import { listPayments } from '@/libs/appointmentCheckoutServer';
import {
  APPOINTMENT_FINANCIAL_OVERPAYMENT_RECONCILIATION_REQUIRED,
  appointmentFinancialOverpayment,
  resolveAppointmentDepositFinancials,
} from '@/libs/appointmentDepositFinancials';
import { resolveAppointmentPaymentLedger } from '@/libs/appointmentPaymentLedger';
import { validateAppointmentTaxSnapshotChain } from '@/libs/appointmentTaxSnapshot';
import { db } from '@/libs/DB';
import { loadAppointmentDepositCreditRows } from '@/libs/depositCredit.server';
import { createOpaqueToken } from '@/libs/lusterSecurity';
import { getSalonById } from '@/libs/queries';
import { requireAppointmentManagerAccess } from '@/libs/routeAccessGuards';
import { resolveEtransferSettings } from '@/libs/taxConfig';
import { appointmentPaymentLinkSchema, appointmentSchema } from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

// =============================================================================
// POST /api/appointments/[id]/payment-link — mint the payment-instruction link
// =============================================================================
// The QR on the checkout sheet points at a Luster-hosted instruction page.
// Tokens are 256-bit opaque values stored sha256-hashed; one active link per
// appointment (minting revokes prior links); links are revoked automatically
// when the appointment is fully paid or reopened. The URL carries only the
// token — never client data.
// =============================================================================

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const appointmentId = params.id;
    const access = await requireAppointmentManagerAccess(appointmentId, {
      assignedOnly: true,
      wrongRoleMessage: 'Only salon staff or admins can create payment links',
      tenantForbiddenMessage: 'Appointment does not belong to your salon',
      salonSlugHint: new URL(request.url).searchParams.get('salonSlug'),
    });
    if (!access.ok) {
      return access.response;
    }
    const { appointment } = access;

    const salon = await getSalonById(appointment.salonId);
    const settings = (salon?.settings as SalonSettings | null | undefined) ?? null;
    const etransfer = resolveEtransferSettings(settings);
    if (!etransfer.enabled || !etransfer.qrPageEnabled) {
      return Response.json(
        {
          error: {
            code: 'PAYMENT_PAGE_DISABLED',
            message: 'Enable the payment QR page in Settings → Payments & taxes first.',
          },
        },
        { status: 409 },
      );
    }

    const { token, tokenHash } = createOpaqueToken();
    const now = new Date();

    const mintResult = await db.transaction(async (tx) => {
      const [lockedAppointment] = await tx
        .select()
        .from(appointmentSchema)
        .where(and(
          eq(appointmentSchema.id, appointmentId),
          eq(appointmentSchema.salonId, appointment.salonId),
        ))
        .for('update')
        .limit(1);
      if (!lockedAppointment) {
        return { ok: false as const, code: 'APPOINTMENT_NOT_FOUND', message: 'Appointment not found.' };
      }
      if (lockedAppointment.status !== 'completed') {
        return {
          ok: false as const,
          code: 'INVOICE_NOT_FINALIZED',
          message: 'Complete the appointment and finalize its invoice before creating a payment link.',
        };
      }
      if (
        lockedAppointment.finalPriceCents === null
        || lockedAppointment.taxAmountCents === null
      ) {
        return {
          ok: false as const,
          code: 'INVOICE_NOT_FINALIZED',
          message: 'The final invoice is incomplete, so a payment link cannot be created safely.',
        };
      }
      const taxChain = validateAppointmentTaxSnapshotChain(lockedAppointment);
      if (!taxChain.ok) {
        return {
          ok: false as const,
          code: 'TAX_SNAPSHOT_INVALID',
          reason: taxChain.code,
          message: taxChain.detail,
        };
      }
      const depositRows = await loadAppointmentDepositCreditRows({
        salonId: lockedAppointment.salonId,
        appointmentId,
        database: tx,
        forUpdate: true,
        appointmentLockHeld: true,
      });
      const paymentRows = await listPayments(tx, appointmentId);
      const paymentLedger = resolveAppointmentPaymentLedger({
        cachedAmountPaidCents: lockedAppointment.amountPaidCents,
        paymentRows,
        expectedSalonId: lockedAppointment.salonId,
        appointmentStatus: lockedAppointment.status,
        paymentStatus: lockedAppointment.paymentStatus,
      });
      if (!paymentLedger.ok) {
        return {
          ok: false as const,
          code: paymentLedger.code,
          message: paymentLedger.detail,
        };
      }
      const invoiceCurrency = taxChain.invoiceCurrency;
      if (!invoiceCurrency) {
        return {
          ok: false as const,
          code: 'INVOICE_CURRENCY_UNAVAILABLE',
          message: 'The historical invoice currency is unavailable, so a payment link cannot be created safely.',
        };
      }
      const financials = resolveAppointmentDepositFinancials({
        deposits: depositRows,
        invoiceCurrency,
        finalPriceCents: lockedAppointment.finalPriceCents,
        taxAmountCents: lockedAppointment.taxAmountCents,
        tipCents: lockedAppointment.tipCents,
        appointmentPaymentsCents: paymentLedger.appointmentPaymentsCents,
        appointmentStatus: lockedAppointment.status,
        paymentStatus: lockedAppointment.paymentStatus,
      });
      if (!financials.depositResolution.ok) {
        return {
          ok: false as const,
          code: financials.depositResolution.code,
          message: financials.depositResolution.detail,
        };
      }
      if (!financials.financials.ok) {
        return { ok: false as const, code: 'INVALID_FINANCIAL_DATA', message: 'The payment amount is unavailable.' };
      }
      if (financials.financials.excessDepositCents > 0) {
        return {
          ok: false as const,
          code: 'DEPOSIT_EXCESS_REQUIRES_REFUND',
          message: 'Refund the deposit in full before requesting another payment.',
        };
      }
      if (appointmentFinancialOverpayment(financials)) {
        return {
          ok: false as const,
          code: APPOINTMENT_FINANCIAL_OVERPAYMENT_RECONCILIATION_REQUIRED,
          message: 'Collected money exceeds the frozen invoice. Reconcile it before creating payment instructions.',
        };
      }
      if (financials.financials.remainingBalanceCents === 0) {
        return { ok: false as const, code: 'NO_BALANCE_DUE', message: 'This appointment has no remaining balance.' };
      }

      // One active link per appointment: minting supersedes prior links.
      await tx
        .update(appointmentPaymentLinkSchema)
        .set({ revokedAt: now })
        .where(
          and(
            eq(appointmentPaymentLinkSchema.appointmentId, appointmentId),
            isNull(appointmentPaymentLinkSchema.revokedAt),
          ),
        );
      await tx.insert(appointmentPaymentLinkSchema).values({
        id: `plink_${crypto.randomUUID()}`,
        salonId: appointment.salonId,
        appointmentId,
        tokenHash,
      });
      return { ok: true as const };
    });

    if (!mintResult.ok) {
      return Response.json(
        {
          error: {
            code: mintResult.code,
            message: mintResult.message,
            ...('reason' in mintResult ? { reason: mintResult.reason } : {}),
          },
        },
        { status: mintResult.code === 'APPOINTMENT_NOT_FOUND' ? 404 : 409 },
      );
    }

    const url = `${new URL(request.url).origin}/pay/${token}`;
    return Response.json({ data: { url } });
  } catch (error) {
    console.error('Error creating payment link:', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to create payment link' } },
      { status: 500 },
    );
  }
}
