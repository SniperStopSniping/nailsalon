import { describe, expect, it } from 'vitest';

import type { AdjustmentBalanceInput, AdjustmentPayment, AdjustmentRefund, AdjustmentRequest } from './adjustments';
import { adjustmentPermissions, resolveAdjustmentBalance } from './adjustments';

const scope = { salonId: 'salon-one', appointmentId: 'appointment-one' };
const payment = (overrides: Partial<AdjustmentPayment> = {}): AdjustmentPayment => ({
  ...scope,
  id: 'payment-one',
  movementId: 'stripe-charge-one',
  kind: 'online',
  principalCents: 10000,
  tipCents: 0,
  state: 'confirmed',
  ...overrides,
});
const refund = (overrides: Partial<AdjustmentRefund> = {}): AdjustmentRefund => ({
  ...scope,
  id: 'refund-one',
  paymentId: 'payment-one',
  principalCents: 2000,
  tipCents: 0,
  state: 'succeeded',
  ...overrides,
});
const request = (overrides: Partial<AdjustmentRequest> = {}): AdjustmentRequest => ({
  ...scope,
  id: 'request-one',
  billRevision: 2,
  principalCents: 2000,
  tipCents: 0,
  state: 'open',
  ...overrides,
});
const input = (overrides: Partial<AdjustmentBalanceInput> = {}): AdjustmentBalanceInput => ({
  revision: 2,
  bill: { ...scope, revision: 2, serviceCents: 12000, taxCents: 0, tipCents: 0 },
  payments: [payment()],
  refunds: [],
  requests: [],
  ...overrides,
});

