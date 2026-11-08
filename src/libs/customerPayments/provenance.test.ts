import { describe, expect, it } from 'vitest';

import { resolveAppointmentPaymentLedger } from '@/libs/appointmentPaymentLedger';

import { customerPaymentCompletionTip, customerPaymentTipFloor, hasVerifiedCustomerPaymentTender, isCustomerPaymentTender, verifyCustomerPaymentTender } from './provenance';

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
    const verified = verifyCustomerPaymentTender(row, capture);

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
    expect(() => verifyCustomerPaymentTender(row, { ...capture, ...patch } as never)).toThrow('PROVENANCE_RECONCILIATION');
  });

  it.each([{ reference: 'manual' }, { id: 'manual' }, { method: 'cash' }, { recordedByType: 'admin' }, { voidedAt: new Date() }])('rejects changed source %j', (patch) => {
    expect(() => verifyCustomerPaymentTender({ ...row, ...patch }, capture)).toThrow('PROVENANCE_RECONCILIATION');
    expect(hasVerifiedCustomerPaymentTender({ ...verifyCustomerPaymentTender(row, capture), ...patch })).toBe(false);
  });

  it('preserves omitted tip, rejects explicit reduction, and permits a higher tip', () => {
    const rows = [verifyCustomerPaymentTender(row, capture)];

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
