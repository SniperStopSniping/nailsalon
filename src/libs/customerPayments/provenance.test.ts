import { describe, expect, it } from 'vitest';

import { resolveAppointmentPaymentLedger, resolveAppointmentPaymentLedgerForReconciliation } from '@/libs/appointmentPaymentLedger';

import { customerPaymentCompletionTip, customerPaymentTenderSummary, customerPaymentTipFloor, hasVerifiedCustomerPaymentTender, isCustomerPaymentTender, verifyCustomerPaymentTender } from './provenance';

const id = '00000000-0000-4000-8000-000000000001';
const capture = { id, salonId: 's', appointmentId: 'a', amountCents: 12000, tipCents: 2000, state: 'posted' as const, mode: 'test' as const, synthetic: true as const };
const row = { id: `cpay_${id}`, reference: `customer_payment_capture:${id}`, salonId: 's', appointmentId: 'a', amountCents: 12000, method: 'online', recordedByType: 'system', voidedAt: null };
const ledger = { cachedAmountPaidCents: 12000, expectedSalonId: 's', appointmentStatus: 'confirmed', paymentStatus: 'pending' };

describe('reserved customer-payment tender provenance', () => {
  it('detects either prefix independently and never treats markers as manual tender', () => {
    expect(isCustomerPaymentTender({ id: 'cpay_broken' })).toBe(true);
    expect(isCustomerPaymentTender({ reference: 'customer_payment_capture:broken' })).toBe(true);
    expect(isCustomerPaymentTender({ id: 'ordinary', reference: 'bank transfer' })).toBe(false);
    expect(resolveAppointmentPaymentLedger({ ...ledger, paymentRows: [row] }).ok).toBe(false);
    expect(resolveAppointmentPaymentLedger({ ...ledger, cachedAmountPaidCents: 0, paymentRows: [{ ...row, voidedAt: new Date() }] }).ok).toBe(false);
  });

  it('credits only verified posted gross tender exactly once', () => {
    const verified = verifyCustomerPaymentTender(row, capture, []);

    expect(hasVerifiedCustomerPaymentTender(verified)).toBe(true);
    expect(resolveAppointmentPaymentLedger({ ...ledger, paymentRows: [verified] })).toMatchObject({ ok: true, ledgerPaymentsCents: 12000 });
    expect(JSON.stringify(verified)).not.toContain('tipCents');
    expect(hasVerifiedCustomerPaymentTender(JSON.parse(JSON.stringify(verified)))).toBe(false);
  });

  it.each([
    { state: 'held_review' },
    { mode: 'live' },
    { synthetic: false },
    { salonId: 'foreign' },
    { appointmentId: 'foreign' },
    { amountCents: 12001 },
    { tipCents: 12001 },
    { tipCents: -1 },
  ])('rejects invalid capture %j', (patch) => {
    expect(() => verifyCustomerPaymentTender(row, { ...capture, ...patch } as never, [])).toThrow('PROVENANCE_RECONCILIATION');
  });

  it.each([{ reference: 'manual' }, { id: 'manual' }, { method: 'cash' }, { recordedByType: 'admin' }, { voidedAt: new Date() }])('rejects changed source %j', (patch) => {
    expect(() => verifyCustomerPaymentTender({ ...row, ...patch }, capture, [])).toThrow('PROVENANCE_RECONCILIATION');
    expect(hasVerifiedCustomerPaymentTender({ ...verifyCustomerPaymentTender(row, capture, []), ...patch })).toBe(false);
  });

  it('preserves omitted tip, rejects explicit reduction, and permits a higher tip', () => {
    const rows = [verifyCustomerPaymentTender(row, capture, [])];

    expect(customerPaymentTipFloor(rows)).toBe(2000);
    expect(customerPaymentCompletionTip(rows, undefined, 2000)).toBe(2000);
    expect(customerPaymentCompletionTip(rows, undefined, 2500)).toBe(2500);
    expect(customerPaymentCompletionTip(rows, 3000, 2000)).toBe(3000);
    expect(() => customerPaymentCompletionTip(rows, 0, 2000)).toThrow('PREPAID_TIP_REQUIRED');
    expect(() => customerPaymentCompletionTip([row], undefined, 2000)).toThrow('PROVENANCE_RECONCILIATION');
  });

  it('leaves legacy zero-tip default and ordinary tender behavior unchanged', () => {
    const ordinary = { amountCents: 1000, voidedAt: null };

    expect(customerPaymentCompletionTip([ordinary], undefined, 2000)).toBe(0);
    expect(resolveAppointmentPaymentLedger({ ...ledger, cachedAmountPaidCents: 1000, paymentRows: [ordinary], expectedSalonId: undefined }).ok).toBe(true);
  });
});

describe('immutable refund provenance', () => {
  const base = { id: 'refund-row', refundId: 're_1', captureId: id, salonId: 's', appointmentId: 'a', state: 'applied' as const };

  it.each([
    { principalCents: 10000, tipCents: 2000 },
    { principalCents: 3000, tipCents: 500 },
    { principalCents: 0, tipCents: 1000 },
  ])('keeps gross immutable and blocks collection after %j', (allocation) => {
    const amountCents = allocation.principalCents + allocation.tipCents;
    const refunds = [{ ...base, ...allocation, amountCents }];
    const verified = verifyCustomerPaymentTender(row, capture, refunds);
    const net = 12000 - amountCents;

    expect(verified.amountCents).toBe(12000);
    expect(customerPaymentTenderSummary(verified)).toMatchObject({ grossCents: 12000, netCents: net, refundedCents: amountCents, collectionHold: true });
    expect(resolveAppointmentPaymentLedger({ ...ledger, cachedAmountPaidCents: net, paymentRows: [verified] }).ok).toBe(false);
    expect(resolveAppointmentPaymentLedgerForReconciliation({ ...ledger, cachedAmountPaidCents: net, paymentRows: [verified] })).toMatchObject({ ok: true, collectionHold: true, ledgerPaymentsCents: net });
    expect(() => customerPaymentCompletionTip([verified], undefined, 2000)).toThrow('REFUND_RECONCILIATION');
    expect(customerPaymentTenderSummary(verifyCustomerPaymentTender(row, capture, refunds))).toEqual(customerPaymentTenderSummary(verified));
    expect(() => verifyCustomerPaymentTender(row, capture, [...refunds, ...refunds])).toThrow('REFUND_RECONCILIATION');
  });

  it('holds review evidence without crediting an unproven refund allocation', () => {
    const verified = verifyCustomerPaymentTender(row, capture, [{ ...base, state: 'held_review', amountCents: 90000, principalCents: 0, tipCents: 0 }]);

    expect(customerPaymentTenderSummary(verified)).toMatchObject({ netCents: 12000, refundedCents: 0, collectionHold: true });
    expect(resolveAppointmentPaymentLedger({ ...ledger, paymentRows: [verified] }).ok).toBe(false);
  });

  it('rejects missing, foreign, oversized and inconsistent receipt evidence', () => {
    expect(() => verifyCustomerPaymentTender(row, capture, undefined as never)).toThrow('REFUND_EVIDENCE_REQUIRED');

    for (const patch of [{ salonId: 'foreign' }, { captureId: 'foreign' }, { amountCents: 1 }, { principalCents: 12000, amountCents: 12000 }, { tipCents: 2001, amountCents: 2001, principalCents: 0 }]) {
      expect(() => verifyCustomerPaymentTender(row, capture, [{ ...base, principalCents: 1000, tipCents: 0, amountCents: 1000, ...patch }])).toThrow('REFUND_RECONCILIATION');
    }
  });
});
