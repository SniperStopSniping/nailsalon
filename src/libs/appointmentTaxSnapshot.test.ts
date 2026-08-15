import { describe, expect, it } from 'vitest';

import {
  buildBookingTaxSnapshot,
  buildFinalTaxSnapshot,
  DISABLED_TAX_CONFIG,
} from '@/libs/taxConfig';

import {
  resolveCheckoutCurrencyProjection,
  validateAppointmentTaxSnapshotChain,
} from './appointmentTaxSnapshot';

const booking = buildBookingTaxSnapshot({
  taxConfig: DISABLED_TAX_CONFIG,
  totals: {
    taxApplied: false,
    taxableSubtotalCents: 0,
    taxAmountCents: 0,
    finalPriceCents: 5000,
  },
  capturedAt: new Date('2026-08-15T12:00:00.000Z'),
  currency: 'CAD',
});
const reschedule = buildBookingTaxSnapshot({
  taxConfig: DISABLED_TAX_CONFIG,
  totals: {
    taxApplied: false,
    taxableSubtotalCents: 0,
    taxAmountCents: 0,
    finalPriceCents: 6000,
  },
  capturedAt: new Date('2026-08-16T12:00:00.000Z'),
  currency: 'CAD',
});
const final = buildFinalTaxSnapshot({
  taxConfig: DISABLED_TAX_CONFIG,
  totals: {
    taxApplied: false,
    taxableSubtotalCents: 0,
    taxAmountCents: 0,
    finalPriceCents: 6500,
  },
  capturedAt: new Date('2026-08-17T12:00:00.000Z'),
  currency: 'CAD',
  taxExempt: false,
});

const base = {
  status: 'confirmed',
  completedAt: null,
  totalPrice: 6000,
  finalPriceCents: null,
  taxableSubtotalCents: null,
  taxAmountCents: null,
  taxExempt: null,
  taxExemptReason: null,
  invoiceCurrency: 'CAD',
  bookingTaxSnapshot: booking,
  rescheduleTaxSnapshot: reschedule,
  finalTaxSnapshot: null,
};

describe('appointment tax snapshot chain', () => {
  it('uses issue-time currency only for a pre-D6 active row with no money evidence', () => {
    expect(resolveCheckoutCurrencyProjection({
      frozenCurrency: null,
      currentCurrency: 'cad',
      appointmentStatus: 'confirmed',
      hasDepositHistory: false,
      hasSnapshotEvidence: false,
    })).toBe('CAD');
    expect(resolveCheckoutCurrencyProjection({
      frozenCurrency: null,
      currentCurrency: 'cad',
      appointmentStatus: 'confirmed',
      hasDepositHistory: true,
      hasSnapshotEvidence: false,
    })).toBeNull();
    expect(resolveCheckoutCurrencyProjection({
      frozenCurrency: null,
      currentCurrency: 'cad',
      appointmentStatus: 'completed',
      hasDepositHistory: false,
      hasSnapshotEvidence: false,
    })).toBeNull();
  });

  it('preserves original history while selecting and validating the current reschedule estimate', () => {
    expect(validateAppointmentTaxSnapshotChain(base)).toMatchObject({
      ok: true,
      invoiceCurrency: 'CAD',
      active: { source: 'reschedule', snapshot: reschedule },
    });
  });

  it('rejects a reschedule estimate that no longer matches the booked total', () => {
    expect(validateAppointmentTaxSnapshotChain({
      ...base,
      totalPrice: 6100,
    })).toMatchObject({
      ok: false,
      code: 'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
    });
  });

  it('requires a final actual snapshot for a completed row with either estimate generation', () => {
    expect(validateAppointmentTaxSnapshotChain({
      ...base,
      status: 'completed',
      bookingTaxSnapshot: null,
    })).toMatchObject({
      ok: false,
      code: 'TAX_SNAPSHOT_INVALID_SHAPE',
    });
  });

  it('validates final snapshot money against immutable scalar columns', () => {
    expect(validateAppointmentTaxSnapshotChain({
      ...base,
      status: 'completed',
      completedAt: new Date(final.capturedAt),
      finalPriceCents: 6500,
      taxableSubtotalCents: 0,
      taxAmountCents: 0,
      taxExempt: false,
      finalTaxSnapshot: final,
    })).toMatchObject({ ok: true, active: { source: 'final' } });

    expect(validateAppointmentTaxSnapshotChain({
      ...base,
      status: 'completed',
      completedAt: new Date(final.capturedAt),
      finalPriceCents: 6400,
      taxableSubtotalCents: 0,
      taxAmountCents: 0,
      taxExempt: false,
      finalTaxSnapshot: final,
    })).toMatchObject({
      ok: false,
      code: 'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
    });
  });

  it('binds the final tax identity to the immutable completion instant', () => {
    expect(validateAppointmentTaxSnapshotChain({
      ...base,
      status: 'completed',
      completedAt: new Date('2026-08-17T12:00:01.000Z'),
      finalPriceCents: 6500,
      taxableSubtotalCents: 0,
      taxAmountCents: 0,
      taxExempt: false,
      finalTaxSnapshot: final,
    })).toMatchObject({
      ok: false,
      code: 'TAX_SNAPSHOT_TIMESTAMP_INVALID',
    });
  });

  it('keeps truly historical rows explicit without inventing currency or tax facts', () => {
    expect(validateAppointmentTaxSnapshotChain({
      ...base,
      status: 'completed',
      invoiceCurrency: null,
      bookingTaxSnapshot: null,
      rescheduleTaxSnapshot: null,
      finalTaxSnapshot: null,
    })).toEqual({
      ok: true,
      invoiceCurrency: null,
      active: { source: 'historical', snapshot: null },
    });
  });
});