describe('post-payment adjustment balances', () => {
  it('collects only the increase after a full payment without changing original facts', () => {
    const evidence = input();
    const before = structuredClone(evidence);

    expect(resolveAdjustmentBalance(evidence)).toMatchObject({ totalCents: 12000, netPaidCents: 10000, balanceDueCents: 2000, overpaidCents: 0, canReservePayment: true });
    expect(evidence).toEqual(before);
  });

  it('credits deposits once and preserves excess deposits when service is reduced', () => {
    const evidence = input({ payments: [payment({ kind: 'deposit', principalCents: 2000 })] });

    expect(resolveAdjustmentBalance(evidence).balanceDueCents).toBe(10000);

    evidence.bill.serviceCents = 1500;

    expect(resolveAdjustmentBalance(evidence)).toMatchObject({ balanceDueCents: 0, overpaidCents: 500, canReserveRefund: true });
  });

  it('settles a reduced invoice after refund without making the old invoice collectible', () => {
    const evidence = input();
    evidence.bill.serviceCents = 8000;

    expect(resolveAdjustmentBalance(evidence)).toMatchObject({ overpaidCents: 2000, canReserveRefund: true });

    evidence.refunds = [refund()];

    expect(resolveAdjustmentBalance(evidence)).toMatchObject({ totalCents: 8000, grossPaidCents: 10000, refundedCents: 2000, netPaidCents: 8000, balanceDueCents: 0, overpaidCents: 0, canReserveRefund: false, canReservePayment: false });
  });

  it('sums multiple actual payments including manual tenders and a deposit', () => {
    expect(resolveAdjustmentBalance(input({ payments: [
      payment({ id: 'deposit', movementId: 'deposit-charge', kind: 'deposit', principalCents: 2000 }),
      payment({ principalCents: 7000 }),
      payment({ id: 'cash', movementId: 'manual-cash-entry', kind: 'manual', principalCents: 3000 }),
    ] }))).toMatchObject({ netPaidCents: 12000, balanceDueCents: 0 });
  });

  it('refuses double-crediting a deposit as another online tender', () => {
    expect(() => resolveAdjustmentBalance(input({ payments: [payment(), payment({ id: 'deposit-copy', kind: 'deposit' })] }))).toThrow('ADJUSTMENT_DUPLICATE_MOVEMENT');
  });

  it.each(['payments', 'refunds', 'requests'] as const)('rejects wrong-salon %s evidence', (kind) => {
    const evidence = input({ payments: [payment()], refunds: [refund()], requests: [request()] });
    evidence[kind][0]!.salonId = 'other-salon';

    expect(() => resolveAdjustmentBalance(evidence)).toThrow('ADJUSTMENT_SCOPE_MISMATCH');
  });

  it.each(['payments', 'refunds', 'requests'] as const)('rejects duplicate %s evidence', (kind) => {
    const evidence = input({ payments: [payment()], refunds: [refund()], requests: [request()] });
    if (kind === 'payments') {
      evidence.payments.push(payment());
    }
    if (kind === 'refunds') {
      evidence.refunds.push(refund());
    }
    if (kind === 'requests') {
      evidence.requests.push(request());
    }

    expect(() => resolveAdjustmentBalance(evidence)).toThrow('ADJUSTMENT_DUPLICATE_EVIDENCE');
  });

  it.each(['requested', 'pending'] as const)('reserves %s refunds without counting them as returned money', (state) => {
    const evidence = input({ refunds: [refund({ state })] });
    evidence.bill.serviceCents = 8000;

    expect(resolveAdjustmentBalance(evidence)).toMatchObject({ netPaidCents: 10000, refundedCents: 0, pendingRefundCents: 2000, overpaidCents: 2000, canReserveRefund: false, blockedReasons: ['REFUND_PENDING'], refundable: [{ principalCents: 8000 }] });
  });

  it.each(['failed', 'canceled'] as const)('does not subtract a %s refund', (state) => {
    const evidence = input({ refunds: [refund({ state })] });
    evidence.bill.serviceCents = 8000;

    expect(resolveAdjustmentBalance(evidence)).toMatchObject({ netPaidCents: 10000, pendingRefundCents: 0, overpaidCents: 2000, canReserveRefund: true });
  });

  it('rejects refunds beyond the original payment including pending reservations', () => {
    expect(() => resolveAdjustmentBalance(input({ refunds: [refund({ principalCents: 9000 }), refund({ id: 'refund-two', state: 'pending' })] }))).toThrow('ADJUSTMENT_REFUND_EXCEEDS_PAYMENT');
  });

  it('refuses refund attribution to an unknown payment', () => {
    expect(() => resolveAdjustmentBalance(input({ refunds: [refund({ paymentId: 'unknown' })] }))).toThrow('ADJUSTMENT_INVALID_REFUND_PARENT');
  });

  it('never uses a prepaid tip to cover an increased service price', () => {
    const evidence = input({ payments: [payment({ tipCents: 2000 })] });
    const result = resolveAdjustmentBalance(evidence);

    expect(result).toMatchObject({ netPaidCents: 12000, totalCents: 12000, principalDueCents: 2000, tipOverpaidCents: 2000, canReservePayment: false, canReserveRefund: false, blockedReasons: ['COMPONENT_REALLOCATION_REQUIRED'] });
  });

  it('keeps tax and the unchanged tip in the revised total', () => {
    const evidence = input({ payments: [payment({ principalCents: 11300, tipCents: 1500 })] });
    evidence.bill.taxCents = 1560;
    evidence.bill.tipCents = 1500;

    expect(resolveAdjustmentBalance(evidence)).toMatchObject({ totalCents: 15060, netPaidCents: 12800, principalDueCents: 2260, tipDueCents: 0, balanceDueCents: 2260 });
  });

  it.each(['reserved', 'open', 'processing', 'uncertain'] as const)('blocks new collection while a request is %s', (state) => {
    expect(resolveAdjustmentBalance(input({ requests: [request({ state })] })).canReservePayment).toBe(false);
  });

  it('requires resolution of stale payment requests after a second bill edit', () => {
    expect(resolveAdjustmentBalance(input({ requests: [request({ billRevision: 1 })] })).blockedReasons).toContain('PAYMENT_REQUEST_STALE');
  });

  it('never treats a paid request label as an actual payment', () => {
    expect(resolveAdjustmentBalance(input({ requests: [request({ state: 'paid' })] }))).toMatchObject({ netPaidCents: 10000, canReservePayment: false, blockedReasons: ['PAYMENT_CONFIRMATION_PENDING'] });
  });

  it('requires the exact recorded payment for a completed request', () => {
    expect(resolveAdjustmentBalance(input({ requests: [request({ state: 'paid' })], payments: [payment(), payment({ id: 'additional', requestId: 'request-one', movementId: 'second-charge', principalCents: 2000 })] }))).toMatchObject({ netPaidCents: 12000, balanceDueCents: 0, blockedReasons: [] });
  });

  it('shows held money separately instead of implying it was never received', () => {
    expect(resolveAdjustmentBalance(input({ payments: [payment({ state: 'under_review' })], refunds: [refund({ state: 'under_review' })] }))).toMatchObject({ netPaidCents: 0, underReviewPaymentCents: 10000, underReviewRefundCents: 2000, canReservePayment: false });
  });

  it('blocks all new money operations for unresolved provider evidence', () => {
    expect(resolveAdjustmentBalance(input({ payments: [payment({ state: 'under_review' })] }))).toMatchObject({ canReservePayment: false, canReserveRefund: false, blockedReasons: ['PAYMENT_UNDER_REVIEW'] });
  });

  it.each([Number.NaN, Infinity, -1, 1.5, 50_000_001])('rejects invalid money %s', (amount) => {
    const evidence = input();
    evidence.bill.serviceCents = amount;

    expect(() => resolveAdjustmentBalance(evidence)).toThrow('ADJUSTMENT_INVALID_EVIDENCE');
  });

  it('bounds sums as well as individual components', () => {
    const evidence = input();
    evidence.bill.serviceCents = 50000000;
    evidence.bill.taxCents = 1;

    expect(() => resolveAdjustmentBalance(evidence)).toThrow('ADJUSTMENT_AMOUNT_OUT_OF_RANGE');
  });
});

describe('payment adjustment permissions', () => {
  const actor = { role: 'staff' as const, hasAppointmentAccess: true, impersonating: false, canEditItems: true, canRecordPayment: true };

  it('allows staff requests while keeping refund execution owner-only', () => {
    expect(adjustmentPermissions(actor)).toMatchObject({ canAdjustBill: true, canRequestPayment: true, canRequestRefund: true, canIssueRefund: false });
    expect(adjustmentPermissions({ ...actor, role: 'owner' }).canIssueRefund).toBe(true);
    expect(adjustmentPermissions({ ...actor, role: 'admin' }).canIssueRefund).toBe(false);
  });

  it.each([{ hasAppointmentAccess: false }, { impersonating: true }])('denies every action without genuine access: %o', (override) => {
    expect(Object.values(adjustmentPermissions({ ...actor, ...override }))).toEqual([false, false, false, false, false, false]);
  });
});
