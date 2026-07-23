import { describe, expect, it } from 'vitest';

import {
  buildReportingProvenance,
  resolveAppointmentBalance,
  resolveCompletedAppointmentRevenue,
  summarizeCompletedAppointmentRevenue,
  UNSUPPORTED_DEPOSIT_DUE,
} from './financialReporting';

describe('completed appointment revenue provenance', () => {
  it('uses a finalized snapshot without adding tax or tips', () => {
    const result = resolveCompletedAppointmentRevenue({
      status: 'completed',
      paymentStatus: 'paid',
      finalPriceCents: 8200,
      legacyBookedTotalCents: 9000,
    });

    expect(result).toEqual({ amountCents: 8200, source: 'finalized' });
  });

  it('labels booked-total fallback as legacy', () => {
    const result = resolveCompletedAppointmentRevenue({
      status: 'completed',
      paymentStatus: 'pending',
      finalPriceCents: null,
      legacyBookedTotalCents: 7500,
    });

    expect(result).toEqual({ amountCents: 7500, source: 'legacy' });
  });

  it.each([
    { status: 'cancelled', deletedAt: null, paymentStatus: 'paid' },
    { status: 'no_show', deletedAt: null, paymentStatus: 'paid' },
    { status: 'confirmed', deletedAt: null, paymentStatus: 'pending' },
    { status: 'completed', deletedAt: new Date('2026-07-01'), paymentStatus: 'paid' },
    { status: 'completed', deletedAt: null, paymentStatus: 'comp' },
  ])('excludes ineligible appointment %#', (appointment) => {
    const result = resolveCompletedAppointmentRevenue({
      ...appointment,
      finalPriceCents: 5000,
      legacyBookedTotalCents: 5000,
    });

    expect(result).toEqual({ amountCents: 0, source: 'excluded' });
  });

  it('does not silently fall back when a present finalized snapshot is invalid', () => {
    const result = resolveCompletedAppointmentRevenue({
      status: 'completed',
      paymentStatus: 'paid',
      finalPriceCents: -1,
      legacyBookedTotalCents: 6000,
    });

    expect(result).toEqual({ amountCents: 0, source: 'unresolved' });
  });

  it('summarizes finalized, legacy, unresolved, and excluded rows separately', () => {
    const summary = summarizeCompletedAppointmentRevenue([
      {
        status: 'completed',
        paymentStatus: 'paid',
        finalPriceCents: 5000,
        legacyBookedTotalCents: 5500,
      },
      {
        status: 'completed',
        paymentStatus: 'pending',
        finalPriceCents: null,
        legacyBookedTotalCents: 4000,
      },
      {
        status: 'completed',
        paymentStatus: 'paid',
        finalPriceCents: null,
        legacyBookedTotalCents: null,
      },
      {
        status: 'cancelled',
        paymentStatus: 'paid',
        finalPriceCents: 9000,
        legacyBookedTotalCents: 9000,
      },
    ]);

    expect(summary).toEqual({
      completedAppointmentRevenueCents: 9000,
      provenance: {
        mode: 'mixed',
        finalizedAppointmentCount: 1,
        legacyAppointmentCount: 1,
        unresolvedAppointmentCount: 1,
        finalizedAmountCents: 5000,
        legacyFallbackAmountCents: 4000,
        isEstimated: true,
      },
    });
  });

  it('marks a finalized aggregate with unresolved rows as incomplete', () => {
    const provenance = buildReportingProvenance({
      finalizedAppointmentCount: 2,
      legacyAppointmentCount: 0,
      unresolvedAppointmentCount: 1,
      finalizedAmountCents: 10000,
      legacyFallbackAmountCents: 0,
    });

    expect(provenance.mode).toBe('finalized');
    expect(provenance.isEstimated).toBe(true);
  });

  it('returns empty, non-estimated provenance when there are no eligible rows', () => {
    expect(buildReportingProvenance({
      finalizedAppointmentCount: 0,
      legacyAppointmentCount: 0,
      unresolvedAppointmentCount: 0,
      finalizedAmountCents: 0,
      legacyFallbackAmountCents: 0,
    })).toMatchObject({
      mode: 'empty',
      isEstimated: false,
    });
  });
});

