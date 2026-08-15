import { describe, expect, it } from 'vitest';

import {
  computeDepositCreditFinancials,
  type DepositCreditRow,
  resolveDepositCredit,
} from './depositCredit';
import {
  buildForfeitureTaxSnapshot,
  type ForfeitureTaxSnapshot,
  resolveTaxConfig,
} from './taxConfig';

const NOW = new Date('2026-08-15T12:00:00.000Z');

function deposit(overrides: Partial<DepositCreditRow> = {}): DepositCreditRow {
  return {
    id: 'dep_1',
    status: 'paid',
    amountCents: 2500,
    currency: 'cad',
    stripePaymentIntentId: 'pi_1',
    stripeRefundId: null,
    refundedAt: null,
    refundStatus: null,
    refundStatusChangedAt: null,
    refundAmountCents: null,
    refundRequestedAt: null,
    refundTrigger: null,
    refundLastErrorCode: null,
    refundFailureReason: null,
    externalRefundObservedCents: null,
    refundConflictFlag: false,
    refundTerminalFailureCount: 0,
    priorRefundIds: [],
    forfeitedAt: null,
    forfeitureTaxSnapshot: null,
    createdAt: NOW,
    ...overrides,
  };
}

function forfeitureSnapshot(
  overrides: Partial<ForfeitureTaxSnapshot> = {},
): ForfeitureTaxSnapshot {
  return {
    ...buildForfeitureTaxSnapshot({
      taxConfig: resolveTaxConfig({
        payments: {
          tax: {
            enabled: true,
            name: 'HST',
            rateBps: 1300,
            jurisdiction: 'Ontario HST',
            country: 'CA',
            region: 'ON',
          },
        },
      }, NOW),
      grossForfeitedCents: 2500,
      capturedAt: NOW,
      currency: 'CAD',
    }),
    ...overrides,
  };
}

function forfeitedDeposit(overrides: Partial<DepositCreditRow> = {}): DepositCreditRow {
  return deposit({
    forfeitedAt: NOW,
    forfeitureTaxSnapshot: forfeitureSnapshot(),
    ...overrides,
  });
}

function resolve(deposits: readonly DepositCreditRow[], invoiceCurrency = 'CAD') {
  return resolveDepositCredit({ deposits, invoiceCurrency });
}

function succeededRefund(overrides: Partial<DepositCreditRow> = {}): DepositCreditRow {
  return deposit({
    status: 'refunded',
    stripeRefundId: 're_1',
    refundedAt: NOW,
    refundStatus: 'succeeded',
    refundStatusChangedAt: NOW,
    refundAmountCents: 2500,
    refundRequestedAt: NOW,
    refundTrigger: 'owner',
    ...overrides,
  });
}

