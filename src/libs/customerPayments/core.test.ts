import { describe, expect, it } from 'vitest';

import type { CustomerPaymentCheckoutInput } from './checkout';
import { buildCustomerPaymentCheckout } from './checkout';
import type { CustomerPaymentQuoteInput } from './money';
import { calculatePaymentSnapshot } from './money';
import { assertCustomerPaymentsRuntime, resolvePaymentChoice } from './policy';
import { calculateApplicationFeeRefund } from './refunds';

const quote: CustomerPaymentQuoteInput = {
  currency: 'cad',
  servicesCents: 10000,
  discountCents: 1000,
  taxCents: 1170,
  tipCents: 2000,
  collection: 'full',
};
const checkout: CustomerPaymentCheckoutInput = {
  runtime: { featureEnabled: true, deploymentEnvironment: 'test', stripeMode: 'test' },
  policy: { mode: 'optional_full', choice: 'online' },
  quote,
  stripeAccountId: 'acct_test123',
  idempotencyKey: 'attempt-1',
  referenceId: 'payment-1',
  successUrl: 'https://example.com/success',
  cancelUrl: 'https://example.com/cancel',
};

describe('customer payment runtime and policy', () => {
  it.each([{}, { featureEnabled: true }, { featureEnabled: true, deploymentEnvironment: 'production', stripeMode: 'test' }, { featureEnabled: true, deploymentEnvironment: 'preview', stripeMode: 'live' }, { featureEnabled: true, deploymentEnvironment: 'unknown', stripeMode: 'test' }, { featureEnabled: false, deploymentEnvironment: 'test', stripeMode: 'test' }])('fails closed for %j', (runtime) => {
    expect(() => assertCustomerPaymentsRuntime(runtime)).toThrow('CUSTOMER_PAYMENTS_DISABLED');
  });

  it.each(['development', 'preview', 'test'])('allows explicitly enabled test mode in %s', (deploymentEnvironment) => {
    expect(() => assertCustomerPaymentsRuntime({ featureEnabled: true, deploymentEnvironment, stripeMode: 'test' })).not.toThrow();
  });

  it('allows optional pay in person and full online', () => {
    expect(resolvePaymentChoice({ mode: 'optional_full', choice: 'in_person' })).toBe('offline');
    expect(resolvePaymentChoice({ mode: 'optional_full', choice: 'online' })).toBe('full');
    expect(resolvePaymentChoice({ mode: 'full_online_required', choice: 'online' })).toBe('full');
  });

  it('cannot bypass required deposit or mandatory online', () => {
    expect(() => resolvePaymentChoice({ mode: 'required_deposit', choice: 'in_person', requiredDepositCents: 2000 })).toThrow('DEPOSIT_REQUIRED');
    expect(() => resolvePaymentChoice({ mode: 'full_online_required', choice: 'in_person' })).toThrow('ONLINE_PAYMENT_REQUIRED');
    expect(() => resolvePaymentChoice({ mode: 'required_deposit', choice: 'online' })).toThrow('INVALID_REQUIRED_DEPOSIT');
    expect(resolvePaymentChoice({ mode: 'required_deposit', choice: 'online', requiredDepositCents: 2000 })).toBe('deposit');
    expect(() => resolvePaymentChoice({ mode: 'other' as never, choice: 'online' })).toThrow('INVALID_PAYMENT_POLICY');
  });
});

