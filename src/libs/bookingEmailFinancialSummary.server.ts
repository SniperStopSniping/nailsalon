import 'server-only';

import { and, eq } from 'drizzle-orm';

import { listPayments } from '@/libs/appointmentCheckoutServer';
import {
  type AppointmentDepositPresentationState,
  resolveAppointmentDepositFinancials,
  resolveAppointmentDepositPresentation,
} from '@/libs/appointmentDepositFinancials';
import { resolveAppointmentPaymentLedger } from '@/libs/appointmentPaymentLedger';
import { validateAppointmentTaxSnapshotChain } from '@/libs/appointmentTaxSnapshot';
import { db } from '@/libs/DB';
import type { DepositCreditRow } from '@/libs/depositCredit';
import { loadAppointmentDepositCreditRows } from '@/libs/depositCredit.server';
import type {
  BookingTaxSnapshot,
  FinalTaxSnapshot,
} from '@/libs/taxConfig';
import { appointmentSchema } from '@/models/Schema';

export type BookingEmailFinancialSummary = {
  /** Present on canonical server-built summaries; optional for legacy callers. */
  appointmentStatus?: string;
  currency: string;
  serviceInvoiceTotalCents: number;
  totalDueCents: number;
  /** Immutable tax evidence, populated only after snapshot validation succeeds. */
  taxAmountCents: number | null;
  taxLabel: string | null;
  taxMode: 'added' | 'included' | null;
  taxClassification: 'estimate' | 'actual' | null;
  taxApplied: boolean | null;
  collectedDepositCents: number;
  refundedDepositCents: number;
  forfeitedDepositCents: number;
  depositCreditAppliedCents: number;
  appointmentPaymentsCents: number;
  amountAlreadyPaidCents: number;
  balanceCents: number;
  depositBlockedCode: string | null;
  depositPresentationState: AppointmentDepositPresentationState;
};

type BookingEmailAppointmentMoneySnapshot = {
  status: string;
  completedAt: Date | null;
  paymentStatus: string | null;
  totalPrice: number;
  finalPriceCents: number | null;
  taxableSubtotalCents: number | null;
  taxAmountCents: number | null;
  taxExempt: boolean | null;
  taxExemptReason: string | null;
  tipCents: number | null;
  invoiceCurrency: string | null;
  bookingTaxSnapshot: BookingTaxSnapshot | null;
  rescheduleTaxSnapshot?: BookingTaxSnapshot | null;
  finalTaxSnapshot: FinalTaxSnapshot | null;
};