describe('resolveDepositCredit', () => {
  it('returns a resolved zero for an appointment with no deposit rows', () => {
    expect(resolve([])).toEqual({
      ok: true,
      state: 'none',
      collectedDepositCents: 0,
      succeededRefundedCents: 0,
      forfeitedDepositCents: 0,
      eligibleCreditCents: 0,
      creditedDepositIds: [],
      refundedDepositIds: [],
      forfeitedDepositIds: [],
    });
  });

  it('credits exactly one clean collected deposit', () => {
    expect(resolve([deposit()])).toEqual({
      ok: true,
      state: 'creditable',
      collectedDepositCents: 2500,
      succeededRefundedCents: 0,
      forfeitedDepositCents: 0,
      eligibleCreditCents: 2500,
      creditedDepositIds: ['dep_1'],
      refundedDepositIds: [],
      forfeitedDepositIds: [],
    });
  });

  it.each(['checkout_created', 'expired', 'canceled', 'waived'])(
    'treats a clean uncollected %s row as zero credit',
    (status) => {
      expect(resolve([deposit({ status, stripePaymentIntentId: null })])).toMatchObject({
        ok: true,
        state: 'none',
        eligibleCreditCents: 0,
      });
    },
  );

  it('keeps a clean uncollected row at zero credit without inventing invoice currency', () => {
    expect(resolveDepositCredit({
      deposits: [deposit({ status: 'checkout_created', stripePaymentIntentId: null })],
      invoiceCurrency: '',
    })).toMatchObject({
      ok: true,
      state: 'none',
      eligibleCreditCents: 0,
    });
  });

  it('blocks an uncollected row with a PaymentIntent until its money is reconciled', () => {
    expect(resolve([deposit({ status: 'waived' })])).toMatchObject({
      ok: false,
      code: 'DEPOSIT_RECONCILIATION_REQUIRED',
    });
  });

  it('credits zero only for a definitive exact full succeeded refund', () => {
    expect(resolve([succeededRefund()])).toEqual({
      ok: true,
      state: 'fully_refunded',
      collectedDepositCents: 2500,
      succeededRefundedCents: 2500,
      forfeitedDepositCents: 0,
      eligibleCreditCents: 0,
      creditedDepositIds: [],
      refundedDepositIds: ['dep_1'],
      forfeitedDepositIds: [],
    });
  });

  it('resolves a coherent full forfeiture as retained money with zero credit', () => {
    expect(resolve([forfeitedDeposit()])).toEqual({
      ok: true,
      state: 'forfeited',
      collectedDepositCents: 2500,
      succeededRefundedCents: 0,
      forfeitedDepositCents: 2500,
      eligibleCreditCents: 0,
      creditedDepositIds: [],
      refundedDepositIds: [],
      forfeitedDepositIds: ['dep_1'],
    });
  });

  it('keeps immutable forfeiture evidence when the retained deposit is later fully refunded', () => {
    expect(resolve([succeededRefund({
      forfeitedAt: NOW,
      forfeitureTaxSnapshot: forfeitureSnapshot(),
    })])).toEqual({
      ok: true,
      state: 'fully_refunded',
      collectedDepositCents: 2500,
      succeededRefundedCents: 2500,
      forfeitedDepositCents: 2500,
      eligibleCreditCents: 0,
      creditedDepositIds: [],
      refundedDepositIds: ['dep_1'],
      forfeitedDepositIds: ['dep_1'],
    });
  });

  it.each(['requested', 'pending', 'failed']) (
    'blocks a %s refund after forfeiture instead of crediting or settling it',
    (refundStatus) => {
      expect(resolve([forfeitedDeposit({
        refundStatus,
        refundStatusChangedAt: NOW,
      })])).toMatchObject({
        ok: false,
        code: refundStatus === 'failed'
          ? 'DEPOSIT_REFUND_UNRESOLVED'
          : 'DEPOSIT_REFUND_IN_FLIGHT',
      });
    },
  );

  it('blocks one-sided, partial, wrong-currency, and timestamp-drifted forfeiture evidence', () => {
    for (const row of [
      deposit({ forfeitedAt: NOW }),
      deposit({ forfeitureTaxSnapshot: forfeitureSnapshot() }),
      forfeitedDeposit({
        forfeitureTaxSnapshot: forfeitureSnapshot({
          grossForfeitedCents: 2000,
          estimatedNetCents: 2000,
        }),
      }),
      forfeitedDeposit({
        forfeitureTaxSnapshot: forfeitureSnapshot({ currency: 'USD' }),
      }),
      forfeitedDeposit({
        forfeitureTaxSnapshot: forfeitureSnapshot({
          capturedAt: '2026-08-15T12:00:01.000Z',
        }),
      }),
    ]) {
      expect(resolve([row])).toMatchObject({
        ok: false,
        code: 'DEPOSIT_RECONCILIATION_REQUIRED',
      });
    }
  });

  it('blocks forged forfeiture tax components and rounding', () => {
    for (const snapshot of [
      forfeitureSnapshot({ estimatedTaxIncludedCents: 1 }),
      forfeitureSnapshot({
        taxEstimateApplied: true,
        estimatedTaxIncludedCents: 287,
        estimatedNetCents: 2213,
      }),
      forfeitureSnapshot({
        taxEstimateApplied: true,
        estimatedTaxIncludedCents: 288,
        estimatedNetCents: 2212,
        configuration: {
          ...forfeitureSnapshot().configuration,
          enabled: false,
        },
      }),
    ]) {
      expect(resolve([forfeitedDeposit({ forfeitureTaxSnapshot: snapshot })])).toMatchObject({
        ok: false,
        code: 'DEPOSIT_RECONCILIATION_REQUIRED',
      });
    }
  });

  it('blocks a retained forfeiture alongside another retained paid deposit', () => {
    expect(resolve([
      forfeitedDeposit({ id: 'dep_forfeited' }),
      deposit({ id: 'dep_creditable' }),
    ])).toMatchObject({
      ok: false,
      code: 'DEPOSIT_RECONCILIATION_REQUIRED',
      depositIds: ['dep_forfeited', 'dep_creditable'],
    });
  });

  it('requires collection identity for both a paid row and a succeeded refund', () => {
    expect(resolve([deposit({ stripePaymentIntentId: null })])).toMatchObject({
      ok: false,
      code: 'DEPOSIT_RECONCILIATION_REQUIRED',
    });
    expect(resolve([succeededRefund({ stripePaymentIntentId: null })])).toMatchObject({
      ok: false,
      code: 'DEPOSIT_RECONCILIATION_REQUIRED',
    });
  });

  it.each(['requested', 'pending'])(
    'blocks a %s refund rather than racing it with collection',
    (refundStatus) => {
      expect(resolve([deposit({ refundStatus, refundStatusChangedAt: NOW })])).toMatchObject({
        ok: false,
        code: 'DEPOSIT_REFUND_IN_FLIGHT',
      });
    },
  );

  it('blocks a failed refund even when the original deposit is still retained', () => {
    expect(resolve([deposit({
      refundStatus: 'failed',
      refundStatusChangedAt: NOW,
      refundTerminalFailureCount: 1,
    })])).toMatchObject({ ok: false, code: 'DEPOSIT_REFUND_UNRESOLVED' });
  });

  it('blocks a succeeded-to-failed reversal whose outer status remains refunded', () => {
    expect(resolve([succeededRefund({
      refundStatus: 'failed',
      refundFailureReason: 'declined',
    })])).toMatchObject({ ok: false, code: 'DEPOSIT_REFUND_UNRESOLVED' });
  });

  it('blocks pending outer-refunded state instead of treating the outer status as success', () => {
    expect(resolve([succeededRefund({ refundStatus: 'pending' })])).toMatchObject({
      ok: false,
      code: 'DEPOSIT_REFUND_IN_FLIGHT',
    });
  });

  it('blocks a historical outer-refunded row with no reconciled refund status', () => {
    expect(resolve([deposit({
      status: 'refunded',
      stripeRefundId: 're_historical',
      refundedAt: NOW,
    })])).toMatchObject({ ok: false, code: 'DEPOSIT_RECONCILIATION_REQUIRED' });
  });

  it('blocks a paid row carrying stale refund identity without a current status', () => {
    expect(resolve([deposit({ stripeRefundId: 're_stale' })])).toMatchObject({
      ok: false,
      code: 'DEPOSIT_RECONCILIATION_REQUIRED',
    });
  });

  it('never subtracts the detection-only external partial amount', () => {
    const result = resolve([deposit({ externalRefundObservedCents: 500 })]);

    expect(result).toMatchObject({
      ok: false,
      code: 'DEPOSIT_PARTIAL_REFUND_UNSUPPORTED',
    });
    expect(result).not.toMatchObject({ eligibleCreditCents: 2000 });
  });

  it('blocks a locally stamped succeeded partial refund', () => {
    expect(resolve([succeededRefund({ refundAmountCents: 500 })])).toMatchObject({
      ok: false,
      code: 'DEPOSIT_PARTIAL_REFUND_UNSUPPORTED',
    });
  });

  it('blocks a refund identity conflict before considering the row creditable', () => {
    expect(resolve([deposit({ refundConflictFlag: true })])).toMatchObject({
      ok: false,
      code: 'DEPOSIT_REFUND_CONFLICT',
    });
  });

  it('blocks currency drift and malformed invoice currency', () => {
    expect(resolve([deposit()], 'USD')).toMatchObject({
      ok: false,
      code: 'DEPOSIT_CURRENCY_MISMATCH',
    });
    expect(resolve([deposit()], 'not-money')).toMatchObject({
      ok: false,
      code: 'DEPOSIT_CURRENCY_MISMATCH',
    });
  });

  it.each([0, -1, 2.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'blocks invalid original amount %s',
    (amountCents) => {
      expect(resolve([deposit({ amountCents })])).toMatchObject({
        ok: false,
        code: 'DEPOSIT_INVALID_MONEY',
      });
    },
  );

  it('requires the full succeeded-refund identity, amount, and timestamps', () => {
    for (const row of [
      succeededRefund({ stripeRefundId: null }),
      succeededRefund({ refundAmountCents: 2600 }),
      succeededRefund({ refundedAt: null }),
      succeededRefund({ refundStatusChangedAt: null }),
      succeededRefund({ status: 'paid' }),
    ]) {
      expect(resolve([row])).toMatchObject({
        ok: false,
        code: 'DEPOSIT_RECONCILIATION_REQUIRED',
      });
    }
  });

  it('consumes all terminal history and credits only the one clean paid row', () => {
    const rows = [
      deposit({ id: 'dep_waived', status: 'waived', stripePaymentIntentId: null }),
      succeededRefund({ id: 'dep_refunded' }),
      deposit({ id: 'dep_current', amountCents: 3000 }),
      deposit({ id: 'dep_expired', status: 'expired', stripePaymentIntentId: null }),
    ];

    expect(resolve(rows)).toEqual({
      ok: true,
      state: 'creditable',
      collectedDepositCents: 5500,
      succeededRefundedCents: 2500,
      forfeitedDepositCents: 0,
      eligibleCreditCents: 3000,
      creditedDepositIds: ['dep_current'],
      refundedDepositIds: ['dep_refunded'],
      forfeitedDepositIds: [],
    });
  });

  it('blocks multiple creditable deposits rather than silently adding duplicate money', () => {
    expect(resolve([
      deposit({ id: 'dep_a' }),
      deposit({ id: 'dep_b', amountCents: 1500 }),
    ])).toMatchObject({
      ok: false,
      code: 'DEPOSIT_RECONCILIATION_REQUIRED',
      depositIds: ['dep_a', 'dep_b'],
    });
  });

  it('blocks duplicate row identities rather than counting a loader retry twice', () => {
    expect(resolve([deposit(), deposit()])).toMatchObject({
      ok: false,
      code: 'DEPOSIT_RECONCILIATION_REQUIRED',
      depositIds: ['dep_1', 'dep_1'],
    });
  });

  it('is deterministic across terminal-history ordering', () => {
    const paid = deposit({ id: 'dep_paid' });
    const refunded = succeededRefund({ id: 'dep_refunded' });
    const first = resolve([paid, refunded]);
    const second = resolve([refunded, paid]);

    expect(first).toMatchObject({
      ok: true,
      collectedDepositCents: 5000,
      succeededRefundedCents: 2500,
      eligibleCreditCents: 2500,
    });
    expect(second).toMatchObject({
      ok: true,
      collectedDepositCents: 5000,
      succeededRefundedCents: 2500,
      eligibleCreditCents: 2500,
    });
  });
});

describe('computeDepositCreditFinancials', () => {
  it('applies credit to finalPrice + tax, then leaves tip separately due', () => {
    expect(computeDepositCreditFinancials({
      finalPriceCents: 10000,
      taxAmountCents: 1300,
      tipCents: 1000,
      tenderedCents: 8800,
      eligibleDepositCreditCents: 2500,
    })).toEqual({
      ok: true,
      serviceInvoiceCents: 11300,
      totalDueCents: 12300,
      depositCreditAppliedCents: 2500,
      excessDepositCents: 0,
      serviceBalanceAfterCreditCents: 8800,
      tenderedCents: 8800,
      amountAlreadyPaidCents: 11300,
      remainingBalanceCents: 1000,
      tenderExcessCents: 0,
      complimentary: false,
      legacyPaidAssumed: false,
      financiallySettled: false,
    });
  });

  it('caps credit and computes excess against service invoice, never tip', () => {
    expect(computeDepositCreditFinancials({
      finalPriceCents: 1000,
      taxAmountCents: 130,
      tipCents: 500,
      tenderedCents: 0,
      eligibleDepositCreditCents: 1500,
    })).toMatchObject({
      ok: true,
      serviceInvoiceCents: 1130,
      totalDueCents: 1630,
      depositCreditAppliedCents: 1130,
      excessDepositCents: 370,
      remainingBalanceCents: 500,
      financiallySettled: false,
    });
  });

  it('never returns a negative remaining balance and exposes tender excess', () => {
    expect(computeDepositCreditFinancials({
      finalPriceCents: 5000,
      taxAmountCents: 0,
      tipCents: 0,
      tenderedCents: 4000,
      eligibleDepositCreditCents: 2500,
    })).toMatchObject({
      ok: true,
      remainingBalanceCents: 0,
      tenderExcessCents: 1500,
      financiallySettled: false,
    });
  });

  it('makes a complimentary appointment owe zero explicitly', () => {
    expect(computeDepositCreditFinancials({
      finalPriceCents: 10000,
      taxAmountCents: 1300,
      tipCents: 1000,
      tenderedCents: 0,
      eligibleDepositCreditCents: 2500,
      appointmentStatus: 'completed',
      paymentStatus: 'comp',
    })).toMatchObject({
      ok: true,
      complimentary: true,
      depositCreditAppliedCents: 0,
      excessDepositCents: 2500,
      legacyPaidAssumed: false,
      remainingBalanceCents: 0,
      financiallySettled: false,
    });
  });

  it('keeps a no-deposit complimentary appointment settled', () => {
    expect(computeDepositCreditFinancials({
      finalPriceCents: 10000,
      taxAmountCents: 1300,
      tipCents: 0,
      tenderedCents: 0,
      eligibleDepositCreditCents: 0,
      appointmentStatus: 'completed',
      paymentStatus: 'comp',
    })).toMatchObject({
      ok: true,
      complimentary: true,
      depositCreditAppliedCents: 0,
      excessDepositCents: 0,
      remainingBalanceCents: 0,
      financiallySettled: true,
    });
  });

  it('treats any recorded tender on a complimentary appointment as excess', () => {
    expect(computeDepositCreditFinancials({
      finalPriceCents: 10000,
      taxAmountCents: 0,
      tipCents: 0,
      tenderedCents: 500,
      eligibleDepositCreditCents: 0,
      appointmentStatus: 'completed',
      paymentStatus: 'comp',
    })).toMatchObject({
      ok: true,
      remainingBalanceCents: 0,
      tenderExcessCents: 500,
      financiallySettled: false,
    });
  });

  it('preserves a legacy completed paid row with null paid snapshot as settled', () => {
    expect(computeDepositCreditFinancials({
      finalPriceCents: 10000,
      taxAmountCents: 1300,
      tipCents: 1000,
      tenderedCents: null,
      eligibleDepositCreditCents: 2500,
      appointmentStatus: 'completed',
      paymentStatus: 'paid',
    })).toMatchObject({
      ok: true,
      tenderedCents: 9800,
      amountAlreadyPaidCents: 12300,
      remainingBalanceCents: 0,
      legacyPaidAssumed: true,
      financiallySettled: true,
    });
  });

  it('does not infer tender for a non-completed row merely labelled paid', () => {
    expect(computeDepositCreditFinancials({
      finalPriceCents: 10000,
      taxAmountCents: 0,
      tipCents: 0,
      tenderedCents: null,
      eligibleDepositCreditCents: 2500,
      appointmentStatus: 'confirmed',
      paymentStatus: 'paid',
    })).toMatchObject({
      ok: true,
      tenderedCents: 0,
      remainingBalanceCents: 7500,
      legacyPaidAssumed: false,
    });
  });

  it('normalizes all-null legacy snapshots to zero without inventing tender', () => {
    expect(computeDepositCreditFinancials({
      finalPriceCents: null,
      taxAmountCents: null,
      tipCents: null,
      tenderedCents: null,
      eligibleDepositCreditCents: 0,
    })).toMatchObject({
      ok: true,
      totalDueCents: 0,
      amountAlreadyPaidCents: 0,
      remainingBalanceCents: 0,
    });
  });

  it.each([
    ['finalPriceCents', -1],
    ['taxAmountCents', 1.5],
    ['tipCents', Number.NaN],
    ['tenderedCents', -1],
    ['eligibleDepositCreditCents', Number.MAX_SAFE_INTEGER + 1],
  ] as const)('blocks invalid %s', (field, value) => {
    expect(computeDepositCreditFinancials({
      finalPriceCents: field === 'finalPriceCents' ? value : 1000,
      taxAmountCents: field === 'taxAmountCents' ? value : 0,
      tipCents: field === 'tipCents' ? value : 0,
      tenderedCents: field === 'tenderedCents' ? value : 0,
      eligibleDepositCreditCents: field === 'eligibleDepositCreditCents' ? value : 0,
    })).toEqual({ ok: false, code: 'DEPOSIT_INVALID_MONEY', field });
  });

  it('blocks aggregate money beyond the supported minor-unit range', () => {
    expect(computeDepositCreditFinancials({
      finalPriceCents: 40_000_000,
      taxAmountCents: 20_000_000,
      tipCents: 0,
      tenderedCents: 0,
      eligibleDepositCreditCents: 0,
    })).toEqual({
      ok: false,
      code: 'DEPOSIT_INVALID_MONEY',
      field: 'serviceInvoiceCents',
    });
  });

  it('blocks a persisted deposit outside the supported minor-unit range', () => {
    expect(resolveDepositCredit({
      deposits: [deposit({ amountCents: 50_000_001 })],
      invoiceCurrency: 'CAD',
    })).toMatchObject({ ok: false, code: 'DEPOSIT_INVALID_MONEY' });
  });
});
