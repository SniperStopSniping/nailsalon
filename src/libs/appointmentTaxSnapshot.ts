import {
  type ActiveInvoiceTaxSnapshotSelection,
  type BookingTaxSnapshot,
  type FinalTaxSnapshot,
  selectActiveInvoiceTaxSnapshot,
  type TaxSnapshotValidationFailure,
  validateInvoiceTaxSnapshot,
} from '@/libs/taxConfig';

export type AppointmentTaxSnapshotInput = {
  status: string | null;
  completedAt: Date | null;
  totalPrice: number;
  finalPriceCents: number | null;
  taxableSubtotalCents: number | null;
  taxAmountCents: number | null;
  taxExempt: boolean | null;
  taxExemptReason: string | null;
  invoiceCurrency: string | null;
  bookingTaxSnapshot: BookingTaxSnapshot | null;
  rescheduleTaxSnapshot: BookingTaxSnapshot | null;
  finalTaxSnapshot: FinalTaxSnapshot | null;
};

export type AppointmentTaxSnapshotChainValidation
  = | {
    ok: true;
    invoiceCurrency: string | null;
    active: ActiveInvoiceTaxSnapshotSelection;
  }
  | TaxSnapshotValidationFailure;

/**
 * A pre-D6 active appointment with no money history can safely use the salon's
 * current checkout currency as an issue-time draft: completion locks and
 * revalidates that configuration before writing the first final invoice. A
 * completed row, deposit history, or any snapshot evidence must remain frozen
 * and never borrows mutable settings.
 */
export function resolveCheckoutCurrencyProjection(input: {
  frozenCurrency: string | null;
  currentCurrency: string;
  appointmentStatus: string | null;
  hasDepositHistory: boolean;
  hasSnapshotEvidence: boolean;
}): string | null {
  if (input.frozenCurrency !== null) {
    return input.frozenCurrency;
  }
  if (
    input.appointmentStatus === 'completed'
    || input.hasDepositHistory
    || input.hasSnapshotEvidence
  ) {
    return null;
  }
  const currentCurrency = input.currentCurrency.trim().toUpperCase();
  return /^[A-Z]{3}$/u.test(currentCurrency) ? currentCurrency : null;
}

function invalid(
  code: TaxSnapshotValidationFailure['code'],
  detail: string,
): TaxSnapshotValidationFailure {
  return { ok: false, code, detail };
}

/**
 * Validate the whole immutable invoice-tax chain, not merely whichever JSON
 * happens to drive today's amount. The original booking estimate remains
 * evidence after a reschedule; the latest reschedule estimate must agree with
 * the current booked total; and a completed D6.1 row must carry a scalar-
 * consistent final actual snapshot. Only a row with no snapshot evidence at
 * all may take the explicit historical fallback in its caller.
 */
export function validateAppointmentTaxSnapshotChain(
  input: AppointmentTaxSnapshotInput,
): AppointmentTaxSnapshotChainValidation {
  const active = selectActiveInvoiceTaxSnapshot({
    bookingTaxSnapshot: input.bookingTaxSnapshot,
    rescheduleTaxSnapshot: input.rescheduleTaxSnapshot,
    finalTaxSnapshot: input.finalTaxSnapshot,
  });
  const invoiceCurrency = input.invoiceCurrency
    ?? active.snapshot?.currency
    ?? null;
  const hasEstimate = input.bookingTaxSnapshot !== null
    || input.rescheduleTaxSnapshot !== null;

  if (input.status === 'completed' && hasEstimate && input.finalTaxSnapshot === null) {
    return invalid(
      'TAX_SNAPSHOT_INVALID_SHAPE',
      'The finalized invoice is missing its final tax snapshot.',
    );
  }
  if (active.snapshot !== null && invoiceCurrency === null) {
    return invalid(
      'TAX_SNAPSHOT_CURRENCY_MISMATCH',
      'The tax snapshot has no frozen invoice currency.',
    );
  }

  const bookingValidation = input.bookingTaxSnapshot === null
    ? null
    : validateInvoiceTaxSnapshot(input.bookingTaxSnapshot, {
      expectedKind: 'booking_estimate',
      expectedCurrency: invoiceCurrency,
      ...(input.rescheduleTaxSnapshot === null
        ? { expectedScalars: { bookingTotalPriceCents: input.totalPrice } }
        : {}),
    });
  if (bookingValidation && !bookingValidation.ok) {
    return bookingValidation;
  }

  const rescheduleValidation = input.rescheduleTaxSnapshot === null
    ? null
    : validateInvoiceTaxSnapshot(input.rescheduleTaxSnapshot, {
      expectedKind: 'booking_estimate',
      expectedCurrency: invoiceCurrency,
      expectedScalars: { bookingTotalPriceCents: input.totalPrice },
    });
  if (rescheduleValidation && !rescheduleValidation.ok) {
    return rescheduleValidation;
  }

  const finalValidation = input.finalTaxSnapshot === null
    ? null
    : validateInvoiceTaxSnapshot(input.finalTaxSnapshot, {
      expectedKind: 'final_actual',
      expectedCurrency: invoiceCurrency,
      expectedScalars: {
        finalPriceCents: input.finalPriceCents,
        taxableSubtotalCents: input.taxableSubtotalCents,
        taxAmountCents: input.taxAmountCents,
        taxExempt: input.taxExempt,
        taxExemptReason: input.taxExemptReason,
      },
    });
  if (finalValidation && !finalValidation.ok) {
    return finalValidation;
  }
  if (input.finalTaxSnapshot !== null) {
    if (
      !(input.completedAt instanceof Date)
      || Number.isNaN(input.completedAt.getTime())
      || input.finalTaxSnapshot.capturedAt !== input.completedAt.toISOString()
    ) {
      return invalid(
        'TAX_SNAPSHOT_TIMESTAMP_INVALID',
        'The final tax snapshot timestamp does not match the invoice completion instant.',
      );
    }
  }

  return { ok: true, invoiceCurrency, active };
}