export function buildBookingEmailFinancialSummary(input: {
  appointment: BookingEmailAppointmentMoneySnapshot;
  deposits: readonly DepositCreditRow[];
  appointmentPaymentsCents: number | null;
}): BookingEmailFinancialSummary | null {
  const taxChain = validateAppointmentTaxSnapshotChain({
    ...input.appointment,
    rescheduleTaxSnapshot: input.appointment.rescheduleTaxSnapshot ?? null,
  });
  if (!taxChain.ok || taxChain.invoiceCurrency === null) {
    return null;
  }
  const currency = taxChain.invoiceCurrency;
  const taxSnapshot = taxChain.active.snapshot;

  const resolution = resolveAppointmentDepositFinancials({
    deposits: input.deposits,
    invoiceCurrency: currency,
    finalPriceCents: input.appointment.finalPriceCents
      ?? taxSnapshot?.serviceSubtotalCents
      ?? input.appointment.totalPrice,
    taxAmountCents: input.appointment.taxAmountCents
      ?? taxSnapshot?.taxAmountCents
      ?? 0,
    tipCents: input.appointment.tipCents,
    appointmentPaymentsCents: input.appointmentPaymentsCents,
    appointmentStatus: input.appointment.status,
    paymentStatus: input.appointment.paymentStatus,
  });

  if (
    !resolution.financials.ok
    || resolution.financials.excessDepositCents > 0
    || resolution.financials.tenderExcessCents > 0
  ) {
    return null;
  }

  return {
    appointmentStatus: input.appointment.status,
    currency,
    serviceInvoiceTotalCents: resolution.financials.serviceInvoiceCents,
    totalDueCents: resolution.financials.totalDueCents,
    taxAmountCents: taxSnapshot?.taxAmountCents ?? null,
    taxLabel: taxSnapshot?.configuration.label ?? null,
    taxMode: taxSnapshot?.configuration.mode ?? null,
    taxClassification: taxSnapshot?.classification ?? null,
    taxApplied: taxSnapshot?.taxApplied ?? null,
    collectedDepositCents: resolution.depositResolution.ok
      ? resolution.depositResolution.collectedDepositCents
      : 0,
    refundedDepositCents: resolution.depositResolution.ok
      ? resolution.depositResolution.succeededRefundedCents
      : 0,
    forfeitedDepositCents: resolution.depositResolution.ok
      ? resolution.depositResolution.forfeitedDepositCents
      : 0,
    depositCreditAppliedCents: resolution.financials.depositCreditAppliedCents,
    appointmentPaymentsCents: resolution.financials.tenderedCents,
    amountAlreadyPaidCents: resolution.financials.amountAlreadyPaidCents,
    balanceCents: resolution.financials.remainingBalanceCents,
    depositBlockedCode: resolution.depositResolution.ok
      ? null
      : resolution.depositResolution.code,
    depositPresentationState: resolveAppointmentDepositPresentation({
      appointmentStatus: input.appointment.status,
      resolution: resolution.depositResolution,
    }),
  };
}

/**
 * Rebuild the customer-facing money summary from the same immutable tax
 * snapshot, deposit resolver, and appointment-payment ledger used by checkout.
 * A historical row without a currency/tax identity returns null instead of
 * borrowing today's salon settings and silently rewriting its invoice.
 */
export async function loadBookingEmailFinancialSummary(input: {
  salonId: string;
  appointmentId: string;
}): Promise<BookingEmailFinancialSummary | null> {
  const [appointment] = await db.select({
    status: appointmentSchema.status,
    completedAt: appointmentSchema.completedAt,
    paymentStatus: appointmentSchema.paymentStatus,
    totalPrice: appointmentSchema.totalPrice,
    finalPriceCents: appointmentSchema.finalPriceCents,
    taxableSubtotalCents: appointmentSchema.taxableSubtotalCents,
    taxAmountCents: appointmentSchema.taxAmountCents,
    taxExempt: appointmentSchema.taxExempt,
    taxExemptReason: appointmentSchema.taxExemptReason,
    tipCents: appointmentSchema.tipCents,
    invoiceCurrency: appointmentSchema.invoiceCurrency,
    bookingTaxSnapshot: appointmentSchema.bookingTaxSnapshot,
    rescheduleTaxSnapshot: appointmentSchema.rescheduleTaxSnapshot,
    finalTaxSnapshot: appointmentSchema.finalTaxSnapshot,
    amountPaidCents: appointmentSchema.amountPaidCents,
  }).from(appointmentSchema).where(and(
    eq(appointmentSchema.id, input.appointmentId),
    eq(appointmentSchema.salonId, input.salonId),
  )).limit(1);

  if (!appointment) {
    return null;
  }

  const [deposits, paymentRows] = await Promise.all([
    loadAppointmentDepositCreditRows(input),
    listPayments(db, input.appointmentId),
  ]);
  const paymentLedger = resolveAppointmentPaymentLedger({
    cachedAmountPaidCents: appointment.amountPaidCents,
    paymentRows,
    expectedSalonId: input.salonId,
    appointmentStatus: appointment.status,
    paymentStatus: appointment.paymentStatus,
  });
  if (!paymentLedger.ok) {
    return null;
  }
  return buildBookingEmailFinancialSummary({
    appointment,
    deposits,
    appointmentPaymentsCents: paymentLedger.appointmentPaymentsCents,
  });
}
