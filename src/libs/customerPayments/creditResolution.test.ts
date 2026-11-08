import { describe, expect, it } from 'vitest';

import { buildBookingTaxSnapshot, buildFinalTaxSnapshot, resolveTaxConfig } from '@/libs/taxConfig';
import type { CustomerPaymentCapture, CustomerPaymentRefund } from '@/models/customerPaymentSchema';
import type { Appointment, AppointmentPayment } from '@/models/Schema';

import type { CustomerPaymentCreditNote, CustomerPaymentCreditSource } from './creditResolution';
import { buildCustomerPaymentCreditBasis, projectResolvedCustomerPaymentCredit } from './creditResolution';

const capturedAt = new Date('2026-11-08T12:00:00Z');
const completedAt = new Date('2026-11-08T13:00:00Z');
const refundedAt = new Date('2026-11-08T14:00:00Z');
const id = '00000000-0000-4000-8000-000000000001';
function fixture(): CustomerPaymentCreditSource {
  const config = resolveTaxConfig({ payments: { tax: { enabled: true, name: 'HST', rateBps: 1300 } } }, capturedAt);
  const totals = { finalPriceCents: 10000, taxableSubtotalCents: 10000, taxAmountCents: 1300, taxApplied: true };
  const appointment = {
    id: 'appt',
    salonId: 'salon',
    status: 'completed',
    completedAt,
    deletedAt: null,
    totalPrice: 10000,
    finalPriceCents: 10000,
    finalSubtotalCents: null,
    finalDiscountCents: null,
    finalDiscountReason: null,
    taxableSubtotalCents: 10000,
    taxAmountCents: 1300,
    taxExempt: false,
    taxExemptReason: null,
    invoiceCurrency: 'CAD',
    taxEnabledSnapshot: true,
    taxNameSnapshot: 'HST',
    taxRateBps: 1300,
    taxInclusive: false,
    bookingTaxSnapshot: buildBookingTaxSnapshot({ taxConfig: config, totals, currency: 'CAD', capturedAt }),
    rescheduleTaxSnapshot: null,
    finalTaxSnapshot: buildFinalTaxSnapshot({ taxConfig: config, totals, currency: 'CAD', capturedAt: completedAt }),
    tipCents: 2000,
    amountPaidCents: 6800,
    paymentStatus: 'paid',
  } as Appointment;
  const capture: CustomerPaymentCapture = {
    id,
    salonId: 'salon',
    appointmentId: 'appt',
    quoteId: 'quote',
    stripeAccountId: 'acct_test',
    paymentIntentId: 'pi_test',
    tenderId: `cpay_${id}`,
    currency: 'cad',
    mode: 'test',
    source: 'synthetic_test',
    amountCents: 13300,
    principalCents: 11300,
    tipCents: 2000,
    applicationFeeCents: 100,
    quotedApplicationFeeCents: 100,
    state: 'posted',
    reviewReason: null,
    capturedAt,
    recordedAt: capturedAt,
    fingerprint: 'a'.repeat(64),
  };
  const payment = { id: capture.tenderId, salonId: 'salon', appointmentId: 'appt', amountCents: 13300, reference: `customer_payment_capture:${id}`, method: 'online', recordedByType: 'system', recordedAt: capturedAt, voidedAt: null } as AppointmentPayment;
  const refund: CustomerPaymentRefund = { id: 'refund-row', captureId: id, salonId: 'salon', appointmentId: 'appt', stripeAccountId: 'acct_test', paymentIntentId: 'pi_test', currency: 'cad', mode: 'test', source: 'synthetic_test', refundId: 're_test', amountCents: 6500, principalCents: 5500, tipCents: 1000, state: 'applied', reviewReason: null, occurredAt: refundedAt, recordedAt: refundedAt, fingerprint: 'b'.repeat(64) };
  return { appointment, captures: [capture], payments: [payment], deposits: [], refunds: [refund], feeBindings: [], feeRefunds: [] };
}
function note(source = fixture()): CustomerPaymentCreditNote {
  const basis = buildCustomerPaymentCreditBasis(source);
  return { id: 'decision1', salonId: basis.salonId, appointmentId: basis.appointmentId, captureId: basis.captureId, currency: 'CAD', scope: 'customer_refund_credit', basisVersion: 1, evidenceFingerprint: basis.evidenceFingerprint, serviceCreditCents: 5000, taxCreditCents: 500, tipCreditCents: 1000, previousDecisionId: null, deltaServiceCreditCents: 5000, deltaTaxCreditCents: 500, deltaTipCreditCents: 1000 };
}