describe('server-authoritative cent snapshot', () => {
  it('separates tax, tip, customer fees, platform fee and balance deterministically', () => {
    const snapshot = calculatePaymentSnapshot(quote);

    expect(snapshot).toMatchObject({ version: 1, serviceTotalCents: 10170, totalCents: 12170, chargeCents: 12170, remainingCents: 0, applicationFeeCents: 100, customerPlatformFeeCents: 0, customerFeeTaxCents: 0, stripeProcessingFeePayer: 'account' });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot).toEqual(calculatePaymentSnapshot({ ...quote }));
    expect(calculatePaymentSnapshot({ ...quote, tipCents: 0 }).applicationFeeCents).toBe(100);
  });

  it('collects deposit plus tip and preserves outstanding service balance', () => {
    expect(calculatePaymentSnapshot({ ...quote, collection: 'deposit', depositCents: 2000 }))
      .toMatchObject({ chargeCents: 4000, remainingCents: 8170, applicationFeeCents: 100 });
  });

  it('never charges a fee offline or on comped services', () => {
    expect(calculatePaymentSnapshot({ ...quote, collection: 'offline' })).toMatchObject({ chargeCents: 0, remainingCents: 12170, applicationFeeCents: 0 });
    expect(calculatePaymentSnapshot({ ...quote, discountCents: 10000, taxCents: 0 })).toMatchObject({ chargeCents: 2000, applicationFeeCents: 0 });
    expect(calculatePaymentSnapshot({ ...quote, discountCents: 10000, taxCents: 0, tipCents: 0 })).toMatchObject({ chargeCents: 0, applicationFeeCents: 0 });
  });

  it.each([-1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('rejects invalid cents %s', (value) => {
    for (const field of ['servicesCents', 'discountCents', 'taxCents', 'tipCents']) {
      expect(() => calculatePaymentSnapshot({ ...quote, [field]: value })).toThrow('INVALID_CENTS');
    }
  });

  it('rejects overflow, invalid discounts, deposit amounts and tiny charges', () => {
    expect(() => calculatePaymentSnapshot({ ...quote, servicesCents: Number.MAX_SAFE_INTEGER })).toThrow('INVALID_CENTS');
    expect(() => calculatePaymentSnapshot({ ...quote, discountCents: 10001 })).toThrow('DISCOUNT_EXCEEDS_SERVICES');

    for (const depositCents of [undefined, 0, -1, 1.5, 20000]) {
      expect(() => calculatePaymentSnapshot({ ...quote, collection: 'deposit', depositCents })).toThrow();
    }

    expect(() => calculatePaymentSnapshot({ ...quote, depositCents: 1000 })).toThrow('UNEXPECTED_DEPOSIT_AMOUNT');

    for (const servicesCents of [1, 99, 100]) {
      expect(() => calculatePaymentSnapshot({ ...quote, servicesCents, discountCents: 0, taxCents: 0, tipCents: 0 })).toThrow('CHARGE_MUST_EXCEED_APPLICATION_FEE');
    }
  });

  it('supports a bounded configured fee, including zero', () => {
    for (const feeCents of [0, 50, 200]) {
      expect(calculatePaymentSnapshot({ ...quote, feePolicy: { payer: 'salon', feeCents, taxTreatment: 'not_collected_in_test_mode' } }).applicationFeeCents).toBe(feeCents);
    }
  });

  it('rejects unsupported surcharge, currency and tax configuration', () => {
    expect(() => calculatePaymentSnapshot({ ...quote, currency: 'usd' as never })).toThrow('UNSUPPORTED_PAYMENT_CONFIGURATION');

    for (const feePolicy of [
      { payer: 'customer', feeCents: 100, taxTreatment: 'not_collected_in_test_mode' },
      { payer: 'salon', feeCents: 100, taxTreatment: 'unknown' },
      { payer: 'salon', feeCents: 10001, taxTreatment: 'not_collected_in_test_mode' },
      { payer: 'salon', feeCents: 100, taxTreatment: 'not_collected_in_test_mode', refundPolicy: 'never' },
    ]) {
      expect(() => calculatePaymentSnapshot({ ...quote, feePolicy: feePolicy as never })).toThrow('UNSUPPORTED_FEE_POLICY');
    }
  });
});

describe('pure Checkout builder', () => {
  it('builds direct-charge card/Apple Pay eligible Checkout with only the Luster fee', () => {
    const result = buildCustomerPaymentCheckout(checkout);

    expect(result.params.payment_intent_data?.application_fee_amount).toBe(100);
    expect(result.params.payment_intent_data).not.toHaveProperty('transfer_data');
    expect(result.params.line_items?.[0]?.price_data?.unit_amount).toBe(12170);
    expect(result.params.payment_method_types).toEqual(['card']);
    expect(result.requestOptions).toEqual({ stripeAccount: 'acct_test123', idempotencyKey: 'attempt-1' });
  });

  it('omits the application fee for comped services and rejects zero-charge Checkout', () => {
    const compedQuote = { ...quote, discountCents: 10000, taxCents: 0 };

    expect(buildCustomerPaymentCheckout({ ...checkout, quote: compedQuote }).params.payment_intent_data).not.toHaveProperty('application_fee_amount');
    expect(() => buildCustomerPaymentCheckout({ ...checkout, quote: { ...compedQuote, tipCents: 0 } })).toThrow('NO_ONLINE_PAYMENT_DUE');
  });

  it('rejects production and pay-in-person before constructing Checkout', () => {
    expect(() => buildCustomerPaymentCheckout({ ...checkout, runtime: { ...checkout.runtime, deploymentEnvironment: 'production' } })).toThrow('CUSTOMER_PAYMENTS_DISABLED');
    expect(() => buildCustomerPaymentCheckout({ ...checkout, policy: { mode: 'optional_full', choice: 'in_person' } })).toThrow('NO_ONLINE_PAYMENT_DUE');
    expect(() => buildCustomerPaymentCheckout({ ...checkout, policy: { mode: 'required_deposit', choice: 'in_person', requiredDepositCents: 2000 } })).toThrow('DEPOSIT_REQUIRED');
  });

  it('uses policy deposit rather than browser collection overrides', () => {
    const result = buildCustomerPaymentCheckout({ ...checkout, policy: { mode: 'required_deposit', choice: 'online', requiredDepositCents: 2000 } });

    expect(result.snapshot.chargeCents).toBe(4000);
  });

  it('rejects invalid identities and insecure return URLs', () => {
    for (const patch of [{ stripeAccountId: '' }, { idempotencyKey: '' }, { referenceId: '' }, { successUrl: 'http://example.com' }, { cancelUrl: 'https://user:pass@example.com' }]) {
      expect(() => buildCustomerPaymentCheckout({ ...checkout, ...patch })).toThrow();
    }
  });
});

describe('cumulative proportional application fee refunds', () => {
  const base = { originalChargeCents: 300, originalApplicationFeeCents: 100, applicationFeeAlreadyRefundedCents: 0 };

  it('handles repeated partials and returns every cent on full refund', () => {
    let reversed = 0;
    for (let cumulative = 1; cumulative <= 300; cumulative++) {
      const result = calculateApplicationFeeRefund({ ...base, cumulativeChargeRefundedCents: cumulative, applicationFeeAlreadyRefundedCents: reversed });
      reversed += result.additionalFeeRefundCents;

      expect(calculateApplicationFeeRefund({ ...base, cumulativeChargeRefundedCents: cumulative, applicationFeeAlreadyRefundedCents: reversed }).additionalFeeRefundCents).toBe(0);
    }

    expect(reversed).toBe(100);
  });

  it('uses exact multiplication at safe integer boundaries', () => {
    expect(calculateApplicationFeeRefund({ originalChargeCents: Number.MAX_SAFE_INTEGER, originalApplicationFeeCents: 100, cumulativeChargeRefundedCents: Number.MAX_SAFE_INTEGER - 1, applicationFeeAlreadyRefundedCents: 0 }).targetFeeRefundCents).toBe(99);
  });

  it('handles zero fee or zero refund', () => {
    expect(calculateApplicationFeeRefund({ ...base, cumulativeChargeRefundedCents: 0 }).additionalFeeRefundCents).toBe(0);
    expect(calculateApplicationFeeRefund({ ...base, originalApplicationFeeCents: 0, cumulativeChargeRefundedCents: 300 }).additionalFeeRefundCents).toBe(0);
  });

  it('rejects impossible, over-refunded and stale cumulative totals', () => {
    for (const patch of [{ originalChargeCents: 0 }, { originalApplicationFeeCents: 300 }, { cumulativeChargeRefundedCents: 301 }, { applicationFeeAlreadyRefundedCents: 101 }, { applicationFeeAlreadyRefundedCents: 1 }, { cumulativeChargeRefundedCents: 0.5 }]) {
      expect(() => calculateApplicationFeeRefund({ ...base, cumulativeChargeRefundedCents: 0, ...patch })).toThrow();
    }
  });
});
