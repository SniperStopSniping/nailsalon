/**
 * Canonical provenance check for appointment tender.
 *
 * `appointment_payment` is the tender ledger and `amount_paid_cents` is its
 * cached non-voided sum.  Consumers must not silently prefer either source
 * when they disagree: doing so can collect the same historical payment twice.
 */

export const PAYMENT_LEDGER_RECONCILIATION_REQUIRED
  = 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED' as const;

export type AppointmentPaymentLedgerRow = {
  salonId?: string;
  amountCents: number;
  voidedAt: Date | string | null;
};

type ResolveAppointmentPaymentLedgerInput = {
  cachedAmountPaidCents: number | null;
  paymentRows: readonly AppointmentPaymentLedgerRow[];
  expectedSalonId?: string;
  appointmentStatus: string | null;
  paymentStatus: string | null;
};

export type AppointmentPaymentLedgerResolution
  = | {
    ok: true;
    state: 'ledger' | 'explicit_zero' | 'untracked_zero' | 'legacy_paid';
    /** Null deliberately delegates to the completed+paid legacy inference. */
    appointmentPaymentsCents: number | null;
    ledgerPaymentsCents: number;
    hasPaymentRows: boolean;
    legacyPaidAssumed: boolean;
  }
  | {
    ok: false;
    code: typeof PAYMENT_LEDGER_RECONCILIATION_REQUIRED;
    detail: string;
    cachedAmountPaidCents: number | null;
    ledgerPaymentsCents: number | null;
    hasPaymentRows: boolean;
  };

function blocked(
  input: ResolveAppointmentPaymentLedgerInput,
  ledgerPaymentsCents: number | null,
): AppointmentPaymentLedgerResolution {
  return {
    ok: false,
    code: PAYMENT_LEDGER_RECONCILIATION_REQUIRED,
    detail: 'The stored paid amount does not agree with the appointment payment ledger. Reconcile the payment history before continuing.',
    cachedAmountPaidCents: input.cachedAmountPaidCents,
    ledgerPaymentsCents,
    hasPaymentRows: input.paymentRows.length > 0,
  };
}

export function resolveAppointmentPaymentLedger(
  input: ResolveAppointmentPaymentLedgerInput,
): AppointmentPaymentLedgerResolution {
  if (
    input.expectedSalonId !== undefined
    && input.paymentRows.some(row => row.salonId !== input.expectedSalonId)
  ) {
    return blocked(input, null);
  }
  const cached = input.cachedAmountPaidCents;
  if (cached !== null && (!Number.isSafeInteger(cached) || cached < 0)) {
    return blocked(input, null);
  }

  let ledgerPaymentsCents = 0;
  for (const row of input.paymentRows) {
    if (!Number.isSafeInteger(row.amountCents) || row.amountCents <= 0) {
      return blocked(input, null);
    }
    if (row.voidedAt === null) {
      const next = ledgerPaymentsCents + row.amountCents;
      if (!Number.isSafeInteger(next)) {
        return blocked(input, null);
      }
      ledgerPaymentsCents = next;
    }
  }

  if (input.paymentRows.length === 0) {
    if (cached !== null && cached > 0) {
      return blocked(input, ledgerPaymentsCents);
    }
    if (cached === 0) {
      return {
        ok: true,
        state: 'explicit_zero',
        appointmentPaymentsCents: 0,
        ledgerPaymentsCents,
        hasPaymentRows: false,
        legacyPaidAssumed: false,
      };
    }
    if (input.appointmentStatus === 'completed' && input.paymentStatus === 'paid') {
      return {
        ok: true,
        state: 'legacy_paid',
        appointmentPaymentsCents: null,
        ledgerPaymentsCents,
        hasPaymentRows: false,
        legacyPaidAssumed: true,
      };
    }
    if (input.appointmentStatus === 'completed' && input.paymentStatus !== 'comp') {
      // A completed historical row can lose its old `paid` scalar when a
      // credited deposit is later refunded. NULL cache + no ledger cannot prove
      // the remaining tender was zero, so collecting from it would risk a
      // second charge. Fresh D6.1 completions persist an explicit zero instead.
      return blocked(input, ledgerPaymentsCents);
    }
    // New/pre-ledger appointments legitimately have no cache or rows yet.
    return {
      ok: true,
      state: 'untracked_zero',
      appointmentPaymentsCents: 0,
      ledgerPaymentsCents,
      hasPaymentRows: false,
      legacyPaidAssumed: false,
    };
  }

  // Historical ledgers predate the cache column. Their rows remain the
  // authoritative provenance; only an explicitly stored cache can disagree.
  if (cached !== null && cached !== ledgerPaymentsCents) {
    return blocked(input, ledgerPaymentsCents);
  }

  return {
    ok: true,
    state: 'ledger',
    appointmentPaymentsCents: ledgerPaymentsCents,
    ledgerPaymentsCents,
    hasPaymentRows: true,
    legacyPaidAssumed: false,
  };
}