describe('explicit immutable completed invoice credit projection', () => {
  it('separates gross invoice, explicit credit, reduced obligation and real cash without changing source', () => {
    const source = fixture();
    const before = structuredClone(source);
    const projected = projectResolvedCustomerPaymentCredit(source, note(source));

    expect(projected).toMatchObject({
      state: 'resolved',
      original: { serviceCents: 10000, taxCents: 1300, tipCents: 2000, totalCents: 13300 },
      credit: { serviceCents: 5000, taxCents: 500, tipCents: 1000, totalCents: 6500 },
      adjusted: { serviceCents: 5000, taxCents: 800, tipCents: 1000, totalCents: 6800 },
      actualNetTenderCents: 6800,
      collectibleBalanceCents: 0,
      ordinaryActionsBlocked: true,
    });
    expect(source).toEqual(before);
    expect(Object.isFrozen(projected.adjusted)).toBe(true);
  });

  it.each(['unfinalized', 'foreign', 'extra_capture', 'extra_tender', 'deposit', 'held', 'cache', 'tax', 'tip', 'comp'] as const)('fails closed for %s source', (change) => {
    const source = fixture();
    if (change === 'unfinalized') {
      source.appointment.status = 'confirmed';
    }
    if (change === 'foreign') {
      source.captures = [{ ...source.captures[0]!, salonId: 'foreign' }];
    }
    if (change === 'extra_capture') {
      source.captures = [...source.captures, source.captures[0]!];
    }
    if (change === 'extra_tender') {
      source.payments = [...source.payments, source.payments[0]!];
    }
    if (change === 'deposit') {
      source.deposits = [{} as never];
    }
    if (change === 'held') {
      source.refunds = [{ ...source.refunds[0]!, state: 'held_review', reviewReason: 'unallocated' }];
    }
    if (change === 'cache') {
      source.appointment.amountPaidCents = 13300;
    }
    if (change === 'tax') {
      source.appointment.taxRateBps = 500;
    }
    if (change === 'comp') {
      source.appointment.paymentStatus = 'comp';
    }
    if (change === 'tip') {
      source.appointment.tipCents = 3000;
    }

    expect(() => buildCustomerPaymentCreditBasis(source)).toThrow();
  });

  it('does not invalidate for notes/contact/updatedAt or transport metadata outside monetary source', () => {
    const source = fixture();
    const decision = note(source);
    source.appointment = { ...source.appointment, clientName: 'Changed name', clientPhone: '4165550199', techNotes: 'New note', updatedAt: new Date() };
    source.payments = [{ ...source.payments[0]!, note: 'New descriptive note' }];
    const withTransport = { ...source, transportReceipts: [{ eventId: 'new delivery' }] };

    expect(projectResolvedCustomerPaymentCredit(withTransport, decision).state).toBe('resolved');
  });

  it('stales the old decision for new customer cash and supports a monotonic replacement chain', () => {
    const source = fixture();
    const first = note(source);
    source.refunds = [...source.refunds, { ...source.refunds[0]!, id: 'refund2', refundId: 're_2', amountCents: 1000, principalCents: 1000, tipCents: 0, fingerprint: 'c'.repeat(64) }];
    source.appointment.amountPaidCents = 5800;

    expect(() => projectResolvedCustomerPaymentCredit(source, first)).toThrow();

    const next: CustomerPaymentCreditNote = { ...first, id: 'decision2', previousDecisionId: first.id, evidenceFingerprint: buildCustomerPaymentCreditBasis(source).evidenceFingerprint, serviceCreditCents: 6000, deltaServiceCreditCents: 1000, deltaTaxCreditCents: 0, deltaTipCreditCents: 0 };

    expect(projectResolvedCustomerPaymentCredit(source, next, [first])).toMatchObject({ actualNetTenderCents: 5800, collectibleBalanceCents: 0 });
    expect(() => projectResolvedCustomerPaymentCredit(source, next)).toThrow();
    expect(() => projectResolvedCustomerPaymentCredit(source, { ...next, deltaServiceCreditCents: 999 }, [first])).toThrow();
    expect(() => projectResolvedCustomerPaymentCredit(source, next, [first, first])).toThrow();
  });

  it('allows full and tip-only customer credits without inventing tender', () => {
    for (const full of [true, false]) {
      const source = fixture();
      source.refunds = [{ ...source.refunds[0]!, principalCents: full ? 11300 : 0, tipCents: 2000, amountCents: full ? 13300 : 2000 }];
      source.appointment.amountPaidCents = full ? 0 : 11300;
      const decision = { ...note(source), serviceCreditCents: full ? 10000 : 0, taxCreditCents: full ? 1300 : 0, tipCreditCents: 2000, deltaServiceCreditCents: full ? 10000 : 0, deltaTaxCreditCents: full ? 1300 : 0, deltaTipCreditCents: 2000 };

      expect(projectResolvedCustomerPaymentCredit(source, decision)).toMatchObject({ actualNetTenderCents: full ? 0 : 11300, collectibleBalanceCents: 0 });
    }
  });

  it.each([{ taxCreditCents: 1301, deltaTaxCreditCents: 1301 }, { serviceCreditCents: -1 }, { tipCreditCents: 0, deltaTipCreditCents: 0 }, { scope: 'fee_refund_credit' }, { evidenceFingerprint: '0'.repeat(64) }])('rejects unsupported allocation/binding %j', (patch) => {
    expect(() => projectResolvedCustomerPaymentCredit(fixture(), { ...note(), ...patch } as CustomerPaymentCreditNote)).toThrow();
  });

  it('validates fee facts separately without making fee returns customer credit or invalidating customer resolution', () => {
    const source = fixture();
    const decision = note(source);
    const common = { captureId: id, salonId: 'salon', appointmentId: 'appt', stripeAccountId: 'acct_test', paymentIntentId: 'pi_test', currency: 'cad' as const, mode: 'test' as const, source: 'synthetic_test' as const, occurredAt: refundedAt, recordedAt: refundedAt, fingerprint: 'd'.repeat(64) };
    source.feeBindings = [{ ...common, id: 'binding', applicationFeeId: 'fee_test', amountCents: 100 }];
    source.feeRefunds = [{ ...common, id: 'fee_refund', applicationFeeId: 'fee_test', feeRefundId: 'fr_test', bindingId: 'binding', amountCents: 100, state: 'applied', reviewReason: null }];

    expect(projectResolvedCustomerPaymentCredit(source, decision).state).toBe('resolved');

    source.feeRefunds = [{ ...source.feeRefunds[0]!, state: 'held_review', reviewReason: 'Fee allocation under review' }];

    expect(projectResolvedCustomerPaymentCredit(source, decision).state).toBe('resolved');
  });
});

it('binds all distinct customer receipts deterministically, not their load order', () => {
  const source = fixture();
  source.refunds = [
    { ...source.refunds[0]!, id: 'first', refundId: 're_first', amountCents: 3000, principalCents: 2500, tipCents: 500 },
    { ...source.refunds[0]!, id: 'second', refundId: 're_second', amountCents: 3500, principalCents: 3000, tipCents: 500 },
  ];
  const decision = note(source);
  source.refunds = [...source.refunds].reverse();

  expect(projectResolvedCustomerPaymentCredit(source, decision).state).toBe('resolved');

  source.refunds = [{ ...source.refunds[0]!, fingerprint: 'e'.repeat(64) }, source.refunds[1]!];

  expect(() => projectResolvedCustomerPaymentCredit(source, decision)).toThrow();

  source.refunds = [source.refunds[0]!, source.refunds[0]!];

  expect(() => buildCustomerPaymentCreditBasis(source)).toThrow();
});