describe('appointment balance categories', () => {
  const NOW = new Date('2026-07-15T16:00:00.000Z');

  it('computes completed outstanding from revenue, tax, tips, and payments', () => {
    const result = resolveAppointmentBalance({
      status: 'completed',
      paymentStatus: 'partially_paid',
      finalPriceCents: 10000,
      legacyBookedTotalCents: 10000,
      taxAmountCents: 1300,
      tipCents: 1000,
      nonVoidedPaymentsCents: 5000,
    });

    expect(result).toEqual({
      category: 'completed_outstanding',
      scope: 'completed',
      source: 'finalized',
      amountCents: 7300,
      reason: null,
    });
  });

  it('clamps an overpaid completed balance to zero', () => {
    const result = resolveAppointmentBalance({
      status: 'completed',
      paymentStatus: 'paid',
      finalPriceCents: 5000,
      legacyBookedTotalCents: 5000,
      taxAmountCents: 0,
      tipCents: 0,
      nonVoidedPaymentsCents: 6000,
    });

    expect(result.amountCents).toBe(0);
    expect(result.category).toBe('completed_outstanding');
  });

  it('requires an explicit reliability decision for legacy completed debt', () => {
    const input = {
      status: 'completed',
      paymentStatus: 'pending',
      finalPriceCents: null,
      legacyBookedTotalCents: 7000,
      taxAmountCents: null,
      tipCents: 0,
      nonVoidedPaymentsCents: 2000,
    };

    expect(resolveAppointmentBalance(input)).toMatchObject({
      category: 'unresolved',
      scope: 'completed',
      reason: 'unreliable_legacy_data',
    });
    expect(resolveAppointmentBalance({
      ...input,
      legacyPaymentDataReliable: true,
    })).toMatchObject({
      category: 'completed_outstanding',
      source: 'legacy',
      amountCents: 5000,
    });
  });

  it('keeps an ordinary future appointment balance separate from completed debt', () => {
    const result = resolveAppointmentBalance({
      status: 'confirmed',
      paymentStatus: 'partially_paid',
      startTime: '2026-07-20T16:00:00.000Z',
      now: NOW,
      finalPriceCents: null,
      legacyBookedTotalCents: 9000,
      taxAmountCents: null,
      tipCents: null,
      nonVoidedPaymentsCents: 2500,
    });

    expect(result).toEqual({
      category: 'upcoming_balance',
      scope: 'upcoming',
      source: 'booked',
      amountCents: 6500,
      reason: null,
    });
  });

  it('does not classify a past confirmed appointment as upcoming debt', () => {
    const result = resolveAppointmentBalance({
      status: 'confirmed',
      paymentStatus: 'pending',
      startTime: '2026-07-10T16:00:00.000Z',
      now: NOW,
      finalPriceCents: null,
      legacyBookedTotalCents: 9000,
      nonVoidedPaymentsCents: 0,
    });

    expect(result.category).toBe('excluded');
  });

  it('does not invent a balance when authoritative payment totals are absent', () => {
    const result = resolveAppointmentBalance({
      status: 'completed',
      paymentStatus: 'pending',
      finalPriceCents: 9000,
      legacyBookedTotalCents: 9000,
      taxAmountCents: 0,
      tipCents: 0,
      nonVoidedPaymentsCents: null,
    });

    expect(result).toMatchObject({
      category: 'unresolved',
      scope: 'completed',
      reason: 'invalid_payment_amount',
    });
  });

  it.each([
    { deletedAt: new Date('2026-07-15'), paymentStatus: 'paid' },
    { deletedAt: null, paymentStatus: 'comp' },
  ])('excludes deleted or complimentary balances %#', (excluded) => {
    const result = resolveAppointmentBalance({
      status: 'completed',
      ...excluded,
      finalPriceCents: 8000,
      legacyBookedTotalCents: 8000,
      nonVoidedPaymentsCents: 0,
    });

    expect(result.category).toBe('excluded');
  });

  it('reports deposit due as unsupported instead of zero dollars', () => {
    expect(UNSUPPORTED_DEPOSIT_DUE).toEqual({
      supported: false,
      amountCents: null,
      reason: 'Per-appointment deposit obligations are not recorded.',
    });
  });
});
