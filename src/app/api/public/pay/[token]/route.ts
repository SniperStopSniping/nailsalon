import { and, eq, isNull } from 'drizzle-orm';

import { sumNonVoidedPayments } from '@/libs/appointmentCheckoutServer';
import { buildPaymentReference, computeBalance } from '@/libs/checkoutTotals';
import { db } from '@/libs/DB';
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

export async function GET(
  _request: Request,
  { params }: { params: { token: string } },
): Promise<Response> {
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

    const etransfer = resolveEtransferSettings(
      (row.salonSettings as SalonSettings | null | undefined) ?? null,
    );
    if (!etransfer.enabled || !etransfer.qrPageEnabled) {
      return Response.json(
        { error: { code: 'PAYMENT_LINK_INVALID', message: 'This payment link is invalid or no longer active.' } },
        { status: 404 },
      );
    }

    const { appointment } = row;
    const amountPaidCents = await sumNonVoidedPayments(db, appointment.id);
    // Completed checkouts have authoritative snapshots; before completion the
    // booked total is the best honest figure (finalized at checkout).
    const amountDue = appointment.status === 'completed'
      ? computeBalance({
        finalPriceCents: appointment.finalPriceCents,
        taxAmountCents: appointment.taxAmountCents,
        tipCents: appointment.tipCents,
        amountPaidCents,
        paymentStatus: appointment.paymentStatus,
      })
      : {
          totalDueCents: appointment.totalPrice,
          amountPaidCents,
          balanceCents: Math.max(0, appointment.totalPrice - amountPaidCents),
        };

    return Response.json({
      data: {
        salonName: row.salonName,
        amountDueCents: amountDue.balanceCents,
        totalCents: amountDue.totalDueCents,
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
