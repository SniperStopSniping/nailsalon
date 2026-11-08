import { describe, expect, it } from 'vitest';

import { projectCustomerPaymentRefundReport } from './refundReporting';

type Input = Parameters<typeof projectCustomerPaymentRefundReport>[0];
function fixture(): Input {
  const at = new Date('2026-10-01T12:00:00Z');
  const later = new Date('2026-10-02T12:00:00Z');
  const id = '11111111-1111-4111-8111-111111111111';
  const capture = { id, salonId: 'salon', appointmentId: 'appt', stripeAccountId: 'acct_fixture', paymentIntentId: 'pi_fixture', mode: 'test', source: 'synthetic_test', currency: 'cad', tenderId: `cpay_${id}`, amountCents: 12000, principalCents: 10000, tipCents: 2000, applicationFeeCents: 100, quotedApplicationFeeCents: 100, state: 'posted', reviewReason: null, capturedAt: at, recordedAt: at, quoteId: 'quote', fingerprint: 'capture' } as const;
  const identity = { captureId: id, salonId: 'salon', appointmentId: 'appt', stripeAccountId: 'acct_fixture', paymentIntentId: 'pi_fixture', currency: 'cad', mode: 'test', source: 'synthetic_test', occurredAt: later, recordedAt: later } as const;
  return { salonId: 'salon', currency: 'CAD', start: later, end: new Date(later.getTime() + 1000), captures: [capture], markers: [{ id: capture.tenderId, salonId: 'salon', appointmentId: 'appt', amountCents: 12000, method: 'online', reference: `customer_payment_capture:${id}`, recordedByType: 'system', recordedAt: at, voidedAt: null } as Input['markers'][number]], refunds: [{ ...identity, id: 'refund', refundId: 're_first', amountCents: 3000, principalCents: 2500, tipCents: 500, state: 'applied', reviewReason: null, fingerprint: 'refund' }], bindings: [{ ...identity, id: 'binding', applicationFeeId: 'fee_original', amountCents: 100, fingerprint: 'binding' }], feeRefunds: [{ ...identity, id: 'fee_refund', feeRefundId: 'fr_first', applicationFeeId: 'fee_original', bindingId: 'binding', amountCents: 25, state: 'applied', reviewReason: null, fingerprint: 'fee' }] };
}

describe('refund report evidence validation', () => {
  it('keeps customer and fee cash separate and original capture outside refund date', () => {
    expect(projectCustomerPaymentRefundReport(fixture())).toMatchObject({ refundedCents: 3000, feeRefundedCents: 25 });
  });

  it.each(['duplicate', 'foreign', 'missing_capture', 'missing_marker', 'bad_date', 'bad_fee_binding', 'unapplied_reason'] as const)('refuses %s evidence', (change) => {
    const f = fixture();
    if (change === 'duplicate') {
      f.refunds = [f.refunds[0]!, { ...f.refunds[0]!, id: 'second' }];
    }
    if (change === 'foreign') {
      f.refunds = [{ ...f.refunds[0]!, salonId: 'other' }];
    }
    if (change === 'missing_capture') {
      f.captures = [];
    }
    if (change === 'missing_marker') {
      f.markers = [];
    }
    if (change === 'bad_date') {
      f.refunds = [{ ...f.refunds[0]!, occurredAt: f.end }];
    }
    if (change === 'bad_fee_binding') {
      f.feeRefunds = [{ ...f.feeRefunds[0]!, bindingId: 'missing' }];
    }
    if (change === 'unapplied_reason') {
      f.refunds = [{ ...f.refunds[0]!, state: 'held_review', reviewReason: null }];
    }

    expect(() => projectCustomerPaymentRefundReport(f)).toThrow('REPORTING_RECONCILIATION_REQUIRED');
  });

  it('rejects collectively excessive applied allocations within a reporting period', () => {
    const f = fixture();
    f.refunds = Array.from({ length: 5 }, (_, i) => ({ ...f.refunds[0]!, id: `refund_${i}`, refundId: `re_${i}` }));

    expect(() => projectCustomerPaymentRefundReport(f)).toThrow('REPORTING_RECONCILIATION_REQUIRED');
  });

  it('allows shared internal IDs across distinct movement tables, but not duplicate external movements', () => {
    const f = fixture();
    f.feeRefunds = [{ ...f.feeRefunds[0]!, id: f.refunds[0]!.id }];

    expect(projectCustomerPaymentRefundReport(f)).toMatchObject({ refundedCents: 3000, feeRefundedCents: 25 });
  });
});
