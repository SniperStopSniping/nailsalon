import { describe, expect, it } from 'vitest';

import {
  PAYMENT_LEDGER_RECONCILIATION_REQUIRED,
  resolveAppointmentPaymentLedger,
} from './appointmentPaymentLedger';

const base = {
  appointmentStatus: 'completed',
  paymentStatus: 'partially_paid',
};

describe('resolveAppointmentPaymentLedger', () => {
  it('blocks a payment child row whose tenant does not match its appointment', () => {
    expect(resolveAppointmentPaymentLedger({
      ...base,
      cachedAmountPaidCents: 1000,
      paymentRows: [{
        salonId: 'salon_other',
        amountCents: 1000,
        voidedAt: null,
      }],
      expectedSalonId: 'salon_expected',
    })).toMatchObject({
      ok: false,
      code: PAYMENT_LEDGER_RECONCILIATION_REQUIRED,
      ledgerPaymentsCents: null,
    });
  });

  it('blocks a positive cached paid amount with no provenance rows', () => {
    expect(resolveAppointmentPaymentLedger({
      ...base,
      cachedAmountPaidCents: 2_500,
      paymentRows: [],
    })).toMatchObject({
      ok: false,
      code: PAYMENT_LEDGER_RECONCILIATION_REQUIRED,
      ledgerPaymentsCents: 0,
      cachedAmountPaidCents: 2_500,
    });
  });

  it('blocks cache-versus-ledger drift in either direction', () => {
    const rows = [{ amountCents: 2_500, voidedAt: null }];

    expect(resolveAppointmentPaymentLedger({
      ...base,
      cachedAmountPaidCents: 2_000,
      paymentRows: rows,
    }).ok).toBe(false);
    expect(resolveAppointmentPaymentLedger({
      ...base,
      cachedAmountPaidCents: 0,
      paymentRows: rows,
    }).ok).toBe(false);
  });

  it('accepts authoritative historical ledger rows when the later cache is null', () => {
    expect(resolveAppointmentPaymentLedger({
      ...base,
      cachedAmountPaidCents: null,
      paymentRows: [{ amountCents: 2_500, voidedAt: null }],
    })).toMatchObject({
      ok: true,
      state: 'ledger',
      appointmentPaymentsCents: 2_500,
      ledgerPaymentsCents: 2_500,
    });
  });

  it('uses only non-voided rows and accepts a matching cache', () => {
    expect(resolveAppointmentPaymentLedger({
      ...base,
      cachedAmountPaidCents: 2_500,
      paymentRows: [
        { amountCents: 2_500, voidedAt: null },
        { amountCents: 9_999, voidedAt: new Date('2026-01-01T00:00:00Z') },
      ],
    })).toMatchObject({
      ok: true,
      state: 'ledger',
      appointmentPaymentsCents: 2_500,
      ledgerPaymentsCents: 2_500,
    });
  });

  it('accepts explicit zero, including a fully voided ledger', () => {
    expect(resolveAppointmentPaymentLedger({
      ...base,
      cachedAmountPaidCents: 0,
      paymentRows: [],
    })).toMatchObject({ ok: true, state: 'explicit_zero', appointmentPaymentsCents: 0 });
    expect(resolveAppointmentPaymentLedger({
      ...base,
      cachedAmountPaidCents: 0,
      paymentRows: [{ amountCents: 500, voidedAt: '2026-01-01T00:00:00Z' }],
    })).toMatchObject({ ok: true, state: 'ledger', appointmentPaymentsCents: 0 });
  });

  it('preserves null/no-row completed+paid legacy inference', () => {
    expect(resolveAppointmentPaymentLedger({
      appointmentStatus: 'completed',
      paymentStatus: 'paid',
      cachedAmountPaidCents: null,
      paymentRows: [],
    })).toMatchObject({
      ok: true,
      state: 'legacy_paid',
      appointmentPaymentsCents: null,
      legacyPaidAssumed: true,
    });
  });

  it('blocks a completed legacy row after its paid scalar is invalidated by a refund', () => {
    expect(resolveAppointmentPaymentLedger({
      appointmentStatus: 'completed',
      paymentStatus: 'pending',
      cachedAmountPaidCents: null,
      paymentRows: [],
    })).toMatchObject({
      ok: false,
      code: PAYMENT_LEDGER_RECONCILIATION_REQUIRED,
      cachedAmountPaidCents: null,
      ledgerPaymentsCents: 0,
    });
  });

  it('treats null/no-row unfinished appointments as zero tender', () => {
    expect(resolveAppointmentPaymentLedger({
      appointmentStatus: 'confirmed',
      paymentStatus: 'pending',
      cachedAmountPaidCents: null,
      paymentRows: [],
    })).toMatchObject({
      ok: true,
      state: 'untracked_zero',
      appointmentPaymentsCents: 0,
    });
  });

  it('fails closed for invalid or overflowing minor-unit data', () => {
    expect(resolveAppointmentPaymentLedger({
      ...base,
      cachedAmountPaidCents: -1,
      paymentRows: [],
    }).ok).toBe(false);
    expect(resolveAppointmentPaymentLedger({
      ...base,
      cachedAmountPaidCents: Number.MAX_SAFE_INTEGER,
      paymentRows: [
        { amountCents: Number.MAX_SAFE_INTEGER, voidedAt: null },
        { amountCents: 1, voidedAt: null },
      ],
    }).ok).toBe(false);
  });
});
